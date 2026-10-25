/**
 * Editing state for one photo: a mask and a look (panel, perspective guide, grain size,
 * rotation) per cabinet region, plus a "protect" mask for worktops, appliances, handles and
 * anything else that must never be recoloured. Pure and immutable so every change can be undone.
 */
import { z } from "zod";
import { applyInto, boundingBox, cloneMask, createMask, decodeRle, encodeRle, isEmpty, type Mask } from "./mask";
import { guideAspect, isConvexQuad, rectGuide, type Quad } from "./perspective";
import { DEFAULT_GUIDE_HEIGHT_CM, PHOTO_REGION_IDS, PHOTO_REGION_LABELS, type PhotoRegionId } from "./regions";
import type { RegionLook } from "./materials";

export interface RegionState extends RegionLook {
  panelCode?: string;
  /** False while the guide is the automatic photo-aligned box; true once the user has fitted it. */
  guideAdjusted: boolean;
}

export interface PhotoDoc {
  width: number;
  height: number;
  masks: Record<PhotoRegionId, Mask>;
  protect: Mask;
  regions: Record<PhotoRegionId, RegionState>;
  /** 0 = flat panel colour, 1 = full original shading. */
  shadingStrength: number;
}

export type MaskTarget = PhotoRegionId | "protect";

export const DEFAULT_SHADING = 0.85;

export function defaultRegionState(region: PhotoRegionId): RegionState {
  return { guideAdjusted: false, guideSizeCm: { w: 100, h: DEFAULT_GUIDE_HEIGHT_CM[region] }, scale: 1, rotationDeg: 0, mirror: true };
}

export function createDoc(width: number, height: number): PhotoDoc {
  const masks = {} as Record<PhotoRegionId, Mask>;
  const regions = {} as Record<PhotoRegionId, RegionState>;
  for (const r of PHOTO_REGION_IDS) {
    masks[r] = createMask(width, height);
    regions[r] = defaultRegionState(r);
  }
  return { width, height, masks, protect: createMask(width, height), regions, shadingStrength: DEFAULT_SHADING };
}

/** Starting guide for a region: its selection's bounding box, with a width suggested from the box shape. */
function autoGuide(mask: Mask, look: RegionState): Pick<RegionState, "guide" | "guideSizeCm"> {
  const box = boundingBox(mask);
  if (!box) return { guide: undefined, guideSizeCm: look.guideSizeCm };
  const guide = rectGuide(box);
  const h = look.guideSizeCm.h;
  return { guide, guideSizeCm: { w: Math.max(10, Math.round(h * guideAspect(guide))), h } };
}

function overlaps(a: Mask, b: Mask): boolean {
  for (let i = 0; i < a.data.length; i++) if (a.data[i] && b.data[i]) return true;
  return false;
}
function without(a: Mask, b: Mask): Mask {
  const m = cloneMask(a);
  applyInto(m, b, 0);
  return m;
}

/**
 * Adds or removes `edit` from a region (or the protect mask).
 * - Adding to a region takes those pixels away from every other region (a pixel has one finish).
 * - Protected pixels are never part of any region.
 * - The automatic guide follows the selection until the user fits the guide by hand.
 */
export function applyMaskEdit(doc: PhotoDoc, target: MaskTarget, edit: Mask, mode: "add" | "remove"): PhotoDoc {
  const masks = { ...doc.masks };
  const regions = { ...doc.regions };
  let protect = doc.protect;
  const value = mode === "add" ? 255 : 0;
  if (target === "protect") {
    protect = cloneMask(doc.protect);
    applyInto(protect, edit, value);
    if (mode === "add") for (const r of PHOTO_REGION_IDS) if (overlaps(masks[r], edit)) masks[r] = without(masks[r], edit);
  } else {
    const m = cloneMask(doc.masks[target]);
    applyInto(m, edit, value);
    if (mode === "add") {
      applyInto(m, doc.protect, 0);
      for (const r of PHOTO_REGION_IDS) if (r !== target && overlaps(masks[r], m)) masks[r] = without(masks[r], m);
    }
    masks[target] = m;
  }
  for (const r of PHOTO_REGION_IDS) {
    if (masks[r] === doc.masks[r]) continue;
    const look = regions[r];
    if (isEmpty(masks[r])) regions[r] = { ...look, guide: look.guideAdjusted ? look.guide : undefined };
    else if (!look.guideAdjusted) regions[r] = { ...look, ...autoGuide(masks[r], look) };
  }
  return { ...doc, masks, regions, protect };
}

