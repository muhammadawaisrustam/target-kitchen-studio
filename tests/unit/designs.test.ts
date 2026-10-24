import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "@/lib/designs/model";
import { buildShareUrl, decodeShareToken, encodeShareToken } from "@/lib/designs/share";
import { buildSummary, summaryToCsv } from "@/lib/designs/summary";
import { neutraliseCell, parseCsv } from "@/lib/catalogue/csv";

const snap = (lower: string): D.DesignSnapshot => ({
  modelId: "demo-l-island",
  selections: { lower_cabinets: lower, upper_cabinets: "1-001-T18-C-J-1" },
  camera: { alpha: -1.05, beta: 1.18, radius: 4.7, target: [1.8, 0.95, -1.35] },
});

test("designs: create, add variants, rename, delete, and keep each variant's panels separate", () => {
  let d = D.createDesign("  Villa 12  ", snap("1-026-T18-C-J-1"));
  assert.equal(d.name, "Villa 12");
  assert.equal(d.variants[0]!.name, "Variant A");
  d = D.addVariant(d, snap("1-668-T18-C-L-27"));
  assert.equal(d.variants.length, 2);
  assert.equal(d.variants[1]!.name, "Variant B");
  assert.equal(d.activeVariantId, d.variants[1]!.id);
  assert.equal(d.variants[0]!.selections.lower_cabinets, "1-026-T18-C-J-1", "first variant unchanged");
  d = D.updateVariant(d, d.variants[1]!.id, snap("1-669-T18-C-L-27"));
  assert.equal(d.variants[1]!.selections.lower_cabinets, "1-669-T18-C-L-27");
  d = D.renameVariant(d, d.variants[1]!.id, "Dark option");
  assert.equal(D.nextVariantName(d), "Variant B");
  assert.throws(() => D.renameDesign(d, "   "));
  d = D.deleteVariant(d, d.variants[1]!.id);
  assert.equal(d.variants.length, 1);
  assert.equal(d.activeVariantId, d.variants[0]!.id);
  assert.throws(() => D.deleteVariant(d, d.variants[0]!.id), /at least one variant/);
});

test("designs: stored data is validated and damaged entries are skipped, not guessed", () => {
  const good = D.createDesign("A", snap("x"));
  const { designs, skipped } = D.parseStoredDesigns([good, { id: "bad" }, "junk", { ...good, id: "d2", activeVariantId: "missing" }]);
  assert.equal(designs.length, 2);
  assert.equal(skipped, 2);
  assert.equal(designs[1]!.activeVariantId, good.variants[0]!.id, "unknown active variant falls back to the first");
  assert.equal(D.parseStoredDesigns(null).designs.length, 0);
  // unknown region keys are dropped
  const odd = { ...good, variants: [{ ...good.variants[0]!, selections: { lower_cabinets: "A", roof: "B" } }] };
  assert.deepEqual(D.parseStoredDesigns([odd]).designs[0]!.variants[0]!.selections, { lower_cabinets: "A" });
});

test("designs: sameSelections ignores key order and empty values", () => {
  assert.ok(D.sameSelections({ lower_cabinets: "A", upper_cabinets: "B" }, { upper_cabinets: "B", lower_cabinets: "A" }));
  assert.ok(!D.sameSelections({ lower_cabinets: "A" }, { lower_cabinets: "B" }));
  assert.ok(!D.sameSelections({ lower_cabinets: "A" }, { lower_cabinets: "A", upper_cabinets: "B" }));
});

test("share links: round trip, unicode names, compact, and garbage rejected", () => {
  const input = { ...snap("1-026-T18-C-J-1"), designName: "مطبخ فيلا ١٢", variantName: "Variant B" };
  const token = encodeShareToken(input);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.ok(token.length < 400, `token length ${token.length}`);
  const out = decodeShareToken(token)!;
  assert.deepEqual(out.selections, input.selections);
  assert.equal(out.modelId, "demo-l-island");
  assert.equal(out.designName, input.designName);
  assert.deepEqual(out.camera, input.camera);
  assert.ok(buildShareUrl("https://example.org/", input).startsWith("https://example.org/?design="));
  for (const bad of ["", "%%%", "abc", "x".repeat(4000), btoa('{"v":2}'), encodeShareToken(input).slice(0, 20)]) assert.equal(decodeShareToken(bad), null, bad.slice(0, 20));
  // a token with an out-of-range camera keeps the panels but drops the camera
  const weird = btoa(JSON.stringify({ v: 1, m: "demo-straight", s: { l: "A" }, c: [0, 9, 4, 0, 0, 0] })).replace(/=+$/, "");
  const w = decodeShareToken(weird)!;
  assert.equal(w.selections.lower_cabinets, "A");
  assert.equal(w.camera, undefined);
});

test("summary: one row per region, unknown details left empty, CSV is spreadsheet-safe", () => {
  const products = {
    "1-026-T18-C-J-1": { panelCode: "1-026-T18-C-J-1", productName: "GARDEN OAK", brand: "Kastamonu", board: "Particleboard", finish: "Not stated", widthMm: 2800, heightMm: 2070, thicknessMm: 18, isDemo: false },
  } as never;
  const rows = buildSummary(["upper_cabinets", "lower_cabinets"], { lower_cabinets: "1-026-T18-C-J-1" }, products);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.panelCode, null);
  assert.equal(rows[1]!.sheet, "2800 × 2070 mm");
  const csv = summaryToCsv(rows, { designName: "=HYPERLINK(\"x\")", layout: "L" });
  const parsed = parseCsv(csv);
  assert.equal(parsed[0]![1], "'=HYPERLINK(\"x\")");
  assert.ok(parsed.some((r) => r[1] === "1-026-T18-C-J-1" && r[2] === "GARDEN OAK"));
  assert.equal(neutraliseCell("+974 5555 1234"), "+974 5555 1234", "phone numbers stay readable");
  assert.equal(neutraliseCell("-2+3"), "'-2+3");
  assert.equal(neutraliseCell("@SUM(A1)"), "'@SUM(A1)");
});
