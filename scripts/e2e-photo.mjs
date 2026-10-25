// Browser acceptance tests for "My Kitchen Photo" (the 14 checks in docs/photo-visualiser.md).
//
//   ADMIN_PASSWORD=some-long-test-password DATA_DIR=/tmp/tks-photo npm start
//   E2E_DATA_DIR=/tmp/tks-photo ADMIN_PASSWORD=some-long-test-password npm run test:e2e:photo
//
// Optional: PHOTO_FRONT=/path/front.jpg PHOTO_ANGLE=/path/angled.jpg to test on real kitchen photos.
// Without them a synthetic kitchen picture is generated (cabinets, worktop, wall, handles).
// Screenshots and results.json go to E2E_OUT (default e2e-photo-screenshots/).
import { chromium, devices } from "playwright";
import sharp from "sharp";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.E2E_OUT || "e2e-photo-screenshots";
const DATA_DIR = process.env.E2E_DATA_DIR || "";
const PASSWORD = process.env.ADMIN_PASSWORD || "";
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tks-photo-e2e-"));

const results = [];
const ONLY = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(",") : null;
const check = async (id, name, fn) => {
  if (ONLY && !ONLY.includes(id)) return;
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, ok: true, detail: detail ?? "", ms: Date.now() - t0 });
    console.log(`PASS  ${id} ${name}${detail ? `  (${detail})` : ""}`);
  } catch (err) {
    results.push({ id, name, ok: false, detail: String(err?.message ?? err).split("\n").slice(0, 4).join(" | "), ms: Date.now() - t0 });
    console.log(`FAIL  ${id} ${name}  -> ${String(err?.message ?? err).split("\n").slice(0, 6).join(" | ")}`);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

// ---------- test images ----------
async function syntheticKitchen(file) {
  const doors = (x0, y0, w, h, n, fill) =>
    Array.from({ length: n }, (_, i) => `<rect x="${x0 + i * (w / n) + 3}" y="${y0}" width="${w / n - 6}" height="${h}" fill="${fill}"/><rect x="${x0 + (i + 0.5) * (w / n) - 2}" y="${y0 + 12}" width="4" height="40" fill="#333"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1000">
    <defs><linearGradient id="l" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity="0.25"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
    <rect width="1400" height="1000" fill="#7d8fa8"/>
    <rect x="0" y="0" width="1400" height="80" fill="#f2f0ea"/>
    <rect x="150" y="120" width="1100" height="260" fill="#2b2b2b"/>${doors(150, 120, 1100, 260, 5, "#d9cdb8")}
    <rect x="150" y="520" width="1100" height="40" fill="#efefef"/>
    <rect x="150" y="560" width="1100" height="300" fill="#2b2b2b"/>${doors(150, 560, 1100, 300, 5, "#8a5a3c")}
    <rect x="600" y="600" width="220" height="200" fill="#151515"/>
    <rect x="0" y="860" width="1400" height="140" fill="#9a958c"/>
    <rect x="150" y="120" width="1100" height="740" fill="url(#l)"/>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(file);
  return file;
}
const FRONT = process.env.PHOTO_FRONT || (await syntheticKitchen(path.join(TMP, "synthetic-kitchen.jpg")));
const SYNTHETIC = !process.env.PHOTO_FRONT;
// Points (in the photo's own pixels) used for the synthetic picture. Real photos set PHOTO_POINTS as JSON.
const POINTS = process.env.PHOTO_POINTS
  ? JSON.parse(process.env.PHOTO_POINTS)
  : { upper: [[260, 250], [480, 250], [700, 250]], lower: [[260, 700], [480, 700]], wall: [70, 450], worktop: [[150, 540], [1250, 540]] };

const files = {
  pdf: path.join(TMP, "brochure.pdf"),
  fakeJpg: path.join(TMP, "not-really.jpg"),
  heic: path.join(TMP, "IMG_0001.HEIC"),
  huge: path.join(TMP, "huge.jpg"),
  tiny: path.join(TMP, "tiny.png"),
  rotated: path.join(TMP, "rotated-exif6.jpg"),
  png: path.join(TMP, "kitchen.png"),
  webp: path.join(TMP, "kitchen.webp"),
};
fs.writeFileSync(files.pdf, "%PDF-1.7\n%âãÏÓ\n1 0 obj<<>>endobj\n");
fs.writeFileSync(files.fakeJpg, "this is a text file pretending to be a photo");
fs.writeFileSync(files.heic, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(64)]));
fs.writeFileSync(files.huge, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(21 * 1024 * 1024)]));
await sharp({ create: { width: 120, height: 90, channels: 3, background: "#888" } }).png().toFile(files.tiny);
// A landscape photo stored sideways with EXIF orientation 6, as phones do. It must show upright (portrait).
await sharp(FRONT).resize(800).rotate(-90).withMetadata({ orientation: 6 }).jpeg().toFile(files.rotated);
await sharp(FRONT).resize(900).png().toFile(files.png);
await sharp(FRONT).resize(900).webp().toFile(files.webp);

// ---------- browser helpers ----------
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const pageErrors = [];
const watch = (page, label) => {
  page.on("pageerror", (e) => pageErrors.push(`[${label}] ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && pageErrors.push(`[${label}] console: ${m.text()}`));
};
const P = "[data-testid=photo-studio] ";

async function openPhoto(opts = { viewport: { width: 1440, height: 900 } }, label = "desktop") {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  watch(page, label);
  await page.goto(`${BASE}/?mode=photo`);
  await page.waitForSelector("[data-testid=photo-dropzone]");
  return { ctx, page };
}
async function upload(page, file) {
  await page.setInputFiles(P + "[data-testid=photo-input]", file);
  await page.waitForSelector("[data-testid=photo-pending]");
  await page.click("[data-testid=photo-use]");
  await page.waitForSelector("[data-testid=photo-stage]");
  await page.waitForTimeout(300);
}
const stageInfo = async (page) => {
  const s = page.locator("[data-testid=photo-stage]");
  return { box: await s.boundingBox(), W: Number(await s.getAttribute("data-image-width")), H: Number(await s.getAttribute("data-image-height")) };
};
const at = async (page, x, y) => {
  const { box, W, H } = await stageInfo(page);
  return { x: box.x + (x / W) * box.width, y: box.y + (y / H) * box.height };
};
const clickAt = async (page, x, y) => {
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
};
const drag = async (page, pts) => {
  const first = await at(page, ...pts[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    const q = await at(page, ...p);
    await page.mouse.move(q.x, q.y, { steps: 8 });
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
};
const area = async (page, r) => Number(await page.locator(`[data-testid=photo-region-${r}]`).getAttribute("data-area"));
const code = (page, r) => page.locator(`[data-testid=photo-region-${r}]`).getAttribute("data-panel-code");
const region = (page, r) => page.click(`[data-testid=photo-region-${r}]`);
const tool = (page, t) => page.click(`[data-testid=tool-${t}]`);
const pick = async (page, panelCode) => {
  await page.click("[data-testid=photo-tab-finish]");
  await page.fill(P + "[data-testid=panel-search]", panelCode);
  await page.waitForTimeout(500);
  await page.locator(P + `[data-testid="product-${panelCode}"]`).click();
};
const waitComposite = (page) => page.waitForFunction(() => !!window.__photoStudio?.composite, null, { timeout: 15_000 });
/** Compares the preview with the original photo, inside and outside the selections. */
const pixelReport = (page) =>
  page.evaluate(() => {
    const { doc, original, composite } = window.__photoStudio;
    if (!composite) return { composite: false };
    const masks = Object.values(doc.masks).map((m) => m.data);
    let outside = 0, changedOutside = 0, inside = 0, changedInside = 0;
    for (let i = 0; i < original.width * original.height; i++) {
      const sel = masks.some((m) => m[i]);
      const o = i * 4;
      const same = original.data[o] === composite.data[o] && original.data[o + 1] === composite.data[o + 1] && original.data[o + 2] === composite.data[o + 2] && original.data[o + 3] === composite.data[o + 3];
      if (sel) {
        inside++;
        if (!same) changedInside++;
      } else {
        outside++;
        if (!same) changedOutside++;
      }
    }
    // What is on screen must be the composite.
    const c = document.querySelector("[data-testid=photo-output]");
    const shown = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let screenDiff = 0;
    for (let i = 0; i < shown.length; i += 97) if (shown[i] !== composite.data[i]) screenDiff++;
    return { composite: true, outside, changedOutside, inside, changedInside, screenDiff };
  });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

// ---------- the 14 checks ----------
const { page } = await openPhoto();

await check("T1", "Upload a valid kitchen photo (JPG, PNG, WebP), preview before processing, privacy note", async () => {
  await page.setInputFiles(P + "[data-testid=photo-input]", FRONT);
  await page.waitForSelector("[data-testid=photo-pending] img");
  const name = await page.locator("[data-testid=photo-pending]").textContent();
  assert(name.includes(path.basename(FRONT)), "file name not shown in the preview");
  await shot(page, "photo-01-pending");
  const privacy = await page.locator("[data-testid=photo-privacy]").textContent();
  assert(/processed entirely in your browser/.test(privacy), "privacy note missing");
  await page.click("[data-testid=photo-use]");
  await page.waitForSelector("[data-testid=photo-stage]");
  const { W, H } = await stageInfo(page);
  assert(W > 0 && H > 0 && Math.max(W, H) <= 1600, `processing size ${W}×${H}`);
  // PNG and WebP open too (in a second page, so this one keeps the JPG).
  const { ctx: c2, page: p2 } = await openPhoto(undefined, "formats");
  for (const f of [files.png, files.webp]) {
    await upload(p2, f);
    await p2.click("[data-testid=photo-new]");
    await p2.waitForSelector("[data-testid=photo-dropzone]");
  }
  await c2.close();
  return `JPG ${W}×${H} for editing${SYNTHETIC ? " (synthetic test kitchen)" : ""}; PNG and WebP also open; privacy note shown before processing`;
});

await check("T2", "Invalid formats, HEIC, fake and oversized files are refused with clear messages; EXIF rotation corrected", async () => {
  const { ctx, page: p } = await openPhoto(undefined, "invalid");
  const msgs = {};
  for (const [k, f] of Object.entries({ pdf: files.pdf, fake: files.fakeJpg, heic: files.heic, huge: files.huge, tiny: files.tiny })) {
    await p.setInputFiles(P + "[data-testid=photo-input]", f);
    if (k === "tiny") {
      await p.click("[data-testid=photo-use]");
    }
    await p.waitForSelector("[data-testid=photo-error]", { timeout: 10_000 });
    msgs[k] = await p.locator("[data-testid=photo-error]").textContent();
    assert(!(await p.locator("[data-testid=photo-stage]").count()), `${k} was accepted`);
    if (k === "tiny") await p.click("[data-testid=photo-remove]");
  }
  assert(/not a supported image/.test(msgs.pdf), msgs.pdf);
  assert(/not a valid JPG/.test(msgs.fake), msgs.fake);
  assert(/HEIC/.test(msgs.heic), msgs.heic);
  assert(/limit is 20\.0 MB/.test(msgs.huge), msgs.huge);
  assert(/at least 320/.test(msgs.tiny), msgs.tiny);
  await shot(p, "photo-02-invalid");
  await upload(p, files.rotated);
  // The file stores the landscape kitchen turned sideways (portrait pixels) plus "rotate 90°" in EXIF.
  const { W, H } = await stageInfo(p);
  assert(W > H, `EXIF-rotated photo shown ${W}×${H}, expected the upright landscape`);
  const upright = await p.evaluate(() => {
    const { original: o } = window.__photoStudio;
    const rowMean = (y) => {
      let s = 0;
      for (let x = 0; x < o.width; x++) s += o.data[(y * o.width + x) * 4];
      return s / o.width;
    };
    return { top: rowMean(5), bottom: rowMean(o.height - 5) };
  });
  // In the test kitchen the ceiling (top) is lighter than the floor (bottom).
  if (SYNTHETIC) assert(upright.top > upright.bottom + 40, `content not upright: top ${upright.top}, bottom ${upright.bottom}`);
  await ctx.close();
  return `pdf, fake jpg, HEIC, 21 MB and 120×90 refused with specific messages; sideways phone photo (EXIF 6) shown upright ${W}×${H}`;
});

await check("T3", "Select cabinet surfaces manually (smart select, brush, shape)", async () => {
  await region(page, "upper_cabinets");
  await tool(page, "smart");
  for (const p of POINTS.upper) await clickAt(page, ...p);
  const smart = await area(page, "upper_cabinets");
  assert(smart > 0.03, `smart select area ${smart}`);
  await region(page, "lower_cabinets");
  await tool(page, "brush");
  await drag(page, [POINTS.lower[0], POINTS.lower[1]]);
  const brushed = await area(page, "lower_cabinets");
  assert(brushed > 0.001, `brush area ${brushed}`);
  await tool(page, "smart");
  for (const p of POINTS.lower) await clickAt(page, ...p);
  const lower = await area(page, "lower_cabinets");
  // Shape tool on "other panels"
  await region(page, "other_panels");
  await tool(page, "polygon");
  for (const p of [[20, 880], [120, 880], [120, 980], [20, 980]]) await clickAt(page, ...p);
  await page.click("[data-testid=polygon-finish]");
  await page.waitForTimeout(200);
  const shape = await area(page, "other_panels");
  assert(shape > 0.004, `shape area ${shape}`);
  await shot(page, "photo-03-selected");
  return `upper ${(smart * 100).toFixed(1)}% (smart select), lower ${(lower * 100).toFixed(1)}% (brush + smart), other ${(shape * 100).toFixed(2)}% (shape)`;
});

await check("T4", "Correct mistakes: eraser, remove mode, protect, clear, undo/redo", async () => {
  // A mistaken smart-select click on the wall, then removed again.
  await region(page, "upper_cabinets");
  await tool(page, "smart");
  const before = await area(page, "upper_cabinets");
  await clickAt(page, ...POINTS.wall);
  const mistaken = await area(page, "upper_cabinets");
  assert(mistaken > before, "the mistaken click added nothing");
  await page.click("[data-testid=photo-undo]");
  await page.waitForTimeout(200);
  assert(Math.abs((await area(page, "upper_cabinets")) - before) < 1e-6, "undo did not remove the mistake");
  await page.click("[data-testid=photo-redo]");
  await page.waitForTimeout(200);
  assert((await area(page, "upper_cabinets")) === mistaken, "redo did not bring it back");
  await page.click("[data-testid=mode-remove]");
  await clickAt(page, ...POINTS.wall);
  await page.click("[data-testid=mode-add]");
  const fixed = await area(page, "upper_cabinets");
  assert(Math.abs(fixed - before) < 0.002, `remove mode left ${fixed} vs ${before}`);
  // Eraser
  await tool(page, "erase");
  await drag(page, [POINTS.upper[0], [POINTS.upper[0][0] + 60, POINTS.upper[0][1]]]);
  const erased = await area(page, "upper_cabinets");
  assert(erased < fixed, "eraser removed nothing");
  // Protect the worktop: protected pixels leave every region and block later selection.
  await tool(page, "protect");
  await drag(page, POINTS.worktop);
  const protectedOverlap = await page.evaluate(() => {
    const { doc } = window.__photoStudio;
    let n = 0, p = 0;
    for (let i = 0; i < doc.protect.data.length; i++) if (doc.protect.data[i]) {
      p++;
      if (Object.values(doc.masks).some((m) => m.data[i])) n++;
    }
    return { n, p };
  });
  assert(protectedOverlap.p > 0 && protectedOverlap.n === 0, `protected ${protectedOverlap.p}px, ${protectedOverlap.n} still selected`);
  return `wall mistake undone/redone and removed; eraser ${(fixed * 100).toFixed(1)}% → ${(erased * 100).toFixed(1)}%; ${protectedOverlap.p} px protected and excluded`;
});

let textureRequests = [];
page.on("request", (r) => r.url().includes("/brands/kastamonu/textures/") && textureRequests.push(new URL(r.url()).pathname));

await check("T5", "Apply a real Target (Kastamonu) panel texture to the selected surface", async () => {
  await region(page, "upper_cabinets");
  await pick(page, "1-668-T18-C-L-27");
  await page.waitForFunction(() => document.querySelector("[data-testid=photo-region-upper_cabinets]")?.dataset.panelCode === "1-668-T18-C-L-27");
  await waitComposite(page);
  await page.waitForTimeout(300);
  const rep = await pixelReport(page);
  assert(rep.changedInside > rep.inside * 0.2, `only ${rep.changedInside}/${rep.inside} selected pixels changed`);
  assert(textureRequests.some((u) => u.endsWith("/1-668.jpg")), `texture file not requested: ${textureRequests.join(",")}`);
  const badge = await page.locator("[data-testid=approximate-badge]").isVisible();
  assert(badge, "approximate-preview label missing");
  await shot(page, "photo-04-texture");
  return `1-668-T18-C-L-27 CANALETTO WALNUT from ${textureRequests.find((u) => u.endsWith("/1-668.jpg"))}; labelled “Approximate visual preview”`;
});

await check("T6", "Areas outside the masks are unchanged by compositing", async () => {
  const rep = await pixelReport(page);
  assert(rep.composite, "no composite");
  assert(rep.changedOutside === 0, `${rep.changedOutside} pixels outside the selections changed`);
  assert(rep.screenDiff === 0, `on-screen canvas differs from the composite at ${rep.screenDiff} samples`);
  return `${rep.outside} unselected pixels identical to the photo; ${rep.changedInside} of ${rep.inside} selected pixels changed`;
});

await check("T7", "Different panel codes on different regions; a missing texture is refused, not substituted", async () => {
  await region(page, "lower_cabinets");
  await pick(page, "1-001-T18-C-J-1");
  await page.waitForFunction(() => document.querySelector("[data-testid=photo-region-lower_cabinets]")?.dataset.panelCode === "1-001-T18-C-J-1");
  await region(page, "other_panels");
  await pick(page, "1-026-T18-C-J-1");
  await page.waitForFunction(() => document.querySelector("[data-testid=photo-region-other_panels]")?.dataset.panelCode === "1-026-T18-C-J-1");
  await page.waitForTimeout(400);
  const codes = { upper: await code(page, "upper_cabinets"), lower: await code(page, "lower_cabinets"), other: await code(page, "other_panels") };
  assert(codes.upper === "1-668-T18-C-L-27" && codes.lower === "1-001-T18-C-J-1" && codes.other === "1-026-T18-C-J-1", JSON.stringify(codes));
  // Break one texture file and try to apply it: warning, region keeps its panel.
  await page.route("**/brands/kastamonu/textures/1-525.jpg", (r) => r.fulfill({ status: 404, body: "missing" }));
  await region(page, "other_panels");
  await pick(page, "1-525-T18-C-J-1");
  await page.waitForSelector("[data-testid=photo-notice]");
  const notice = await page.locator("[data-testid=photo-notice]").textContent();
  assert(/could not be loaded/.test(notice) && /no other panel was substituted/.test(notice), notice);
  assert((await code(page, "other_panels")) === "1-026-T18-C-J-1", "region changed despite the missing texture");
  await page.unroute("**/brands/kastamonu/textures/1-525.jpg");
  await page.click("[data-testid=view-preview]");
  await shot(page, "photo-05-three-regions");
  return `upper ${codes.upper}, lower ${codes.lower} (plain colour), other ${codes.other}; broken texture 1-525 refused with a warning`;
});

await check("T8", "Reset restores the original photo (and Undo brings the work back)", async () => {
  await page.click("[data-testid=photo-reset]");
  await page.waitForFunction(() => window.__photoStudio && !window.__photoStudio.composite);
  await page.waitForTimeout(200);
  const same = await page.evaluate(() => {
    const { original } = window.__photoStudio;
    const c = document.querySelector("[data-testid=photo-output]");
    const shown = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let diff = 0;
    for (let i = 0; i < shown.length; i++) if (shown[i] !== original.data[i]) diff++;
    return diff;
  });
  assert(same === 0, `${same} bytes differ from the original after reset`);
  await page.click("[data-testid=photo-undo]");
  await waitComposite(page);
  assert((await code(page, "upper_cabinets")) === "1-668-T18-C-L-27", "undo after reset did not restore");
  return "screen identical to the uploaded photo after Reset; Undo restored all three regions";
});

await check("T9", "Compare original and preview: toggle, slider, zoom, full size", async () => {
  await page.click("[data-testid=view-original]");
  assert((await page.locator("[data-testid=photo-view-label]").textContent()) === "Original photo", "original label");
  await page.click("[data-testid=view-compare]");
  await page.waitForSelector("[data-testid=photo-before]");
  await page.locator("[data-testid=compare-slider]").fill("30");
  const clip = await page.locator("[data-testid=photo-before]").evaluate((el) => el.style.clipPath);
  assert(clip.includes("70%"), `clip ${clip}`);
  await page.locator("[data-testid=photo-viewport]").screenshot({ path: path.join(OUT, "photo-06-compare.png") });
  await page.click("[data-testid=view-preview]");
  await page.click(P + "[data-testid=zoom-in]");
  await page.click(P + "[data-testid=zoom-in]");
  const z = await page.locator(P + "[data-testid=zoom-level]").textContent();
  assert(z === "156%", `zoom ${z}`);
  await page.click(P + "[data-testid=zoom-fit]");
  await page.click(P + "[data-testid=full-size]");
  await page.waitForSelector("[data-testid=full-size-view]");
  await page.click("[data-testid=full-size-close]");
  return `original label, compare slider at 30% clips the original, zoom 156%, full-size view opens`;
});

await check("T10", "Design summary lists the selected panel codes by region", async () => {
  await page.click("[data-testid=photo-tab-summary]");
  const rows = await page.locator("[data-testid=photo-summary-list] [data-panel-code]").evaluateAll((els) => els.map((e) => [e.dataset.testid, e.dataset.panelCode]));
  const map = Object.fromEntries(rows);
  assert(map["summary-upper_cabinets"] === "1-668-T18-C-L-27" && map["summary-lower_cabinets"] === "1-001-T18-C-J-1" && map["summary-other_panels"] === "1-026-T18-C-J-1", JSON.stringify(rows));
  await shot(page, "photo-07-summary");
  return rows.map(([k, v]) => `${k.replace("summary-", "")}: ${v}`).join(", ");
});

await check("T11", "Save the design (reopens with the same codes) and submit a quote with an attached preview", async () => {
  await page.click("[data-testid=photo-save]");
  await page.fill("[data-testid=photo-save-name]", "E2E villa photo");
  await page.fill("[data-testid=photo-save-notes]", "Customer prefers matt");
  await page.click("[data-testid=photo-save-confirm]");
  await page.waitForFunction(() => document.querySelector("[data-testid=photo-design-status]")?.textContent.includes("E2E villa photo"));
  // Reload, reopen from the saved list.
  await page.goto(`${BASE}/?mode=photo`);
  await page.click("[data-testid=photo-open-designs]");
  await page.waitForSelector("[data-testid=photo-design-open]");
  await page.locator("[data-testid=photo-design-open]").first().click();
  await page.waitForSelector("[data-testid=photo-stage]");
  await waitComposite(page);
  const reopened = [await code(page, "upper_cabinets"), await code(page, "lower_cabinets"), await code(page, "other_panels")];
  assert(reopened.join() === "1-668-T18-C-L-27,1-001-T18-C-J-1,1-026-T18-C-J-1", `reopened ${reopened}`);
  // Quote with preview.
  await page.click("[data-testid=photo-open-quote]");
  await page.waitForSelector("[data-testid=quote-form]");
  const listed = await page.locator("[data-testid=quote-panels]").textContent();
  assert(listed.includes("1-668-T18-C-L-27") && listed.includes("Other panels"), listed);
  await page.fill("[data-testid=q-name]", "Photo Tester");
  await page.fill("[data-testid=q-email]", "photo@test.qa");
  await page.check("[data-testid=q-consent]");
  await page.check("[data-testid=q-attach-preview]");
  await page.click("[data-testid=q-submit]");
  const outcome = await Promise.race([page.waitForSelector("[data-testid=quote-success]").then(() => "ok"), page.waitForSelector("[data-testid=quote-error]").then(() => "error")]);
  if (outcome === "error") throw new Error(`quote failed: ${await page.locator("[data-testid=quote-error]").textContent()}`);
  const ref = await page.locator("[data-testid=quote-reference]").textContent();
  await shot(page, "photo-08-quote-sent");
  let stored = "server data folder not checked (set E2E_DATA_DIR)";
  if (DATA_DIR) {
    const list = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "enquiries.json"), "utf8")).enquiries;
    const e = list.find((x) => x.reference === ref);
    assert(e && e.source === "photo", "enquiry not stored as a photo enquiry");
    assert(e.design.items.map((i) => i.panelCode).join() === "1-668-T18-C-L-27,1-001-T18-C-J-1,1-026-T18-C-J-1", "stored codes differ");
    const img = path.join(DATA_DIR, "enquiry-previews", `${e.id}.jpg`);
    assert(fs.existsSync(img) && fs.statSync(img).size === e.photo.preview.bytes, "preview file missing");
    // Admin-only access to the preview.
    const anon = await page.request.get(`${BASE}/api/admin/enquiries/${e.id}/preview`);
    let adminStatus = "admin not configured";
    if (PASSWORD) {
      const ctx = await browser.newContext();
      const login = await ctx.request.post(`${BASE}/api/admin/session`, { data: { password: PASSWORD }, headers: { Origin: BASE } });
      assert(login.ok(), "admin sign-in failed");
      const r = await ctx.request.get(`${BASE}/api/admin/enquiries/${e.id}/preview`);
      assert(r.status() === 200 && r.headers()["content-type"] === "image/jpeg" && /no-store/.test(r.headers()["cache-control"]), `admin preview ${r.status()}`);
      adminStatus = "200 for a signed-in admin";
      await ctx.close();
    }
    assert(anon.status() === 401 || anon.status() === 503, `preview served without sign-in (${anon.status()})`);
    stored = `stored with 3 checked codes; ${Math.round(fs.statSync(img).size / 1024)} KB preview kept privately; ${anon.status()} without sign-in, ${adminStatus}`;
  }
  await page.click("[data-testid=dialog-close]");
  return `saved and reopened “E2E villa photo”; quote ${ref}; ${stored}`;
});

