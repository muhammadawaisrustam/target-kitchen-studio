import { NextResponse } from "next/server";
import { toSpreadsheetCsv } from "@/lib/catalogue/csv";
import { stripOrigin } from "@/lib/catalogue/edits";
import { PRODUCT_FIELDS } from "@/lib/catalogue/schema";
import { adminRoute } from "@/lib/server/adminRoute";
import { loadLiveCatalogue } from "@/lib/server/liveCatalogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET ?format=csv|json: every live panel (all statuses), in the import format, so it can be edited and imported back. */
export const GET = adminRoute(async (request) => {
  const live = await loadLiveCatalogue();
  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
  const stamp = new Date().toISOString().slice(0, 10);
  const products = live.admin.filter((p) => p.origin !== "deleted").map(stripOrigin);
  if (format === "json") {
    const body = JSON.stringify({ exportedAt: new Date().toISOString(), products, lists: live.storedTaxonomy }, null, 2);
    return new NextResponse(body, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="panels-${stamp}.json"`, "Cache-Control": "no-store" } });
  }
  const rows = [[...PRODUCT_FIELDS], ...products.map((p) => PRODUCT_FIELDS.map((f) => (p[f] === undefined ? "" : String(p[f]))))];
  return new NextResponse(toSpreadsheetCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="panels-${stamp}.csv"`, "Cache-Control": "no-store" } });
});
