import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  MAX_FILE_BYTES,
  fitWithin,
  orientationTransform,
  orientationWasIgnored,
  readJpegOrientation,
  readJpegSize,
  sniffImageKind,
  validateDimensions,
  validateImageFile,
} from "@/lib/photo/validation";
import * as M from "@/lib/photo/mask";
import { applyHomography, homography, imageToGuide, isConvexQuad, UNIT_SQUARE, type Quad } from "@/lib/photo/perspective";
import { compositeAll, compositeRegion, computeShading, type RgbaImage } from "@/lib/photo/composite";
import { checkTexture, materialSource, surfaceMapping } from "@/lib/photo/materials";
import * as S from "@/lib/photo/state";
import { createPhotoDesignMeta, parsePhotoDesign, PhotoDesignMetaSchema } from "@/lib/photo/design";
import { noSegmentation, getSegmentationService } from "@/lib/photo/segmentation";

const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_HEAD = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
const HEIC_HEAD = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic")]);

// ---------- image validation ----------

test("photo upload: JPG, JPEG, PNG and WebP are accepted by their contents", () => {
  assert.equal(sniffImageKind(JPEG_HEAD), "jpeg");
  assert.equal(sniffImageKind(PNG_HEAD), "png");
  assert.equal(sniffImageKind(WEBP_HEAD), "webp");
  for (const [name, head, kind] of [["k.jpg", JPEG_HEAD, "jpeg"], ["k.JPEG", JPEG_HEAD, "jpeg"], ["k.png", PNG_HEAD, "png"], ["k.webp", WEBP_HEAD, "webp"]] as const) {
    const r = validateImageFile({ name, type: "", size: 1000 }, head);
    assert.deepEqual(r, { ok: true, kind });
  }
  // A JPEG with a wrong extension is still a JPEG.
  assert.deepEqual(validateImageFile({ name: "photo.png", type: "image/png", size: 10 }, JPEG_HEAD), { ok: true, kind: "jpeg" });
});

test("photo upload: wrong formats, HEIC, empty, fake and oversized files are rejected with helpful messages", () => {
  const bad = (name: string, head: Uint8Array, size = 1000, type = "") => {
    const r = validateImageFile({ name, type, size }, head);
    assert.equal(r.ok, false);
    return (r as { error: string }).error;
  };
  assert.match(bad("doc.pdf", new TextEncoder().encode("%PDF-1.7")), /not a supported image/);
  assert.match(bad("IMG_0001.HEIC", HEIC_HEAD), /HEIC/);
  assert.match(bad("anim.gif", new TextEncoder().encode("GIF89a....")), /GIF/);
  assert.match(bad("fake.jpg", new TextEncoder().encode("hello world")), /contents are not a valid/);
  assert.match(bad("empty.jpg", JPEG_HEAD, 0), /empty/);
  assert.match(bad("huge.jpg", JPEG_HEAD, MAX_FILE_BYTES + 1), /limit is 20\.0 MB/);
  assert.ok(validateImageFile({ name: "ok.jpg", type: "", size: MAX_FILE_BYTES }, JPEG_HEAD).ok, "exactly at the limit is fine");
});

test("photo upload: dimension limits and resizing for processing", () => {
  assert.equal(validateDimensions(4032, 3024), null);
  assert.match(validateDimensions(200, 800)!, /at least 320/);
  assert.match(validateDimensions(10000, 9000)!, /too large/);
  assert.match(validateDimensions(0, 10)!, /could not be read/);
  assert.deepEqual(fitWithin(4032, 3024, 1600), { width: 1600, height: 1200, scale: 1600 / 4032 });
  assert.deepEqual(fitWithin(3024, 4032, 1600), { width: 1200, height: 1600, scale: 1600 / 4032 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600, scale: 1 }, "never enlarged");
});

function jpegWithExif(orientation: number, little: boolean, w = 40, h = 30): Uint8Array {
  const u16 = (v: number) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v: number) => (little ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const sof = [0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, ...sof, 0xff, 0xda, 0, 2]);
}

