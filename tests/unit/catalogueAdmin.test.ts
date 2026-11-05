import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergeProductEdits, newProductId } from "@/lib/catalogue/edits";
import { queryAdminProducts } from "@/lib/catalogue/adminQuery";
import type { Product } from "@/lib/catalogue/schema";
import { buildTaxonomy, hiddenTaxonomy, isVisible, sizeId, taxonomyId } from "@/lib/catalogue/taxonomy";
import { FileCatalogueStore, SupabaseCatalogueStore, setCatalogueStore, type StoreRow } from "@/lib/server/catalogueStore";
import { saveImage, sniffImage } from "@/lib/server/mediaStore";

const P = (over: Partial<Product> & { id: string; panelCode: string }): Product => ({
  productName: "Oak",
  category: "Woods",
  colourFamily: "Brown",
  finish: "Matt",
  brand: "Kastamonu",
  board: "Particleboard",
  widthMm: 1830,
  heightMm: 3660,
  thicknessMm: 18,
  isActive: true,
  isPublished: true,
  isDemo: false,
  ...over,
});

const base = [P({ id: "k-1", panelCode: "1-001" }), P({ id: "k-2", panelCode: "1-002", category: "Uni colors" }), P({ id: "k-3", panelCode: "1-003", brand: "Glory" })];

test("edits: edit, delete and add are layered over the brand files", () => {
  const r = mergeProductEdits(base, [
    { id: "k-1", product: { ...base[0]!, productName: "Garden Oak" }, updatedAt: "" },
    { id: "k-2", product: null, updatedAt: "" },
    { id: "new-1", product: P({ id: "new-1", panelCode: "N-1" }), updatedAt: "" },
  ]);
  assert.deepEqual(r.products.map((p) => p.id).sort(), ["k-1", "k-3", "new-1"]);
  assert.equal(r.products.find((p) => p.id === "k-1")!.productName, "Garden Oak");
  assert.deepEqual(Object.fromEntries(r.admin.map((p) => [p.id, p.origin])), { "k-1": "edited", "k-2": "deleted", "k-3": "file", "new-1": "added" });
  assert.ok(!("origin" in r.products[0]!));
});

test("edits: an added panel whose code later appears in a brand file is ignored, not duplicated", () => {
  const r = mergeProductEdits(base, [{ id: "x", product: P({ id: "x", panelCode: "1-003" }), updatedAt: "" }]);
  assert.equal(r.products.filter((p) => p.panelCode === "1-003").length, 1);
  assert.equal(r.products.find((p) => p.panelCode === "1-003")!.id, "k-3");
  assert.equal(r.conflicts.length, 1);
});

test("edits: new ids follow the brand importer's form", () => {
  assert.equal(newProductId("Kastamonu", "1-026-T18-C-J-1"), "kastamonu-1-026-t18-c-j-1");
  assert.equal(newProductId(undefined, "AB 12"), "panel-ab-12");
});

test("taxonomy: lists combine stored entries with values in the data, with counts and order", () => {
  const t = buildTaxonomy(base, [
    { kind: "brand", name: "Glory", sortOrder: 10, isActive: true },
    { kind: "brand", name: "Greenlam", isActive: true },
  ]);
  assert.deepEqual(t.brand.map((e) => [e.name, e.productCount, e.stored]), [["Glory", 1, true], ["Greenlam", 0, true], ["Kastamonu", 2, false]]);
  assert.deepEqual(t.size.map((e) => [e.id, e.productCount]), [["1830x3660x18", 3]]);
  assert.equal(taxonomyId({ kind: "category", name: "Uni Colors" }), "uni-colors");
  assert.equal(sizeId({ widthMm: 1220, thicknessMm: 8 }), "1220x-x8");
});

test("taxonomy: switching off a brand, category or size hides its panels from the studio", () => {
  const hidden = hiddenTaxonomy([{ kind: "brand", name: "Glory", isActive: false }]);
  assert.deepEqual(base.filter((p) => isVisible(p, hidden)).map((p) => p.id), ["k-1", "k-2"]);
  const bySize = hiddenTaxonomy([{ kind: "size", name: "x", widthMm: 1830, heightMm: 3660, thicknessMm: 18, isActive: false }]);
  assert.equal(base.filter((p) => isVisible(p, bySize)).length, 0);
  assert.ok(!isVisible({ ...base[0]!, isPublished: false }, new Map()));
});

