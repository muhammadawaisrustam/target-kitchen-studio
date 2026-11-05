/** Logical regions (cabinets and worktops). Each kitchen model maps its own meshes onto these ids. */
export const REGION_IDS = ["upper_cabinets", "lower_cabinets", "tall_cabinets", "island_panels", "open_shelves", "worktop", "island_top"] as const;
export type RegionId = (typeof REGION_IDS)[number];

export const REGION_LABELS: Record<RegionId, string> = {
  upper_cabinets: "Upper cabinets",
  lower_cabinets: "Lower cabinets",
  tall_cabinets: "Tall units",
  island_panels: "Kitchen island",
  open_shelves: "Open shelves",
  worktop: "Worktop",
  island_top: "Island top",
};

export const isRegionId = (v: unknown): v is RegionId => typeof v === "string" && (REGION_IDS as readonly string[]).includes(v);
