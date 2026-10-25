/**
 * Procedural DEMONSTRATION kitchens built from real 3D geometry.
 *
 * These are prototypes for visualising panel finishes. They are not manufacturing models:
 * dimensions are typical, not measured, and there are no cutting lists or drawings.
 *
 * Mesh naming convention: "<region>__<part>_<n>" for configurable parts and "fixed__<part>"
 * for everything else. The model registry maps regions by these prefixes, exactly as it would
 * map the mesh names of an imported GLB file.
 */
import {
  Color3,
  DynamicTexture,
  Mesh,
  CreateBox,
  CreateCylinder,
  CreatePlane,
  CreateSphere,
  PBRMaterial,
  Scene,
  Texture,
  TransformNode,
  Vector3,
} from "./babylon";
import type { GrainAxis, ProceduralBuilderId } from "@/lib/models/types";
import { computeBoxProjectedUVs } from "./uv";

type V3 = [number, number, number];

export interface BuiltKitchen {
  root: TransformNode;
  meshes: Mesh[];
  shadowCasters: Mesh[];
  /** Approximate bounds used to clamp camera panning. */
  bounds: { min: V3; max: V3 };
}

interface Mats {
  neutral: PBRMaterial;
  wall: PBRMaterial;
  floor: PBRMaterial;
  quartz: PBRMaterial;
  plinth: PBRMaterial;
  steel: PBRMaterial;
  blackGlass: PBRMaterial;
  darkMetal: PBRMaterial;
  ceramic: PBRMaterial;
  ceramicDark: PBRMaterial;
  wood: PBRMaterial;
  glow: PBRMaterial;
  book1: PBRMaterial;
  book2: PBRMaterial;
  plant: PBRMaterial;
}

function pbr(scene: Scene, name: string, hex: string, roughness: number, metallic = 0): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.FromHexString(hex).toLinearSpace();
  m.roughness = roughness;
  m.metallic = metallic;
  return m;
}

