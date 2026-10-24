// End-to-end browser checks for the 3D prototype, run against a running server.
//
//   npm run build && npm start            (in one terminal)
//   npm run test:e2e                      (in another; BASE_URL defaults to http://localhost:3000)
//
// Uses Playwright's Chromium. WebGL runs through SwiftShader (software) when no GPU is present,
// so timings here are slower than on a real device.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.E2E_OUT || "e2e-screenshots";
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = async (name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail: detail ?? "" });
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: String(err?.message ?? err) });
    console.log(`FAIL  ${name}  -> ${err?.message ?? err}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function openStudio(viewport, extra = {}) {
  const context = await browser.newContext({ viewport, ...extra });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=viewport][data-status=ready]", { timeout: 120_000 });
  const readyMs = Date.now() - t0;
  await page.waitForFunction(() => document.querySelectorAll("[data-testid^=region-][data-status=ok]").length >= 3, null, { timeout: 60_000 });
  return { page, context, errors, readyMs };
}

const cam = (page) => page.evaluate(() => window.__kitchenViewer.getCameraState());
const region = (page, r) => page.evaluate((r) => window.__kitchenViewer.inspectRegion(r), r);
const canvasShot = async (page) => (await page.locator("[data-testid=kitchen-canvas]").screenshot()).toString("base64");

// ---------------- desktop ----------------
const { page, errors, readyMs } = await openStudio({ width: 1440, height: 900 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/01-desktop-initial.png` });

await check("T1 real 3D kitchen renders (WebGL scene with geometry)", async () => {
  const info = await page.evaluate(() => {
    const v = window.__kitchenViewer;
    return { meshes: v.scene.meshes.length, webgl: v.engine.webGLVersion, regions: v.regions };
  });
  assert(info.meshes > 100, `only ${info.meshes} meshes`);
  assert(info.regions.length === 5, `regions: ${info.regions}`);
  return `WebGL${info.webgl}, ${info.meshes} meshes, regions ${info.regions.join("/")}, ready in ${readyMs} ms`;
});

await check("T2a drag rotates the camera", async () => {
  const before = await cam(page);
  const box = await page.locator("[data-testid=kitchen-canvas]").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 20, cy + i * 4);
  await page.mouse.up();
  await page.waitForTimeout(900);
  const after = await cam(page);
  assert(Math.abs(after.alpha - before.alpha) > 0.1, `alpha ${before.alpha} -> ${after.alpha}`);
  return `alpha ${before.alpha.toFixed(2)} -> ${after.alpha.toFixed(2)}, beta ${before.beta.toFixed(2)} -> ${after.beta.toFixed(2)}`;
});

await check("T2b mouse wheel zooms", async () => {
  const before = await cam(page);
  const box = await page.locator("[data-testid=kitchen-canvas]").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200);
  await page.waitForTimeout(900);
  const after = await cam(page);
  assert(after.radius < before.radius - 0.2, `radius ${before.radius} -> ${after.radius}`);
  return `radius ${before.radius.toFixed(2)} -> ${after.radius.toFixed(2)}`;
});

await check("T2c right-drag pans", async () => {
  const before = await cam(page);
  const box = await page.locator("[data-testid=kitchen-canvas]").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "right" });
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + i * 15, cy);
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(900);
  const after = await cam(page);
  const moved = Math.hypot(...after.target.map((v, i) => v - before.target[i]));
  assert(moved > 0.05, `target moved ${moved}`);
  return `target moved ${moved.toFixed(2)} m`;
});

