import { test } from "node:test";
import assert from "node:assert/strict";
import { ProductSchema, type Product } from "@/lib/catalogue/schema";
import { missingTextureSpec, productToMaterialSpec, roughnessFor } from "@/lib/materials/materialSpec";
import { buildExplicitMapping, mapMeshesToRegions } from "@/lib/models/mapping";
import { KITCHEN_MODELS } from "@/lib/models/registry";
import { computeBoxProjectedUVs } from "@/lib/scene/uv";

const product = (over: Partial<Product> = {}): Product =>
  ProductSchema.parse({
    id: "p", panelCode: "P-1", productName: "P", category: "Woodgrain", colourFamily: "Mid wood", finish: "Matt",
    isActive: true, isPublished: true, ...over,
  });

test("texture products map to texture specs with physical scale and grain rotation", () => {
  const spec = productToMaterialSpec(product({ textureUrl: "/a.jpg", textureScale: 0.5, grainDirection: "horizontal", textureRotation: 10 }));
  assert.equal(spec.kind, "texture");
  assert.equal(spec.repeatsPerMetre, 2);
  assert.ok(Math.abs(spec.rotationRad - (100 * Math.PI) / 180) < 1e-9);
});

test("colour-only products map to colour specs; neither gives a placeholder with a warning", () => {
  assert.equal(productToMaterialSpec(product({ colourHex: "#112233" })).kind, "colour");
  const none = productToMaterialSpec(product());
  assert.equal(none.kind, "placeholder");
  assert.match(none.warning!, /cannot be previewed/);
});

test("missing textures never substitute another product", () => {
  const spec = missingTextureSpec(product({ textureUrl: "/gone.jpg", colourHex: "#FF0000" }), "404");
  assert.equal(spec.kind, "placeholder");
  assert.equal(spec.textureUrl, undefined);
  assert.equal(spec.colourHex, undefined);
  assert.equal(spec.panelCode, "P-1");
  assert.match(spec.warning!, /could not be loaded \(404\).*no other panel/);
});

test("roughness: product value wins, otherwise finish estimate, otherwise fallback", () => {
  assert.deepEqual(roughnessFor({ roughness: 0.3, finish: "Matt" }), { value: 0.3, source: "product" });
  assert.equal(roughnessFor({ finish: "High Gloss" }).source, "finish-default");
  assert.ok(roughnessFor({ finish: "High Gloss" }).value < roughnessFor({ finish: "Super Matt" }).value);
  assert.equal(roughnessFor({ finish: "Mystery" }).source, "fallback");
});

test("mesh mapping: names, patterns and material names; unmapped meshes reported", () => {
  const meshes = [
    { name: "upper_cabinets__door_01" },
    { name: "Cabinet_Base_Door.003", materialName: "MAT_Base_Fronts" },
    { name: "Tall_Front_L" },
    { name: "Worktop" },
  ];
  const res = mapMeshesToRegions(meshes, {
    upper_cabinets: { meshNamePatterns: ["^upper_cabinets__"] },
    lower_cabinets: { materialNames: ["mat_base_fronts"] },
    tall_cabinets: { meshNames: ["Tall_Front_L"] },
    island_panels: { meshNamePatterns: ["^island"] },
  });
  assert.equal(res.byRegion.get("upper_cabinets")!.length, 1);
  assert.equal(res.byRegion.get("lower_cabinets")![0]!.name, "Cabinet_Base_Door.003");
  assert.equal(res.byRegion.get("tall_cabinets")![0]!.name, "Tall_Front_L");
  assert.deepEqual(res.unmapped.map((m) => m.name), ["Worktop"]);
  assert.deepEqual(res.emptyRegions, ["island_panels"]);
});

test("explicit mapping export groups mesh names by region", () => {
  const m = buildExplicitMapping({ b: "lower_cabinets", a: "lower_cabinets", c: "", d: "upper_cabinets" }, { uvMode: "model" });
  assert.deepEqual(m.lower_cabinets, { meshNames: ["a", "b"], uvMode: "model" });
  assert.deepEqual(m.upper_cabinets!.meshNames, ["d"]);
});

test("registry: every model has defaults only for regions it maps", () => {
  for (const model of KITCHEN_MODELS) {
    for (const [r, list] of Object.entries(model.defaults)) {
      assert.ok(r in model.regions, `${model.id} default for unmapped ${r}`);
      assert.ok(list && list.length > 0, `${model.id} ${r} has no candidates`);
    }
    assert.ok(["upper_cabinets", "lower_cabinets", "tall_cabinets"].every((r) => r in model.regions));
  }
});

test("box-projected UVs are in metres and follow the grain axis", () => {
  // Front face of a 0.6 m wide x 0.7 m high door (normal -z): grain "y" => v follows height.
  const pos = [0, 0, 0, 0.6, 0, 0, 0.6, 0.7, 0, 0, 0.7, 0];
  const nor = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
  const uv = computeBoxProjectedUVs(pos, nor, "y");
  assert.deepEqual([...uv].map((v) => +v.toFixed(3)), [0, 0, 0.6, 0, 0.6, 0.7, 0, 0.7]);
  // Same geometry on a shelf top (normal +y), grain along x => v follows the shelf length.
  const top = computeBoxProjectedUVs([0, 0, 0, 1.2, 0, 0, 1.2, 0, 0.26], [0, 1, 0, 0, 1, 0, 0, 1, 0], "x");
  assert.deepEqual([...top].map((v) => +v.toFixed(3)), [0, 0, 0, 1.2, 0.26, 1.2]);
  // Offsets shift the texture without changing scale.
  const shifted = computeBoxProjectedUVs(pos, nor, "y", [0.5, 0.25]);
  assert.equal(+(shifted[2]! - shifted[0]!).toFixed(3), 0.6);
});
