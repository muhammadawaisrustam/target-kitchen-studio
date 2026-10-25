import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/adminAuth";
import { getPreviewStore } from "@/lib/server/previewStore";
import { StorageUnavailableError } from "@/lib/server/enquiryStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET: the preview image a customer attached to a photo enquiry. Signed-in admins only, never cached. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const bytes = await getPreviewStore().read(id);
    if (!bytes) return NextResponse.json({ error: "No preview image for this enquiry." }, { status: 404 });
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename="enquiry-${id}.jpg"` },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof StorageUnavailableError ? err.message : "The preview could not be loaded." }, { status: 503 });
  }
}