await check("T2d zoom buttons and preset views", async () => {
  const r0 = (await cam(page)).radius;
  await page.click("[data-testid=zoom-out]");
  await page.waitForTimeout(800);
  const r1 = (await cam(page)).radius;
  await page.click("[data-testid=zoom-in]");
  await page.waitForTimeout(800);
  const r2 = (await cam(page)).radius;
  assert(r1 > r0 && r2 < r1, `radius ${r0} -> ${r1} -> ${r2}`);
  await page.click("[data-testid=view-front]");
  await page.waitForTimeout(900);
  const front = await cam(page);
  assert(Math.abs(front.alpha + Math.PI / 2) < 0.05, `front alpha ${front.alpha}`);
  await page.screenshot({ path: `${OUT}/02-front-view.png` });
  await page.click("[data-testid=view-top]");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/03-top-view.png` });
  return `zoom ${r0.toFixed(2)} -> ${r1.toFixed(2)} -> ${r2.toFixed(2)}; front alpha ${front.alpha.toFixed(2)}`;
});

await check("T2f arrow keys rotate when the canvas has focus", async () => {
  const before = await cam(page);
  await page.focus("[data-testid=kitchen-canvas]");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(500);
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(800);
  const after = await cam(page);
  assert(Math.abs(after.alpha - before.alpha) > 0.02, `alpha ${before.alpha} -> ${after.alpha}`);
  return `alpha ${before.alpha.toFixed(2)} -> ${after.alpha.toFixed(2)}`;
});

await check("T2e reset view restores the default camera", async () => {
  await page.click("[data-testid=reset-camera]");
  await page.waitForTimeout(1000);
  const c = await cam(page);
  const def = await page.evaluate(() => window.__kitchenViewer["model"].camera);
  const diff = Math.abs(c.alpha - def.alpha) + Math.abs(c.beta - def.beta) + Math.abs(c.radius - def.radius);
  assert(diff < 0.02, `camera differs by ${diff}`);
  return "matches registry default";
});

await check("T3 search by panel code and by name", async () => {
  await page.fill("[data-testid=panel-search]", "WD-004");
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=product-grid] li").length === 1);
  assert(await page.locator("[data-testid=product-DEMO-WD-004]").isVisible(), "WD-004 card not shown");
  await page.fill("[data-testid=panel-search]", "linen");
  await page.waitForSelector("[data-testid=product-DEMO-TX-301]");
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=product-grid] li").length === 1);
  await page.fill("[data-testid=panel-search]", "zzzz-nothing");
  await page.waitForSelector("[data-testid=empty-results]");
  await page.fill("[data-testid=panel-search]", "");
  await page.waitForFunction(() => document.querySelector("[data-testid=result-count]")?.textContent?.startsWith("21 panels"));
  return "code, name and empty-result states work";
});

await check("T3b category filter", async () => {
  await page.selectOption("[data-testid=filter-category]", "Unicolour");
  await page.waitForFunction(() => document.querySelector("[data-testid=result-count]")?.textContent?.startsWith("8 panels"));
  await page.selectOption("[data-testid=filter-category]", "");
  await page.waitForFunction(() => document.querySelector("[data-testid=result-count]")?.textContent?.startsWith("21 panels"));
  return "Unicolour -> 8 panels";
});

let upperBefore;
await check("T4 selecting a panel changes only the selected region", async () => {
  upperBefore = await region(page, "upper_cabinets");
  const lowerBefore = await region(page, "lower_cabinets");
  const shotBefore = await canvasShot(page);
  await page.click("[data-testid=region-upper_cabinets]");
  await page.click("[data-testid=product-DEMO-WD-004]");
  await page.waitForFunction(() => document.querySelector("[data-testid=region-upper_cabinets]")?.dataset.status === "ok" && document.querySelector("[data-testid=region-upper_cabinets]")?.dataset.panelCode === "DEMO-WD-004");
  await page.waitForTimeout(600);
  const upper = await region(page, "upper_cabinets");
  const lower = await region(page, "lower_cabinets");
  assert(upper.textureName?.includes("DEMO-WD-004"), `upper texture ${upper.textureName}`);
  assert(upper.materialNames.length === 1 && upper.materialNames[0] === "region:upper_cabinets", `upper materials ${upper.materialNames}`);
  assert(lower.textureName === lowerBefore.textureName, "lower cabinets changed too");
  const shotAfter = await canvasShot(page);
  assert(shotAfter !== shotBefore, "canvas pixels did not change");
  await page.screenshot({ path: `${OUT}/04-upper-walnut.png` });
  return `upper ${upperBefore.albedoHex}/${upperBefore.textureName ?? "colour"} -> ${upper.textureName}; ${upper.meshCount} meshes`;
});

await check("T5 second panel on another region keeps the first", async () => {
  await page.click("[data-testid=region-tall_cabinets]");
  await page.click("[data-testid=product-DEMO-UC-106]");
  await page.waitForFunction(() => document.querySelector("[data-testid=region-tall_cabinets]")?.dataset.panelCode === "DEMO-UC-106" && document.querySelector("[data-testid=region-tall_cabinets]")?.dataset.status === "ok");
  await page.click("[data-testid=region-lower_cabinets]");
  await page.click("[data-testid=product-DEMO-ST-201]");
  await page.waitForFunction(() => document.querySelector("[data-testid=region-lower_cabinets]")?.dataset.panelCode === "DEMO-ST-201" && document.querySelector("[data-testid=region-lower_cabinets]")?.dataset.status === "ok");
  const upper = await region(page, "upper_cabinets");
  const tall = await region(page, "tall_cabinets");
  const lower = await region(page, "lower_cabinets");
  assert(upper.textureName?.includes("DEMO-WD-004"), "upper was overwritten");
  assert(tall.textureName === null && tall.albedoHex?.toUpperCase() === "#8C9A84", `tall ${tall.albedoHex}`);
  assert(lower.textureName?.includes("DEMO-ST-201"), `lower ${lower.textureName}`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/05-three-regions.png` });
  return "upper=WD-004, tall=UC-106 (colour #8C9A84), lower=ST-201";
});

