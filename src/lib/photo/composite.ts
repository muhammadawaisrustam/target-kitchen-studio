/**
 * Material compositing for photo previews. Pure typed-array code (no DOM), so it runs the same in
 * the browser, in a worker and in unit tests.
 *
 * For each cabinet region:
 *   1. the panel texture is laid out on the plane described by the region's perspective guide
 *      (a homography), at a real-world repeat size, with the panel's grain direction and the
 *      user's rotation;
 *   2. it is multiplied by the photo's own shading (blurred luminance relative to the region's
 *      average), so shadows, door gaps and light fall-off stay where they were;
 *   3. it is blended into the image through the region mask. Pixels outside every mask are never
 *      written, so they stay byte-for-byte identical to the original photo.
 *
 * This is a visual approximation: it cannot re-light the scene, recover reflections or model
 * curved or profiled doors, and the result is labelled as an approximate preview in the UI.
 */
import type { Quad } from "./perspective";
import { imageToGuide, rectGuide } from "./perspective";
import type { Mask } from "./mask";
import { boundingBox, insideFeather } from "./mask";

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export type PhotoMaterial =
  | { kind: "texture"; panelCode: string; texture: RgbaImage }
  | { kind: "colour"; panelCode: string; rgb: [number, number, number] };

export interface SurfaceMapping {
  /** Cabinet-face guide in image pixels. Null = use the selection's bounding box, photo-aligned. */
  guide: Quad | null;
  /** Real-world size of the guide, in metres. */
  guideSizeM: { w: number; h: number };
  /** Metres covered by one repeat of the texture image. */
  repeatM: number;
  /** In-plane rotation of the texture (grain direction + user rotation), radians. */
  rotationRad: number;
  /** Mirror alternate repeats so the edges of non-seamless swatches meet without a hard seam. */
  mirror: boolean;
}

export interface RegionLayer {
  mask: Mask;
  material: PhotoMaterial;
  mapping: SurfaceMapping;
}

// sRGB <-> linear lookup tables.
const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const LIN_STEPS = 4096;
const TO_SRGB = new Uint8Array(LIN_STEPS + 1);
for (let i = 0; i <= LIN_STEPS; i++) {
  const c = i / LIN_STEPS;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  TO_SRGB[i] = Math.round(Math.min(1, Math.max(0, s)) * 255);
}
const toSrgb = (lin: number) => TO_SRGB[lin <= 0 ? 0 : lin >= 1 ? LIN_STEPS : (lin * LIN_STEPS) | 0]!;