await check("T12", "Works on a phone (390×844 touch): no sideways scroll, draw with a finger, controls reachable", async () => {
  const { ctx, page: p } = await openPhoto({ ...devices["iPhone 13"] }, "phone");
  await upload(p, FRONT);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `horizontal overflow ${overflow}px`);
  await p.click("[data-testid=photo-region-upper_cabinets]");
  await p.click("[data-testid=tool-smart]");
  const pt = await at(p, ...POINTS.upper[1]);
  await p.touchscreen.tap(pt.x, pt.y);
  await p.waitForTimeout(400);
  const a = Number(await p.locator("[data-testid=photo-region-upper_cabinets]").getAttribute("data-area"));
  assert(a > 0.01, `tap selected ${a}`);
  await p.fill(P + "[data-testid=panel-search]", "1-668");
  await p.waitForTimeout(500);
  await p.locator(P + '[data-testid="product-1-668-T18-C-L-27"]').click();
  await p.waitForFunction(() => !!window.__photoStudio?.composite, null, { timeout: 15_000 });
  const vp = await p.locator("[data-testid=photo-viewport]").boundingBox();
  assert(vp.height > 250, `photo area only ${vp.height}px tall`);
  await p.screenshot({ path: path.join(OUT, "photo-09-phone.png") });
  await ctx.close();
  return `no horizontal scroll; tap smart-select ${(a * 100).toFixed(1)}%; texture applied; photo area ${Math.round(vp.height)}px tall`;
});

