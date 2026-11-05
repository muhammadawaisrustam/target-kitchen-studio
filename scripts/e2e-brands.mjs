// Browser checks against the real (imported) brand catalogue.
//   npm run build && npm start      (serves data/brands/*.json by default)
//   npm run test:e2e:brands
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.E2E_OUT || "e2e-screenshots";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? "" });
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, detail: String(err?.message ?? err) });
    console.log(`FAIL  ${name}  -> ${err?.message ?? err}`);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const textureRequests = new Set();
page.on("request", (r) => /\/brands\/.+\/textures\//.test(r.url()) && textureRequests.add(r.url()));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-testid=viewport][data-status=ready]", { timeout: 120_000 });
const region = (r) => page.evaluate((r) => window.__kitchenViewer.inspectRegion(r), r);
const waitRegion = (r, code) =>
  page.waitForFunction(
    ({ r, code }) => {
      const el = document.querySelector(`[data-testid=region-${r}]`);
      return el?.dataset.panelCode === code && el?.dataset.status === "ok";
    },
    { r, code },
    { timeout: 60_000 },
  );

await check("Real catalogue loads: 422 published Item IDs from five brands, no DEMO disclaimer", async () => {
  await page.waitForFunction(() => document.querySelector("[data-testid=result-count]")?.textContent === "422 panels");
  assert(!(await page.locator("[data-testid=demo-disclaimer]").count()), "demo disclaimer shown on real data");
  assert(await page.locator("[data-testid=colour-disclaimer]").isVisible(), "colour disclaimer missing");
  return "422 panels";
});

await check("Starting design uses real codes", async () => {
  await waitRegion("lower_cabinets", "1-026-T18-C-J-1");
  await waitRegion("island_panels", "1-680-T18-C-L-27");
  await waitRegion("upper_cabinets", "1-001-T18-C-J-1");
  const lower = await region("lower_cabinets");
  assert(lower.textureName?.endsWith("/brands/kastamonu/textures/1-026.jpg"), `lower texture ${lower.textureName}`);
  const upper = await region("upper_cabinets");
  assert(upper.textureName === null, "Corpus White should be a plain colour");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/brands-01-start.png` });
  return `lower GARDEN OAK texture, upper CORPUS WHITE ${upper.albedoHex}`;
});

await check("Only selected textures are downloaded (not all 300)", async () => {
  assert(textureRequests.size <= 5, `${textureRequests.size} textures requested`);
  return `${textureRequests.size} texture files requested at start`;
});

await check("Search by Item ID fragment, by name, and by board filter", async () => {
  await page.fill("[data-testid=panel-search]", "1-669");
  await page.waitForSelector("[data-testid='product-1-669-T18-C-L-27']");
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=product-grid] li").length === 1);
  await page.fill("[data-testid=panel-search]", "walnut");
  await page.waitForFunction(() => document.querySelector("[data-testid=result-count]")?.textContent === "34 panels");
  await page.fill("[data-testid=panel-search]", "");
  await page.selectOption("[data-testid=filter-board]", "MDF");
  await page.waitForFunction(() => document.querySelector("[data-testid=result-count]")?.textContent === "113 panels");
  await page.selectOption("[data-testid=filter-board]", "");
  return "1-669 -> CLAY; 'walnut' -> 34; MDF -> 113";
});

await check("Apply a real woodgrain and a real PVC gloss to two regions", async () => {
  await page.click("[data-testid=region-tall_cabinets]");
  await page.fill("[data-testid=panel-search]", "canaletto");
  await page.click("[data-testid='product-1-668-T18-C-L-27']");
  await waitRegion("tall_cabinets", "1-668-T18-C-L-27");
  await page.click("[data-testid=region-upper_cabinets]");
  await page.fill("[data-testid=panel-search]", "HG RED");
  await page.click("[data-testid='product-3-191-T18-M-M-1']");
  await waitRegion("upper_cabinets", "3-191-T18-M-M-1");
  const tall = await region("tall_cabinets");
  const upper = await region("upper_cabinets");
  assert(tall.textureName?.endsWith("/textures/1-668.jpg"), `tall ${tall.textureName}`);
  assert(upper.albedoHex?.toUpperCase() === "#BD2226" && upper.roughness < 0.2, `upper ${JSON.stringify(upper)}`);
  const lower = await region("lower_cabinets");
  assert(lower.textureName?.endsWith("/textures/1-026.jpg"), "lower region changed");
  await page.fill("[data-testid=panel-search]", "");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/brands-02-mixed.png` });
  return `tall CANALETTO WALNUT, upper HG RED PVC (roughness ${upper.roughness}), lower unchanged`;
});

await check("Details show only PDF facts plus labelled estimates", async () => {
  const text = await page.textContent("[data-testid=selected-details]");
  for (const s of ["3-191-T18-M-M-1", "Kastamonu", "PVC/PET", "High gloss", "1220 × 2800 mm", "Turkey", "p. 28", "(estimated)"])
    assert(text.includes(s), `missing "${s}" in: ${text}`);
  assert(!/DEMO/.test(text), "DEMO label on real product");
  return "code, brand, board, finish, sheet, origin, source page, colour marked estimated";
});

await check("Panels from the other brands apply to their own regions (Glory, Target, Greenlam, Polylac)", async () => {
  const counts = {};
  for (const b of ["Glory", "Target", "Greenlam", "Polylac"]) {
    await page.selectOption("[data-testid=filter-brand]", b);
    await page.waitForFunction((b) => document.querySelector("[data-testid=filter-brand]")?.value === b && !document.querySelector("[data-testid=product-list][aria-busy=true]"), b);
    counts[b] = await page.textContent("[data-testid=result-count]");
  }
  await page.selectOption("[data-testid=filter-brand]", "");
  const picks = [
    ["lower_cabinets", "yellow bologna", "3-620-T18-M-M-24", "/brands/glory/textures/3-620.jpg"],
    ["upper_cabinets", "vanilla oak", "1-516-T18-M2-S-6", "/brands/target/textures/1-516.jpg"],
    ["tall_cabinets", "artisan oak", "1-443-T0.8-HVRB-L-9", "/brands/greenlam/textures/1-443.jpg"],
    ["island_panels", "polylac 3", "4-692-T18-M-M-28", "/brands/polylac/textures/4-692.jpg"],
  ];
  for (const [r, q, code] of picks) {
    await page.click(`[data-testid=region-${r}]`);
    await page.fill("[data-testid=panel-search]", q);
    await page.click(`[data-testid='product-${code}']`);
    await waitRegion(r, code);
  }
  for (const [r, , , tex] of picks) {
    const info = await region(r);
    assert(info.textureName?.endsWith(tex), `${r}: ${info.textureName}`);
  }
  await page.fill("[data-testid=panel-search]", "");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/brands-03-all-brands.png` });
  return `brand counts ${JSON.stringify(counts)}; Glory, Target, Greenlam HPL and Polylac each on their own region`;
});

await check("No page errors", async () => {
  assert(errors.length === 0, errors.join(" | "));
});

const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await check("Phone layout with real data", async () => {
  await m.goto(BASE);
  await m.waitForSelector("[data-testid=viewport][data-status=ready]", { timeout: 120_000 });
  await m.waitForFunction(() => document.querySelector("[data-testid=region-lower_cabinets]")?.dataset.status === "ok", null, { timeout: 60_000 });
  await m.waitForTimeout(700);
  await m.screenshot({ path: `${OUT}/brands-03-mobile.png` });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, "horizontal overflow");
});

await browser.close();
fs.writeFileSync(`${OUT}/brands-results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