export function clearTarget(doc: PhotoDoc, target: MaskTarget): PhotoDoc {
  const empty = createMask(doc.width, doc.height);
  if (target === "protect") return { ...doc, protect: empty };
  return { ...doc, masks: { ...doc.masks, [target]: empty }, regions: { ...doc.regions, [target]: { ...doc.regions[target], guide: undefined, guideAdjusted: false } } };
}

export function assignPanel(doc: PhotoDoc, region: PhotoRegionId, panelCode: string | undefined): PhotoDoc {
  return { ...doc, regions: { ...doc.regions, [region]: { ...doc.regions[region], panelCode } } };
}

export function updateLook(doc: PhotoDoc, region: PhotoRegionId, patch: Partial<RegionState>): PhotoDoc {
  const next = { ...doc.regions[region], ...patch };
  if (patch.guide && !isConvexQuad(patch.guide)) throw new Error("The guide corners must form a four-sided shape without crossing edges.");
  return { ...doc, regions: { ...doc.regions, [region]: next } };
}

/** Puts the guide back to the automatic photo-aligned box. */
export function resetGuide(doc: PhotoDoc, region: PhotoRegionId): PhotoDoc {
  const look = { ...doc.regions[region], guideAdjusted: false };
  return { ...doc, regions: { ...doc.regions, [region]: { ...look, ...autoGuide(doc.masks[region], look) } } };
}

export interface AssignedRegion {
  region: PhotoRegionId;
  regionLabel: string;
  panelCode: string;
}

/** Regions that have both a selected area and a panel, in a fixed order. This is what the summary and quote list. */
export function assignedRegions(doc: PhotoDoc): AssignedRegion[] {
  return PHOTO_REGION_IDS.filter((r) => doc.regions[r].panelCode && !isEmpty(doc.masks[r])).map((r) => ({ region: r, regionLabel: PHOTO_REGION_LABELS[r], panelCode: doc.regions[r].panelCode! }));
}

// ---------- serialisation (undo history and saved designs) ----------

const finite = z.number().finite();
const PointSchema = z.object({ x: finite, y: finite });
const QuadSchema = z.tuple([PointSchema, PointSchema, PointSchema, PointSchema]);

const RegionStateSchema = z.object({
  panelCode: z.string().trim().min(1).max(40).optional(),
  guide: QuadSchema.optional(),
  guideAdjusted: z.boolean(),
  guideSizeCm: z.object({ w: finite.min(1).max(2000), h: finite.min(1).max(2000) }),
  scale: finite.min(0.1).max(10),
  rotationDeg: finite.min(-360).max(360),
  mirror: z.boolean(),
});

export const SerializedDocSchema = z.object({
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
  shadingStrength: finite.min(0).max(1),
  protect: z.string(),
  regions: z.array(RegionStateSchema.extend({ id: z.enum(PHOTO_REGION_IDS), mask: z.string() })).max(PHOTO_REGION_IDS.length),
});
export type SerializedDoc = z.infer<typeof SerializedDocSchema>;

// Masks are never changed in place once in a doc, so their encoding can be cached.
const rleCache = new WeakMap<Uint8Array, string>();
const rle = (m: Mask) => {
  let s = rleCache.get(m.data);
  if (s === undefined) {
    s = encodeRle(m);
    rleCache.set(m.data, s);
  }
  return s;
};

export function serializeDoc(doc: PhotoDoc): SerializedDoc {
  return {
    width: doc.width,
    height: doc.height,
    shadingStrength: doc.shadingStrength,
    protect: rle(doc.protect),
    regions: PHOTO_REGION_IDS.map((id) => ({ id, mask: rle(doc.masks[id]), ...doc.regions[id] })),
  };
}

/** Rebuilds a doc. Throws if the data is damaged or was saved for a different image size. */
export function deserializeDoc(raw: unknown, expected?: { width: number; height: number }): PhotoDoc {
  const s = SerializedDocSchema.parse(raw);
  if (expected && (s.width !== expected.width || s.height !== expected.height)) throw new Error("The saved selections were made on a different image size.");
  const doc = createDoc(s.width, s.height);
  doc.shadingStrength = s.shadingStrength;
  doc.protect = decodeRle(s.protect, s.width, s.height);
  rleCache.set(doc.protect.data, s.protect);
  for (const r of s.regions) {
    const { id, mask, ...look } = r;
    doc.masks[id] = decodeRle(mask, s.width, s.height);
    rleCache.set(doc.masks[id].data, mask);
    doc.regions[id] = { ...defaultRegionState(id), ...look };
  }
  return doc;
}

// ---------- undo / redo ----------

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 50;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

export function pushHistory<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}
