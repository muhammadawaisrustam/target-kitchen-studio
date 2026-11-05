import { parseAdminProductParams, queryAdminProducts } from "@/lib/catalogue/adminQuery";
import { adminRoute, json, readJson } from "@/lib/server/adminRoute";
import { getCatalogueStore } from "@/lib/server/catalogueStore";
import { createProduct, loadLiveCatalogue } from "@/lib/server/liveCatalogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET: panels for the admin table, with search, list filters, status and paging. */
export const GET = adminRoute(async (request) => {
  const live = await loadLiveCatalogue();
  const result = queryAdminProducts(live.admin, parseAdminProductParams(new URL(request.url).searchParams));
  const store = getCatalogueStore();
  return json({ ...result, conflicts: live.conflicts, storage: { kind: store.kind, description: store.description } });
});

/** POST { product }: add a new panel. */
export const POST = adminRoute(async (request) => {
  const body = await readJson<{ product?: Record<string, unknown> }>(request);
  const product = await createProduct(body.product ?? {});
  return json({ product }, 201);
});