/** Linear luminance of the photo, lightly blurred so fine texture of the OLD finish does not print through. */
export function computeShading(img: RgbaImage, blurRadius = 2): Float32Array {
  const { width: w, height: h, data } = img;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.2126 * TO_LINEAR[data[i * 4]!]! + 0.7152 * TO_LINEAR[data[i * 4 + 1]!]! + 0.0722 * TO_LINEAR[data[i * 4 + 2]!]!;
  if (blurRadius <= 0) return lum;
  return boxBlur(boxBlur(lum, w, h, blurRadius), w, h, blurRadius);
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

/** Mean shading inside a mask, used to normalise so the panel keeps its own brightness. */
export function meanInside(shading: Float32Array, mask: Mask): number {
  let sum = 0, n = 0;
  for (let i = 0; i < mask.data.length; i++)
    if (mask.data[i]) {
      sum += shading[i]!;
      n++;
    }
  return n ? sum / n : 0;
}

const wrap = (i: number, n: number, mirror: boolean) => {
  if (!mirror) return ((i % n) + n) % n;
  const p = 2 * n;
  const m = ((i % p) + p) % p;
  return m < n ? m : p - 1 - m;
};

/**
 * Composites one region into `out` (RGBA, same size as the photo) in place.
 * @param strength 0 = flat texture, 1 = full original shading
 */
export function compositeRegion(out: Uint8ClampedArray | Uint8Array, width: number, height: number, layer: RegionLayer, shading: Float32Array, strength: number): { written: number } {
  const { mask, material, mapping } = layer;
  if (mask.width !== width || mask.height !== height) throw new Error("Mask and photo sizes differ.");
  const box = boundingBox(mask);
  if (!box) return { written: 0 };
  const guide = mapping.guide ?? rectGuide(box);
  const Hinv = imageToGuide(guide) ?? imageToGuide(rectGuide(box));
  if (!Hinv) return { written: 0 };
  const alpha = insideFeather(mask, 1);
  const mean = meanInside(shading, mask) || 1;
  const k = Math.max(0, Math.min(1, strength));

  const gw = Math.max(0.01, mapping.guideSizeM.w), gh = Math.max(0.01, mapping.guideSizeM.h);
  const cos = Math.cos(mapping.rotationRad), sin = Math.sin(mapping.rotationRad);
  const repeat = Math.max(0.01, mapping.repeatM);

  const tex = material.kind === "texture" ? material.texture : null;
  const tw = tex?.width ?? 1, th = tex?.height ?? 1;
  const td = tex?.data;
  const flat = material.kind === "colour" ? material.rgb.map((c) => TO_LINEAR[c]!) : null;
  // Average texture colour, used if a pixel falls beyond the guide's horizon line.
  let avg = [0.5, 0.5, 0.5];
  if (td) {
    const s = [0, 0, 0];
    const step = Math.max(1, Math.floor((tw * th) / 4096));
    let n = 0;
    for (let i = 0; i < tw * th; i += step, n++) for (let c = 0; c < 3; c++) s[c]! += TO_LINEAR[td[i * 4 + c]!]!;
    avg = s.map((v) => v / n);
  }
  const [a, b, c, d, e, f, g, hh, ii] = Hinv;
  let written = 0;

  for (let y = box.y0; y <= box.y1; y++) {
    const py = y + 0.5;
    for (let x = box.x0; x <= box.x1; x++) {
      const idx = y * width + x;
      const al = alpha[idx]!;
      if (!al) continue;
      const px = x + 0.5;
      let r: number, gr: number, bl: number;
      if (flat) {
        r = flat[0]!;
        gr = flat[1]!;
        bl = flat[2]!;
      } else {
        const wq = g * px + hh * py + ii;
        if (wq <= 1e-9) {
          r = avg[0]!;
          gr = avg[1]!;
          bl = avg[2]!;
        } else {
          // Position on the cabinet plane in metres, then rotated and scaled into texture pixels.
          const mx = ((a * px + b * py + c) / wq) * gw;
          const my = ((d * px + e * py + f) / wq) * gh;
          const tx = ((cos * mx + sin * my) / repeat) * tw - 0.5;
          const ty = ((-sin * mx + cos * my) / repeat) * th - 0.5;
          const x0 = Math.floor(tx), y0 = Math.floor(ty);
          const fx = tx - x0, fy = ty - y0;
          const xa = wrap(x0, tw, mapping.mirror), xb = wrap(x0 + 1, tw, mapping.mirror);
          const ya = wrap(y0, th, mapping.mirror), yb = wrap(y0 + 1, th, mapping.mirror);
          const i00 = (ya * tw + xa) * 4, i10 = (ya * tw + xb) * 4, i01 = (yb * tw + xa) * 4, i11 = (yb * tw + xb) * 4;
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          r = TO_LINEAR[td![i00]!]! * w00 + TO_LINEAR[td![i10]!]! * w10 + TO_LINEAR[td![i01]!]! * w01 + TO_LINEAR[td![i11]!]! * w11;
          gr = TO_LINEAR[td![i00 + 1]!]! * w00 + TO_LINEAR[td![i10 + 1]!]! * w10 + TO_LINEAR[td![i01 + 1]!]! * w01 + TO_LINEAR[td![i11 + 1]!]! * w11;
          bl = TO_LINEAR[td![i00 + 2]!]! * w00 + TO_LINEAR[td![i10 + 2]!]! * w10 + TO_LINEAR[td![i01 + 2]!]! * w01 + TO_LINEAR[td![i11 + 2]!]! * w11;
        }
      }
      let s = 1 + k * (shading[idx]! / mean - 1);
      if (s < 0.05) s = 0.05;
      else if (s > 2.2) s = 2.2;
      const o = idx * 4;
      const t = al / 255;
      out[o] = Math.round(toSrgb(r * s) * t + out[o]! * (1 - t));
      out[o + 1] = Math.round(toSrgb(gr * s) * t + out[o + 1]! * (1 - t));
      out[o + 2] = Math.round(toSrgb(bl * s) * t + out[o + 2]! * (1 - t));
      written++;
    }
  }
  return { written };
}

/** Builds the full preview: a copy of the original with every region composited in order. */
export function compositeAll(original: RgbaImage, layers: RegionLayer[], shading: Float32Array, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(original.data);
  for (const layer of layers) compositeRegion(out, original.width, original.height, layer, shading, strength);
  return out;
}
