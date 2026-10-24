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
    assert.ok(p.textureUrl || p.colourHex, `${p.panelCode} has no preview`);
  }
});

test("Kastamonu: 145 Item IDs from the PDF, searchable by Item ID and name", { skip: !files.includes("kastamonu.json") }, () => {
  const { products } = JSON.parse(fs.readFileSync(path.join(dir, "kastamonu.json"), "utf8"));
  const valid = validateCatalogueRecords(products).valid;
  assert.equal(valid.length, 145);
  const clay = queryCatalogue(valid, { q: "1-669" }).items;
  assert.deepEqual(clay.map((p) => p.productName), ["CLAY"]);
  assert.equal(clay[0]!.widthMm, 2070);
  assert.equal(clay[0]!.madeIn, "Italy");
  // One decor, two sheet sizes: two products sharing one swatch (same decor, not a substitution).
  const brown = queryCatalogue(valid, { q: "brown galaxy" }).items.filter((p) => p.productName === "BROWN GALAXY");
  assert.equal(brown.length, 2);
  assert.equal(brown[0]!.decorCode, brown[1]!.decorCode);
  assert.equal(queryCatalogue(valid, { board: ["MDF"] }).total, 32);
  // Finish is only filled where the PDF states it.
  assert.equal(valid.find((p) => p.productName === "HG RED PVC")!.finish, "High gloss");
  assert.equal(valid.find((p) => p.productName === "CLAY")!.finish, "Not stated");
});
