import "server-only";
import { mergeProductEdits, newProductId, type AdminProduct, type ProductEdit } from "@/lib/catalogue/edits";
import { codeKey, ProductSchema, type Product } from "@/lib/catalogue/schema";
import {
  buildTaxonomy,
  hiddenTaxonomy,
  isVisible,
  replaceTaxonomyValue,
  taxonomyId,
  TaxonomyItemSchema,
  TAXONOMY_KINDS,
  type TaxonomyEntry,
  type TaxonomyItem,
  type TaxonomyKind,
} from "@/lib/catalogue/taxonomy";
import { validateCatalogueRecords, type ValidationReport } from "@/lib/catalogue/validate";
import { loadCatalogue } from "./catalogueRepository";
import { getCatalogueStore, type StoreRow } from "./catalogueStore";

/**
 * The catalogue the site actually serves: the deployed brand files (and any older admin file
 * imports), with the admin's edits from the catalogue store applied on top.
 *
 * Reads are cached for a few seconds. A change made on this server clears the cache at once;
 * other server instances (serverless) pick it up within CACHE_MS.
 */
const CACHE_MS = 10_000;

export interface LiveCatalogue {
  /** Every live product (deleted ones removed), any publish status. */
  products: Product[];
  /** Products the studio may show. */
  visible: Product[];
  /** Products with their origin, including deleted originals. For the admin only. */
  admin: AdminProduct[];
  taxonomy: Record<TaxonomyKind, TaxonomyEntry[]>;
  storedTaxonomy: TaxonomyItem[];
  edits: ProductEdit[];
  conflicts: { id: string; message: string }[];
  isDemo: boolean;
  baseIds: Set<string>;
}

let cache: { at: number; base: unknown; value: LiveCatalogue } | null = null;
export const invalidateLiveCatalogue = () => {
  cache = null;
};

function parseRows(rows: StoreRow[]) {
  const edits: ProductEdit[] = [];
  const taxonomy: TaxonomyItem[] = [];
  for (const r of rows) {
    if (r.kind === "product") {
      const d = r.data as { product?: unknown };
      if (d?.product === null) edits.push({ id: r.id, product: null, updatedAt: r.updatedAt });
      else {
        const p = ProductSchema.safeParse(d?.product);
        if (p.success) edits.push({ id: r.id, product: { ...p.data, id: r.id }, updatedAt: r.updatedAt });
        else console.warn(`[catalogue] stored edit for ${r.id} is not a valid product and is ignored`);
      }
    } else if ((TAXONOMY_KINDS as readonly string[]).includes(r.kind)) {
      const t = TaxonomyItemSchema.safeParse(r.data);
      if (t.success) taxonomy.push(t.data);
    }
  }
  return { edits, taxonomy };
}

/**
 * `fresh: true` always reads the store: the admin and every change use it, so they never act on
 * (or show) data another server instance has since changed. The studio uses the short cache.
 */
export async function loadLiveCatalogue({ fresh = false }: { fresh?: boolean } = {}): Promise<LiveCatalogue> {
  const base = await loadCatalogue();
  if (!fresh && cache && cache.base === base && Date.now() - cache.at < CACHE_MS) return cache.value;
  const { edits, taxonomy: storedTaxonomy } = parseRows(await getCatalogueStore().list());
  const merged = mergeProductEdits(base.products, edits);
  if (merged.conflicts.length) console.warn("[catalogue] edits not applied:", merged.conflicts.slice(0, 10));
  const hidden = hiddenTaxonomy(storedTaxonomy);
  const value: LiveCatalogue = {
    products: merged.products,
    visible: merged.products.filter((p) => isVisible(p, hidden)),
    admin: merged.admin,
    taxonomy: buildTaxonomy(merged.products, storedTaxonomy),
    storedTaxonomy,
    edits,
    conflicts: merged.conflicts,
    isDemo: merged.products.length > 0 && merged.products.every((p) => p.isDemo),
    baseIds: new Set(base.products.map((p) => p.id)),
  };
  cache = { at: Date.now(), base, value };
  return value;
}

/** Same as loadLiveCatalogue, but if the edits store cannot be read the site still works from the brand files. */
export async function loadPublicCatalogue(): Promise<{ products: Product[]; all: Product[]; isDemo: boolean; taxonomy?: LiveCatalogue["taxonomy"] }> {
  try {
    const live = await loadLiveCatalogue({ fresh: true });
    return { products: live.visible, all: live.products, isDemo: live.isDemo, taxonomy: live.taxonomy };
  } catch (err) {
    console.error("[catalogue] admin edits could not be loaded; serving the brand files only", err);
    const base = await loadCatalogue();
    const visible = base.products.filter((p) => p.isActive && p.isPublished);
    return { products: visible, all: base.products, isDemo: base.isDemo };
  }
}

export class CatalogueEditError extends Error {
  constructor(message: string, readonly status = 422, readonly details?: ValidationReport["errors"]) {
    super(message);
  }
}

