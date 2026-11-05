import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./dataDir";
import { StorageUnavailableError } from "./enquiryStore";

/**
 * Images uploaded from the admin (panel swatches, textures, brand logos).
 *  - Supabase Storage, public bucket "catalogue-media", when Supabase is configured. The URL is
 *    an https:// link on the Supabase project.
 *  - Otherwise DATA_DIR/media on the server's disk, served by /api/media/<file>.
 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MEDIA_BUCKET = "catalogue-media";

const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
export type ImageExt = keyof typeof TYPES;
export const contentTypeOf = (ext: string) => TYPES[ext as ImageExt];

/** Detects the format from the file's first bytes, so a renamed file cannot pass as an image. */
export function sniffImage(buf: Uint8Array): ImageExt | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (String.fromCharCode(...buf.slice(0, 4)) === "RIFF" && String.fromCharCode(...buf.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

export const safeName = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";

export function mediaFileName(original: string, ext: ImageExt) {
  return `${safeName(original)}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
}

export const mediaDir = () => path.join(dataDir(), "media");

export async function saveImage(original: string, bytes: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<{ url: string; bytes: number }> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new StorageUnavailableError("The image is larger than 4 MB.");
  const ext = sniffImage(bytes);
  if (!ext) throw new StorageUnavailableError("Only JPG, PNG and WebP images can be uploaded.");
  const name = mediaFileName(original, ext);
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    const base = SUPABASE_URL.replace(/\/$/, "");
    let res: Response;
    try {
      res = await fetchImpl(`${base}/storage/v1/object/${MEDIA_BUCKET}/${name}`, {
        method: "POST",
        headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": TYPES[ext], "Cache-Control": "31536000" },
        body: bytes as unknown as BodyInit,
      });
    } catch (err) {
      throw new StorageUnavailableError("The image store could not be reached.", err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new StorageUnavailableError(
        `The image store refused the upload (HTTP ${res.status}).${/bucket/i.test(text) ? ` Create the public bucket "${MEDIA_BUCKET}" (supabase/schema.sql does this).` : ""}`,
        text,
      );
    }
    return { url: `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${name}`, bytes: bytes.byteLength };
  }
  try {
    await fs.mkdir(mediaDir(), { recursive: true });
    await fs.writeFile(path.join(mediaDir(), name), bytes);
  } catch (err) {
    throw new StorageUnavailableError("Images cannot be saved on this server (its disk is not writable). Connect Supabase to upload images.", err);
  }
  return { url: `/api/media/${name}`, bytes: bytes.byteLength };
}

/** Reads an uploaded image from DATA_DIR/media, or null if the name is not a valid upload. */
export async function readImage(name: string): Promise<{ body: Buffer; type: string } | null> {
  const m = /^[a-z0-9-]{1,60}\.(jpg|png|webp)$/.exec(name);
  if (!m) return null;
  const body = await fs.readFile(path.join(mediaDir(), name)).catch(() => null);
  return body ? { body, type: TYPES[m[1] as ImageExt] } : null;
}
