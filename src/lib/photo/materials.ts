/**
 * Which catalogue products can be laid onto a photo, and with what settings. Uses the same product
 * records and texture files as the 3D studio; nothing is substituted when a texture is missing.
 */
import type { Product } from "@/lib/catalogue/schema";
import { DEFAULT_TEXTURE_SCALE_M, textureRotationRad } from "@/lib/materials/materialSpec";
import type { SurfaceMapping } from "./composite";
import type { Quad } from "./perspective";

export type MaterialSource = { ok: true; kind: "texture"; url: string } | { ok: true; kind: "colour"; rgb: [number, number, number] } | { ok: false; reason: string };

/** Smallest texture image that is still useful on a photo. */
export const MIN_TEXTURE_EDGE = 64;

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Decides what to draw for a product. Products with neither a texture nor a colour cannot be applied. */
export function materialSource(product: Pick<Product, "panelCode" | "productName" | "textureUrl" | "colourHex">): MaterialSource {
  if (product.textureUrl) return { ok: true, kind: "texture", url: product.textureUrl };
  if (product.colourHex) {
    const rgb = hexToRgb(product.colourHex);
    if (rgb) return { ok: true, kind: "colour", rgb };
  }
  return { ok: false, reason: `${product.panelCode} (${product.productName}) has no texture image or colour in the catalogue, so it cannot be shown on your photo. Choose another panel, or ask us to add its texture.` };
}

/** Checks a loaded texture image. Returns a warning message, or null when it is usable. */
export function checkTexture(product: Pick<Product, "panelCode">, width: number, height: number): string | null {
  if (width < MIN_TEXTURE_EDGE || height < MIN_TEXTURE_EDGE)
    return `The texture image for ${product.panelCode} is only ${width} × ${height} pixels, too small to preview. It was not applied.`;
  return null;
}

export interface RegionLook {
  guide?: Quad;
  guideSizeCm: { w: number; h: number };
  /** User grain-size multiplier: 2 = grain twice as large. */
  scale: number;
  rotationDeg: number;
  mirror: boolean;
}

/** Real-world texture layout for a region: product repeat size and grain direction, plus the user's adjustments. */
export function surfaceMapping(product: Pick<Product, "textureScale" | "grainDirection" | "textureRotation">, look: RegionLook): SurfaceMapping {
  return {
    guide: look.guide ?? null,
    guideSizeM: { w: look.guideSizeCm.w / 100, h: look.guideSizeCm.h / 100 },
    repeatM: (product.textureScale ?? DEFAULT_TEXTURE_SCALE_M) * Math.max(0.1, look.scale),
    rotationRad: textureRotationRad(product) + (look.rotationDeg * Math.PI) / 180,
    mirror: look.mirror,
  };
}

/** True when the repeat size is an assumption rather than a catalogue value (Kastamonu does not state it). */
export const repeatIsAssumed = (product: Pick<Product, "textureScale">) => product.textureScale === undefined;