test("photo upload: EXIF orientation is read (both byte orders) and corrected only when the browser did not", () => {
  for (const o of [1, 3, 6, 8]) {
    assert.equal(readJpegOrientation(jpegWithExif(o, true)), o);
    assert.equal(readJpegOrientation(jpegWithExif(o, false)), o);
  }
  assert.equal(readJpegOrientation(JPEG_HEAD), 1);
  assert.equal(readJpegOrientation(PNG_HEAD), 1);
  assert.deepEqual(readJpegSize(jpegWithExif(6, true, 40, 30)), { width: 40, height: 30 });
  // A phone photo stored 40×30 with orientation 6 should display as 30×40.
  assert.equal(orientationWasIgnored(6, { width: 40, height: 30 }, { width: 40, height: 30 }), true);
  assert.equal(orientationWasIgnored(6, { width: 40, height: 30 }, { width: 30, height: 40 }), false);
  assert.equal(orientationWasIgnored(1, { width: 40, height: 30 }, { width: 40, height: 30 }), false);
  // Transform for orientation 6 (rotate 90° clockwise) maps the stored top-left corner to the top-right.
  const [a, b, c, d, e, f] = orientationTransform(6, 40, 30);
  const map = (x: number, y: number) => [a * x + c * y + e, b * x + d * y + f];
  assert.deepEqual(map(0, 0), [30, 0]);
  assert.deepEqual(map(40, 30), [0, 40]);
});

// ---------- masks ----------

test("masks: brush, erase, polygon and set operations", () => {
  const m = M.createMask(40, 30);
  M.paintSegment(m, { x: 5, y: 5 }, { x: 30, y: 5 }, 3, 255);
  const brushed = M.countSelected(m);
  assert.ok(brushed > 100 && brushed < 250, `brush stroke size ${brushed}`);
  M.paintCircle(m, 15, 5, 3, 0);
  assert.ok(M.countSelected(m) < brushed, "eraser removes pixels");
  assert.equal(m.data[5 * 40 + 15], 0);

  const p = M.createMask(40, 30);
  M.fillPolygon(p, [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }], 255);
  assert.equal(M.countSelected(p), 100, "10×10 square covers exactly 100 pixel centres");
  assert.deepEqual(M.boundingBox(p), { x0: 10, y0: 10, x1: 19, y1: 19 });
  M.fillPolygon(p, [{ x: 12, y: 12 }, { x: 14, y: 12 }, { x: 14, y: 14 }, { x: 12, y: 14 }], 0);
  assert.equal(M.countSelected(p), 96, "polygon in remove mode cuts a hole");

  const u = M.union(m, p);
  assert.equal(M.countSelected(u), M.countSelected(m) + M.countSelected(p) - M.countSelected(M.intersect(m, p)));
  assert.equal(M.countSelected(M.subtract(p, p)), 0);
  assert.equal(M.countSelected(M.invert(p)), 40 * 30 - 96);
  assert.equal(M.countSelected(p), 96, "operations do not modify their inputs");
  assert.throws(() => M.union(m, M.createMask(10, 10)), /different sizes/);
});

function image(w: number, h: number, fill: (x: number, y: number) => [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

test("masks: smart select grows over similar colour, stops at edges and respects protected areas", () => {
  // Left half cabinet beige (with slight noise), right half wall blue.
  const img = image(40, 20, (x, y) => (x < 20 ? [200 + ((x * 7 + y * 3) % 9), 180, 150] : [60, 90, 200]));
  const sel = M.floodSelect(img.data, 40, 20, { x: 5, y: 5 }, 15);
  assert.equal(M.countSelected(sel), 20 * 20, "selects exactly the beige half");
  const barrier = M.createMask(40, 20);
  M.fillPolygon(barrier, [{ x: 0, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 20 }, { x: 0, y: 20 }], 255);
  const limited = M.floodSelect(img.data, 40, 20, { x: 5, y: 5 }, 15, barrier);
  assert.equal(M.countSelected(limited), 20 * 10, "protected rows are excluded");
  assert.equal(M.countSelected(M.floodSelect(img.data, 40, 20, { x: 5, y: 15 }, 15, barrier)), 0, "clicking a protected pixel selects nothing");
  assert.equal(M.countSelected(M.floodSelect(img.data, 40, 20, { x: -1, y: 5 }, 15)), 0);
});

test("masks: run-length storage round-trips and rejects damaged data", () => {
  const m = M.createMask(97, 61);
  M.paintCircle(m, 40, 30, 18, 255);
  M.fillPolygon(m, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], 255);
  const enc = M.encodeRle(m);
  assert.deepEqual(M.decodeRle(enc, 97, 61).data, m.data);
  assert.deepEqual(M.decodeRle(M.encodeRle(M.createMask(5, 5)), 5, 5).data, new Uint8Array(25));
  assert.throws(() => M.decodeRle(enc, 96, 61), /does not match/);
  // A 1600×1200 cabinet-shaped mask stays small.
  const big = M.createMask(1600, 1200);
  M.fillPolygon(big, [{ x: 100, y: 100 }, { x: 1500, y: 140 }, { x: 1480, y: 700 }, { x: 120, y: 650 }], 255);
  assert.ok(M.encodeRle(big).length < 8000, `encoded ${M.encodeRle(big).length} chars`);
});

test("masks: inside feather never touches pixels outside the selection", () => {
  const m = M.createMask(20, 20);
  M.fillPolygon(m, [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }], 255);
  const a = M.insideFeather(m, 1);
  for (let i = 0; i < a.length; i++) {
    if (!m.data[i]) assert.equal(a[i], 0);
    else assert.ok(a[i]! >= 127);
  }
  assert.equal(a[10 * 20 + 10], 255);
  assert.ok(a[5 * 20 + 5]! < 255, "corner pixel is softened");
});

