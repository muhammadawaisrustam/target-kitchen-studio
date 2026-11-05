import { NextResponse } from "next/server";
import { FACET_KEYS, parseCatalogueParams, queryCatalogue } from "@/lib/catalogue/query";
import { compareEntries, slugify } from "@/lib/catalogue/taxonomy";
import { loadPublicCatalogue } from "@/lib/server/liveCatalogue";

export const dynamic = "force-dynamic";

/** GET /api/catalogue?q=&category=&colourFamily=&finish=&codes=&page=&pageSize= */
export async function GET(request: Request) {
  try {
    const { products, isDemo, taxonomy } = await loadPublicCatalogue();
    const query = parseCatalogueParams(new URL(request.url).searchParams);
    const page = queryCatalogue(products, query);
    // Filter lists follow the order set in the admin; entries without an order follow, A to Z.
    if (taxonomy) {
      for (const key of FACET_KEYS) {
        const order = new Map(taxonomy[key].map((e) => [e.id, e]));
        page.facets[key].sort((a, b) => {
          const ea = order.get(slugify(a.value)) ?? { name: a.value };
          const eb = order.get(slugify(b.value)) ?? { name: b.value };
          return compareEntries(ea, eb);
        });
      }
    }
    return NextResponse.json({ ...page, isDemo });
  } catch (err) {
    console.error("[catalogue] failed to load", err);
    return NextResponse.json({ error: "The panel catalogue could not be loaded." }, { status: 500 });
  }
}
