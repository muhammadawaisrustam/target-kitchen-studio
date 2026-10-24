import { NextResponse } from "next/server";
import { EnquiryUpdateSchema } from "@/lib/enquiries/schema";
import { noStore, requireAdmin } from "@/lib/server/adminAuth";
import { getEnquiryStore, StorageUnavailableError } from "@/lib/server/enquiryStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** PATCH { status?, adminNote? } */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const parsed = EnquiryUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid update." }, { status: 422 });
  try {
    const updated = await getEnquiryStore().update(id, parsed.data);
    if (!updated) return NextResponse.json({ error: "Enquiry not found." }, { status: 404 });
    return NextResponse.json({ enquiry: updated }, { headers: noStore });
  } catch (err) {
    return NextResponse.json({ error: err instanceof StorageUnavailableError ? err.message : "The change could not be saved." }, { status: 503 });
  }
}