// ---------- perspective ----------

test("perspective: homography maps guide corners exactly and rejects folded guides", () => {
  const q: Quad = [{ x: 100, y: 80 }, { x: 400, y: 120 }, { x: 390, y: 300 }, { x: 110, y: 330 }];
  const H = homography(UNIT_SQUARE, q)!;
  for (let i = 0; i < 4; i++) {
    const p = applyHomography(H, UNIT_SQUARE[i]!);
    assert.ok(Math.abs(p.x - q[i]!.x) < 1e-6 && Math.abs(p.y - q[i]!.y) < 1e-6);
  }
  const inv = imageToGuide(q)!;
  const mid = applyHomography(inv, applyHomography(H, { x: 0.3, y: 0.7 }));
  assert.ok(Math.abs(mid.x - 0.3) < 1e-9 && Math.abs(mid.y - 0.7) < 1e-9);
  assert.ok(isConvexQuad(q));
  assert.equal(isConvexQuad([q[0], q[2], q[1], q[3]]), false, "crossed corners");
  assert.equal(imageToGuide([q[0], q[0], q[2], q[3]]), null, "degenerate guide");
});

// ---------- compositing ----------

const stripes = (w: number, h: number): RgbaImage => image(w, h, (x) => (x % 8 < 4 ? [250, 20, 20] : [20, 20, 250]));

test("compositing: pixels outside the mask are byte-for-byte unchanged", () => {
  const photo = image(60, 40, (x, y) => [(x * 4) % 256, (y * 6) % 256, 128]);
  const mask = M.createMask(60, 40);
  M.fillPolygon(mask, [{ x: 10, y: 5 }, { x: 50, y: 8 }, { x: 48, y: 35 }, { x: 12, y: 30 }], 255);
  const shading = computeShading(photo);
  const out = compositeAll(photo, [{ mask, material: { kind: "texture", panelCode: "X", texture: stripes(32, 32) }, mapping: { guide: null, guideSizeM: { w: 1, h: 1 }, repeatM: 0.5, rotationRad: 0, mirror: true } }], shading, 0.85);
  let changedInside = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const same = out[i * 4] === photo.data[i * 4] && out[i * 4 + 1] === photo.data[i * 4 + 1] && out[i * 4 + 2] === photo.data[i * 4 + 2] && out[i * 4 + 3] === photo.data[i * 4 + 3];
    if (!mask.data[i]) assert.ok(same, `pixel ${i} outside the mask changed`);
    else if (!same) changedInside++;
  }
  assert.ok(changedInside > M.countSelected(mask) * 0.9, "texture applied inside the mask");
});

