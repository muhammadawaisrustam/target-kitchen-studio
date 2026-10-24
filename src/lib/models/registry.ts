import type { KitchenModelDefinition } from "./types";

/**
 * Kitchen model registry. To add a model, append a definition here (see docs/ADDING-KITCHEN-MODELS.md).
 * GLB models use the same region mapping rules as the procedural demo kitchens.
 *
 * The procedural builders name meshes "<region>__<part>", so the rules below are plain prefixes.
 */
const proceduralRules = {
  upper_cabinets: { meshNamePatterns: ["^upper_cabinets__"], uvMode: "box-projection", grainAxis: "y" },
  lower_cabinets: { meshNamePatterns: ["^lower_cabinets__"], uvMode: "box-projection", grainAxis: "y" },
  tall_cabinets: { meshNamePatterns: ["^tall_cabinets__"], uvMode: "box-projection", grainAxis: "y" },
  island_panels: { meshNamePatterns: ["^island_panels__"], uvMode: "box-projection", grainAxis: "y" },
  open_shelves: { meshNamePatterns: ["^open_shelves__"], uvMode: "box-projection", grainAxis: "x" },
} as const;

export const KITCHEN_MODELS: KitchenModelDefinition[] = [
  {
    id: "demo-l-island",
    name: "L-shaped kitchen with island",
    description: "Prototype L-shaped kitchen with tall units, open shelving and a central island.",
    layout: "l-shape-island",
    source: { type: "procedural", builder: "demo-l-island" },
    previewImage: "/demo-assets/models/demo-l-island.jpg",
    isPrototype: true,
    regions: { ...proceduralRules },
    defaults: {
      upper_cabinets: "DEMO-UC-101",
      lower_cabinets: "DEMO-WD-001",
      tall_cabinets: "DEMO-UC-101",
      island_panels: "DEMO-WD-004",
      open_shelves: "DEMO-WD-001",
    },
    camera: { alpha: -1.05, beta: 1.18, radius: 4.7, target: [1.8, 0.95, -1.35] },
  },
  {
    id: "demo-straight",
    name: "Straight kitchen",
    description: "Prototype single-wall kitchen with tall units and open shelving.",
    layout: "straight",
    source: { type: "procedural", builder: "demo-straight" },
    previewImage: "/demo-assets/models/demo-straight.jpg",
    isPrototype: true,
    regions: {
      upper_cabinets: proceduralRules.upper_cabinets,
      lower_cabinets: proceduralRules.lower_cabinets,
      tall_cabinets: proceduralRules.tall_cabinets,
      open_shelves: proceduralRules.open_shelves,
    },
    defaults: {
      upper_cabinets: "DEMO-UC-104",
      lower_cabinets: "DEMO-UC-104",
      tall_cabinets: "DEMO-WD-003",
      open_shelves: "DEMO-WD-003",
    },
    camera: { alpha: -1.35, beta: 1.25, radius: 5.4, target: [2.1, 1.1, -0.6] },
  },
];

export const DEFAULT_MODEL_ID = KITCHEN_MODELS[0]!.id;

export function getModel(id: string | undefined | null): KitchenModelDefinition | undefined {
  return KITCHEN_MODELS.find((m) => m.id === id);
}
