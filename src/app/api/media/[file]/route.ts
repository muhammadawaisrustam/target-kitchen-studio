import { readImage } from "@/lib/server/mediaStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET: an image uploaded in the admin (only used when images are kept on the server's disk). */
export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const img = await readImage(file);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.body), { headers: { "Content-Type": img.type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
