import { TAXONOMY_KINDS, type TaxonomyKind } from "@/lib/catalogue/taxonomy";
import { adminRoute, json, readJson } from "@/lib/server/adminRoute";
import { CatalogueEditError, reorderTaxonomy } from "@/lib/server/liveCatalogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { kind, ids }: save the display order. */
export const POST = adminRoute(async (request) => {
  const body = await readJson<{ kind?: unknown; ids?: unknown }>(request);
  if (typeof body.kind !== "string" || !(TAXONOMY_KINDS as readonly string[]).includes(body.kind)) throw new CatalogueEditError("Unknown list.");
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 2000) : [];
  await reorderTaxonomy(body.kind as TaxonomyKind, ids);
  return json({ ok: true });
});