test("compositing: texture colour appears inside, shading is kept, and colours differ per region", () => {
  // Grey photo, darker at the bottom (a shadow).
  const photo = image(40, 40, (_x, y) => (y < 20 ? [180, 180, 180] : [90, 90, 90]));
  const shading = computeShading(photo, 0);
  const top = M.createMask(40, 40);
  M.fillPolygon(top, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 40 }, { x: 0, y: 40 }], 255);
  const right = M.createMask(40, 40);
  M.fillPolygon(right, [{ x: 20, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 20, y: 40 }], 255);
  const mapping = { guide: null, guideSizeM: { w: 1, h: 1 }, repeatM: 1, rotationRad: 0, mirror: false };
  const out = compositeAll(
    photo,
    [
      { mask: top, material: { kind: "colour", panelCode: "RED", rgb: [200, 40, 40] }, mapping },
      { mask: right, material: { kind: "colour", panelCode: "GREEN", rgb: [40, 160, 60] }, mapping },
    ],
    shading,
    1,
  );
  const px = (x: number, y: number) => [out[(y * 40 + x) * 4]!, out[(y * 40 + x) * 4 + 1]!, out[(y * 40 + x) * 4 + 2]!];
  assert.ok(px(10, 10)[0]! > px(10, 10)[1]! * 2, "left region is red");
  assert.ok(px(30, 10)[1]! > px(30, 10)[0]! * 2, "right region is green");
  assert.ok(px(10, 30)[0]! < px(10, 10)[0]!, "shadow in the photo darkens the new finish");
  // With shading strength 0 the panel colour is flat.
  const flat = new Uint8ClampedArray(photo.data);
  compositeRegion(flat, 40, 40, { mask: top, material: { kind: "colour", panelCode: "RED", rgb: [200, 40, 40] }, mapping }, shading, 0);
  assert.deepEqual([flat[(10 * 40 + 10) * 4], flat[(30 * 40 + 10) * 4]], [200, 200]);
});

test("compositing: the perspective guide changes how the grain is laid out", () => {
  const photo = image(80, 60, () => [128, 128, 128]);
  const shading = computeShading(photo, 0);
  const mask = M.createMask(80, 60);
  M.fillPolygon(mask, [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 60 }, { x: 0, y: 60 }], 255);
  const tex = stripes(16, 16);
  const run = (guide: Quad | null) => {
    const out = new Uint8ClampedArray(photo.data);
    compositeRegion(out, 80, 60, { mask, material: { kind: "texture", panelCode: "S", texture: tex }, mapping: { guide, guideSizeM: { w: 2, h: 1.5 }, repeatM: 0.25, rotationRad: 0, mirror: false } }, shading, 0);
    return out;
  };
  const straight = run(null);
  const angled = run([{ x: 0, y: 10 }, { x: 80, y: 0 }, { x: 80, y: 60 }, { x: 0, y: 50 }]);
  let diff = 0;
  for (let i = 0; i < straight.length; i += 4) if (straight[i] !== angled[i]) diff++;
  assert.ok(diff > 200, `perspective guide changed ${diff} pixels`);
  // Photo-aligned: vertical stripes repeat 8 times across a 2 m guide with 0.25 m repeats.
  let transitions = 0;
  for (let x = 1; x < 80; x++) if ((straight[(30 * 80 + x) * 4]! > 128) !== (straight[(30 * 80 + x - 1) * 4]! > 128)) transitions++;
  assert.ok(transitions >= 28 && transitions <= 34, `stripe transitions ${transitions}`);
});

// ---------- texture selection ----------

const product = (over: object) =>
  ({ id: "p", panelCode: "1-026-T18-C-J-1", productName: "GARDEN OAK", category: "Woodgrain", colourFamily: "Beige", finish: "Not stated", isActive: true, isPublished: true, isDemo: false, ...over }) as never;

test("texture selection: real texture first, then plain colour, and products without either are refused", () => {
  assert.deepEqual(materialSource(product({ textureUrl: "/brands/kastamonu/textures/1-026.jpg", colourHex: "#ffffff" })), { ok: true, kind: "texture", url: "/brands/kastamonu/textures/1-026.jpg" });
  assert.deepEqual(materialSource(product({ colourHex: "#F9F9F7" })), { ok: true, kind: "colour", rgb: [249, 249, 247] });
  const none = materialSource(product({}));
  assert.equal(none.ok, false);
  assert.match((none as { reason: string }).reason, /1-026-T18-C-J-1.*no texture image or colour/);
  assert.match(checkTexture(product({}), 32, 520)!, /too small/);
  assert.equal(checkTexture(product({}), 520, 520), null);
});

test("texture selection: every real Kastamonu panel resolves to its own texture file or colour", () => {
  const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/brands/kastamonu.json"), "utf8")) as { products: { panelCode: string; productName: string; textureUrl?: string; colourHex?: string }[] };
  let textures = 0;
  for (const p of data.products) {
    const src = materialSource(p);
    assert.ok(src.ok, `${p.panelCode} has no material`);
    if (src.kind === "texture") {
      textures++;
      assert.ok(fs.existsSync(path.join(process.cwd(), "public", src.url)), `missing file ${src.url}`);
    }
  }
  assert.ok(textures > 50, `${textures} panels use texture images`);
});

