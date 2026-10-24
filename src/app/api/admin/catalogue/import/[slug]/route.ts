import { NextResponse } from "next/server";
import { noStore, requireAdmin } from "@/lib/server/adminAuth";
import { deleteImport } from "@/lib/server/catalogueRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { slug } = await ctx.params;
  const ok = await deleteImport(slug);
  return ok ? NextResponse.json({ deleted: slug }, { headers: noStore }) : NextResponse.json({ error: "Import not found." }, { status: 404 });
}
