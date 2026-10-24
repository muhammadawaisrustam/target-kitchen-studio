import type { GrainAxis } from "@/lib/models/types";

const AXES = ["x", "y", "z"] as const;

/**
 * Computes planar "box projection" UVs, in metres, from world-space positions and normals.
 *
 * Why: primitive boxes come with 0..1 UVs per face, which stretches wood grain differently on
 * every door. Projecting world positions gives every surface the same physical texture scale,
 * so a 1 m texture tile covers 1 m of door regardless of the door's size.
 *
 * For each vertex, the face plane is chosen from the dominant normal axis. The V coordinate
 * follows `grainAxis` when that axis lies in the face plane (e.g. vertical grain on a door
 * front, lengthwise grain on a shelf top); otherwise V falls back to the plane's other axis
 * (end grain on panel edges). Texture images are authored with grain along V.
 *
 * `offset` shifts the texture per mesh so neighbouring doors do not show identical grain.
 */
export function computeBoxProjectedUVs(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  grainAxis: GrainAxis = "y",
  offset: [number, number] = [0, 0],
): Float32Array {
  const count = Math.floor(positions.length / 3);
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const p = [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
    const n = [Math.abs(normals[i * 3]!), Math.abs(normals[i * 3 + 1]!), Math.abs(normals[i * 3 + 2]!)];
    const dominant = n[0]! >= n[1]! && n[0]! >= n[2]! ? 0 : n[1]! >= n[2]! ? 1 : 2;
    const inPlane = [0, 1, 2].filter((a) => a !== dominant) as [number, number];
    const g = AXES.indexOf(grainAxis);
    const vAxis = inPlane.includes(g) ? g : inPlane[0]!;
    const uAxis = inPlane[0] === vAxis ? inPlane[1] : inPlane[0];
    uvs[i * 2] = p[uAxis]! + offset[0];
    uvs[i * 2 + 1] = p[vAxis]! + offset[1];
  }
  return uvs;
}

/** Small deterministic hash used to give each mesh a stable texture offset. */
export function stableOffset(name: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const a = ((h >>> 0) % 1000) / 1000;
  const b = (((h >>> 10) >>> 0) % 1000) / 1000;
  return [a * 3.7, b * 2.9];
}
