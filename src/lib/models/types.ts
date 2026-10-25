import type { RegionId } from "./regions";

export type GrainAxis = "x" | "y" | "z";

/**
 * How a model's meshes are assigned to a logical region. Rules are evaluated in order:
 * exact mesh names, then mesh-name regular expressions, then source material names.
 */
export interface RegionMappingRule {
  meshNames?: readonly string[];
  meshNamePatterns?: readonly string[];
  materialNames?: readonly string[];
  /**
   * "model": use the UVs authored in the asset (must be 1 UV unit = 1 metre for correct grain scale).
   * "box-projection": regenerate planar UVs in metres from the geometry. Suitable for flat panel
   * geometry (doors, carcasses, shelves); curved or profiled parts need proper UV unwrapping.
   */
  uvMode?: "model" | "box-projection";
  /** World axis the grain should follow for box-projected UVs. Defaults to "y" (vertical). */
  grainAxis?: GrainAxis;
}

export interface CameraState {
  alpha: number;
  beta: number;
  radius: number;
  target: [number, number, number];
}

export type ProceduralBuilderId = "demo-l-island" | "demo-straight" | "demo-u-shape" | "demo-galley" | "demo-peninsula" | "demo-straight-island";

export type ModelSource =
  | { type: "procedural"; builder: ProceduralBuilderId }
  | { type: "gltf"; url: string };

export interface KitchenModelDefinition {
  id: string;
  name: string;
  description: string;
  layout: "straight" | "l-shape" | "u-shape" | "island" | "l-shape-island" | "galley" | "peninsula" | "straight-island";
  source: ModelSource;
  previewImage: string;
  /** Prototype models are illustrative only and are labelled as such in the UI. */
  isPrototype: boolean;
  regions: Partial<Record<RegionId, RegionMappingRule>>;
  /**
   * Starting panel per region, used for new designs and "Reset design". Each region lists
   * candidate panel codes in order; the first one present in the loaded catalogue is used.
   * If none is present the region keeps its original (unassigned) finish.
   */
  defaults: Partial<Record<RegionId, readonly string[]>>;
  camera: CameraState;
}
