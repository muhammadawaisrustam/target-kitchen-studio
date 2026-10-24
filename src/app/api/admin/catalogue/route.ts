import { NextResponse } from "next/server";
import { noStore, requireAdmin } from "@/lib/server/adminAuth";
import { loadCatalogue } from "@/lib/server/catalogueRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET: catalogue sources and validation summary. */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { sources, products, report, isDemo } = await loadCatalogue();
  return NextResponse.json(
    {
      sources,
      totalProducts: products.length,
      published: products.filter((p) => p.isPublished && p.isActive).length,
      brands: [...new Set(products.map((p) => p.brand).filter(Boolean))].sort(),
      isDemo,
      errors: report.errors.slice(0, 100),
      errorCount: report.errors.length,
    },
    { headers: noStore },
  );
}
