import { adminRoute, json, readJson } from "@/lib/server/adminRoute";
import { CatalogueEditError, deleteProducts, loadLiveCatalogue, updateProduct } from "@/lib/server/liveCatalogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export const GET = adminRoute<Ctx>(async (_request, ctx) => {
  const { id } = await ctx.params;
  const live = await loadLiveCatalogue({ fresh: true });
  const product = live.admin.find((p) => p.id === id);
  if (!product) throw new CatalogueEditError("Panel not found.", 404);
  return json({ product });
});

/** PUT { product }: save the whole panel (all fields). */
export const PUT = adminRoute<Ctx>(async (request, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson<{ product?: Record<string, unknown> }>(request);
  return json({ product: await updateProduct(id, body.product ?? {}) });
});

export const DELETE = adminRoute<Ctx>(async (_request, ctx) => {
  const { id } = await ctx.params;
  const n = await deleteProducts([id]);
  if (!n) throw new CatalogueEditError("Panel not found.", 404);
  return json({ deleted: id });
});
