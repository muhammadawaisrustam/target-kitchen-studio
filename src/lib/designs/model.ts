import { z } from "zod";
import { REGION_IDS, type RegionId } from "@/lib/models/regions";
import type { CameraState } from "@/lib/models/types";

/**
 * Saved designs and their variants.
 * A design is a named project (e.g. "Villa 12 kitchen"); each variant is one complete set of
 * panel choices for a kitchen layout. Everything here is pure so it can be unit tested.
 */

export type Selections = Partial<Record<RegionId, string>>;

const CodeSchema = z.string().trim().min(1).max(40);
export const SelectionsSchema = z
  .record(z.string(), CodeSchema)
  .transform((rec) => Object.fromEntries(Object.entries(rec).filter(([k]) => (REGION_IDS as readonly string[]).includes(k))) as Selections);

const finite = z.number().finite();
export const CameraSchema = z.object({
  alpha: finite,
  beta: finite.min(0).max(Math.PI),
  radius: finite.positive().max(100),
  target: z.tuple([finite, finite, finite]),
});

export const VariantSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  modelId: z.string().min(1).max(60),
  selections: SelectionsSchema,
  camera: CameraSchema.optional(),
  updatedAt: z.string(),
});
export type DesignVariant = z.infer<typeof VariantSchema>;

export const DesignSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  createdAt: z.string(),
  updatedAt: z.string(),
  activeVariantId: z.string(),
  variants: z.array(VariantSchema).min(1).max(20),
});
export type SavedDesign = z.infer<typeof DesignSchema>;

export const MAX_VARIANTS = 20;
export const MAX_DESIGNS = 100;

export interface DesignSnapshot {
  modelId: string;
  selections: Selections;
  camera?: CameraState;
}

export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** "Variant A", "Variant B", … skipping names already used. */
export function nextVariantName(design: Pick<SavedDesign, "variants"> | undefined): string {
  const used = new Set(design?.variants.map((v) => v.name.toLowerCase()) ?? []);
  for (let i = 0; i < 26 * 4; i++) {
    const label = `Variant ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) + 1 : ""}`;
    if (!used.has(label.toLowerCase())) return label;
  }
  return `Variant ${used.size + 1}`;
}

const cleanSelections = (s: Selections): Selections =>
  Object.fromEntries(Object.entries(s).filter(([, c]) => typeof c === "string" && c.length > 0)) as Selections;

export function makeVariant(name: string, snap: DesignSnapshot, now = new Date().toISOString()): DesignVariant {
  return { id: newId("v"), name: name.trim() || "Variant A", modelId: snap.modelId, selections: cleanSelections(snap.selections), camera: snap.camera, updatedAt: now };
}

export function createDesign(name: string, snap: DesignSnapshot, variantName = "Variant A", now = new Date().toISOString()): SavedDesign {
  const variant = makeVariant(variantName, snap, now);
  return { id: newId("d"), name: name.trim() || "Untitled design", createdAt: now, updatedAt: now, activeVariantId: variant.id, variants: [variant] };
}

export function updateVariant(design: SavedDesign, variantId: string, snap: DesignSnapshot, now = new Date().toISOString()): SavedDesign {
  return {
    ...design,
    updatedAt: now,
    activeVariantId: variantId,
    variants: design.variants.map((v) =>
      v.id === variantId ? { ...v, modelId: snap.modelId, selections: cleanSelections(snap.selections), camera: snap.camera, updatedAt: now } : v,
    ),
  };
}

export function addVariant(design: SavedDesign, snap: DesignSnapshot, name?: string, now = new Date().toISOString()): SavedDesign {
  if (design.variants.length >= MAX_VARIANTS) throw new Error(`A design can have at most ${MAX_VARIANTS} variants.`);
  const variant = makeVariant(name?.trim() || nextVariantName(design), snap, now);
  return { ...design, updatedAt: now, activeVariantId: variant.id, variants: [...design.variants, variant] };
}

export function renameDesign(design: SavedDesign, name: string, now = new Date().toISOString()): SavedDesign {
  const n = name.trim();
  if (!n) throw new Error("Design name cannot be empty.");
  return { ...design, name: n.slice(0, 80), updatedAt: now };
}

export function renameVariant(design: SavedDesign, variantId: string, name: string, now = new Date().toISOString()): SavedDesign {
  const n = name.trim();
  if (!n) throw new Error("Variant name cannot be empty.");
  return { ...design, updatedAt: now, variants: design.variants.map((v) => (v.id === variantId ? { ...v, name: n.slice(0, 60) } : v)) };
}

export function deleteVariant(design: SavedDesign, variantId: string, now = new Date().toISOString()): SavedDesign {
  if (design.variants.length <= 1) throw new Error("A design needs at least one variant. Delete the design instead.");
  const variants = design.variants.filter((v) => v.id !== variantId);
  const activeVariantId = design.activeVariantId === variantId ? variants[0]!.id : design.activeVariantId;
  return { ...design, updatedAt: now, variants, activeVariantId };
}

export function sameSelections(a: Selections, b: Selections): boolean {
  const ka = Object.keys(cleanSelections(a)).sort();
  const kb = Object.keys(cleanSelections(b)).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k as RegionId] === b[k as RegionId]);
}

/** Parses stored designs, keeping valid ones and counting the ones that had to be skipped. */
export function parseStoredDesigns(raw: unknown): { designs: SavedDesign[]; skipped: number } {
  const list = Array.isArray(raw) ? raw : [];
  const designs: SavedDesign[] = [];
  let skipped = 0;
  for (const item of list) {
    const r = DesignSchema.safeParse(item);
    if (r.success && r.data.variants.some((v) => v.id === r.data.activeVariantId)) designs.push(r.data);
    else if (r.success) designs.push({ ...r.data, activeVariantId: r.data.variants[0]!.id });
    else skipped++;
  }
  return { designs, skipped };
}