await check("T13", "The 3D configurator still works (switch modes, 3D renders, panel applies)", async () => {
  await page.click("[data-testid=mode-panel-photo] [data-testid=mode-3d]");
  await page.waitForSelector("[data-testid=viewport][data-status=ready]", { timeout: 120_000 });
  const meshes = await page.evaluate(() => window.__kitchenViewer.inspectRegion("lower_cabinets").meshCount);
  await page.click("[data-testid=region-lower_cabinets]");
  await page.fill("[data-testid=mode-panel-3d] [data-testid=panel-search]", "1-669");
  await page.waitForTimeout(500);
  await page.locator('[data-testid=mode-panel-3d] [data-testid="product-1-669-T18-C-L-27"]').click();
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-testid=region-lower_cabinets]");
    return el?.dataset.panelCode === "1-669-T18-C-L-27" && el?.dataset.status === "ok";
  }, null, { timeout: 60_000 });
  await shot(page, "photo-10-3d-still-works");
  // Back to the photo: work in progress is still there.
  await page.click("[data-testid=mode-panel-3d] [data-testid=mode-photo]");
  assert((await code(page, "upper_cabinets")) === "1-668-T18-C-L-27", "photo work lost after switching modes");
  return `3D ready, lower cabinets ${meshes} meshes, 1-669 applied in 3D; photo work kept when switching back`;
});