test("admin query: status, search and list filters", () => {
  const { admin } = mergeProductEdits(base, [{ id: "k-2", product: null, updatedAt: "" }]);
  assert.equal(queryAdminProducts(admin, {}).total, 2);
  assert.equal(queryAdminProducts(admin, { status: "deleted" }).items[0]!.id, "k-2");
  assert.equal(queryAdminProducts(admin, { filters: { brand: "glory" } }).items[0]!.id, "k-3");
  assert.equal(queryAdminProducts(admin, { q: "1-001" }).total, 1);
  assert.equal(queryAdminProducts(admin, {}).counts.deleted, 1);
});

test("file store: put, overwrite, remove", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tks-store-"));
  const s = new FileCatalogueStore(path.join(dir, "c.json"));
  await s.put([{ kind: "brand", id: "a", data: { n: 1 }, updatedAt: "t" }, { kind: "product", id: "a", data: { n: 2 }, updatedAt: "t" }]);
  await s.put([{ kind: "brand", id: "a", data: { n: 3 }, updatedAt: "t" }]);
  assert.deepEqual((await s.list()).map((r) => [r.kind, r.id, (r.data as { n: number }).n]), [["brand", "a", 3], ["product", "a", 2]]);
  await s.remove([{ kind: "brand", id: "a" }]);
  assert.deepEqual((await s.list()).map((r) => r.kind), ["product"]);
});

test("Supabase store: pages through rows, upserts on (kind, id), deletes by key", async () => {
  const calls: { url: string; method: string; body?: string; prefer?: string }[] = [];
  const all: StoreRow[] = Array.from({ length: 1001 }, (_, i) => ({ kind: "product", id: `p${i}`, data: {}, updatedAt: "t" }));
  const fake: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string, prefer: (init?.headers as Record<string, string>)?.Prefer });
    if ((init?.method ?? "GET") === "GET") {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return new Response(JSON.stringify(all.slice(offset, offset + 1000).map((r) => ({ kind: r.kind, id: r.id, data: r.data, updated_at: r.updatedAt }))));
    }
    return new Response(null, { status: 201 });
  };
  const s = new SupabaseCatalogueStore("https://x.supabase.co/", "key", fake);
  assert.equal((await s.list()).length, 1001);
  assert.equal(calls.length, 2);
  await s.put([{ kind: "brand", id: "glory", data: { name: "Glory" }, updatedAt: "t" }]);
  assert.match(calls[2]!.url, /catalogue_items\?on_conflict=kind,id$/);
  assert.match(calls[2]!.prefer!, /merge-duplicates/);
  await s.remove([{ kind: "brand", id: "glory" }]);
  assert.equal(calls[3]!.method, "DELETE");
  assert.match(decodeURIComponent(calls[3]!.url), /kind=eq\.brand&id=in\.\("glory"\)/);
  const failing = new SupabaseCatalogueStore("https://x", "k", async () => new Response('relation "public.catalogue_items" does not exist', { status: 404 }));
  await assert.rejects(failing.list(), /schema\.sql/);
});

test("media: only real JPG/PNG/WebP files are accepted; saved to DATA_DIR without Supabase", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(sniffImage(png), "png");
  assert.equal(sniffImage(new TextEncoder().encode("<svg></svg>")), null);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tks-media-"));
  const old = { d: process.env.DATA_DIR, u: process.env.SUPABASE_URL };
  process.env.DATA_DIR = dir;
  delete process.env.SUPABASE_URL;
  try {
    const r = await saveImage("Garden Oak.PNG", png);
    assert.match(r.url, /^\/api\/media\/garden-oak-[0-9a-f]{8}\.png$/);
    await assert.rejects(saveImage("x.jpg", new TextEncoder().encode("hello")), /Only JPG, PNG and WebP/);
  } finally {
    process.env.DATA_DIR = old.d;
    if (old.u) process.env.SUPABASE_URL = old.u;
  }
});

