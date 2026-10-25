// Browser checks for every kitchen layout in the model registry.
//   npm run build && npm start
//   npm run test:e2e:layouts        (BASE_URL to change the server)
// For each layout: it loads, every declared region has meshes and gets its starting panel,
// changing one region leaves the others alone, camera presets work, and a screenshot is saved.
import { chromium } from "playwright";
import fs from "node:fs";
import { KITCHEN_MODELS } from "../src/lib/models/registry.ts";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.E2E_OUT || "e2e-screenshots";
const PREVIEWS = process.env.SAVE_PREVIEWS ? "public/demo-assets/models" : null;
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
await page.goto(BASE);
await page.waitForSelector("[data-testid=viewport][data-status=ready]", { timeout: 120_000 });

const catalogue = await page.evaluate(() => fetch("/api/catalogue?pageSize=60&q=").then((r) => r.json()));
const isDemo = catalogue.isDemo;
const pick = (list) => list.find((c) => (isDemo ? c.startsWith("DEMO-") : !c.startsWith("DEMO-")));

await check("Layout menu lists every registered layout", async () => {
  const options = await page.locator("[data-testid=layout-select] option").evaluateAll((els) => els.map((e) => e.value));
  assert(options.length === KITCHEN_MODELS.length && KITCHEN_MODELS.every((m) => options.includes(m.id)), options.join(", "));
  return `${options.length} layouts`;
});

for (const model of KITCHEN_MODELS) {
  await check(`${model.name}: loads with its starting panels in every region`, async () => {
    await page.selectOption("[data-testid=layout-select]", model.id);
    await page.waitForSelector("[data-testid=viewport][data-status=ready]", { timeout: 60_000 });
    const expected = Object.entries(model.defaults).map(([r, list]) => [r, pick(list)]);
    for (const [r, code] of expected) {
      await page.waitForFunction(
        ({ r, code }) => {
          const el = document.querySelector(`[data-testid=region-${r}]`);
          return el?.dataset.panelCode === code && el?.dataset.status === "ok";
        },
        { r, code },
        { timeout: 60_000 },
      );
    }
    const counts = await page.evaluate((regions) => Object.fromEntries(regions.map((r) => [r, window.__kitchenViewer.inspectRegion(r).meshCount])), Object.keys(model.regions));
    for (const [r, n] of Object.entries(counts)) assert(n > 0, `${r} has no meshes`);
    await page.click("[data-testid=reset-camera]");
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/layout-${model.id}.png` });
    if (PREVIEWS) {
      const canvas = await page.locator("[data-testid=kitchen-canvas]").screenshot();
      const sharp = (await import("sharp")).default;
      await sharp(canvas).resize(640).jpeg({ quality: 80 }).toFile(`${PREVIEWS}/${model.id}.jpg`);
    }
    return `${Object.keys(counts).length} regions: ${Object.entries(counts).map(([r, n]) => `${r} ${n}`).join(", ")}`;
  });

  await check(`${model.name}: changing one region leaves the others unchanged`, async () => {
    const regions = Object.keys(model.regions);
    const target = regions.includes("lower_cabinets") ? "lower_cabinets" : regions[0];
    const before = await page.evaluate((rs) => Object.fromEntries(rs.map((r) => [r, window.__kitchenViewer.inspectRegion(r)])), regions);
    const code = isDemo ? "DEMO-UC-107" : "3-191-T18-M-M-1";
    await page.click(`[data-testid=region-${target}]`);
    await page.fill("[data-testid=panel-search]", code);
    await page.click(`[data-testid='product-${code}']`);
    await page.waitForFunction(({ target, code }) => {
      const el = document.querySelector(`[data-testid=region-${target}]`);
      return el?.dataset.panelCode === code && el?.dataset.status === "ok";
    }, { target, code });
    await page.fill("[data-testid=panel-search]", "");
    const after = await page.evaluate((rs) => Object.fromEntries(rs.map((r) => [r, window.__kitchenViewer.inspectRegion(r)])), regions);
    assert(after[target].albedoHex !== before[target].albedoHex || after[target].textureName !== before[target].textureName, "target region did not change");
    for (const r of regions.filter((x) => x !== target)) {
      assert(after[r].albedoHex === before[r].albedoHex && after[r].textureName === before[r].textureName, `${r} changed`);
    }
    return `${target} -> ${code}; ${regions.length - 1} other regions unchanged`;
  });

  await check(`${model.name}: front and top views, then reset`, async () => {
    await page.click("[data-testid=view-front]");
    await page.waitForFunction(() => Math.abs(window.__kitchenViewer.getCameraState().alpha + Math.PI / 2) < 0.05, null, { timeout: 5000 });
    await page.click("[data-testid=view-top]");
    await page.waitForFunction(() => window.__kitchenViewer.getCameraState().beta < 0.3, null, { timeout: 5000 });
    await page.click("[data-testid=reset-camera]");
    await page.waitForFunction((a) => Math.abs(window.__kitchenViewer.getCameraState().alpha - a) < 0.05, model.camera.alpha, { timeout: 5000 });
  });
}

await check("Saved design and share link keep the chosen layout", async () => {
  const last = KITCHEN_MODELS[KITCHEN_MODELS.length - 1];
  await page.click("[data-testid=open-summary]");
  const url = await page.inputValue("[data-testid=share-url]");
  await page.click("[data-testid=dialog-close]");
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p2.goto(url);
  await p2.waitForSelector("[data-testid=viewport][data-status=ready]", { timeout: 120_000 });
  await p2.waitForFunction((id) => document.querySelector("[data-testid=layout-select]")?.value === id, last.id, { timeout: 30_000 });
  await p2.close();
  return `${last.name} reopened from the link`;
});

await check("No page errors", async () => assert(errors.length === 0, errors.join(" | ")));

const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await check("Phone: every layout loads without horizontal scrolling", async () => {
  await m.goto(BASE);
  await m.waitForSelector("[data-testid=viewport][data-status=ready]", { timeout: 120_000 });
  for (const model of KITCHEN_MODELS) {
    await m.selectOption("[data-testid=layout-select]", model.id);
    await m.waitForSelector("[data-testid=viewport][data-status=ready]", { timeout: 60_000 });
    await m.waitForFunction(() => [...document.querySelectorAll("[data-testid^=region-][data-panel-code]")].every((el) => el.dataset.status !== "loading"), null, { timeout: 60_000 });
    assert(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `${model.id} overflow`);
  }
  await m.screenshot({ path: `${OUT}/layout-mobile.png` });
});

await browser.close();
fs.writeFileSync(`${OUT}/layouts-results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
