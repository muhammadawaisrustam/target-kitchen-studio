import { adminRoute, json, readJson } from "@/lib/server/adminRoute";
import { bulkUpdateProducts, CatalogueEditError, deleteProducts, restoreProducts } from "@/lib/server/liveCatalogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { ids, action: "update" | "delete" | "restore", patch? } */
export const POST = adminRoute(async (request) => {
  const body = await readJson<{ ids?: unknown; action?: unknown; patch?: unknown }>(request);
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 5000) : [];
  if (!ids.length) throw new CatalogueEditError("Select at least one panel.");
  if (body.action === "delete") return json({ changed: await deleteProducts(ids) });
  if (body.action === "restore") return json({ changed: await restoreProducts(ids) });
  if (body.action === "update" && body.patch && typeof body.patch === "object") return json({ changed: await bulkUpdateProducts(ids, body.patch as Record<string, unknown>) });
  throw new CatalogueEditError("Unknown action.");
});
