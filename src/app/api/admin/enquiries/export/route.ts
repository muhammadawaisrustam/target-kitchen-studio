import { toSpreadsheetCsv } from "@/lib/catalogue/csv";
import { requireAdmin } from "@/lib/server/adminAuth";
import { getEnquiryStore } from "@/lib/server/enquiryStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET: all enquiries as CSV (one row per enquiry; panels joined in one cell). */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const list = await getEnquiryStore().list();
  const origin = new URL(request.url).origin;
  const rows = [
    ["Reference", "Received (UTC)", "Status", "Name", "Phone", "Email", "Company", "Location", "Preferred contact", "Layout", "Design", "Variant", "Panels", "Message", "Admin note", "Link"],
    ...list.map((e) => [
      e.reference,
      e.createdAt,
      e.status,
      e.contact.name,
      e.contact.phone,
      e.contact.email,
      e.contact.company,
      e.contact.location,
      e.contact.preferredContact,
      e.design.modelName,
      e.design.designName,
      e.design.variantName,
      e.design.items.map((i) => `${i.regionLabel}: ${i.panelCode} ${i.productName}`).join("; "),
      e.message,
      e.adminNote,
      e.design.shareToken ? `${origin}/?design=${e.design.shareToken}` : "",
    ]),
  ];
  return new Response("﻿" + toSpreadsheetCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="enquiries-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
