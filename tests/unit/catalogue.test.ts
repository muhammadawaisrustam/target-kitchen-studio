import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateCatalogueRecords, csvToRecords, parseImportFile } from "@/lib/catalogue/validate";
import { queryCatalogue } from "@/lib/catalogue/query";
import { parseCsv, toCsv } from "@/lib/catalogue/csv";

const base = {
  id: "p1",
  panelCode: "DEMO-X-1",
  productName: "Test",
  category: "Woodgrain",
  colourFamily: "Light wood",
  finish: "Matt",
  textureUrl: "/t/x.jpg",
  textureScale: 1,
  grainDirection: "vertical",
  thumbnailUrl: "/t/x-thumb.jpg",
  isActive: true,
  isPublished: true,
};

test("demo catalogue is valid and every record is flagged DEMO", () => {
  const raw = JSON.parse(fs.readFileSync("data/demo-catalogue.json", "utf8"));
  const report = validateCatalogueRecords(raw.products);
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  assert.ok(report.valid.length >= 20);
  for (const p of report.valid) {
    assert.equal(p.isDemo, true, `${p.panelCode} must be isDemo`);
    assert.match(p.panelCode, /^DEMO-/);
    assert.match(p.productName, /^Demo /);
  }
  const textured = report.valid.filter((p) => p.textureUrl && !p.panelCode.includes("TEST"));
  assert.ok(textured.length >= 10, "at least 10 textured demo panels");
  for (const p of textured) assert.ok(fs.existsSync(`public${p.textureUrl}`), `missing file for ${p.panelCode}`);
});

test("rejects missing codes, duplicates, bad URLs and unsupported formats", () => {
  const report = validateCatalogueRecords([
    base,
    { ...base, id: "p2" }, // duplicate code
    { ...base, id: "p3", panelCode: "demo-x-1 " }, // duplicate code, case/whitespace-insensitive
    { ...base, id: "p4", panelCode: "" },
    { ...base, id: "p5", panelCode: "A5", textureUrl: "/t/x.tiff" },
    { ...base, id: "p6", panelCode: "A6", textureUrl: "http://insecure.example/x.jpg" },
    { ...base, id: "p7", panelCode: "A7", textureUrl: "/t/../secret.jpg" },
    { ...base, id: "p1", panelCode: "A8" }, // duplicate id
  ]);
  assert.equal(report.valid.length, 1);
  const msgs = report.errors.map((e) => `${e.row}:${e.field}:${e.message}`);
  assert.ok(msgs.some((m) => m.startsWith("2:panelCode:duplicate")));
  assert.ok(msgs.some((m) => m.startsWith("3:panelCode:duplicate")));
  assert.ok(msgs.some((m) => m.startsWith("4:panelCode")));
  assert.ok(msgs.some((m) => m.startsWith("5:textureUrl:unsupported")));
  assert.ok(msgs.some((m) => m.startsWith("6:textureUrl")));
  assert.ok(msgs.some((m) => m.startsWith("7:textureUrl")));
  assert.ok(msgs.some((m) => m.startsWith("8:id:duplicate")));
});

test("optional specifications stay absent and are never invented", () => {
  const [p] = validateCatalogueRecords([{ ...base }]).valid;
  assert.equal(p!.thicknessMm, undefined);
  assert.equal(p!.roughness, undefined);
  assert.equal(p!.stockStatus, undefined);
});

test("warns when a product cannot be previewed", () => {
  const { valid, warnings } = validateCatalogueRecords([{ ...base, textureUrl: undefined }]);
  assert.equal(valid.length, 1);
  assert.ok(warnings.some((w) => /no textureUrl or colourHex/.test(w.message)));
});

test("CSV import: quoted fields, typed values, blank = not supplied", () => {
  const csv = 'panelCode,id,productName,category,colourFamily,finish,thicknessMm,isActive,isPublished,notes,unknownCol\n' +
    'C-1,c1,"Oak, ""rustic""",Woodgrain,Mid wood,Matt,18,yes,true,"line1\nline2",x\n' +
    "C-2,c2,Plain,Unicolour,White,Matt,,1,0,,\n";
  const { records, unknownColumns } = csvToRecords(csv);
  assert.deepEqual(unknownColumns, ["unknownCol"]);
  assert.equal(records[0]!.productName, 'Oak, "rustic"');
  assert.equal(records[0]!.thicknessMm, 18);
  assert.equal(records[0]!.isActive, true);
  assert.equal(records[0]!.notes, "line1\nline2");
  assert.equal("thicknessMm" in records[1]!, false);
  assert.equal(records[1]!.isPublished, false);
  assert.deepEqual(parseCsv(toCsv([["a,b", 'q"'], ["1", ""]])), [["a,b", 'q"'], ["1", ""]]);
  assert.throws(() => parseImportFile("x.xlsx", ""), /Unsupported/);
});

test("T11: data model, validation and query handle 600 records", () => {
  const records = Array.from({ length: 600 }, (_, i) => ({
    ...base,
    id: `bulk-${i}`,
    panelCode: `BULK-${String(i).padStart(4, "0")}`,
    productName: `Bulk panel ${i}`,
    category: ["Woodgrain", "Unicolour", "Stone & Concrete"][i % 3]!,
    colourFamily: ["White", "Grey", "Dark wood", "Beige"][i % 4]!,
    textureUrl: undefined,
    colourHex: "#AABBCC",
  }));
  const t0 = performance.now();
  const { valid, errors } = validateCatalogueRecords(records);
  const page = queryCatalogue(valid, { q: "bulk", category: ["Unicolour"], page: 3, pageSize: 24 });
  const ms = performance.now() - t0;
  assert.equal(errors.length, 0);
  assert.equal(valid.length, 600);
  assert.equal(page.total, 200);
  assert.equal(page.items.length, 24);
  assert.equal(page.pageCount, 9);
  assert.ok(ms < 1000, `took ${ms} ms`);
});

test("query: search by code without dashes, facets and unpublished products", () => {
  const items = validateCatalogueRecords([
    { ...base, id: "a", panelCode: "DEMO-WD-004", productName: "Walnut" },
    { ...base, id: "b", panelCode: "DEMO-UC-101", productName: "White", category: "Unicolour" },
    { ...base, id: "c", panelCode: "HIDDEN-1", productName: "Hidden", isPublished: false },
  ]).valid;
  assert.equal(queryCatalogue(items, { q: "wd004" }).total, 1);
  assert.equal(queryCatalogue(items, { q: "walnut" }).items[0]!.panelCode, "DEMO-WD-004");
  assert.equal(queryCatalogue(items, {}).total, 2, "unpublished is hidden");
  const r = queryCatalogue(items, { category: ["Unicolour"] });
  assert.equal(r.total, 1);
  assert.deepEqual(r.facets.category.map((f) => f.value), ["Unicolour", "Woodgrain"], "facet ignores its own filter");
});
