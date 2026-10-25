/**
 * Upload checks for "My Kitchen Photo". Pure functions so they can be unit tested in Node.
 *
 * The file's type is decided from its first bytes ("magic numbers"), not only from its name or
 * the browser-supplied MIME type, because both can be wrong (renamed files, HEIC from iPhones).
 */

export const ACCEPTED_IMAGE_KINDS = ["jpeg", "png", "webp"] as const;
export type ImageKind = (typeof ACCEPTED_IMAGE_KINDS)[number];

export const ACCEPTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
export const ACCEPT_ATTRIBUTE = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

/** Largest file accepted. Phone photos are usually 2 to 8 MB. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Guards against images that would use too much memory when decoded. */
export const MAX_PIXELS = 60_000_000;
/** Smaller photos do not have enough detail to select cabinet doors. */
export const MIN_EDGE = 320;
/** Long edge used for selection and compositing. Large enough to look sharp, small enough to stay fast on phones. */
export const PROCESSING_MAX_EDGE = 1600;

export type ValidationResult = { ok: true; kind: ImageKind } | { ok: false; error: string };

const MIME_TO_KIND: Record<string, ImageKind> = { "image/jpeg": "jpeg", "image/jpg": "jpeg", "image/pjpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

/** Detects the real image format from the first bytes of the file. */
export function sniffImageKind(head: Uint8Array): ImageKind | "heic" | "gif" | null {
  const b = head;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1|avif)$/.test(ascii(8, 12))) return "heic";
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "gif";
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Checks a chosen file before it is decoded.
 * @param file name, browser MIME type and size of the file
 * @param head at least the first 16 bytes of the file
 */
export function validateImageFile(file: { name: string; type: string; size: number }, head: Uint8Array): ValidationResult {
  if (file.size === 0) return { ok: false, error: "This file is empty. Please choose another photo." };
  if (file.size > MAX_FILE_BYTES)
    return { ok: false, error: `This photo is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}. Please export a smaller JPG from your phone or photo app.` };
  const sniffed = sniffImageKind(head);
  if (sniffed === "heic")
    return {
      ok: false,
      error: "This looks like an iPhone HEIC/HEIF photo, which browsers cannot open. Share or export it as JPG (on iPhone: Settings › Camera › Formats › Most Compatible), then try again.",
    };
  if (sniffed === "gif") return { ok: false, error: "GIF images are not supported. Please use a JPG, PNG or WebP photo." };
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : "";
  const extOk = (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext);
  const mimeKind = MIME_TO_KIND[file.type.toLowerCase()];
  if (!sniffed) {
    if (!extOk && !mimeKind) return { ok: false, error: `“${file.name}” is not a supported image. Please choose a JPG, JPEG, PNG or WebP photo.` };
    return { ok: false, error: `“${file.name}” is named like an image but its contents are not a valid JPG, PNG or WebP file. It may be damaged.` };
  }
  return { ok: true, kind: sniffed };
}

/** Checks the decoded image size. */
export function validateDimensions(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "The photo could not be read. It may be damaged.";
  if (width * height > MAX_PIXELS) return `This photo is ${width} × ${height} pixels, which is too large to process in the browser. Please use one under ${Math.round(MAX_PIXELS / 1e6)} megapixels.`;
  if (Math.min(width, height) < MIN_EDGE) return `This photo is only ${width} × ${height} pixels. Please use one at least ${MIN_EDGE} pixels on the short side so cabinet doors can be selected.`;
  return null;
}

/** Size that fits inside maxEdge on the long side, keeping the aspect ratio. Never enlarges. */
export function fitWithin(width: number, height: number, maxEdge = PROCESSING_MAX_EDGE): { width: number; height: number; scale: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

// ---------- EXIF orientation ----------

/**
 * Reads the EXIF orientation tag (1 to 8) of a JPEG. Returns 1 when there is none.
 * Only the first 128 KB is needed, as EXIF sits at the start of the file.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (view.getUint8(offset) !== 0xff) return 1;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) return 1; // start of scan / end: no EXIF before image data
    const size = view.getUint16(offset + 2);
    if (marker === 0xe1 && offset + 10 <= bytes.length && view.getUint32(offset + 4) === 0x45786966 /* "Exif" */) {
      const tiff = offset + 10;
      if (tiff + 8 > bytes.length) return 1;
      const little = view.getUint16(tiff) === 0x4949;
      const u16 = (p: number) => view.getUint16(p, little);
      const u32 = (p: number) => view.getUint32(p, little);
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > bytes.length) return 1;
      const entries = u16(ifd);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) return 1;
        if (u16(entry) === 0x0112) {
          const v = u16(entry + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    offset += 2 + size;
  }
  return 1;
}

/** Orientations 5 to 8 swap width and height. */
export const orientationSwapsAxes = (orientation: number) => orientation >= 5 && orientation <= 8;

/**
 * Canvas transform [a, b, c, d, e, f] that draws a raw (sensor-orientation) image of size w × h
 * upright. Used only when the browser has not already applied the EXIF orientation.
 */
export function orientationTransform(orientation: number, w: number, h: number): [number, number, number, number, number, number] {
  switch (orientation) {
    case 2: return [-1, 0, 0, 1, w, 0];
    case 3: return [-1, 0, 0, -1, w, h];
    case 4: return [1, 0, 0, -1, 0, h];
    case 5: return [0, 1, 1, 0, 0, 0];
    case 6: return [0, 1, -1, 0, h, 0];
    case 7: return [0, -1, -1, 0, h, w];
    case 8: return [0, -1, 1, 0, 0, w];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

/** Stored pixel size of a JPEG (before any EXIF rotation), from its frame header. Null if not found. */
export function readJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (view.getUint8(offset) !== 0xff) return null;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const size = view.getUint16(offset + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    if (marker === 0xda) return null;
    offset += 2 + size;
  }
  return null;
}

/**
 * Whether a decoder ignored the EXIF orientation. Only detectable for orientations that swap the
 * axes (5 to 8): an upright decode of those has width and height swapped compared with the file.
 */
export function orientationWasIgnored(orientation: number, stored: { width: number; height: number } | null, decoded: { width: number; height: number }): boolean {
  if (!orientationSwapsAxes(orientation) || !stored || stored.width === stored.height) return false;
  return decoded.width === stored.width && decoded.height === stored.height;
}
