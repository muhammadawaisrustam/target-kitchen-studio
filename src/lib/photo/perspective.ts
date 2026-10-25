/**
 * Perspective guides. The user drags four corners onto the edges of a cabinet face in the photo
 * (top-left, top-right, bottom-right, bottom-left). A homography maps that quadrilateral to a flat
 * rectangle, so the panel texture is laid out on the cabinet's plane and the wood grain follows
 * the cabinet's verticals and shrinks with distance, instead of running straight up the photo.
 */
import type { Point } from "./mask";

export type Quad = [Point, Point, Point, Point];
/** Row-major 3 × 3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const UNIT_SQUARE: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Solves A x = b by Gaussian elimination with partial pivoting. Returns null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** Homography H with H·src[i] ≅ dst[i] for the four point pairs. Null if the points are degenerate. */
export function homography(src: Quad, dst: Quad): Mat3 | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  if (!h || h.some((v) => !Number.isFinite(v))) return null;
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

export function applyHomography(H: Mat3, p: Point): Point {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** True when the four corners form a convex shape in order (no crossed or folded edges). */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(q[i]!, q[(i + 1) % 4]!, q[(i + 2) % 4]!);
    if (Math.abs(c) < 1e-9) return false;
    const s = Math.sign(c);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/**
 * Maps image pixels to positions on the guide's plane, in [0, 1] across the guide
 * (u along the top edge, v down the side edge). Null if the guide is not a usable shape.
 */
export function imageToGuide(q: Quad): Mat3 | null {
  if (!isConvexQuad(q)) return null;
  const H = homography(UNIT_SQUARE, q);
  return H ? invert3(H) : null;
}

/** An axis-aligned guide covering a box, used until the user adjusts the corners. */
export function rectGuide(box: { x0: number; y0: number; x1: number; y1: number }): Quad {
  return [
    { x: box.x0, y: box.y0 },
    { x: box.x1 + 1, y: box.y0 },
    { x: box.x1 + 1, y: box.y1 + 1 },
    { x: box.x0, y: box.y1 + 1 },
  ];
}

/** Average width / height of the guide in pixels; used to suggest a real-world width from a known height. */
export function guideAspect(q: Quad): number {
  const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  const w = (len(q[0], q[1]) + len(q[3], q[2])) / 2;
  const h = (len(q[0], q[3]) + len(q[1], q[2])) / 2;
  return h > 0 ? w / h : 1;
}
