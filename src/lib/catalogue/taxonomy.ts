import { z } from "zod";
import type { Product } from "./schema";
import { AssetUrlSchema } from "./schema";

/**
 * Editable lists used to describe panels: brands, categories (collections), boards, finishes,
 * colour groups and sheet sizes.
 *
 * Products keep plain text values (brand: "Kastamonu"), so the bundled brand files stay valid
 * as they are. A list entry is matched to products by its name (or, for sizes, its dimensions)
 * and adds what the files cannot hold: a description, a logo or image, a display order, and an
 * on/off switch. Switching an entry off hides every panel that uses it from the studio.
 *
 * Values used by products but never edited still appear in the lists ("from the data").
 */
export const TAXONOMY_KINDS = ["brand", "category", "board", "finish", "colourFamily", "size"] as const;
export type TaxonomyKind = (typeof TAXONOMY_KINDS)[number];
export type TextTaxonomyKind = Exclude<TaxonomyKind, "size">;

export const TAXONOMY_LABELS: Record<TaxonomyKind, { one: string; many: string }> = {
  brand: { one: "Brand", many: "Brands" },
  category: { one: "Category", many: "Categories" },
  board: { one: "Board", many: "Boards" },
  finish: { one: "Finish", many: "Finishes" },
  colourFamily: { one: "Colour group", many: "Colour groups" },
  size: { one: "Sheet size", many: "Sheet sizes" },
};

/** Product field each text list describes. */
export const TAXONOMY_FIELD: Record<TextTaxonomyKind, "brand" | "category" | "board" | "finish" | "colourFamily"> = {
  brand: "brand",
  category: "category",
  board: "board",
  finish: "finish",
  colourFamily: "colourFamily",
};

const mm = z.number().positive().max(10000);

export const TaxonomyItemSchema = z.object({
  kind: z.enum(TAXONOMY_KINDS),
  name: z.string().trim().min(1, "name is required").max(60),
  description: z.string().trim().max(500).optional(),
  imageUrl: AssetUrlSchema.optional(),
  /** Lower comes first in the studio's filter lists. Unset entries follow, A to Z. */
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().default(true),
  /** Sizes only. */
  widthMm: mm.optional(),
  heightMm: mm.optional(),
  thicknessMm: z.number().positive().max(200).optional(),
  updatedAt: z.string().optional(),
});
export type TaxonomyItem = z.infer<typeof TaxonomyItemSchema>;
export type TaxonomyItemInput = z.input<typeof TaxonomyItemSchema>;

export const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

type Dims = { widthMm?: number; heightMm?: number; thicknessMm?: number };
const n = (v?: number) => (v === undefined ? "-" : String(v));
export const sizeId = (d: Dims) => `${n(d.widthMm)}x${n(d.heightMm)}x${n(d.thicknessMm)}`;
export const sizeName = (d: Dims) =>
  [d.widthMm && d.heightMm ? `${d.widthMm} × ${d.heightMm} mm` : d.widthMm ? `${d.widthMm} mm wide` : d.heightMm ? `${d.heightMm} mm long` : "", d.thicknessMm ? `${d.thicknessMm} mm thick` : ""]
    .filter(Boolean)
    .join(", ") || "No size given";

/** Stable id of a list entry: the slug of its name, or the dimensions for a size. */
export function taxonomyId(item: Pick<TaxonomyItem, "kind" | "name"> & Dims): string {
  return item.kind === "size" ? sizeId(item) : slugify(item.name);
}

/** The value (or size id) of a list kind on a product, if any. */
export function productTaxonomyId(p: Product, kind: TaxonomyKind): string | undefined {
  if (kind === "size") return p.widthMm || p.heightMm || p.thicknessMm ? sizeId(p) : undefined;
  const v = p[TAXONOMY_FIELD[kind]];
  return v ? slugify(v) : undefined;
}

export interface TaxonomyEntry extends TaxonomyItem {
  id: string;
  /** Products (any status, deleted ones excluded) that use this entry. */
  productCount: number;
  /** True when the entry has been edited or added in the admin (stored), false when only seen in the data. */
  stored: boolean;
}

/** Combines stored list entries with the values products actually use. */
export function buildTaxonomy(products: Product[], stored: TaxonomyItem[]): Record<TaxonomyKind, TaxonomyEntry[]> {
  const out = {} as Record<TaxonomyKind, TaxonomyEntry[]>;
  for (const kind of TAXONOMY_KINDS) {
    const map = new Map<string, TaxonomyEntry>();
    for (const s of stored.filter((s) => s.kind === kind)) map.set(taxonomyId(s), { ...s, id: taxonomyId(s), productCount: 0, stored: true });
    for (const p of products) {
      const id = productTaxonomyId(p, kind);
      if (!id) continue;
      let e = map.get(id);
      if (!e) {
        e =
          kind === "size"
            ? { kind, id, name: sizeName(p), widthMm: p.widthMm, heightMm: p.heightMm, thicknessMm: p.thicknessMm, isActive: true, productCount: 0, stored: false }
            : { kind, id, name: p[TAXONOMY_FIELD[kind]]!, isActive: true, productCount: 0, stored: false };
        map.set(id, e);
      }
      e.productCount++;
    }
    out[kind] = [...map.values()].sort(compareEntries);
  }
  return out;
}

export function compareEntries(a: Pick<TaxonomyItem, "sortOrder" | "name">, b: Pick<TaxonomyItem, "sortOrder" | "name">): number {
  const sa = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const sb = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  return sa - sb || a.name.localeCompare(b.name, undefined, { numeric: true });
}

/** Ids of switched-off entries per kind. */
export function hiddenTaxonomy(stored: TaxonomyItem[]): Map<TaxonomyKind, Set<string>> {
  const m = new Map<TaxonomyKind, Set<string>>();
  for (const s of stored) {
    if (s.isActive !== false) continue;
    if (!m.has(s.kind)) m.set(s.kind, new Set());
    m.get(s.kind)!.add(taxonomyId(s));
  }
  return m;
}

/** True when a product may be shown in the studio: published, active, and no list entry it uses is switched off. */
export function isVisible(p: Product, hidden: Map<TaxonomyKind, Set<string>>): boolean {
  if (!p.isPublished || !p.isActive) return false;
  for (const [kind, ids] of hidden) {
    const id = productTaxonomyId(p, kind);
    if (id && ids.has(id)) return false;
  }
  return true;
}

/** Returns the product with a list value replaced, or null when it does not use `fromId`. */
export function replaceTaxonomyValue(p: Product, kind: TaxonomyKind, fromId: string, to: TaxonomyItem): Product | null {
  if (productTaxonomyId(p, kind) !== fromId) return null;
  if (kind === "size") return { ...p, widthMm: to.widthMm, heightMm: to.heightMm, thicknessMm: to.thicknessMm };
  return { ...p, [TAXONOMY_FIELD[kind]]: to.name };
}
