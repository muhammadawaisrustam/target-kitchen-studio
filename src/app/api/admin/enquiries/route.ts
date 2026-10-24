import { NextResponse } from "next/server";
import { noStore, requireAdmin } from "@/lib/server/adminAuth";
import { getEnquiryStore, StorageUnavailableError } from "@/lib/server/enquiryStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const store = getEnquiryStore();
    return NextResponse.json({ enquiries: await store.list(), storage: { kind: store.kind, description: store.description } }, { headers: noStore });
  } catch (err) {
    const message = err instanceof StorageUnavailableError ? err.message : "Enquiries could not be loaded.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
