import { TAXONOMY_KINDS, type TaxonomyKind } from "@/lib/catalogue/taxonomy";
import { adminRoute, json, readJson } from "@/lib/server/adminRoute";
import { getCatalogueStore } from "@/lib/server/catalogueStore";
import { CatalogueEditError, deleteTaxonomy, loadLiveCatalogue, saveTaxonomy } from "@/lib/server/liveCatalogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const kindOf = (v: unknown): TaxonomyKind => {
  if (typeof v === "string" && (TAXONOMY_KINDS as readonly string[]).includes(v)) return v as TaxonomyKind;
  throw new CatalogueEditError("Unknown list.");
};

/** GET: every list (brands, categories, boards, finishes, colour groups, sizes) with panel counts. */
export const GET = adminRoute(async () => {
  const live = await loadLiveCatalogue();
  const store = getCatalogueStore();
  const totals = { panels: live.products.length, visible: live.visible.length, edits: live.edits.length };
  return json({ taxonomy: live.taxonomy, totals, conflicts: live.conflicts, storage: { kind: store.kind, description: store.description } });
});

/** POST { item, previousId? }: add an entry, or edit one (renaming updates every panel that uses it). */
export const POST = adminRoute(async (request) => {
  const body = await readJson<{ item?: unknown; previousId?: unknown }>(request);
  const result = await saveTaxonomy(body.item, typeof body.previousId === "string" && body.previousId ? body.previousId : undefined);
  return json(result);
});

/** DELETE ?kind=&id=&mergeInto= */
export const DELETE = adminRoute(async (request) => {
  const p = new URL(request.url).searchParams;
  const id = p.get("id");
  if (!id) throw new CatalogueEditError("Missing entry.");
  return json(await deleteTaxonomy(kindOf(p.get("kind")), id, p.get("mergeInto") || undefined));
});