test("live catalogue: create, edit, rename a brand, delete with merge, restore", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tks-live-"));
  const brandFile = path.join(dir, "brand.json");
  await fs.writeFile(brandFile, JSON.stringify({ products: base }));
  const old = process.env.CATALOGUE_FILE;
  process.env.CATALOGUE_FILE = brandFile;
  setCatalogueStore(new FileCatalogueStore(path.join(dir, "edits.json")));
  const live = await import("@/lib/server/liveCatalogue");
  try {
    live.invalidateLiveCatalogue();
    const created = await live.createProduct({ panelCode: "G-9", productName: "Stone", category: "Stones", colourFamily: "Grey", finish: "Matt", brand: "Glory" });
    assert.equal(created.id, "glory-g-9");
    await assert.rejects(live.createProduct({ panelCode: "1-001", productName: "Dup", category: "x", colourFamily: "x", finish: "x" }), /already belongs/);

    await live.updateProduct("k-1", { ...base[0], productName: "Garden Oak" });
    let cat = await live.loadLiveCatalogue();
    assert.equal(cat.products.find((p) => p.id === "k-1")!.productName, "Garden Oak");

    // Rename a brand: every panel that used it follows.
    const r = await live.saveTaxonomy({ kind: "brand", name: "Glory Panels", isActive: true }, "glory");
    assert.equal(r.productsUpdated, 2);
    cat = await live.loadLiveCatalogue();
    assert.deepEqual(cat.products.filter((p) => p.brand === "Glory Panels").map((p) => p.id).sort(), ["glory-g-9", "k-3"]);
    assert.ok(!cat.taxonomy.brand.some((e) => e.id === "glory"));

    // Switching it off hides those panels from the studio.
    await live.saveTaxonomy({ kind: "brand", name: "Glory Panels", isActive: false }, "glory-panels");
    const pub = await live.loadPublicCatalogue();
    assert.ok(!pub.products.some((p) => p.brand === "Glory Panels"));
    assert.ok(pub.all.some((p) => p.brand === "Glory Panels"), "still known for old enquiries and share links");

    // A category in use cannot be deleted without a target.
    await assert.rejects(live.deleteTaxonomy("category", "uni-colors"), /still use/);
    await live.deleteTaxonomy("category", "uni-colors", "woods");
    cat = await live.loadLiveCatalogue();
    assert.equal(cat.products.find((p) => p.id === "k-2")!.category, "Woods");

    // Bulk unpublish, delete and restore.
    assert.equal(await live.bulkUpdateProducts(["k-1", "k-2"], { isPublished: false }), 2);
    await assert.rejects(live.bulkUpdateProducts(["k-1"], { panelCode: "x" }), /cannot be changed in bulk/);
    await live.deleteProducts(["k-1", "glory-g-9"]);
    cat = await live.loadLiveCatalogue();
    assert.ok(!cat.products.some((p) => p.id === "k-1" || p.id === "glory-g-9"));
    assert.equal(cat.admin.find((p) => p.id === "k-1")!.origin, "deleted");
    assert.ok(!cat.admin.some((p) => p.id === "glory-g-9"), "an added panel is removed outright");
    await live.restoreProducts(["k-1"]);
    cat = await live.loadLiveCatalogue();
    assert.equal(cat.products.find((p) => p.id === "k-1")!.productName, "Oak", "back to the brand file");

    // Spreadsheet import: new rows added, existing codes need update mode.
    const rows = [{ panelCode: "1-002", productName: "Renamed", category: "Woods", colourFamily: "Brown", finish: "Matt", brand: "Kastamonu" }, { panelCode: "Z-1", productName: "New", category: "Woods", colourFamily: "Brown", finish: "Matt", brand: "Kastamonu" }];
    const dry = await live.importProducts(rows, { updateExisting: false, dryRun: true });
    assert.equal(dry.report.errors.length, 1);
    const done = await live.importProducts(rows, { updateExisting: true, dryRun: false });
    assert.deepEqual([done.saved, done.added, done.updated], [true, 1, 1]);
    cat = await live.loadLiveCatalogue();
    assert.equal(cat.products.find((p) => p.id === "k-2")!.productName, "Renamed");
    assert.ok(cat.products.some((p) => p.id === "kastamonu-z-1"));
  } finally {
    setCatalogueStore(null);
    live.invalidateLiveCatalogue();
    if (old === undefined) delete process.env.CATALOGUE_FILE;
    else process.env.CATALOGUE_FILE = old;
  }
});

test("bundled catalogue lists every brand file (run npm run catalogue:bundle after adding one)", async () => {
  const { BUNDLED_BRAND_FILES } = await import("@/lib/server/bundledCatalogue");
  const onDisk = (await fs.readdir(path.join(process.cwd(), "data/brands"))).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(BUNDLED_BRAND_FILES.map((b) => path.basename(b.file)), onDisk);
});
