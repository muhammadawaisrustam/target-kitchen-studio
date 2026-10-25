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
    // Kastamonu codes first (real catalogue), then DEMO codes (demo catalogue).
    defaults: {
      upper_cabinets: ["1-001-T18-C-J-1", "DEMO-UC-101"], // Corpus White
      lower_cabinets: ["1-026-T18-C-J-1", "DEMO-WD-001"], // Garden Oak
      tall_cabinets: ["1-001-T18-C-J-1", "DEMO-UC-101"],
      island_panels: ["1-680-T18-C-L-27", "DEMO-WD-004"], // Stelvio Walnut
      open_shelves: ["1-026-T18-C-J-1", "DEMO-WD-001"],
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
      upper_cabinets: ["1-216-T18-C-J-1", "DEMO-UC-104"], // Luna
      lower_cabinets: ["1-216-T18-C-J-1", "DEMO-UC-104"],
      tall_cabinets: ["1-507-T18-C-J-1", "DEMO-WD-003"], // Yenice Oak
      open_shelves: ["1-507-T18-C-J-1", "DEMO-WD-003"],
    },
    camera: { alpha: -1.35, beta: 1.25, radius: 5.4, target: [2.1, 1.1, -0.6] },
  },
  {
    id: "demo-u-shape",
    name: "U-shaped kitchen",
    description: "Prototype U-shaped kitchen: cabinets on three walls, tall units and open shelving.",
    layout: "u-shape",
    source: { type: "procedural", builder: "demo-u-shape" },
    previewImage: "/demo-assets/models/demo-u-shape.jpg",
    isPrototype: true,
    regions: {
      upper_cabinets: proceduralRules.upper_cabinets,
      lower_cabinets: proceduralRules.lower_cabinets,
      tall_cabinets: proceduralRules.tall_cabinets,
      open_shelves: proceduralRules.open_shelves,
    },
    defaults: {
      upper_cabinets: ["1-001-T18-C-J-1", "DEMO-UC-101"], // Corpus White
      lower_cabinets: ["1-214-T18-C-J-1", "DEMO-UC-105"], // Anthracite
      tall_cabinets: ["1-026-T18-C-J-1", "DEMO-WD-001"], // Garden Oak
      open_shelves: ["1-026-T18-C-J-1", "DEMO-WD-001"],
    },
    camera: { alpha: -1.75, beta: 1.1, radius: 5.4, target: [1.9, 1.0, -1.3] },
  },
  {
    id: "demo-galley",
    name: "Galley kitchen (two parallel runs)",
    description: "Prototype galley kitchen: a wall run with tall units and an opposite run with a breakfast bar.",
    layout: "galley",
    source: { type: "procedural", builder: "demo-galley" },
    previewImage: "/demo-assets/models/demo-galley.jpg",
    isPrototype: true,
    regions: {
      upper_cabinets: proceduralRules.upper_cabinets,
      lower_cabinets: proceduralRules.lower_cabinets,
      tall_cabinets: proceduralRules.tall_cabinets,
      open_shelves: proceduralRules.open_shelves,
    },
    defaults: {
      upper_cabinets: ["1-505-T18-C-J-1", "DEMO-UC-103"], // Cashmere
      lower_cabinets: ["1-668-T18-C-L-27", "DEMO-WD-004"], // Canaletto Walnut
      tall_cabinets: ["1-505-T18-C-J-1", "DEMO-UC-103"],
      open_shelves: ["1-668-T18-C-L-27", "DEMO-WD-004"],
    },
    camera: { alpha: -0.12, beta: 1.05, radius: 5.8, target: [1.9, 1.0, -1.35] },
  },
  {
    id: "demo-peninsula",
    name: "L-shaped kitchen with peninsula",
    description: "Prototype L-shaped kitchen with a peninsula breakfast bar joined to the main run.",
    layout: "peninsula",
    source: { type: "procedural", builder: "demo-peninsula" },
    previewImage: "/demo-assets/models/demo-peninsula.jpg",
    isPrototype: true,
    regions: { ...proceduralRules },
    defaults: {
      upper_cabinets: ["1-001-T18-C-J-1", "DEMO-UC-101"], // Corpus White
      lower_cabinets: ["1-669-T18-C-L-27", "DEMO-UC-102"], // Clay
      tall_cabinets: ["1-669-T18-C-L-27", "DEMO-UC-102"],
      island_panels: ["1-680-T18-C-L-27", "DEMO-WD-004"], // Stelvio Walnut (peninsula)
      open_shelves: ["1-507-T18-C-J-1", "DEMO-WD-003"], // Yenice Oak
    },
    camera: { alpha: -1.0, beta: 1.15, radius: 5.4, target: [2.1, 0.95, -1.35] },
  },
  {
    id: "demo-straight-island",
    name: "Straight kitchen with island",
    description: "Prototype single-wall kitchen with tall units, open shelving and an island with sink and seating.",
    layout: "straight-island",
    source: { type: "procedural", builder: "demo-straight-island" },
    previewImage: "/demo-assets/models/demo-straight-island.jpg",
    isPrototype: true,
    regions: { ...proceduralRules },
    defaults: {
      upper_cabinets: ["1-218-T18-C-J-1", "DEMO-UC-104"], // Ash Grey
      lower_cabinets: ["1-218-T18-C-J-1", "DEMO-UC-104"],
      tall_cabinets: ["1-507-T18-C-J-1", "DEMO-WD-003"], // Yenice Oak
      island_panels: ["1-488-T18-C-J-1", "DEMO-UC-105"], // Anthracite Oak
      open_shelves: ["1-507-T18-C-J-1", "DEMO-WD-003"],
    },
    camera: { alpha: -1.15, beta: 1.12, radius: 5.8, target: [2.3, 0.95, -1.5] },
  },
];

export const DEFAULT_MODEL_ID = KITCHEN_MODELS[0]!.id;

export function getModel(id: string | undefined | null): KitchenModelDefinition | undefined {
  return KITCHEN_MODELS.find((m) => m.id === id);
}
