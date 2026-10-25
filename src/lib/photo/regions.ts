/**
 * Cabinet regions a homeowner can mark on a photo. These follow the 3D studio's regions where they
 * match, plus "other panels" for side panels, fillers and anything else visible.
 */
export const PHOTO_REGION_IDS = ["upper_cabinets", "lower_cabinets", "tall_cabinets", "island_panels", "other_panels"] as const;
export type PhotoRegionId = (typeof PHOTO_REGION_IDS)[number];

export const PHOTO_REGION_LABELS: Record<PhotoRegionId, string> = {
  upper_cabinets: "Upper cabinets",
  lower_cabinets: "Lower cabinets",
  tall_cabinets: "Tall cabinets",
  island_panels: "Kitchen island",
  other_panels: "Other panels",
};

/** Overlay colours (RGB) so each region is easy to tell apart on the photo. */
export const PHOTO_REGION_COLOURS: Record<PhotoRegionId, [number, number, number]> = {
  upper_cabinets: [37, 99, 235],
  lower_cabinets: [22, 163, 74],
  tall_cabinets: [147, 51, 234],
  island_panels: [234, 88, 12],
  other_panels: [8, 145, 178],
};

/** Typical visible height of each kind of cabinet face, used as a starting value for grain size. Users can change it. */
export const DEFAULT_GUIDE_HEIGHT_CM: Record<PhotoRegionId, number> = {
  upper_cabinets: 70,
  lower_cabinets: 72,
  tall_cabinets: 210,
  island_panels: 85,
  other_panels: 72,
};

export const isPhotoRegionId = (v: unknown): v is PhotoRegionId => typeof v === "string" && (PHOTO_REGION_IDS as readonly string[]).includes(v);