await check("T14", "No unconfigured AI or backend is reported as working", async () => {
  const seg = await page.locator("[data-testid=segmentation-status]").textContent().catch(() => "");
  const text = await page.evaluate(() => document.body.innerText);
  assert(/not set up/.test(seg) || /not set up/.test(text), "segmentation status not shown");
  for (const claim of [/AI detected/i, /automatically detected/i, /detected \d+ cabinets/i]) assert(!claim.test(text), `false claim: ${claim}`);
  // Quote storage failure must not show success.
  const { ctx, page: p } = await openPhoto(undefined, "server-down");
  await upload(p, FRONT);
  await p.click("[data-testid=photo-region-upper_cabinets]");
  await clickAt(p, ...POINTS.upper[0]);
  await pick(p, "1-668-T18-C-L-27");
  await p.waitForFunction(() => !!window.__photoStudio?.composite, null, { timeout: 15_000 });
  await p.route("**/api/enquiries", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Your enquiry could not be saved right now, so it was not sent." }) }));
  await p.click("[data-testid=photo-open-quote]");
  await p.fill("[data-testid=q-name]", "Down Tester");
  await p.fill("[data-testid=q-email]", "down@test.qa");
  await p.check("[data-testid=q-consent]");
  await p.click("[data-testid=q-submit]");
  await p.waitForSelector("[data-testid=quote-error]");
  assert(!(await p.locator("[data-testid=quote-success]").count()), "success shown although the server failed");
  await ctx.close();
  return `“${seg.trim()}” shown; no detection claims; server failure shows an error, never success`;
});

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
if (pageErrors.length) console.log("Page errors:\n" + pageErrors.join("\n"));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ when: new Date().toISOString(), base: BASE, photo: SYNTHETIC ? "synthetic" : path.basename(FRONT), results, pageErrors }, null, 2));
process.exit(passed === results.length && !pageErrors.length ? 0 : 1);
