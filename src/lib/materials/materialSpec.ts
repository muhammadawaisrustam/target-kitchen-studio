import type { Product } from "@/lib/catalogue/schema";

/**
 * Pure mapping from a product record to renderer-agnostic material settings.
 * Keeping this free of Babylon.js makes the rules unit-testable and reusable
 * (e.g. for a future server-side render or a different 3D engine).
 */

export type MaterialKind = "texture" | "colour" | "placeholder";

export interface MaterialSpec {
  kind: MaterialKind;
  productId: string;
  panelCode: string;
  textureUrl?: string;
  colourHex?: string;
  /** Texture repeats per metre of surface (UVs are authored in metres). */
  repeatsPerMetre: number;
  /** Total in-plane rotation of the texture in radians. */
  rotationRad: number;
  roughness: number;
  /** Where the roughness value came from, so the UI can say when it is an estimate. */
  roughnessSource: "product" | "finish-default" | "fallback";
  metallic: number;
  warning?: string;
}

/**
 * Typical roughness per finish name, used ONLY when a product has no measured roughness.
 * These are rendering estimates, not product specifications, and are labelled as such in the UI.
 */
export const FINISH_ROUGHNESS: Record<string, number> = {
  "super matt": 0.92,
  "ultra matt": 0.92,
  matt: 0.8,
  "textured matt": 0.76,
  "deep texture": 0.78,
  satin: 0.5,
  "semi gloss": 0.32,
  gloss: 0.18,
  "high gloss": 0.1,
  "super gloss": 0.06,
};
const FALLBACK_ROUGHNESS = 0.7;
/** Texture source images are authored with the grain running along the image height. */
export const DEFAULT_TEXTURE_SCALE_M = 1;

export function roughnessFor(product: Pick<Product, "roughness" | "finish">): {
  value: number;
  source: MaterialSpec["roughnessSource"];
} {
  if (typeof product.roughness === "number") return { value: product.roughness, source: "product" };
  const preset = FINISH_ROUGHNESS[product.finish.trim().toLowerCase()];
  if (preset !== undefined) return { value: preset, source: "finish-default" };
  return { value: FALLBACK_ROUGHNESS, source: "fallback" };
}

export function textureRotationRad(product: Pick<Product, "grainDirection" | "textureRotation">): number {
  const grain = product.grainDirection === "horizontal" ? 90 : 0;
  return (((grain + (product.textureRotation ?? 0)) % 360) * Math.PI) / 180;
}

export function productToMaterialSpec(product: Product): MaterialSpec {
  const { value: roughness, source: roughnessSource } = roughnessFor(product);
  const base = {
    productId: product.id,
    panelCode: product.panelCode,
    repeatsPerMetre: 1 / (product.textureScale ?? DEFAULT_TEXTURE_SCALE_M),
    rotationRad: textureRotationRad(product),
    roughness,
    roughnessSource,
    metallic: product.metalness ?? 0,
  };
  if (product.textureUrl) return { ...base, kind: "texture", textureUrl: product.textureUrl };
  if (product.colourHex) return { ...base, kind: "colour", colourHex: product.colourHex };
  return {
    ...base,
    kind: "placeholder",
    warning: `${product.panelCode} has no texture or colour data, so it cannot be previewed. A neutral placeholder is shown instead.`,
  };
}

/** Spec used when a texture fails to load. Never substitutes another product's texture. */
export function missingTextureSpec(product: Product, reason?: string): MaterialSpec {
  const spec = productToMaterialSpec(product);
  return {
    ...spec,
    kind: "placeholder",
    textureUrl: undefined,
    colourHex: undefined,
    warning: `The texture for ${product.panelCode} (${product.productName}) could not be loaded${reason ? ` (${reason})` : ""}. A neutral placeholder is shown; no other panel has been substituted.`,
  };
}
