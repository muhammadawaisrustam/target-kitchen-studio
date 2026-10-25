/**
 * Selection masks for cabinet regions. A mask is one byte per pixel of the processing image:
 * 0 = not selected, 255 = selected. All operations are pure (they return a new mask or write into
 * a mask passed in explicitly) so they can be unit tested and undone.
 */

export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export type Point = { x: number; y: number };

export const ON = 255;

export function createMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

export function cloneMask(m: Mask): Mask {
  return { width: m.width, height: m.height, data: m.data.slice() };
}

const sameSize = (a: Mask, b: Mask) => {
  if (a.width !== b.width || a.height !== b.height) throw new Error("Masks have different sizes.");
};

export function countSelected(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) n++;
  return n;
}

export function isEmpty(m: Mask): boolean {
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) return false;
  return true;
}

export function boundingBox(m: Mask): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = m.width, y0 = m.height, x1 = -1, y1 = -1;
  for (let y = 0; y < m.height; y++) {
    const row = y * m.width;
    for (let x = 0; x < m.width; x++) {
      if (m.data[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Sets every pixel of `src` that is on to `value` in `target` (in place). */
export function applyInto(target: Mask, src: Mask, value: 0 | 255) {
  sameSize(target, src);
  for (let i = 0; i < src.data.length; i++) if (src.data[i]) target.data[i] = value;
}

export function union(a: Mask, b: Mask): Mask {
  sameSize(a, b);
  const out = cloneMask(a);
  applyInto(out, b, ON);
  return out;
}

export function subtract(a: Mask, b: Mask): Mask {
  sameSize(a, b);
  const out = cloneMask(a);
  applyInto(out, b, 0);
  return out;
}

export function intersect(a: Mask, b: Mask): Mask {
  sameSize(a, b);
  const out = createMask(a.width, a.height);
  for (let i = 0; i < a.data.length; i++) out.data[i] = a.data[i] && b.data[i] ? ON : 0;
  return out;
}

export function invert(a: Mask): Mask {
  const out = createMask(a.width, a.height);
  for (let i = 0; i < a.data.length; i++) out.data[i] = a.data[i] ? 0 : ON;
  return out;
}

/** Paints a filled circle into the mask (in place). */
export function paintCircle(m: Mask, cx: number, cy: number, radius: number, value: 0 | 255) {
  const r = Math.max(0.5, radius);
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(m.width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(m.height - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) m.data[y * m.width + x] = value;
    }
  }
}

/** Paints a brush stroke from `a` to `b` with round ends (in place). */
export function paintSegment(m: Mask, a: Point, b: Point, radius: number, value: 0 | 255) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const step = Math.max(0.5, radius / 3);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    paintCircle(m, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius, value);
  }
}

/** Fills a polygon (even-odd rule, pixel centres) into the mask (in place). */
export function fillPolygon(m: Mask, pts: Point[], value: 0 | 255) {
  if (pts.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(m.height - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
      if ((p.y <= sy && q.y > sy) || (q.y <= sy && p.y > sy)) xs.push(p.x + ((sy - p.y) / (q.y - p.y)) * (q.x - p.x));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k]! - 0.5)), to = Math.min(m.width - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let x = from; x <= to; x++) m.data[y * m.width + x] = value;
    }
  }
}

/**
 * "Smart select": grows a region from a clicked pixel over neighbouring pixels whose colour is
 * close to the clicked colour (a classic magic-wand fill, not AI). Pixels in `barrier` (for
 * example protected worktops) are never included.
 * @param rgba image pixels (RGBA, 4 bytes per pixel)
 * @param tolerance 0 to 100; colour distance allowed from the clicked pixel
 */
export function floodSelect(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, seed: Point, tolerance: number, barrier?: Mask): Mask {
  const out = createMask(width, height);
  const sx = Math.floor(seed.x), sy = Math.floor(seed.y);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return out;
  const start = sy * width + sx;
  if (barrier?.data[start]) return out;
  // Colours are compared as brightness plus colour difference (YCbCr), with colour weighted
  // more, so a shaded door does not "match" a differently coloured wall of similar brightness.
  // The reference colour is the median of a 5 × 5 patch, so a click on a speck of grain or a
  // reflection does not throw it off.
  const [sr, sg, sb] = seedColour(rgba, width, height, sx, sy, 2);
  const sY = 0.299 * sr + 0.587 * sg + 0.114 * sb, sCb = sb - sY, sCr = sr - sY;
  const t = Math.max(0, Math.min(100, tolerance)) * 2.2;
  const limit = t * t;
  const stack = new Int32Array(width * height);
  let top = 0;
  stack[top++] = start;
  out.data[start] = ON;
  while (top > 0) {
    const i = stack[--top]!;
    const x = i % width;
    const y = (i - x) / width;
    for (let k = 0; k < 4; k++) {
      let nx = x, ny = y;
      if (k === 0) nx--;
      else if (k === 1) nx++;
      else if (k === 2) ny--;
      else ny++;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (out.data[j] || barrier?.data[j]) continue;
      const cr = rgba[j * 4]!, cg = rgba[j * 4 + 1]!, cb = rgba[j * 4 + 2]!;
      const lum = 0.299 * cr + 0.587 * cg + 0.114 * cb;
      const dY = lum - sY, dCb = cb - lum - sCb, dCr = cr - lum - sCr;
      if (dY * dY + 1.5 * (dCb * dCb + dCr * dCr) <= limit) {
        out.data[j] = ON;
        stack[top++] = j;
      }
    }
  }
  return out;
}