test("texture selection: grain direction, repeat size and user adjustments", () => {
  const look = { guideSizeCm: { w: 240, h: 72 }, scale: 2, rotationDeg: 15, mirror: true };
  const m = surfaceMapping(product({ grainDirection: "horizontal" }), look);
  assert.deepEqual(m.guideSizeM, { w: 2.4, h: 0.72 });
  assert.equal(m.repeatM, 2, "1 m default repeat × user scale 2");
  assert.ok(Math.abs(m.rotationRad - (105 * Math.PI) / 180) < 1e-9, "90° for horizontal grain + 15° user rotation");
  assert.equal(surfaceMapping(product({ textureScale: 0.6 }), { ...look, scale: 1 }).repeatM, 0.6);
});

// ---------- design state ----------

const rect = (w: number, h: number, x0: number, y0: number, x1: number, y1: number) => {
  const m = M.createMask(w, h);
  M.fillPolygon(m, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], 255);
  return m;
};

test("design state: a pixel belongs to one region, protected areas are never selected", () => {
  let doc = S.createDoc(50, 40);
  doc = S.applyMaskEdit(doc, "upper_cabinets", rect(50, 40, 0, 0, 30, 20), "add");
  doc = S.applyMaskEdit(doc, "lower_cabinets", rect(50, 40, 20, 10, 50, 40), "add");
  assert.equal(M.countSelected(M.intersect(doc.masks.upper_cabinets, doc.masks.lower_cabinets)), 0, "regions do not overlap");
  assert.equal(M.countSelected(doc.masks.upper_cabinets), 30 * 20 - 10 * 10, "the overlap moved to the newer region");

  // Protect a worktop strip: removed from regions and blocked for later adds.
  doc = S.applyMaskEdit(doc, "protect", rect(50, 40, 0, 18, 50, 22), "add");
  assert.equal(M.countSelected(M.intersect(doc.masks.lower_cabinets, doc.protect)), 0);
  doc = S.applyMaskEdit(doc, "lower_cabinets", rect(50, 40, 0, 0, 50, 40), "add");
  assert.equal(M.countSelected(M.intersect(doc.masks.lower_cabinets, doc.protect)), 0, "protected pixels stay out");

  // Correcting a mistake: remove part of a region.
  const before = M.countSelected(doc.masks.lower_cabinets);
  doc = S.applyMaskEdit(doc, "lower_cabinets", rect(50, 40, 0, 30, 50, 40), "remove");
  assert.equal(M.countSelected(doc.masks.lower_cabinets), before - 50 * 10);
  doc = S.clearTarget(doc, "lower_cabinets");
  assert.ok(M.isEmpty(doc.masks.lower_cabinets));
});

test("design state: automatic guide follows the selection until fitted by hand; summary lists regions with an area and a panel", () => {
  let doc = S.createDoc(100, 80);
  doc = S.applyMaskEdit(doc, "tall_cabinets", rect(100, 80, 10, 5, 30, 75), "add");
  assert.deepEqual(doc.regions.tall_cabinets.guide![0], { x: 10, y: 5 });
  assert.equal(doc.regions.tall_cabinets.guideSizeCm.h, 210);
  assert.equal(doc.regions.tall_cabinets.guideSizeCm.w, 60, "width suggested from the box shape (20 px wide, 70 px tall)");
  const fitted: Quad = [{ x: 12, y: 8 }, { x: 31, y: 4 }, { x: 31, y: 76 }, { x: 12, y: 72 }];
  doc = S.updateLook(doc, "tall_cabinets", { guide: fitted, guideAdjusted: true });
  doc = S.applyMaskEdit(doc, "tall_cabinets", rect(100, 80, 30, 5, 40, 75), "add");
  assert.deepEqual(doc.regions.tall_cabinets.guide, fitted, "a fitted guide is not moved by later edits");
  assert.throws(() => S.updateLook(doc, "tall_cabinets", { guide: [fitted[0], fitted[2], fitted[1], fitted[3]] }), /crossing/);

  doc = S.assignPanel(doc, "tall_cabinets", "1-669-T18-C-L-27");
  doc = S.assignPanel(doc, "upper_cabinets", "1-026-T18-C-J-1"); // no area selected yet
  doc = S.applyMaskEdit(doc, "island_panels", rect(100, 80, 50, 40, 90, 70), "add");
  doc = S.assignPanel(doc, "island_panels", "1-001-T18-C-J-1");
  assert.deepEqual(S.assignedRegions(doc), [
    { region: "tall_cabinets", regionLabel: "Tall cabinets", panelCode: "1-669-T18-C-L-27" },
    { region: "island_panels", regionLabel: "Kitchen island", panelCode: "1-001-T18-C-J-1" },
  ]);
});

