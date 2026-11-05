import { adminRoute, json } from "@/lib/server/adminRoute";
import { CatalogueEditError } from "@/lib/server/liveCatalogue";
import { MAX_IMAGE_BYTES, saveImage } from "@/lib/server/mediaStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST ?name=<original file name>, body = the image bytes. Returns { url }. */
export const POST = adminRoute(async (request) => {
  const name = new URL(request.url).searchParams.get("name") ?? "image";
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_IMAGE_BYTES) throw new CatalogueEditError("The image is larger than 4 MB.", 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength) throw new CatalogueEditError("Choose an image.");
  return json(await saveImage(name, bytes), 201);
});