const now = () => new Date().toISOString();
const productRow = (id: string, product: Product | null): StoreRow => ({ kind: "product", id, data: { product }, updatedAt: now() });

/** Checks one product against the schema and the rest of the live catalogue. */
function checkProduct(live: LiveCatalogue, raw: unknown, existingId?: string): Product {
  const others = live.products.filter((p) => p.id !== existingId);
  const report = validateCatalogueRecords([raw], { existing: others });
  if (report.errors.length) {
    const first = report.errors[0]!;
    throw new CatalogueEditError(`${first.field ? `${first.field}: ` : ""}${first.message}`, 422, report.errors);
  }
  return { ...report.valid[0]!, updatedAt: now() };
}

export async function createProduct(input: Record<string, unknown>): Promise<Product> {
  const live = await loadLiveCatalogue({ fresh: true });
  const code = typeof input.panelCode === "string" ? input.panelCode : "";
  let id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : newProductId(typeof input.brand === "string" ? input.brand : undefined, code);
  if (live.admin.some((p) => p.id === id)) {
    if (typeof input.id === "string" && input.id.trim()) throw new CatalogueEditError(`id "${id}" is already used`);
    let n = 2;
    while (live.admin.some((p) => p.id === `${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  const product = checkProduct(live, { isActive: true, isPublished: true, isDemo: false, ...input, id });
  await getCatalogueStore().put([productRow(id, product)]);
  invalidateLiveCatalogue();
  return product;
}

export async function updateProduct(id: string, input: Record<string, unknown>): Promise<Product> {
  const live = await loadLiveCatalogue({ fresh: true });
  const current = live.admin.find((p) => p.id === id);
  if (!current) throw new CatalogueEditError("Panel not found.", 404);
  const product = checkProduct(live, { ...input, id }, id);
  await getCatalogueStore().put([productRow(id, product)]);
  invalidateLiveCatalogue();
  return product;
}

/** Deletes a panel. A panel from a brand file is hidden (it can be restored); an added panel is removed. */
export async function deleteProducts(ids: string[]): Promise<number> {
  const live = await loadLiveCatalogue({ fresh: true });
  const put: StoreRow[] = [];
  const remove: { kind: string; id: string }[] = [];
  for (const id of ids) {
    if (live.baseIds.has(id)) put.push(productRow(id, null));
    else if (live.edits.some((e) => e.id === id)) remove.push({ kind: "product", id });
  }
  if (put.length) await getCatalogueStore().put(put);
  if (remove.length) await getCatalogueStore().remove(remove);
  invalidateLiveCatalogue();
  return put.length + remove.length;
}

/** Removes the admin's edit so a panel from a brand file goes back to what the file says. */
export async function restoreProducts(ids: string[]): Promise<number> {
  const live = await loadLiveCatalogue({ fresh: true });
  const keys = ids.filter((id) => live.baseIds.has(id) && live.edits.some((e) => e.id === id)).map((id) => ({ kind: "product", id }));
  if (keys.length) await getCatalogueStore().remove(keys);
  invalidateLiveCatalogue();
  return keys.length;
}

/** Applies the same field changes to many panels (e.g. publish, change category). Every result is validated first. */
export async function bulkUpdateProducts(ids: string[], patch: Record<string, unknown>): Promise<number> {
  if ("panelCode" in patch || "id" in patch) throw new CatalogueEditError("Panel codes and ids cannot be changed in bulk.");
  const live = await loadLiveCatalogue({ fresh: true });
  const unset = Object.entries(patch).filter(([, v]) => v === null).map(([k]) => k);
  const rows: StoreRow[] = [];
  for (const id of ids) {
    const p = live.products.find((x) => x.id === id);
    if (!p) continue;
    const next: Record<string, unknown> = { ...p, ...patch };
    for (const k of unset) delete next[k];
    const parsed = ProductSchema.safeParse(next);
    if (!parsed.success) throw new CatalogueEditError(`${p.panelCode}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    rows.push(productRow(id, { ...parsed.data, updatedAt: now() }));
  }
  if (rows.length) await getCatalogueStore().put(rows);
  invalidateLiveCatalogue();
  return rows.length;
}

/**
 * Imports panels from a spreadsheet into the edits store. New codes are added; codes that
 * already exist are updated only when `updateExisting` is set. Nothing is saved if any row has an error.
 */
export async function importProducts(records: unknown[], { updateExisting, dryRun }: { updateExisting: boolean; dryRun: boolean }) {
  const live = await loadLiveCatalogue({ fresh: true });
  const byCode = new Map(live.products.map((p) => [codeKey(p.panelCode), p]));
  // Keep the existing product's id for codes that are already in the catalogue, and fill in ids for new rows.
  const prepared = records.map((r) => {
    if (!r || typeof r !== "object") return r;
    const rec = { ...(r as Record<string, unknown>) };
    const code = typeof rec.panelCode === "string" ? rec.panelCode : "";
    const existing = code ? byCode.get(codeKey(code)) : undefined;
    if (existing) rec.id = existing.id;
    else if (!rec.id && code) rec.id = newProductId(typeof rec.brand === "string" ? rec.brand : undefined, code);
    rec.isActive ??= true;
    rec.isPublished ??= true;
    return rec;
  });
  const report = validateCatalogueRecords(prepared, { existing: live.products, allowUpdateOfExisting: updateExisting });
  const added = report.valid.filter((p) => !byCode.has(codeKey(p.panelCode))).length;
  const updated = report.valid.length - added;
  if (!dryRun && report.errors.length === 0 && report.valid.length) {
    await getCatalogueStore().put(report.valid.map((p) => productRow(p.id, { ...p, updatedAt: now() })));
    invalidateLiveCatalogue();
  }
  return { report, added, updated, saved: !dryRun && report.errors.length === 0 && report.valid.length > 0 };
}

// ---------- lists (brands, categories, sizes...) ----------

/**
 * Creates or edits a list entry. When `previousId` is given and the name (or size) changed,
 * every panel that used the old value is updated to the new one.
 */
export async function saveTaxonomy(input: unknown, previousId?: string): Promise<{ item: TaxonomyItem; productsUpdated: number }> {
  const parsed = TaxonomyItemSchema.safeParse(input);
  if (!parsed.success) throw new CatalogueEditError(`${parsed.error.issues[0]?.path.join(".") || "entry"}: ${parsed.error.issues[0]?.message}`);
  const item: TaxonomyItem = { ...parsed.data, updatedAt: now() };
  if (item.kind === "size" && !item.widthMm && !item.heightMm && !item.thicknessMm) throw new CatalogueEditError("Give a width, length or thickness.");
  const id = taxonomyId(item);
  if (!id) throw new CatalogueEditError("Use letters or numbers in the name.");
  const live = await loadLiveCatalogue({ fresh: true });
  const list = live.taxonomy[item.kind];
  if (id !== previousId && list.some((e) => e.id === id)) throw new CatalogueEditError(`"${item.name}" already exists. Edit that entry, or use "Merge into" to combine them.`, 409);
  if (previousId && !list.some((e) => e.id === previousId)) throw new CatalogueEditError("Entry not found.", 404);

  const rows: StoreRow[] = [{ kind: item.kind, id, data: item, updatedAt: item.updatedAt! }];
  if (previousId) rows.push(...cascade(live, item.kind, previousId, item));
  const store = getCatalogueStore();
  await store.put(rows);
  if (previousId && previousId !== id) await store.remove([{ kind: item.kind, id: previousId }]);
  invalidateLiveCatalogue();
  return { item, productsUpdated: rows.length - 1 };
}

function cascade(live: LiveCatalogue, kind: TaxonomyKind, fromId: string, to: TaxonomyItem): StoreRow[] {
  const rows: StoreRow[] = [];
  for (const p of live.products) {
    const next = replaceTaxonomyValue(p, kind, fromId, to);
    if (!next) continue;
    if (JSON.stringify(next) === JSON.stringify(p)) continue;
    rows.push(productRow(p.id, { ...next, updatedAt: now() }));
  }
  return rows;
}

/**
 * Deletes a list entry. If panels still use it they must be moved to another entry
 * (`mergeInto`), otherwise the delete is refused.
 */
export async function deleteTaxonomy(kind: TaxonomyKind, id: string, mergeInto?: string): Promise<{ productsUpdated: number }> {
  const live = await loadLiveCatalogue({ fresh: true });
  const entry = live.taxonomy[kind].find((e) => e.id === id);
  if (!entry) throw new CatalogueEditError("Entry not found.", 404);
  let rows: StoreRow[] = [];
  if (entry.productCount > 0) {
    const target = mergeInto ? live.taxonomy[kind].find((e) => e.id === mergeInto) : undefined;
    if (!target || target.id === id)
      throw new CatalogueEditError(`${entry.productCount} panel(s) still use "${entry.name}". Choose another entry to move them to, or change those panels first.`, 409);
    rows = cascade(live, kind, id, target);
  }
  const store = getCatalogueStore();
  if (rows.length) await store.put(rows);
  if (entry.stored) await store.remove([{ kind, id }]);
  invalidateLiveCatalogue();
  return { productsUpdated: rows.length };
}

/** Saves the display order of a list (ids in the order wanted). Entries not yet stored are stored. */
export async function reorderTaxonomy(kind: TaxonomyKind, ids: string[]): Promise<void> {
  const live = await loadLiveCatalogue({ fresh: true });
  const list = live.taxonomy[kind];
  const rows: StoreRow[] = [];
  ids.forEach((id, i) => {
    const e = list.find((x) => x.id === id);
    if (!e) return;
    const { id: _id, productCount: _c, stored: _s, ...item } = e;
    rows.push({ kind, id, data: { ...item, sortOrder: (i + 1) * 10, updatedAt: now() }, updatedAt: now() });
  });
  if (rows.length) await getCatalogueStore().put(rows);
  invalidateLiveCatalogue();
}