await check("T6 design summary shows the correct panel codes", async () => {
  const text = async (r) => page.textContent(`[data-testid=region-${r}-summary]`);
  assert((await text("upper_cabinets")).includes("DEMO-WD-004"), "upper summary");
  assert((await text("tall_cabinets")).includes("DEMO-UC-106"), "tall summary");
  assert((await text("lower_cabinets")).includes("DEMO-ST-201"), "lower summary");
  return "region cards match scene";
});

await check("T10 missing texture shows a warning, scene keeps running", async () => {
  await page.click("[data-testid=region-island_panels]");
  await page.fill("[data-testid=panel-search]", "TEST-404");
  await page.click("[data-testid=product-DEMO-TEST-404]");
  await page.waitForFunction(() => document.querySelector("[data-testid=region-island_panels]")?.dataset.status === "warning", null, { timeout: 30_000 });
  const notice = await page.textContent("[data-testid=notice]");
  assert(/could not be loaded/.test(notice), `notice: ${notice}`);
  const island = await region(page, "island_panels");
  assert(island.textureName === "placeholder:missing-texture", `island texture ${island.textureName}`);
  // Scene still responds afterwards.
  await page.click("[data-testid=product-DEMO-TEST-404]");
  await page.fill("[data-testid=panel-search]", "");
  await page.click("[data-testid=product-DEMO-WD-003]");
  await page.waitForFunction(() => document.querySelector("[data-testid=region-island_panels]")?.dataset.status === "ok");
  return `warning: "${notice.slice(0, 80)}…"`;
});

await check("Click on a cabinet in 3D selects its region", async () => {
  await page.click("[data-testid=reset-camera]");
  await page.waitForTimeout(900);
  // Find a screen point that hits a tall unit, then click it like a user would.
  const box = await page.locator("[data-testid=kitchen-canvas]").boundingBox();
  const hit = await page.evaluate(({ w, h }) => {
    const v = window.__kitchenViewer;
    for (let y = 0.15; y < 0.85; y += 0.03)
      for (let x = 0.15; x < 0.95; x += 0.03) {
        const p = v.scene.pick(x * w, y * h);
        if (p?.pickedMesh?.metadata?.regionId === "tall_cabinets") return { x, y };
      }
    return null;
  }, { w: box.width, h: box.height });
  assert(hit, "no tall cabinet found on screen");
  await page.click("[data-testid=region-upper_cabinets]");
  await page.mouse.click(box.x + hit.x * box.width, box.y + hit.y * box.height);
  await page.waitForFunction(() => document.querySelector("[data-testid=active-region-label]")?.textContent === "Tall units");
  return "tapping a tall unit activated 'Tall units'";
});