test("design state: undo, redo and reset through serialised history", () => {
  let doc = S.createDoc(30, 20);
  let h = S.startHistory(S.serializeDoc(doc));
  doc = S.applyMaskEdit(doc, "lower_cabinets", rect(30, 20, 0, 0, 10, 10), "add");
  h = S.pushHistory(h, S.serializeDoc(doc));
  doc = S.assignPanel(doc, "lower_cabinets", "1-026-T18-C-J-1");
  h = S.pushHistory(h, S.serializeDoc(doc));
  h = S.undo(h);
  let back = S.deserializeDoc(h.present);
  assert.equal(back.regions.lower_cabinets.panelCode, undefined);
  assert.equal(M.countSelected(back.masks.lower_cabinets), 100);
  h = S.undo(h);
  assert.ok(M.isEmpty(S.deserializeDoc(h.present).masks.lower_cabinets));
  assert.equal(S.undo(h), h, "nothing more to undo");
  h = S.redo(S.redo(h));
  back = S.deserializeDoc(h.present);
  assert.equal(back.regions.lower_cabinets.panelCode, "1-026-T18-C-J-1");
  // A new edit after undo clears the redo list.
  h = S.pushHistory(S.undo(h), S.serializeDoc(S.createDoc(30, 20)));
  assert.equal(h.future.length, 0);
  // History is capped.
  let big = S.startHistory(0);
  for (let i = 1; i <= 80; i++) big = S.pushHistory(big, i);
  assert.equal(big.past.length, S.HISTORY_LIMIT);
  assert.throws(() => S.deserializeDoc(S.serializeDoc(doc), { width: 31, height: 20 }), /different image size/);
  assert.throws(() => S.deserializeDoc({ width: 1 }));
});

test("saved photo design: records ID, timestamps, panels by region, selections and notes; damaged records are skipped", () => {
  let doc = S.createDoc(40, 30);
  doc = S.applyMaskEdit(doc, "lower_cabinets", rect(40, 30, 0, 15, 40, 30), "add");
  doc = S.assignPanel(doc, "lower_cabinets", "1-026-T18-C-J-1");
  const meta = createPhotoDesignMeta({ name: "  Villa 12 photo ", notes: "Prefers matt", keepsOriginal: true, doc, productNames: { "1-026-T18-C-J-1": "GARDEN OAK" } }, "2026-10-25T08:00:00.000Z");
  assert.match(meta.id, /^pd_/);
  assert.equal(meta.name, "Villa 12 photo");
  assert.equal(meta.createdAt, "2026-10-25T08:00:00.000Z");
  assert.deepEqual(meta.panels, [{ region: "lower_cabinets", regionLabel: "Lower cabinets", panelCode: "1-026-T18-C-J-1", productName: "GARDEN OAK" }]);
  assert.equal(M.countSelected(S.deserializeDoc(meta.state).masks.lower_cabinets), 40 * 15);
  assert.throws(() => createPhotoDesignMeta({ name: " ", keepsOriginal: false, doc, productNames: {} }), /name/);
  assert.ok(PhotoDesignMetaSchema.safeParse(meta).success);

  const preview = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
  assert.ok(parsePhotoDesign({ ...meta, preview, original: preview }));
  assert.equal(parsePhotoDesign({ ...meta, preview }), null, "says it keeps the original but has none");
  assert.ok(parsePhotoDesign({ ...meta, keepsOriginal: false, preview }));
  assert.equal(parsePhotoDesign({ ...meta, preview: "not a blob" }), null);
  assert.equal(parsePhotoDesign({ id: "x" }), null);
});

test("segmentation: nothing is configured, and it says so instead of pretending", async () => {
  const s = getSegmentationService();
  assert.equal(s, noSegmentation);
  const st = await s.status();
  assert.equal(st.available, false);
  assert.match(st.message, /not set up/);
  await assert.rejects(() => s.segment({ width: 1, height: 1, data: new Uint8Array(4) }), /not configured/);
});