function floorTexture(scene: Scene): Texture {
  // 600 x 600 mm porcelain tiles with grout lines; one texture repeat = 1.2 m (2 x 2 tiles).
  const size = 512;
  const tex = new DynamicTexture("fixed__floor_tex", { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#D6D2CB";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const shade = 200 + Math.floor(Math.random() * 25);
    ctx.fillStyle = `rgba(${shade},${shade - 3},${shade - 8},0.35)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
  ctx.strokeStyle = "#B9B4AC";
  ctx.lineWidth = 3;
  for (const p of [0, size / 2]) {
    ctx.beginPath();
    ctx.moveTo(p + 1.5, 0);
    ctx.lineTo(p + 1.5, size);
    ctx.moveTo(0, p + 1.5);
    ctx.lineTo(size, p + 1.5);
    ctx.stroke();
  }
  tex.update();
  tex.uScale = tex.vScale = 1 / 1.2;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

// No environment map is used (it would be an extra download), so metals are approximated as
// non-metallic greys; true metallic PBR surfaces render black without reflections.
function createMaterials(scene: Scene): Mats {
  const floor = pbr(scene, "fixed__floor", "#FFFFFF", 0.55);
  floor.albedoTexture = floorTexture(scene);
  const glow = pbr(scene, "fixed__glow", "#FFF4E0", 1);
  glow.emissiveColor = Color3.FromHexString("#FFE7C2");
  glow.emissiveIntensity = 1.4;
  return {
    // Unassigned cabinet surfaces before a panel is applied (also the "original" material).
    neutral: pbr(scene, "fixed__unassigned_cabinet", "#E7E4DF", 0.8),
    wall: pbr(scene, "fixed__wall", "#EDE9E3", 0.95),
    floor,
    quartz: pbr(scene, "fixed__quartz", "#EEECE8", 0.32),
    plinth: pbr(scene, "fixed__plinth", "#2E2D2B", 0.7),
    steel: pbr(scene, "fixed__steel", "#B9BAB8", 0.3),
    blackGlass: pbr(scene, "fixed__black_glass", "#0D0D0E", 0.06),
    darkMetal: pbr(scene, "fixed__dark_metal", "#3A3A39", 0.45),
    ceramic: pbr(scene, "fixed__ceramic", "#F3EFE8", 0.25),
    ceramicDark: pbr(scene, "fixed__ceramic_dark", "#5D6E64", 0.35),
    wood: pbr(scene, "fixed__stool_wood", "#8B6A4A", 0.6),
    glow,
    book1: pbr(scene, "fixed__book1", "#7C8C7A", 0.8),
    book2: pbr(scene, "fixed__book2", "#C9B79A", 0.8),
    plant: pbr(scene, "fixed__plant", "#4F6B45", 0.7),
  };
}

/**
 * A "run" maps local cabinet coordinates (u = along the run, d = out from the wall) to world
 * space, so the same cabinet code builds against any wall or either side of an island.
 */
interface Frame {
  origin: [number, number]; // world x, z of u=0, d=0
  u: [number, number]; // unit vector (x, z) along the run
  d: [number, number]; // unit vector (x, z) out from the wall
  axis: GrainAxis; // world axis the run follows
}

class Builder {
  meshes: Mesh[] = [];
  casters: Mesh[] = [];
  private counters = new Map<string, number>();
  constructor(
    public scene: Scene,
    public mats: Mats,
    public root: TransformNode,
  ) {}

  private nextName(base: string) {
    const n = (this.counters.get(base) ?? 0) + 1;
    this.counters.set(base, n);
    return `${base}_${String(n).padStart(2, "0")}`;
  }

  /** World-space axis-aligned box. */
  box(base: string, min: V3, max: V3, mat: PBRMaterial, opts: { grainAxis?: GrainAxis; cast?: boolean } = {}): Mesh {
    const size: V3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const mesh = CreateBox(this.nextName(base), { width: size[0], height: size[1], depth: size[2] }, this.scene);
    mesh.position = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    mesh.material = mat;
    mesh.parent = this.root;
    mesh.receiveShadows = true;
    mesh.metadata = { grainAxis: opts.grainAxis ?? "y" };
    this.meshes.push(mesh);
    if (opts.cast !== false) this.casters.push(mesh);
    return mesh;
  }

  /** Box in a run's local frame: u along the run, d out from the wall, y up. */
  runBox(base: string, f: Frame, u0: number, u1: number, d0: number, d1: number, y0: number, y1: number, mat: PBRMaterial, opts: { grainAxis?: GrainAxis; cast?: boolean } = {}) {
    const p = (u: number, d: number): [number, number] => [f.origin[0] + u * f.u[0] + d * f.d[0], f.origin[1] + u * f.u[1] + d * f.d[1]];
    const [ax, az] = p(u0, d0);
    const [bx, bz] = p(u1, d1);
    return this.box(base, [Math.min(ax, bx), y0, Math.min(az, bz)], [Math.max(ax, bx), y1, Math.max(az, bz)], mat, opts);
  }

  cylinder(base: string, center: V3, height: number, diameter: number, mat: PBRMaterial, tessellation = 24) {
    const mesh = CreateCylinder(this.nextName(base), { height, diameter, tessellation }, this.scene);
    mesh.position = new Vector3(...center);
    mesh.material = mat;
    mesh.parent = this.root;
    mesh.receiveShadows = true;
    this.meshes.push(mesh);
    this.casters.push(mesh);
    return mesh;
  }
}

// Typical dimensions (metres).
const PLINTH = 0.1;
const BASE_TOP = 0.87;
const WORKTOP = 0.04;
const BASE_DEPTH = 0.56;
const DOOR = 0.018;
const GAP = 0.003;
const UPPER_Y0 = 1.45;
const UPPER_Y1 = 2.17;
const UPPER_DEPTH = 0.33;
const TALL_Y1 = 2.2;

type Front = { kind: "door" | "drawer"; y0: number; y1: number; split?: 2 } | { kind: "appliance"; y0: number; y1: number; mat: "blackGlass" | "steel" };

function fronts(b: Builder, region: string, f: Frame, u0: number, u1: number, dFront: number, list: Front[], handle: "top" | "bottom" | "side") {
  const m = b.mats;
  for (const fr of list) {
    if (fr.kind === "appliance") {
      b.runBox("fixed__appliance", f, u0 + GAP, u1 - GAP, dFront, dFront + DOOR, fr.y0 + GAP, fr.y1 - GAP, m[fr.mat]);
      b.runBox("fixed__appliance_handle", f, u0 + 0.08, u1 - 0.08, dFront + DOOR, dFront + DOOR + 0.025, fr.y1 - 0.06, fr.y1 - 0.045, m.steel);
      continue;
    }
    const parts = fr.kind === "door" && fr.split === 2 ? 2 : 1;
    const w = (u1 - u0) / parts;
    for (let i = 0; i < parts; i++) {
      const a = u0 + i * w + GAP;
      const c = u0 + (i + 1) * w - GAP;
      b.runBox(`${region}__${fr.kind}`, f, a, c, dFront, dFront + DOOR, fr.y0 + GAP, fr.y1 - GAP, m.neutral, { grainAxis: "y" });
      // Bar handle: horizontal on drawers, vertical near the opening edge on doors.
      if (fr.kind === "drawer" || handle !== "side") {
        const mid = (a + c) / 2;
        const hy = handle === "bottom" ? fr.y0 + 0.05 : fr.kind === "drawer" ? (fr.y0 + fr.y1) / 2 + Math.min(0.06, (fr.y1 - fr.y0) / 4) : fr.y1 - 0.06;
        const len = Math.min(0.3, (c - a) * 0.5);
        b.runBox("fixed__handle", f, mid - len / 2, mid + len / 2, dFront + DOOR, dFront + DOOR + 0.022, hy - 0.006, hy + 0.006, m.steel);
      } else {
        const hu = parts === 2 ? (i === 0 ? c - 0.04 : a + 0.04) : c - 0.04;
        b.runBox("fixed__handle", f, hu - 0.006, hu + 0.006, dFront + DOOR, dFront + DOOR + 0.022, fr.y1 - 0.42, fr.y1 - 0.12, m.steel);
      }
    }
  }
}

type BaseKind = "drawers" | "doors" | "door" | "blind" | "sink";

function baseUnit(b: Builder, region: string, f: Frame, u0: number, w: number, kind: BaseKind) {
  const u1 = u0 + w;
  b.runBox(`${region}__carcass`, f, u0, u1, 0, BASE_DEPTH, PLINTH, BASE_TOP, b.mats.neutral);
  b.runBox("fixed__plinth", f, u0, u1, 0.02, BASE_DEPTH - 0.05, 0, PLINTH, b.mats.plinth, { cast: false });
  if (kind === "blind") return;
  const list: Front[] =
    kind === "drawers"
      ? [
          { kind: "drawer", y0: PLINTH, y1: 0.42 },
          { kind: "drawer", y0: 0.42, y1: 0.66 },
          { kind: "drawer", y0: 0.66, y1: BASE_TOP },
        ]
      : [{ kind: "door", y0: PLINTH, y1: BASE_TOP, split: kind === "door" ? undefined : 2 }];
  fronts(b, region, f, u0, u1, BASE_DEPTH, list, "top");
}

function upperUnit(b: Builder, region: string, f: Frame, u0: number, w: number, doors: 1 | 2, frontFrom = u0) {
  const u1 = u0 + w;
  b.runBox(`${region}__carcass`, f, u0, u1, 0, UPPER_DEPTH, UPPER_Y0, UPPER_Y1, b.mats.neutral);
  fronts(b, region, f, frontFrom, u1, UPPER_DEPTH, [{ kind: "door", y0: UPPER_Y0, y1: UPPER_Y1, split: doors === 2 ? 2 : undefined }], "bottom");
  // Warm LED strip under the cabinet.
  b.runBox("fixed__led", f, u0 + 0.02, u1 - 0.02, UPPER_DEPTH - 0.06, UPPER_DEPTH - 0.04, UPPER_Y0 - 0.006, UPPER_Y0, b.mats.glow, { cast: false });
}

function tallUnit(b: Builder, f: Frame, u0: number, w: number, kind: "oven" | "fridge") {
  const u1 = u0 + w;
  const region = "tall_cabinets";
  b.runBox(`${region}__carcass`, f, u0, u1, 0, BASE_DEPTH, PLINTH, TALL_Y1, b.mats.neutral);
  b.runBox("fixed__plinth", f, u0, u1, 0.02, BASE_DEPTH - 0.05, 0, PLINTH, b.mats.plinth, { cast: false });
  const list: Front[] =
    kind === "oven"
      ? [
          { kind: "drawer", y0: PLINTH, y1: 0.48 },
          { kind: "drawer", y0: 0.48, y1: 0.8 },
          { kind: "appliance", y0: 0.8, y1: 1.4, mat: "blackGlass" },
          { kind: "appliance", y0: 1.4, y1: 1.78, mat: "blackGlass" },
          { kind: "door", y0: 1.78, y1: TALL_Y1 },
        ]
      : [
          { kind: "door", y0: PLINTH, y1: 1.3 },
          { kind: "door", y0: 1.3, y1: TALL_Y1 },
        ];
  fronts(b, region, f, u0, u1, BASE_DEPTH, list, "side");
}

function worktop(b: Builder, f: Frame, u0: number, u1: number, depth = BASE_DEPTH + DOOR + 0.02) {
  b.runBox("fixed__worktop", f, u0, u1, 0, depth, BASE_TOP, BASE_TOP + WORKTOP, b.mats.quartz);
}

function splashback(b: Builder, f: Frame, u0: number, u1: number) {
  b.runBox("fixed__splashback", f, u0, u1, 0, 0.012, BASE_TOP + WORKTOP, UPPER_Y0, b.mats.quartz, { cast: false });
}

function hob(b: Builder, f: Frame, u0: number) {
  const top = BASE_TOP + WORKTOP;
  b.runBox("fixed__hob", f, u0 + 0.05, u0 + 0.55, 0.08, 0.5, top, top + 0.006, b.mats.blackGlass, { cast: false });
}

function hobAndHood(b: Builder, f: Frame, u0: number) {
  const m = b.mats;
  hob(b, f, u0);
  b.runBox("fixed__hood_canopy", f, u0, u0 + 0.6, 0, 0.5, 1.62, 1.7, m.steel);
  b.runBox("fixed__hood_chimney", f, u0 + 0.17, u0 + 0.43, 0, 0.26, 1.7, 2.7, m.steel);
}

function sink(b: Builder, f: Frame, u0: number) {
  const m = b.mats;
  const top = BASE_TOP + WORKTOP;
  b.runBox("fixed__sink", f, u0 + 0.08, u0 + 0.52, 0.12, 0.5, top, top + 0.004, m.darkMetal, { cast: false });
  const tapU = u0 + 0.3;
  const p = (u: number, d: number): [number, number] => [f.origin[0] + u * f.u[0] + d * f.d[0], f.origin[1] + u * f.u[1] + d * f.d[1]];
  const [tx, tz] = p(tapU, 0.06);
  b.cylinder("fixed__tap", [tx, top + 0.15, tz], 0.3, 0.028, m.steel, 16);
  b.runBox("fixed__tap_spout", f, tapU - 0.012, tapU + 0.012, 0.06, 0.24, top + 0.29, top + 0.31, m.steel);
}

function shelves(b: Builder, f: Frame, u0: number, u1: number, heights: number[], depth = 0.26) {
  for (const y of heights) b.runBox("open_shelves__shelf", f, u0, u1, 0, depth, y, y + 0.036, b.mats.neutral, { grainAxis: f.axis });
}

function shelfDecor(b: Builder, f: Frame, u0: number, heights: number[]) {
  const m = b.mats;
  const p = (u: number, d: number): [number, number] => [f.origin[0] + u * f.u[0] + d * f.d[0], f.origin[1] + u * f.u[1] + d * f.d[1]];
  const [y0, y1, y2] = heights;
  if (y0 !== undefined) {
    const [x, z] = p(u0 + 0.15, 0.13);
    b.cylinder("fixed__vase", [x, y0 + 0.036 + 0.11, z], 0.22, 0.12, m.ceramic);
    const [x2, z2] = p(u0 + 0.36, 0.13);
    b.cylinder("fixed__jar", [x2, y0 + 0.036 + 0.07, z2], 0.14, 0.1, m.ceramicDark);
  }
  if (y1 !== undefined) {
    for (let i = 0; i < 6; i++) b.runBox("fixed__book", f, u0 + 0.5 + i * 0.032, u0 + 0.528 + i * 0.032, 0.04, 0.22, y1 + 0.036, y1 + 0.036 + 0.2 + (i % 3) * 0.02, i % 2 ? m.book1 : m.book2);
  }
  if (y2 !== undefined) {
    const [x, z] = p(u0 + 0.3, 0.13);
    b.cylinder("fixed__pot", [x, y2 + 0.036 + 0.07, z], 0.14, 0.16, m.ceramic);
    const plant = CreateSphere("fixed__plant_01", { diameter: 0.22, segments: 12 }, b.scene);
    plant.position = new Vector3(x, y2 + 0.036 + 0.2, z);
    plant.scaling = new Vector3(1, 0.8, 1);
    plant.material = m.plant;
    plant.parent = b.root;
    b.meshes.push(plant);
    b.casters.push(plant);
  }
}

function room(b: Builder, width: number, depth: number, opts: { rightWall?: boolean } = {}) {
  const m = b.mats;
  // Floor and the two walls. Walls are single-sided so they disappear when the camera orbits
  // behind them, giving an automatic cut-away view.
  const floor = b.box("fixed__floor", [-0.5, -0.02, -depth], [width, 0, 0.1], m.floor, { cast: false });
  floor.metadata = { grainAxis: "x", physicalUV: true };
  const back = CreatePlane("fixed__wall_back", { width: width + 0.5, height: 2.7 }, b.scene);
  back.position = new Vector3((width - 0.5) / 2, 1.35, 0); // plane normal faces -z (into the room)
  const left = CreatePlane("fixed__wall_left", { width: depth, height: 2.7 }, b.scene);
  left.position = new Vector3(0, 1.35, -depth / 2);
  left.rotation.y = -Math.PI / 2; // normal faces +x (into the room)
  const walls = [back, left];
  if (opts.rightWall) {
    const right = CreatePlane("fixed__wall_right", { width: depth, height: 2.7 }, b.scene);
    right.position = new Vector3(width, 1.35, -depth / 2);
    right.rotation.y = Math.PI / 2; // normal faces -x (into the room)
    walls.push(right);
  }
  for (const w of walls) {
    w.material = m.wall;
    w.parent = b.root;
    w.receiveShadows = true;
    b.meshes.push(w);
  }
}

function stool(b: Builder, x: number, z: number) {
  const m = b.mats;
  b.cylinder("fixed__stool_seat", [x, 0.66, z], 0.04, 0.36, m.wood, 28);
  b.cylinder("fixed__stool_leg", [x, 0.32, z], 0.64, 0.04, m.darkMetal, 12);
  b.cylinder("fixed__stool_base", [x, 0.01, z], 0.02, 0.36, m.darkMetal, 28);
  b.cylinder("fixed__stool_ring", [x, 0.25, z], 0.015, 0.3, m.darkMetal, 28);
}

function pendant(b: Builder, x: number, z: number) {
  const m = b.mats;
  b.cylinder("fixed__pendant_cord", [x, 2.3, z], 0.8, 0.008, m.darkMetal, 6);
  const shade = CreateCylinder("fixed__pendant_shade", { height: 0.22, diameterTop: 0.08, diameterBottom: 0.3, tessellation: 32 }, b.scene);
  shade.position = new Vector3(x, 1.8, z);
  shade.material = m.darkMetal;
  shade.parent = b.root;
  b.meshes.push(shade);
  b.box("fixed__pendant_bulb", [x - 0.05, 1.68, z - 0.05], [x + 0.05, 1.7, z + 0.05], m.glow, { cast: false });
}

function buildLIsland(b: Builder) {
  room(b, 4.8, 4.6);
  // Back wall run: u along +x, fronts face -z.
  const back: Frame = { origin: [0, 0], u: [1, 0], d: [0, -1], axis: "x" };
  // Left wall run: u along -z, fronts face +x.
  const left: Frame = { origin: [0, 0], u: [0, -1], d: [1, 0], axis: "z" };

  baseUnit(b, "lower_cabinets", back, 0.6, 0.6, "sink");
  baseUnit(b, "lower_cabinets", back, 1.2, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", back, 1.8, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", left, 0, 0.6, "blind"); // corner, hidden behind the back run
  baseUnit(b, "lower_cabinets", left, 0.6, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", left, 1.2, 0.6, "doors");
  baseUnit(b, "lower_cabinets", left, 1.8, 0.6, "door");
  worktop(b, back, 0, 2.4);
  worktop(b, left, BASE_DEPTH + DOOR + 0.02, 2.4);
  splashback(b, back, 0, 2.4);
  splashback(b, left, 0.012, 2.4);
  sink(b, back, 0.6);
  hobAndHood(b, back, 1.2);

  tallUnit(b, back, 2.4, 0.6, "oven");
  tallUnit(b, back, 3.0, 0.6, "fridge");
  // End panel closing the tall units.
  b.runBox("tall_cabinets__end_panel", back, 3.6, 3.6 + DOOR, 0, BASE_DEPTH + DOOR, 0, TALL_Y1, b.mats.neutral);

  upperUnit(b, "upper_cabinets", back, 0.35, 0.85, 2);
  upperUnit(b, "upper_cabinets", back, 1.8, 0.6, 1);
  upperUnit(b, "upper_cabinets", left, 0, 0.9, 1, UPPER_DEPTH + DOOR + 0.002);

  shelves(b, left, 1.05, 2.3, [1.5, 1.82, 2.14]);
  shelfDecor(b, left, 1.1, [1.5, 1.82, 2.14]);

  // Island: cabinets face the back run (+z); the seating side faces the room (-z).
  const islandX0 = 1.6;
  const islandX1 = 3.4;
  const isl: Frame = { origin: [islandX0, -2.3], u: [1, 0], d: [0, 1], axis: "x" };
  baseUnit(b, "island_panels", isl, 0, 0.6, "drawers");
  baseUnit(b, "island_panels", isl, 0.6, 0.6, "doors");
  baseUnit(b, "island_panels", isl, 1.2, 0.6, "drawers");
  const top = BASE_TOP + WORKTOP;
  // Back panel and waterfall end panels in the island finish.
  b.box("island_panels__back_panel", [islandX0, 0, -2.32], [islandX1, BASE_TOP, -2.3], b.mats.neutral);
  b.box("island_panels__end_panel", [islandX0 - 0.02, 0, -2.62], [islandX0, top, -1.72], b.mats.neutral, { grainAxis: "y" });
  b.box("island_panels__end_panel", [islandX1, 0, -2.62], [islandX1 + 0.02, top, -1.72], b.mats.neutral, { grainAxis: "y" });
  b.box("fixed__worktop", [islandX0, BASE_TOP, -2.62], [islandX1, top, -1.72], b.mats.quartz);
  b.cylinder("fixed__bowl", [2.9, top + 0.04, -2.05], 0.08, 0.3, b.mats.ceramicDark, 32);

  stool(b, 2.05, -2.85);
  stool(b, 2.95, -2.85);
  pendant(b, 2.1, -2.15);
  pendant(b, 2.9, -2.15);

  return { min: [0, 0, -4] as V3, max: [4.4, 2.6, 0] as V3 };
}

function buildStraight(b: Builder) {
  room(b, 5.2, 3.6);
  const back: Frame = { origin: [0.3, 0], u: [1, 0], d: [0, -1], axis: "x" };
  tallUnit(b, back, 0, 0.6, "fridge");
  tallUnit(b, back, 0.6, 0.6, "oven");
  b.runBox("tall_cabinets__end_panel", back, -DOOR, 0, 0, BASE_DEPTH + DOOR, 0, TALL_Y1, b.mats.neutral);
  baseUnit(b, "lower_cabinets", back, 1.2, 0.6, "sink");
  baseUnit(b, "lower_cabinets", back, 1.8, 0.6, "doors");
  baseUnit(b, "lower_cabinets", back, 2.4, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", back, 3.0, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", back, 3.6, 0.6, "door");
  b.runBox("lower_cabinets__end_panel", back, 4.2, 4.2 + DOOR, 0, BASE_DEPTH + DOOR, 0, BASE_TOP, b.mats.neutral);
  worktop(b, back, 1.2, 4.2 + DOOR);
  splashback(b, back, 1.2, 4.2 + DOOR);
  sink(b, back, 1.2);
  hobAndHood(b, back, 2.4);
  upperUnit(b, "upper_cabinets", back, 1.2, 1.2, 2);
  shelves(b, back, 3.0, 4.2, [1.55, 1.9]);
  shelfDecor(b, back, 3.0, [1.55, 1.9]);
  return { min: [0, 0, -3] as V3, max: [4.8, 2.6, 0] as V3 };
}

/** Island with cabinets facing the back wall (+z) and a seating overhang on the room side. */
function island(b: Builder, x0: number, units: BaseKind[], zCabinetBack: number, seats: number[]) {
  const x1 = x0 + units.length * 0.6;
  const isl: Frame = { origin: [x0, zCabinetBack], u: [1, 0], d: [0, 1], axis: "x" };
  units.forEach((k, i) => baseUnit(b, "island_panels", isl, i * 0.6, 0.6, k));
  const top = BASE_TOP + WORKTOP;
  const zFront = zCabinetBack + BASE_DEPTH + DOOR + 0.02;
  const zSeat = zCabinetBack - 0.32;
  b.box("island_panels__back_panel", [x0, 0, zCabinetBack - 0.02], [x1, BASE_TOP, zCabinetBack], b.mats.neutral);
  b.box("island_panels__end_panel", [x0 - 0.02, 0, zSeat], [x0, top, zFront], b.mats.neutral, { grainAxis: "y" });
  b.box("island_panels__end_panel", [x1, 0, zSeat], [x1 + 0.02, top, zFront], b.mats.neutral, { grainAxis: "y" });
  b.box("fixed__worktop", [x0, BASE_TOP, zSeat], [x1, top, zFront], b.mats.quartz);
  for (const x of seats) stool(b, x, zSeat - 0.23);
  for (const x of seats) pendant(b, x, (zSeat + zFront) / 2);
}

/** U-shaped kitchen: three walls of cabinets, tall units on the right, open shelves above. */
function buildUShape(b: Builder) {
  const W = 3.6;
  room(b, W, 4.0, { rightWall: true });
  const back: Frame = { origin: [0, 0], u: [1, 0], d: [0, -1], axis: "x" };
  const left: Frame = { origin: [0, 0], u: [0, -1], d: [1, 0], axis: "z" };
  const right: Frame = { origin: [W, 0], u: [0, -1], d: [-1, 0], axis: "z" };
  const wtDepth = BASE_DEPTH + DOOR + 0.02;

  baseUnit(b, "lower_cabinets", back, 0.6, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", back, 1.2, 0.6, "sink");
  baseUnit(b, "lower_cabinets", back, 1.8, 0.6, "doors");
  baseUnit(b, "lower_cabinets", back, 2.4, 0.6, "drawers");
  worktop(b, back, 0, W);
  splashback(b, back, 0, W);
  sink(b, back, 1.2);
  upperUnit(b, "upper_cabinets", back, 0.6, 1.2, 2);
  upperUnit(b, "upper_cabinets", back, 1.8, 1.2, 2);

  baseUnit(b, "lower_cabinets", left, 0, 0.6, "blind");
  baseUnit(b, "lower_cabinets", left, 0.6, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", left, 1.2, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", left, 1.8, 0.6, "door");
  b.runBox("lower_cabinets__end_panel", left, 2.4, 2.4 + DOOR, 0, wtDepth - 0.02, 0, BASE_TOP, b.mats.neutral);
  worktop(b, left, wtDepth, 2.4 + DOOR);
  splashback(b, left, 0.012, 2.4);
  hobAndHood(b, left, 1.2);
  upperUnit(b, "upper_cabinets", left, 1.8, 0.6, 1);

  baseUnit(b, "lower_cabinets", right, 0, 0.6, "blind");
  baseUnit(b, "lower_cabinets", right, 0.6, 0.6, "doors");
  worktop(b, right, wtDepth, 1.2);
  splashback(b, right, 0.012, 1.2);
  shelves(b, right, 0.62, 1.2, [1.5, 1.82, 2.14]);
  shelfDecor(b, right, 0.6, [1.5, 1.82, 2.14]);
  tallUnit(b, right, 1.2, 0.6, "oven");
  tallUnit(b, right, 1.8, 0.6, "fridge");
  b.runBox("tall_cabinets__end_panel", right, 2.4, 2.4 + DOOR, 0, BASE_DEPTH + DOOR, 0, TALL_Y1, b.mats.neutral);

  b.cylinder("fixed__bowl", [0.3, BASE_TOP + WORKTOP + 0.04, -0.9], 0.08, 0.3, b.mats.ceramicDark, 32);
  return { min: [0, 0, -3.6] as V3, max: [W, 2.6, 0] as V3 };
}

/** Galley kitchen: two parallel runs, the second with a breakfast-bar overhang. */
function buildGalley(b: Builder) {
  room(b, 4.2, 3.8);
  const back: Frame = { origin: [0, 0], u: [1, 0], d: [0, -1], axis: "x" };
  const left: Frame = { origin: [0, 0], u: [0, -1], d: [1, 0], axis: "z" };
  const zOpp = -2.7; // back of the opposite run; its fronts face the back wall
  const opp: Frame = { origin: [0, zOpp], u: [1, 0], d: [0, 1], axis: "x" };
  const top = BASE_TOP + WORKTOP;

  tallUnit(b, back, 0, 0.6, "fridge");
  tallUnit(b, back, 0.6, 0.6, "oven");
  baseUnit(b, "lower_cabinets", back, 1.2, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", back, 1.8, 0.6, "sink");
  baseUnit(b, "lower_cabinets", back, 2.4, 0.6, "doors");
  baseUnit(b, "lower_cabinets", back, 3.0, 0.6, "drawers");
  b.runBox("lower_cabinets__end_panel", back, 3.6, 3.6 + DOOR, 0, BASE_DEPTH + DOOR, 0, BASE_TOP, b.mats.neutral);
  worktop(b, back, 1.2, 3.6 + DOOR);
  splashback(b, back, 1.2, 3.6 + DOOR);
  sink(b, back, 1.8);
  upperUnit(b, "upper_cabinets", back, 1.2, 1.2, 2);
  upperUnit(b, "upper_cabinets", back, 2.4, 1.2, 2);

  baseUnit(b, "lower_cabinets", opp, 0.6, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", opp, 1.2, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", opp, 1.8, 0.6, "doors");
  baseUnit(b, "lower_cabinets", opp, 2.4, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", opp, 3.0, 0.6, "door");
  b.runBox("lower_cabinets__back_panel", opp, 0.6, 3.6, -0.02, 0, 0, BASE_TOP, b.mats.neutral);
  b.runBox("lower_cabinets__end_panel", opp, 0.6 - DOOR, 0.6, -0.32, BASE_DEPTH + DOOR, 0, top, b.mats.neutral);
  b.runBox("lower_cabinets__end_panel", opp, 3.6, 3.6 + DOOR, -0.32, BASE_DEPTH + DOOR, 0, top, b.mats.neutral);
  b.runBox("fixed__worktop", opp, 0.6, 3.6, -0.32, BASE_DEPTH + DOOR + 0.02, BASE_TOP, top, b.mats.quartz);
  hob(b, opp, 1.2);
  for (const x of [1.6, 2.4, 3.2]) stool(b, x, zOpp - 0.55);
  for (const x of [1.4, 2.6]) pendant(b, x, zOpp + 0.12);

  shelves(b, left, 0.95, 1.95, [1.5, 1.82, 2.14]);
  shelfDecor(b, left, 1.0, [1.5, 1.82, 2.14]);
  return { min: [0, 0, -3.6] as V3, max: [4.2, 2.6, 0] as V3 };
}

/** L-shaped kitchen with a peninsula breakfast bar. The peninsula uses the island region. */
function buildPeninsula(b: Builder) {
  room(b, 4.8, 4.2);
  const back: Frame = { origin: [0, 0], u: [1, 0], d: [0, -1], axis: "x" };
  const left: Frame = { origin: [0, 0], u: [0, -1], d: [1, 0], axis: "z" };
  const xp = 3.62; // back face of the peninsula cabinets
  const pen: Frame = { origin: [xp, 0], u: [0, -1], d: [-1, 0], axis: "z" };
  const top = BASE_TOP + WORKTOP;
  const wtDepth = BASE_DEPTH + DOOR + 0.02;

  baseUnit(b, "lower_cabinets", back, 0.6, 0.6, "sink");
  baseUnit(b, "lower_cabinets", back, 1.2, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", back, 1.8, 0.6, "doors");
  baseUnit(b, "lower_cabinets", back, 2.4, 0.6, "drawers");
  worktop(b, back, 0, xp - wtDepth);
  splashback(b, back, 0, xp);
  sink(b, back, 0.6);
  hobAndHood(b, back, 1.8);
  upperUnit(b, "upper_cabinets", back, 0.35, 0.85, 2);
  upperUnit(b, "upper_cabinets", back, 2.4, 0.6, 1);
  shelves(b, back, xp - 0.58, xp, [1.55, 1.9]);

  baseUnit(b, "lower_cabinets", left, 0, 0.6, "blind");
  baseUnit(b, "lower_cabinets", left, 0.6, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", left, 1.2, 0.6, "doors");
  worktop(b, left, wtDepth, 1.8);
  splashback(b, left, 0.012, 1.8);
  upperUnit(b, "upper_cabinets", left, 0, 0.9, 1, UPPER_DEPTH + DOOR + 0.002);
  tallUnit(b, left, 1.8, 0.6, "oven");
  tallUnit(b, left, 2.4, 0.6, "fridge");
  b.runBox("tall_cabinets__end_panel", left, 3.0, 3.0 + DOOR, 0, BASE_DEPTH + DOOR, 0, TALL_Y1, b.mats.neutral);

  baseUnit(b, "island_panels", pen, 0, 0.6, "blind");
  baseUnit(b, "island_panels", pen, 0.6, 0.6, "drawers");
  baseUnit(b, "island_panels", pen, 1.2, 0.6, "doors");
  baseUnit(b, "island_panels", pen, 1.8, 0.6, "drawers");
  b.box("island_panels__back_panel", [xp, 0, -2.4], [xp + 0.02, BASE_TOP, 0], b.mats.neutral);
  b.box("island_panels__end_panel", [xp - wtDepth, 0, -2.42], [xp + 0.34, top, -2.4], b.mats.neutral, { grainAxis: "y" });
  b.box("fixed__worktop", [xp - wtDepth, BASE_TOP, -2.4], [xp + 0.34, top, 0], b.mats.quartz);
  for (const z of [-1.0, -1.8]) stool(b, xp + 0.55, z);
  for (const z of [-1.0, -1.8]) pendant(b, xp + 0.05, z);
  b.cylinder("fixed__bowl", [xp - 0.2, top + 0.04, -1.4], 0.08, 0.3, b.mats.ceramicDark, 32);
  return { min: [0, 0, -3.8] as V3, max: [4.4, 2.6, 0] as V3 };
}

/** Straight run along one wall with a free-standing island. */
function buildStraightIsland(b: Builder) {
  room(b, 5.0, 4.6);
  const back: Frame = { origin: [0.2, 0], u: [1, 0], d: [0, -1], axis: "x" };
  tallUnit(b, back, 0, 0.6, "fridge");
  tallUnit(b, back, 0.6, 0.6, "oven");
  b.runBox("tall_cabinets__end_panel", back, -DOOR, 0, 0, BASE_DEPTH + DOOR, 0, TALL_Y1, b.mats.neutral);
  baseUnit(b, "lower_cabinets", back, 1.2, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", back, 1.8, 0.6, "doors");
  baseUnit(b, "lower_cabinets", back, 2.4, 0.6, "drawers");
  baseUnit(b, "lower_cabinets", back, 3.0, 0.6, "door");
  b.runBox("lower_cabinets__end_panel", back, 3.6, 3.6 + DOOR, 0, BASE_DEPTH + DOOR, 0, BASE_TOP, b.mats.neutral);
  worktop(b, back, 1.2, 3.6 + DOOR);
  splashback(b, back, 1.2, 3.6 + DOOR);
  hobAndHood(b, back, 1.8);
  upperUnit(b, "upper_cabinets", back, 1.2, 0.6, 1);
  upperUnit(b, "upper_cabinets", back, 2.4, 1.2, 2);
  shelves(b, back, 3.68, 4.48, [1.5, 1.82, 2.14]);
  shelfDecor(b, back, 3.7, [1.5, 1.82, 2.14]);

  island(b, 1.2, ["drawers", "sink", "doors", "drawers"], -2.1, [1.75, 2.65]);
  sink(b, { origin: [1.2, -2.1], u: [1, 0], d: [0, 1], axis: "x" }, 0.6);
  return { min: [0, 0, -4] as V3, max: [4.6, 2.6, 0] as V3 };
}

/** Assigns physical (metre-based) UVs to fixed meshes that carry textures, e.g. the floor. */
export function applyWorldUVs(mesh: Mesh, grainAxis: GrainAxis, offset: [number, number] = [0, 0]) {
  mesh.computeWorldMatrix(true);
  const pos = mesh.getVerticesData("position");
  const nor = mesh.getVerticesData("normal");
  if (!pos || !nor) return false;
  const wm = mesh.getWorldMatrix();
  const wp = new Float32Array(pos.length);
  const wn = new Float32Array(nor.length);
  const tmp = Vector3.Zero();
  for (let i = 0; i < pos.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(pos[i]!, pos[i + 1]!, pos[i + 2]!, wm, tmp);
    wp[i] = tmp.x;
    wp[i + 1] = tmp.y;
    wp[i + 2] = tmp.z;
    Vector3.TransformNormalFromFloatsToRef(nor[i]!, nor[i + 1]!, nor[i + 2]!, wm, tmp);
    wn[i] = tmp.x;
    wn[i + 1] = tmp.y;
    wn[i + 2] = tmp.z;
  }
  const uvs = computeBoxProjectedUVs(wp, wn, grainAxis, offset);
  // updatable=true so the admin inspector can re-project if a mapping changes.
  mesh.setVerticesData("uv", uvs, true);
  return true;
}

const BUILDERS: Record<ProceduralBuilderId, (b: Builder) => { min: V3; max: V3 }> = {
  "demo-l-island": buildLIsland,
  "demo-straight": buildStraight,
  "demo-u-shape": buildUShape,
  "demo-galley": buildGalley,
  "demo-peninsula": buildPeninsula,
  "demo-straight-island": buildStraightIsland,
};

export function buildProceduralKitchen(scene: Scene, builder: ProceduralBuilderId): BuiltKitchen {
  const root = new TransformNode(`kitchen_root_${builder}`, scene);
  const b = new Builder(scene, createMaterials(scene), root);
  const bounds = BUILDERS[builder](b);
  for (const m of b.meshes) {
    if (m.metadata?.physicalUV) applyWorldUVs(m, "x");
  }
  return { root, meshes: b.meshes, shadowCasters: b.casters, bounds };
}
