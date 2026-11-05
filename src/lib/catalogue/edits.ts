import type { Product } from "./schema";
import { codeKey } from "./schema";

/**
 * Admin edits to panels, layered over the brand files that are deployed with the site.
 *
 * Each edit is keyed by product id and holds either the full edited product or a deletion.
 * The brand files themselves are never changed, so a new brand import can be deployed at any
 * time without losing what was edited here, and "Restore original" simply removes the edit.
 */
export interface ProductEdit {
  id: string;
  /** The full product as edited, or null when the product was deleted. */
  product: Product | null;
  updatedAt: string;
}

export type ProductOrigin = "file" | "edited" | "added" | "deleted";

export interface AdminProduct extends Product {
  origin: ProductOrigin;
}

export interface MergeResult {
  /** Every product after edits, deleted ones removed. */
  products: Product[];
  /** Every product including deleted originals, with where it came from. */
  admin: AdminProduct[];
  /** Edits that could not be applied (e.g. a panel code now used by another product). */
  conflicts: { id: string; message: string }[];
}

export function mergeProductEdits(base: Product[], edits: ProductEdit[]): MergeResult {
  const byId = new Map(edits.map((e) => [e.id, e]));
  const admin: AdminProduct[] = [];
  const conflicts: MergeResult["conflicts"] = [];
  const baseIds = new Set<string>();
  for (const p of base) {
    baseIds.add(p.id);
    const e = byId.get(p.id);
    if (!e) admin.push({ ...p, origin: "file" });
    else if (e.product === null) admin.push({ ...p, origin: "deleted" });
    else admin.push({ ...e.product, id: p.id, origin: "edited" });
  }
  for (const e of edits) {
    if (baseIds.has(e.id) || !e.product) continue;
    admin.push({ ...e.product, id: e.id, origin: "added" });
  }
  // A panel code may only appear once among live products. Edits lose to the brand file.
  const seen = new Map<string, string>();
  const live: AdminProduct[] = [];
  for (const p of [...admin].sort((a, b) => rank(a.origin) - rank(b.origin))) {
    if (p.origin === "deleted") continue;
    const key = codeKey(p.panelCode);
    const owner = seen.get(key);
    if (owner) {
      conflicts.push({ id: p.id, message: `panel code ${p.panelCode} is already used by ${owner}; this edit is ignored` });
      continue;
    }
    seen.set(key, p.id);
    live.push(p);
  }
  return { products: live.map(stripOrigin), admin, conflicts };
}

export const stripOrigin = (p: AdminProduct): Product => {
  const { origin: _origin, ...rest } = p;
  return rest;
};

const rank = (o: ProductOrigin) => (o === "file" ? 0 : o === "edited" ? 1 : 2);

/** Id for a new panel, in the same form as the brand importer: "<brand-slug>-<panel code>". */
export function newProductId(brand: string | undefined, panelCode: string): string {
  const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [brand ? slug(brand) : "panel", slug(panelCode)].filter(Boolean).join("-").slice(0, 80);
}
