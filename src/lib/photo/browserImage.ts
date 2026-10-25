/**
 * Browser-side image loading for the photo visualiser. Everything happens on this device: the
 * file is read, checked, decoded, turned upright and resized in memory. Nothing is uploaded.
 */
import type { Product } from "@/lib/catalogue/schema";
import type { PhotoMaterial, RgbaImage } from "./composite";
import { checkTexture, materialSource } from "./materials";
import {
  fitWithin,
  orientationTransform,
  orientationWasIgnored,
  orientationSwapsAxes,
  readJpegOrientation,
  readJpegSize,
  validateDimensions,
  validateImageFile,
  type ImageKind,
} from "./validation";

export interface LoadedPhoto {
  fileName: string;
  kind: ImageKind;
  fileBytes: number;
  /** Size of the photo as taken (upright). */
  originalWidth: number;
  originalHeight: number;
  /** Image used for editing and previews (resized). */
  image: ImageData;
  orientation: number;
  /** True when this code had to rotate the photo because the browser did not. */
  rotatedManually: boolean;
}

export class PhotoError extends Error {}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // Fall through to <img>, which some browsers decode more leniently.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new PhotoError("This photo could not be opened. It may be damaged or in a format this browser cannot read.");
  }
}

export async function loadPhotoFile(file: File, maxEdge?: number): Promise<LoadedPhoto> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const check = validateImageFile(file, head);
  if (!check.ok) throw new PhotoError(check.error);
  const orientation = check.kind === "jpeg" ? readJpegOrientation(head) : 1;
  const stored = check.kind === "jpeg" ? readJpegSize(head) : null;
  const img = await decode(file);
  try {
    const manual = orientationWasIgnored(orientation, stored, img);
    const uprightW = manual && orientationSwapsAxes(orientation) ? img.height : img.width;
    const uprightH = manual && orientationSwapsAxes(orientation) ? img.width : img.height;
    const dimError = validateDimensions(uprightW, uprightH);
    if (dimError) throw new PhotoError(dimError);
    const size = fitWithin(uprightW, uprightH, maxEdge);
    const canvas = newCanvas(size.width, size.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new PhotoError("This browser could not prepare the photo (no 2D canvas).");
    ctx.imageSmoothingQuality = "high";
    ctx.scale(size.scale, size.scale);
    if (manual) ctx.transform(...orientationTransform(orientation, img.width, img.height));
    ctx.drawImage(img.source, 0, 0);
    return {
      fileName: file.name,
      kind: check.kind,
      fileBytes: file.size,
      originalWidth: uprightW,
      originalHeight: uprightH,
      image: ctx.getImageData(0, 0, size.width, size.height),
      orientation,
      rotatedManually: manual,
    };
  } finally {
    img.close();
  }
}

/** Loads a saved photo (already upright and resized) back into pixels. */
export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const img = await decode(blob);
  try {
    const canvas = newCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img.source, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  } finally {
    img.close();
  }
}

export function imageDataToCanvas(img: ImageData | RgbaImage): HTMLCanvasElement {
  const c = newCanvas(img.width, img.height);
  const data = img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  c.getContext("2d")!.putImageData(data, 0, 0);
  return c;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The image could not be created."))), type, quality));
}

// ---------- panel textures ----------

export type MaterialResult = { ok: true; material: PhotoMaterial } | { ok: false; reason: string };

const textureCache = new Map<string, Promise<RgbaImage>>();

async function loadTexture(url: string): Promise<RgbaImage> {
  let p = textureCache.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const img = await decode(await res.blob());
      try {
        const c = newCanvas(img.width, img.height);
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img.source, 0, 0);
        const d = ctx.getImageData(0, 0, img.width, img.height);
        return { width: d.width, height: d.height, data: d.data };
      } finally {
        img.close();
      }
    })();
    textureCache.set(url, p);
    p.catch(() => textureCache.delete(url)); // allow a retry later
  }
  return p;
}

/** Loads the product's own texture or colour. Never falls back to another product. */
export async function loadProductMaterial(product: Product): Promise<MaterialResult> {
  const src = materialSource(product);
  if (!src.ok) return { ok: false, reason: src.reason };
  if (src.kind === "colour") return { ok: true, material: { kind: "colour", panelCode: product.panelCode, rgb: src.rgb } };
  try {
    const texture = await loadTexture(src.url);
    const problem = checkTexture(product, texture.width, texture.height);
    if (problem) return { ok: false, reason: problem };
    return { ok: true, material: { kind: "texture", panelCode: product.panelCode, texture } };
  } catch (err) {
    return {
      ok: false,
      reason: `The texture image for ${product.panelCode} (${product.productName}) could not be loaded (${(err as Error).message}). It was not applied, and no other panel was substituted.`,
    };
  }
}