await check("T14 demo data is labelled as demonstration", async () => {
  const disclaimer = await page.textContent("[data-testid=demo-disclaimer]");
  assert(/not genuine Target products/.test(disclaimer), "disclaimer missing");
  const codes = await page.$$eval("[data-testid^=product-DEMO]", (els) => els.map((e) => e.dataset.testid));
  const all = await page.$$eval("[data-testid^=product-]", (els) => els.filter((e) => e.tagName === "BUTTON").length);
  assert(codes.length === all, "a product without DEMO code is shown");
  return `${all} cards, all DEMO-coded; disclaimer present`;
});

await check("Reset design restores default panels", async () => {
  await page.click("[data-testid=reset-design]");
  await page.waitForFunction(() => document.querySelector("[data-testid=region-upper_cabinets]")?.dataset.panelCode === "DEMO-UC-101" && document.querySelector("[data-testid=region-upper_cabinets]")?.dataset.status === "ok");
  const upper = await region(page, "upper_cabinets");
  assert(upper.albedoHex?.toUpperCase() === "#F2F1EC" && upper.textureName === null, `upper ${JSON.stringify(upper)}`);
  return "upper back to DEMO-UC-101";
});

await check("Second kitchen layout loads from the registry", async () => {
  await page.selectOption("[data-testid=layout-select]", "demo-straight");
  await page.waitForFunction(() => window.__kitchenViewer.regions.length === 4 && document.querySelectorAll("[data-testid^=region-][data-status=ok]").length === 4, null, { timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/06-straight-kitchen.png` });
  await page.selectOption("[data-testid=layout-select]", "demo-l-island");
  await page.waitForFunction(() => document.querySelectorAll("[data-testid^=region-][data-status=ok]").length === 5, null, { timeout: 60_000 });
  return "straight kitchen: 4 regions; switched back OK";
});

await check("No uncaught page errors on desktop", async () => {
  const relevant = errors.filter((e) => !e.includes("DEMO-TEST-404") && !/Failed to load resource.*404/.test(e));
  assert(relevant.length === 0, relevant.join(" | "));
  return `${errors.length} expected 404 log(s) from the missing-texture test`;
});

// Performance snapshot (software rendering, so this is a lower bound).
await check("Performance snapshot (SwiftShader, no GPU)", async () => {
  const s = await page.evaluate(() => {
    const v = window.__kitchenViewer;
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) v.scene.render();
    const frameMs = (performance.now() - t0) / 10;
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    return { frameMs, mem, textures: v.stats().textures };
  });
  return `avg frame ${s.frameMs.toFixed(1)} ms in software GL, JS heap ${s.mem} MB, textures cached ${s.textures.cached}`;
});

// ---------------- mobile ----------------
await check("T12 usable on a phone-sized screen (390x844, touch)", async () => {
  const m = await openStudio({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.page.waitForTimeout(800);
  await m.page.screenshot({ path: `${OUT}/07-mobile.png` });
  const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, "horizontal page overflow");
  await m.page.tap("[data-testid=region-tall_cabinets]");
  await m.page.tap("[data-testid=product-DEMO-WD-004]");
  await m.page.waitForFunction(() => document.querySelector("[data-testid=region-tall_cabinets]")?.dataset.panelCode === "DEMO-WD-004" && document.querySelector("[data-testid=region-tall_cabinets]")?.dataset.status === "ok");
  // Simulated one-finger drag via touch events dispatched to the canvas.
  const before = await m.page.evaluate(() => window.__kitchenViewer.getCameraState().alpha);
  const box = await m.page.locator("[data-testid=kitchen-canvas]").boundingBox();
  const cdp = await m.context.newCDPSession(m.page);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + i * 12, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await m.page.waitForTimeout(900);
  const after = await m.page.evaluate(() => window.__kitchenViewer.getCameraState().alpha);
  assert(Math.abs(after - before) > 0.05, `touch rotate alpha ${before} -> ${after}`);
  await m.page.screenshot({ path: `${OUT}/08-mobile-after.png` });
  await m.context.close();
  return `no horizontal overflow; tap select works; touch drag alpha ${before.toFixed(2)} -> ${after.toFixed(2)}`;
});

await browser.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
