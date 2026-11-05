import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateCatalogueRecords } from "@/lib/catalogue/validate";
import { queryCatalogue } from "@/lib/catalogue/query";

const dir = "data/brands";
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];

test("imported brand catalogues validate together with unique codes", { skip: files.length === 0 }, () => {
  const records = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).products);
  const report = validateCatalogueRecords(records);
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors.slice(0, 5)));
  for (const p of report.valid) {
    assert.equal(p.isDemo, false, `${p.panelCode} is real data`);
    assert.ok(p.sourceDocument && p.sourcePage, `${p.panelCode} must be traceable to its source`);
    for (const url of [p.textureUrl, p.thumbnailUrl]) if (url) assert.ok(fs.existsSync(path.join("public", url)), `missing ${url}`);
    // Unpublished records (e.g. curved panels shown only as a render) may lack a preview; published ones may not.
    if (p.isPublished) assert.ok(p.textureUrl || p.colourHex, `${p.panelCode} has no preview`);
    assert.match(p.id, new RegExp(`^${p.brand!.toLowerCase()}-`), `${p.panelCode} id must start with its brand`);
  }
});

test("Panels Collection 2026: all 433 Item IDs across five brands, ids kept stable", { skip: files.length < 5 }, () => {
  const records = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).products);
  const valid = validateCatalogueRecords(records).valid;
  assert.equal(valid.length, 433);
  const per = (brand: string) => valid.filter((p) => p.brand === brand).length;
  assert.deepEqual(
    { Kastamonu: per("Kastamonu"), Glory: per("Glory"), Target: per("Target"), Greenlam: per("Greenlam"), Polylac: per("Polylac") },
    { Kastamonu: 163, Glory: 88, Target: 49, Greenlam: 127, Polylac: 6 },
  );
  // Ids of the first Kastamonu import are unchanged, so saved designs and admin edits stay attached.
  assert.ok(valid.some((p) => p.id === "kastamonu-1-001-t18-c-j-1"));
  // Same decor name in two brands stays two products with their own codes and swatches.
  const trend = queryCatalogue(valid, { q: "trend grey" }).items.filter((p) => p.productName === "TREND GREY");
  assert.deepEqual(trend.map((p) => p.brand).sort(), ["Kastamonu", "Target"]);
  assert.notEqual(trend[0]!.thumbnailUrl, trend[1]!.thumbnailUrl);
  // HPL: thickness and finish from the Item ID and the surface heading.
  const wool = valid.filter((p) => p.productName === "WOOL").map((p) => [p.panelCode, p.thicknessMm, p.finish]);
  assert.deepEqual(wool.sort(), [
    ["1-358-T0.8-HASH-S-9", 0.8, "Edgy ash"],
    ["1-358-T0.8-HGLO-S-9", 0.8, "High gloss"],
    ["1-358-T0.8-HSUD-S-9", 0.8, "Suede"],
  ]);
  // Curved panels: radius in notes; no flat swatch in the PDF -> imported but not published.
  const balta = valid.find((p) => p.panelCode === "3-706-R50-T18-24")!;
  assert.equal(balta.isPublished, false);
  assert.match(balta.notes!, /radius 50 mm/);
  const yellow = valid.find((p) => p.panelCode === "3-620-R37-T18-24")!;
  assert.equal(yellow.textureUrl, valid.find((p) => p.panelCode === "3-620-T18-M-M-24")!.textureUrl);
  // Misprinted-looking code is kept as printed but hidden until confirmed.
  assert.equal(valid.find((p) => p.panelCode === "3-1130-T18-M-M-2")!.isPublished, false);
});

test("Kastamonu: 163 Item IDs (145 from the first profile + 18 PVC/PET), searchable by Item ID and name", { skip: !files.includes("kastamonu.json") }, () => {
  const { products } = JSON.parse(fs.readFileSync(path.join(dir, "kastamonu.json"), "utf8"));
  const valid = validateCatalogueRecords(products).valid;
  assert.equal(valid.length, 163);
  const clay = queryCatalogue(valid, { q: "1-669" }).items;
  assert.deepEqual(clay.map((p) => p.productName), ["CLAY"]);
  assert.equal(clay[0]!.widthMm, 2070);
  assert.equal(clay[0]!.madeIn, "Italy");
  // One decor, two sheet sizes: two products sharing one swatch (same decor, not a substitution).
  const brown = queryCatalogue(valid, { q: "brown galaxy" }).items.filter((p) => p.productName === "BROWN GALAXY");
  assert.equal(brown.length, 2);
  assert.equal(brown[0]!.decorCode, brown[1]!.decorCode);
  assert.equal(queryCatalogue(valid, { board: ["MDF"] }).total, 1);
  assert.equal(queryCatalogue(valid, { board: ["PVC/PET"] }).total, 48); // 49 minus the hidden 3-1130
  // Finish is only filled where the PDF states it.
  assert.equal(valid.find((p) => p.productName === "HG RED PVC")!.finish, "High gloss");
  assert.equal(valid.find((p) => p.productName === "CLAY")!.finish, "Not stated");
});
