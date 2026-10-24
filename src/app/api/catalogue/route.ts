import { NextResponse } from "next/server";
import { parseCatalogueParams, queryCatalogue } from "@/lib/catalogue/query";
import { loadCatalogue } from "@/lib/server/catalogueRepository";

export const dynamic = "force-dynamic";

/** GET /api/catalogue?q=&category=&colourFamily=&finish=&codes=&page=&pageSize= */
export async function GET(request: Request) {
  try {
    const { products, isDemo } = await loadCatalogue();
    const query = parseCatalogueParams(new URL(request.url).searchParams);
    const page = queryCatalogue(products, query);
    return NextResponse.json({ ...page, isDemo });
  } catch (err) {
    console.error("[catalogue] failed to load", err);
    return NextResponse.json({ error: "The panel catalogue could not be loaded." }, { status: 500 });
  }
}