/** Per-channel median colour of the (2r+1)² patch around (x, y), clipped to the image. */
export function seedColour(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, x: number, y: number, r: number): [number, number, number] {
  const ch: number[][] = [[], [], []];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const i = (yy * width + xx) * 4;
      for (let c = 0; c < 3; c++) ch[c]!.push(rgba[i + c]!);
    }
  return ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]!) as [number, number, number];
}

/** Closes pinholes left by smart select (wood grain, reflections): dilate then erode by `r` pixels. */
export function closeHoles(m: Mask, r = 1): Mask {
  return erode(dilate(m, r), r);
}

export function dilate(m: Mask, r: number): Mask {
  return morph(m, r, true);
}
export function erode(m: Mask, r: number): Mask {
  return morph(m, r, false);
}

function morph(m: Mask, r: number, grow: boolean): Mask {
  const { width: w, height: h } = m;
  const tmp = new Uint8Array(w * h);
  const out = createMask(w, h);
  // Separable square structuring element.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : ON;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        const s = xx < 0 || xx >= w ? (grow ? 0 : m.data[y * w + x]!) : m.data[y * w + xx]!;
        if (grow ? s : !s) {
          v = grow ? ON : 0;
          break;
        }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : ON;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        const s = yy < 0 || yy >= h ? (grow ? 0 : tmp[y * w + x]!) : tmp[yy * w + x]!;
        if (grow ? s : !s) {
          v = grow ? ON : 0;
          break;
        }
      }
      out.data[y * w + x] = v;
    }
  }
  return out;
}

/**
 * Soft edge alpha (0 to 255) for compositing. Edges are softened only INSIDE the mask, so pixels
 * outside the selection always stay exactly as they were in the photo.
 */
export function insideFeather(m: Mask, r = 1): Uint8Array {
  const { width: w, height: h, data } = m;
  const out = new Uint8Array(w * h);
  const size = (2 * r + 1) * (2 * r + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!data[i]) continue;
      let on = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          if (data[yy * w + xx]) on++;
        }
      }
      // Fully surrounded pixels are 255; edge pixels fade but never below about half.
      out[i] = Math.round(127 + (128 * on) / size);
    }
  }
  return out;
}

// ---------- compact storage (run-length encoding) ----------

/**
 * Encodes a mask as base64 run lengths (alternating off/on runs, starting with off), each run
 * written as a variable-length integer. Cabinet masks are mostly long runs, so a 1600 × 1200
 * mask is usually a few kilobytes.
 */
export function encodeRle(m: Mask): string {
  const bytes: number[] = [];
  const push = (n: number) => {
    while (n >= 0x80) {
      bytes.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    bytes.push(n);
  };
  let current = 0;
  let run = 0;
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i] ? 1 : 0;
    if (v === current) run++;
    else {
      push(run);
      current = v;
      run = 1;
    }
  }
  push(run);
  return bytesToBase64(Uint8Array.from(bytes));
}

export function decodeRle(encoded: string, width: number, height: number): Mask {
  const bytes = base64ToBytes(encoded);
  const m = createMask(width, height);
  let pos = 0;
  let value = 0;
  let i = 0;
  while (i < bytes.length) {
    let n = 0;
    let mul = 1;
    let b: number;
    do {
      if (i >= bytes.length) throw new Error("Damaged mask data.");
      b = bytes[i++]!;
      n += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    if (pos + n > m.data.length) throw new Error("Mask data does not match the image size.");
    if (value) m.data.fill(ON, pos, pos + n);
    pos += n;
    value = value ? 0 : 1;
  }
  if (pos !== m.data.length) throw new Error("Mask data does not match the image size.");
  return m;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBytes(s: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
