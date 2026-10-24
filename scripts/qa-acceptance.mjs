// Independent QA run of the 14 acceptance criteria, against a running server.
//   ADMIN_PASSWORD=... DATA_DIR=/tmp/tks-qa npm start            (real brand data, port 3000)
//   CATALOGUE_FILE=data/stress-catalogue.json PORT=3001 npm start  (600-record stress data, optional)
//   QA_DATA_DIR=/tmp/tks-qa ADMIN_PASSWORD=... node scripts/qa-acceptance.mjs
// Every check records what it actually observed. Console errors, page errors and failed
// requests are collected for the whole run and reported at the end.
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const STRESS = process.env.STRESS_URL || "http://localhost:3001";
const OUT = process.env.QA_OUT || "qa-screenshots";
const DATA_DIR = process.env.QA_DATA_DIR || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const ONLY = process.env.QA_ONLY ? process.env.QA_ONLY.split(",") : null;
const check = async (id, name, fn) => {
  if (ONLY && !ONLY.includes(id)) return;
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, ok: true, detail: detail ?? "", ms: Date.now() - t0 });
    console.log(`PASS  ${id} ${name}${detail ? `  (${detail})` : ""}`);
  } catch (err) {
    results.push({ id, name, ok: false, detail: String(err?.message ?? err).split("\n")[0], ms: Date.now() - t0 });
    console.log(`FAIL  ${id} ${name}  -> ${String(err?.message ?? err).split("\n")[0]}`);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const consoleErrors = [];
const watch = (page, label) => {
  page.on("pageerror", (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`[${label}] console.error: ${m.text()}`);
  });
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText ?? "";
    if (!/ERR_ABORTED/.test(why)) consoleErrors.push(`[${label}] requestfailed: ${r.url()} ${why}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) consoleErrors.push(`[${label}] HTTP ${r.status()}: ${r.url()}`);
  });
};

const ready = (page) => page.waitForSelector("[data-testid=viewport][data-status=ready]", { timeout: 120_000 });
const inspect = (page, r) => page.evaluate((r) => window.__kitchenViewer.inspectRegion(r), r);
const cam = (page) => page.evaluate(() => window.__kitchenViewer.getCameraState());
const waitRegion = (page, r, code, status = "ok") =>
  page.waitForFunction(
    ({ r, code, status }) => {
      const el = document.querySelector(`[data-testid=region-${r}]`);
      return el?.dataset.panelCode === code && el?.dataset.status === status;
    },
    { r, code, status },
    { timeout: 60_000 },
  );
const search = async (page, q) => {
  await page.fill("[data-testid=panel-search]", q);
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !document.querySelector("[data-testid=product-grid][aria-busy=true]"), null, { timeout: 15_000 }).catch(() => {});
};
const pick = async (page, region, code) => {
  await page.click(`[data-testid=region-${region}]`);
  await search(page, code);
  await page.click(`[data-testid="product-${code}"]`);
  await waitRegion(page, region, code);
};
const fresh = async (opts = { viewport: { width: 1440, height: 900 } }, label = "desktop") => {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  watch(page, label);
  return { ctx, page };
};
const textureOf = (code) => `/brands/kastamonu/textures/${code.split("-").slice(0, 2).join("-")}.jpg`;

const { ctx, page } = await fresh();
const loadStart = Date.now();
await page.goto(BASE, { waitUntil: "domcontentloaded" });

// ---------- T1 ----------
await check("T1", "3D kitchen opens", async () => {
  await ready(page);
  const ms = Date.now() - loadStart;
  const info = await page.evaluate(() => ({ stats: window.__kitchenViewer.stats(), regions: window.__kitchenViewer.regions }));
  assert(info.stats.meshes > 50, `only ${info.stats.meshes} meshes`);
  assert(info.regions.length === 5, `regions ${info.regions}`);
  await waitRegion(page, "lower_cabinets", "1-026-T18-C-J-1");
  // The canvas must actually show something other than the clear colour.
  const shot = await page.locator("[data-testid=kitchen-canvas]").screenshot({ path: `${OUT}/T1-open.png` });
  assert(shot.length > 20_000, "canvas screenshot looks empty");
  return `ready in ${ms} ms, ${info.stats.meshes} meshes, regions: ${info.regions.join(", ")}`;
});

// ---------- T2 ----------
await check("T2", "Rotate, zoom and reset the camera", async () => {
  const canvas = page.locator("[data-testid=kitchen-canvas]");
  const box = await canvas.boundingBox();
  const c0 = await cam(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2 + 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const c1 = await cam(page);
  assert(Math.abs(c1.alpha - c0.alpha) > 0.1, `drag did not rotate (alpha ${c0.alpha.toFixed(2)} -> ${c1.alpha.toFixed(2)})`);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(900);
  const c2 = await cam(page);
  assert(c2.radius < c1.radius - 0.05, `wheel did not zoom in (${c1.radius.toFixed(2)} -> ${c2.radius.toFixed(2)})`);
  await page.click("[data-testid=zoom-out]");
  await page.waitForTimeout(800);
  const c3 = await cam(page);
  assert(c3.radius > c2.radius, "zoom-out button did nothing");
  await page.click("[data-testid=zoom-in]");
  await page.waitForTimeout(800);
  const c3b = await cam(page);
  assert(c3b.radius < c3.radius, "zoom-in button did nothing");
  await canvas.focus();
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(600);
  const c4 = await cam(page);
  assert(Math.abs(c4.alpha - c3b.alpha) > 0.01, "arrow key did not rotate");
  await page.click("[data-testid=view-top]");
  await page.waitForTimeout(900);
  const top = await cam(page);
  assert(top.beta < 0.3, `top view beta ${top.beta}`);
  await page.click("[data-testid=reset-camera]");
  await page.waitForTimeout(1000);
  const c5 = await cam(page);
  const d = Math.abs(c5.alpha - -1.05) + Math.abs(c5.beta - 1.18) + Math.abs(c5.radius - 4.7);
  assert(d < 0.02, `reset did not return to the default view (${JSON.stringify(c5)})`);
  return `drag alpha ${c0.alpha.toFixed(2)}→${c1.alpha.toFixed(2)}, wheel radius ${c1.radius.toFixed(2)}→${c2.radius.toFixed(2)}, buttons/arrow/top view ok, reset back to default`;
});

// ---------- T3 ----------
await check("T3", "Search by Item ID and by name", async () => {
  const count = () => page.locator("[data-testid=product-grid] [data-testid^=product-]").count();
  await search(page, "1-669-T18-C-L-27");
  const a = await count();
  assert(a === 1 && (await page.locator('[data-testid="product-1-669-T18-C-L-27"]').count()) === 1, `full code gave ${a}`);
  await search(page, "1669");
  const b = await page.locator('[data-testid="product-1-669-T18-C-L-27"]').count();
  assert(b === 1, "code without dashes did not find 1-669");
  await search(page, "1-493");
  const c = await count();
  assert(c === 2, `decor code 1-493 should give 2 Item IDs, got ${c}`);
  await search(page, "walnut");
  const names = await page.locator("[data-testid=product-grid] [data-testid^=product-]").allInnerTexts();
  assert(names.length > 0 && names.every((t) => /walnut/i.test(t)), `walnut results: ${names.length}`);
  await search(page, "garden oak");
  const g = await page.locator('[data-testid="product-1-026-T18-C-J-1"]').count();
  assert(g === 1, "garden oak not found by name");
  await search(page, "zzqqxx");
  assert(await page.locator("[data-testid=empty-results]").isVisible(), "no empty state for nonsense query");
  await search(page, "");
  return `full ID→1, "1669"→1-669, "1-493"→2, "walnut"→${names.length} (all walnut), "garden oak"→found, nonsense→empty state`;
});

// ---------- T4 / T5 ----------
const A = "1-668-T18-C-L-27"; // CANALETTO WALNUT (texture)
const B = "3-126-T18-M-M-1"; // HG GALAXY BLACK (texture, MDF)
const C = "1-015-T18-C-J-1"; // BLACK (plain colour)
await check("T4", "Changing one region changes only that region", async () => {
  const before = {};
  for (const r of ["upper_cabinets", "tall_cabinets", "island_panels", "open_shelves"]) before[r] = await inspect(page, r);
  await pick(page, "lower_cabinets", A);
  const lower = await inspect(page, "lower_cabinets");
  assert(lower.textureName?.endsWith(textureOf(A)), `lower texture ${lower.textureName}`);
  assert(lower.materialNames.length === 1 && lower.materialNames[0] === "region:lower_cabinets", `lower materials ${lower.materialNames}`);
  for (const [r, b] of Object.entries(before)) {
    const now = await inspect(page, r);
    assert(JSON.stringify(now) === JSON.stringify(b), `${r} changed: ${JSON.stringify(b)} -> ${JSON.stringify(now)}`);
  }
  return `lower → ${A} texture ${lower.textureName}; other 4 regions identical before/after`;
});
await check("T5", "Second region keeps the first region's panel (no overwrite)", async () => {
  await pick(page, "upper_cabinets", B);
  await pick(page, "tall_cabinets", C);
  const lower = await inspect(page, "lower_cabinets");
  const upper = await inspect(page, "upper_cabinets");
  const tall = await inspect(page, "tall_cabinets");
  assert(lower.textureName?.endsWith(textureOf(A)), `lower overwritten: ${lower.textureName}`);
  assert(upper.textureName?.endsWith(textureOf(B)), `upper ${upper.textureName}`);
  assert(tall.textureName === null && tall.albedoHex?.toUpperCase() === "#030406", `tall ${JSON.stringify(tall)}`);
  assert(upper.roughness < 0.2, `HG gloss roughness ${upper.roughness}`);
  // Same panel on two regions must not share a mesh material (otherwise one change would move both).
  await pick(page, "open_shelves", A);
  const shelves = await inspect(page, "open_shelves");
  assert(shelves.materialNames[0] === "region:open_shelves", "shelves share the lower material");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/T5-four-regions.png` });
  return `lower ${A}, upper ${B} (roughness ${upper.roughness}), tall ${C} #030406, shelves ${A} on own material`;
});

// ---------- T6 ----------
await check("T6", "Summary shows the right codes", async () => {
  await page.click("[data-testid=open-summary]");
  const expect = { lower_cabinets: A, upper_cabinets: B, tall_cabinets: C, island_panels: "1-680-T18-C-L-27", open_shelves: A };
  for (const [r, code] of Object.entries(expect)) {
    const t = await page.locator(`[data-testid=summary-row-${r}]`).innerText();
    assert(t.includes(code), `summary ${r}: ${t.replace(/\s+/g, " ")}`);
  }
  const dl = page.waitForEvent("download");
  await page.click("[data-testid=download-summary]");
  const file = await dl;
  const csv = fs.readFileSync(await file.path(), "utf8");
  for (const code of Object.values(expect)) assert(csv.includes(code), `CSV lacks ${code}`);
  await page.screenshot({ path: `${OUT}/T6-summary.png` });
  await page.click("[data-testid=dialog-close]");
  return `5 rows match the 3D regions; CSV contains all 5 codes`;
});

// ---------- T7 ----------
let shareUrl = "";
await check("T7", "Save a named design and restore it after reload", async () => {
  await page.click("[data-testid=open-designs]");
  await page.click("[data-testid=new-design]").catch(() => {});
  await page.fill("[data-testid=design-name-input]", "QA Villa kitchen");
  await page.click("[data-testid=save-new-design]");
  await page.waitForFunction(() => /QA Villa kitchen/.test(document.querySelector("[data-testid=design-status]")?.textContent ?? ""));
  await page.click("[data-testid=dialog-close]");
  // Change something, then reload: the saved version must come back, not the change.
  await pick(page, "lower_cabinets", C);
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  await page.click("[data-testid=open-designs]");
  await page.click('[data-testid="open-design-QA Villa kitchen"]');
  await page.click("[data-testid=dialog-close]").catch(() => {});
  await waitRegion(page, "lower_cabinets", A);
  await waitRegion(page, "upper_cabinets", B);
  await waitRegion(page, "tall_cabinets", C);
  const lower = await inspect(page, "lower_cabinets");
  assert(lower.textureName?.endsWith(textureOf(A)), "3D did not restore lower");
  return `saved "QA Villa kitchen", changed lower, reloaded, reopened: lower ${A}, upper ${B}, tall ${C} in UI and 3D`;
});

// ---------- T8 ----------
await check("T8", "Share link restores the design in a fresh browser", async () => {
  await page.click("[data-testid=view-side]");
  await page.waitForTimeout(900);
  const camBefore = await cam(page);
  await page.click("[data-testid=open-summary]");
  shareUrl = await page.locator("[data-testid=share-url]").inputValue();
  await page.click("[data-testid=dialog-close]");
  assert(shareUrl.startsWith(BASE + "/?design="), `share url ${shareUrl}`);
  const other = await fresh({ ...devices["Pixel 7"] }, "share-mobile");
  await other.page.goto(shareUrl, { waitUntil: "domcontentloaded" });
  await ready(other.page);
  for (const [r, code] of [["lower_cabinets", A], ["upper_cabinets", B], ["tall_cabinets", C], ["island_panels", "1-680-T18-C-L-27"], ["open_shelves", A]]) await waitRegion(other.page, r, code);
  const camAfter = await cam(other.page);
  assert(Math.abs(camAfter.alpha - camBefore.alpha) < 0.01 && Math.abs(camAfter.radius - camBefore.radius) < 0.01, `camera ${JSON.stringify(camBefore)} vs ${JSON.stringify(camAfter)}`);
  const status = await other.page.locator("[data-testid=design-status]").innerText();
  // Damaged link: must not silently show something else as if it were the shared design.
  await other.page.goto(BASE + "/?design=not-a-real-token", { waitUntil: "domcontentloaded" });
  await ready(other.page);
  const notice = await other.page.locator("[data-testid=notice]").innerText();
  assert(/damaged|incomplete/i.test(notice), `no notice for bad link: ${notice}`);
  await other.ctx.close();
  return `${shareUrl.length}-char link, opened on emulated Pixel 7: 5 codes and camera match; status "${status.replace(/\s+/g, " ")}"; damaged link reported`;
});

// ---------- T9 ----------
let reference = "";
await check("T9", "Quote confirmation is truthful", async () => {
  const fill = async (p) => {
    await p.click("[data-testid=open-quote]");
    await p.fill("[data-testid=q-name]", "QA Tester");
    await p.fill("[data-testid=q-phone]", "+974 5555 1234");
    await p.check("[data-testid=q-consent]");
  };
  // a) server error -> no success
  await page.route("**/api/enquiries", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }));
  await fill(page);
  await page.click("[data-testid=q-submit]");
  await page.waitForSelector("[data-testid=quote-error]", { timeout: 10_000 });
  assert(!(await page.locator("[data-testid=quote-success]").count()), "success shown after 500");
  // b) network failure -> no success, form keeps values
  await page.unroute("**/api/enquiries");
  await page.route("**/api/enquiries", (r) => r.abort("internetdisconnected"));
  await page.click("[data-testid=q-submit]");
  await page.waitForTimeout(1200);
  assert(!(await page.locator("[data-testid=quote-success]").count()), "success shown after network failure");
  assert((await page.inputValue("[data-testid=q-name]")) === "QA Tester", "form was cleared after failure");
  // c) missing contact -> validation error, nothing sent
  await page.unroute("**/api/enquiries");
  await page.fill("[data-testid=q-phone]", "");
  let posted = 0;
  const onReq = (r) => r.url().endsWith("/api/enquiries") && r.method() === "POST" && posted++;
  page.on("request", onReq);
  await page.click("[data-testid=q-submit]");
  await page.waitForTimeout(600);
  assert(!(await page.locator("[data-testid=quote-success]").count()), "success without contact details");
  // d) real submit -> success only with a server reference that is really stored
  await page.fill("[data-testid=q-phone]", "+974 5555 1234");
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/enquiries") && r.request().method() === "POST");
  await page.click("[data-testid=q-submit]");
  const r = await resp;
  page.off("request", onReq);
  assert(r.status() === 201, `server answered ${r.status()}`);
  await page.waitForSelector("[data-testid=quote-success]");
  reference = (await page.locator("[data-testid=quote-reference]").innerText()).trim();
  assert(/^ENQ-\d{8}-[A-Z0-9]{6}$/.test(reference), `reference ${reference}`);
  let stored = "not checked (QA_DATA_DIR not set)";
  if (DATA_DIR) {
    const all = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "enquiries.json"), "utf8"));
    const list = Array.isArray(all) ? all : all.enquiries;
    const e = list.find((x) => x.reference === reference);
    assert(e, `${reference} not in enquiries.json`);
    const codes = e.design.items.map((i) => i.panelCode).sort();
    assert(JSON.stringify(codes) === JSON.stringify([A, A, B, C, "1-680-T18-C-L-27"].sort()), `stored codes ${codes}`);
    assert(e.containsDemoPanels === false, "real panels flagged as demo");
    stored = `stored with codes ${codes.join(", ")}`;
  }
  await page.screenshot({ path: `${OUT}/T9-quote-success.png` });
  await page.click("[data-testid=dialog-close]");
  return `500 → error, offline → error with form kept, no contact → blocked (${posted} POST sent), real submit → 201 + ${reference}, ${stored}`;
});

// ---------- T10 ----------
await check("T10", "Missing texture shows a warning, not another panel", async () => {
  const { ctx: c2, page: p } = await fresh(undefined, "missing-texture");
  const victim = "1-020-T18-C-J-1"; // METALIC WALNUT
  await p.route(`**${textureOf(victim)}`, (r) => r.fulfill({ status: 404, body: "" }));
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await ready(p);
  await waitRegion(p, "lower_cabinets", "1-026-T18-C-J-1");
  await p.click("[data-testid=region-lower_cabinets]");
  await search(p, victim);
  await p.click(`[data-testid="product-${victim}"]`);
  await waitRegion(p, "lower_cabinets", victim, "warning");
  const lower = await inspect(p, "lower_cabinets");
  assert(lower.textureName === "placeholder:missing-texture", `texture ${lower.textureName}`);
  const notice = await p.locator("[data-testid=notice]").innerText();
  assert(/could not be loaded/i.test(notice) && notice.includes(victim), `notice: ${notice}`);
  const card = await p.locator("[data-testid=region-lower_cabinets]").innerText();
  assert(/Texture unavailable/i.test(card), "region card has no warning");
  // The scene must keep working afterwards.
  await pick(p, "lower_cabinets", A);
  await p.screenshot({ path: `${OUT}/T10-after-recover.png` });
  await c2.close();
  return `404 on ${textureOf(victim)} → hatched placeholder, notice names ${victim}, card warns; next panel applies normally`;
});

// ---------- T11 ----------
await check("T11", "500+ products", async () => {
  const res = await fetch(`${STRESS}/api/catalogue?pageSize=1`).catch(() => null);
  assert(res && res.ok, `stress server not reachable at ${STRESS}`);
  const total = (await res.json()).total;
  assert(total >= 500, `stress catalogue has ${total}`);
  const { ctx: c3, page: p } = await fresh(undefined, "stress");
  const t0 = Date.now();
  await p.goto(STRESS, { waitUntil: "domcontentloaded" });
  await ready(p);
  await p.waitForFunction((n) => document.querySelector("[data-testid=result-count]")?.textContent?.startsWith(String(n)), total, { timeout: 30_000 });
  const tReady = Date.now() - t0;
  const first = await p.locator("[data-testid=product-grid] [data-testid^=product-]").count();
  // page through with "load more" if present
  const more = p.getByRole("button", { name: /more/i });
  let loaded = first;
  if (await more.count()) {
    await more.first().click();
    await p.waitForFunction((n) => document.querySelectorAll("[data-testid=product-grid] [data-testid^=product-]").length > n, first, { timeout: 15_000 });
    loaded = await p.locator("[data-testid=product-grid] [data-testid^=product-]").count();
  }
  const lastCode = await (async () => {
    const r = await fetch(`${STRESS}/api/catalogue?page=${Math.ceil(total / 24)}&pageSize=24`);
    const j = await r.json();
    return j.items.at(-1).panelCode;
  })();
  const ts = Date.now();
  await search(p, lastCode);
  await p.waitForSelector(`[data-testid="product-${lastCode}"]`, { timeout: 10_000 });
  const tSearch = Date.now() - ts;
  await p.click("[data-testid=region-island_panels]");
  await p.click(`[data-testid="product-${lastCode}"]`);
  await p.waitForFunction((c) => document.querySelector("[data-testid=region-island_panels]")?.dataset.panelCode === c, lastCode);
  const apiT0 = Date.now();
  await fetch(`${STRESS}/api/catalogue?q=oak&pageSize=24`);
  const apiMs = Date.now() - apiT0;
  await c3.close();
  return `${total} records; ready in ${tReady} ms; first page ${first}, after "more" ${loaded}; last record ${lastCode} found in ${tSearch} ms and applied; API search ${apiMs} ms`;
});

// ---------- T12 ----------
await check("T12", "Usable on a phone", async () => {
  const { ctx: c4, page: p } = await fresh({ ...devices["iPhone 13"] }, "iphone");
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await ready(p);
  await waitRegion(p, "lower_cabinets", "1-026-T18-C-J-1");
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, `horizontal overflow ${overflow}px`);
  const tooSmall = await p.evaluate(() =>
    [...document.querySelectorAll("button, select, input, [role=radio]")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.height < 28 || r.width < 28))
      .map(({ el, r }) => `${el.dataset.testid || el.getAttribute("aria-label") || el.textContent.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
  // The panel list must get real screen space (it once collapsed to 24 px on phones).
  const visibleCards = async (pg) => {
    await pg.evaluate(() => window.scrollTo(0, 1e6));
    await pg.waitForTimeout(300);
    return pg.evaluate(() => {
      const top = Math.max(0, document.querySelector("main")?.getBoundingClientRect().bottom ?? 0);
      return [...document.querySelectorAll("[data-testid=product-grid] [data-testid^=product-]")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= top - 1 && r.bottom <= innerHeight + 1;
      }).length;
    });
  };
  const cardsPhone = await visibleCards(p);
  assert(cardsPhone >= 3, `only ${cardsPhone} product cards fully visible on the phone`);
  await p.evaluate(() => window.scrollTo(0, 0));
  // tap region + tap product
  await p.tap("[data-testid=region-tall_cabinets]");
  await p.fill("[data-testid=panel-search]", B);
  await p.waitForTimeout(500);
  await p.tap(`[data-testid="product-${B}"]`);
  await waitRegion(p, "tall_cabinets", B);
  // one-finger touch rotate via CDP touch events
  const box = await p.locator("[data-testid=kitchen-canvas]").boundingBox();
  const c0 = await cam(p);
  const cdp = await c4.newCDPSession(p);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + i * 15, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(800);
  const c1 = await cam(p);
  assert(Math.abs(c1.alpha - c0.alpha) > 0.05, "touch drag did not rotate");
  // dialogs fit the screen
  await p.tap("[data-testid=open-quote]");
  const form = await p.locator("[data-testid=quote-form]").boundingBox();
  assert(form && form.width <= 390 + 1, `quote form ${form?.width}px wide`);
  const submitVisible = await p.locator("[data-testid=q-submit]").isVisible();
  await p.screenshot({ path: `${OUT}/T12-phone-quote.png` });
  await p.tap("[data-testid=dialog-close]");
  await p.tap("[data-testid=open-summary]");
  const ovSummary = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await p.screenshot({ path: `${OUT}/T12-phone-summary.png` });
  await p.tap("[data-testid=dialog-close]");
  await p.screenshot({ path: `${OUT}/T12-phone.png` });
  // tablet portrait too
  const { ctx: c5, page: t } = await fresh({ ...devices["iPad (gen 7)"] }, "ipad");
  await t.goto(BASE, { waitUntil: "domcontentloaded" });
  await ready(t);
  const ovTab = await t.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const cardsTab = await visibleCards(t);
  const { ctx: c7, page: se } = await fresh({ ...devices["iPhone SE"] }, "iphone-se");
  await se.goto(BASE, { waitUntil: "domcontentloaded" });
  await ready(se);
  const cardsSE = await visibleCards(se);
  const ovSE = await se.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await se.screenshot({ path: `${OUT}/T12-iphone-se-list.png` });
  await c7.close();
  assert(cardsTab >= 3 && cardsSE >= 3 && ovSE <= 0, `visible cards tablet ${cardsTab}, iPhone SE ${cardsSE}; SE overflow ${ovSE}`);
  await t.screenshot({ path: `${OUT}/T12-tablet.png` });
  await c5.close();
  await c4.close();
  assert(ovSummary <= 0 && ovTab <= 0, `overflow summary ${ovSummary}, tablet ${ovTab}`);
  return `visible panel cards: iPhone 13 ${cardsPhone}, iPhone SE ${cardsSE}, iPad ${cardsTab}; iPhone 13: no h-scroll, tap region+panel works, touch rotate works, quote form ${Math.round(form.width)}px with submit ${submitVisible ? "reachable" : "NOT visible"}; iPad: no h-scroll; small targets: ${tooSmall.length ? tooSmall.join("; ") : "none"}`;
});

// ---------- T13 ----------
await check("T13", "Import products without code edits (admin CSV import)", async () => {
  assert(ADMIN_PASSWORD, "ADMIN_PASSWORD not set for the QA run");
  const csv = [
    // Same columns as public/catalogue-template.csv
    "id,panelCode,productName,category,colourFamily,finish,brand,thicknessMm,widthMm,heightMm,colourHex,textureUrl,thumbnailUrl,textureScale,grainDirection,isActive,isPublished,isDemo",
    "qa-import-001,QA-IMPORT-001,QA Import Sage,Uni colors,Green,Matt,QA Brand,18,1830,3660,#8A9A7B,,,,none,true,true,true",
    "qa-import-002,QA-IMPORT-002,QA Import Oak,Woodgrain,Light wood,Matt,QA Brand,18,1830,3660,,/brands/kastamonu/textures/1-026.jpg,/brands/kastamonu/thumbs/1-026.jpg,0.8,vertical,true,true,true",
  ].join("\n");
  const file = path.join(OUT, "qa-import.csv");
  fs.writeFileSync(file, csv);
  const { ctx: c6, page: p } = await fresh(undefined, "admin");
  await p.goto(BASE + "/admin", { waitUntil: "domcontentloaded" });
  await p.fill("input[type=password]", ADMIN_PASSWORD);
  await p.keyboard.press("Enter");
  await p.getByText(new RegExp(reference || "ENQ-")).first().waitFor({ timeout: 15_000 });
  await p.click("[data-testid=admin-tab-products]");
  await p.fill("[data-testid=import-label]", "QA import");
  await p.setInputFiles("[data-testid=import-file]", file);
  const steps = [];
  await p.click("[data-testid=import-check]");
  await p.waitForFunction(() => !document.querySelector("[data-testid=import-save]")?.disabled || document.querySelector("[data-testid=import-error]"), null, { timeout: 15_000 });
  const err = await p.locator("[data-testid=import-error]").count();
  if (err) throw new Error(`check refused: ${await p.locator("[data-testid=import-error]").innerText()}`);
  steps.push("Check file", (await p.locator("[data-testid=import-save]").innerText()).trim());
  await p.click("[data-testid=import-save]");
  await p.waitForSelector("[data-testid=import-done]", { timeout: 15_000 });
  steps.push(`"${(await p.locator("[data-testid=import-done]").innerText()).trim().slice(0, 80)}"`);
  await p.screenshot({ path: `${OUT}/T13-admin-import.png`, fullPage: true });
  const api = await (await fetch(`${BASE}/api/catalogue?q=QA-IMPORT&pageSize=10`)).json();
  assert(api.total === 2, `imported products visible in catalogue API: ${api.total} (admin buttons clicked: ${steps.join(" → ")})`);
  // use it in the studio
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await ready(page);
  await pick(page, "island_panels", "QA-IMPORT-002");
  const island = await inspect(page, "island_panels");
  assert(island.textureName?.endsWith("/1-026.jpg"), `island ${island.textureName}`);
  const disclaimer = await page.locator("[data-testid=demo-disclaimer]").count();
  await c6.close();
  return `CSV uploaded via /admin (${steps.join(" → ")}), 2 products live in the catalogue API without restart, QA-IMPORT-002 applied in 3D; demo disclaimer now ${disclaimer ? "shown" : "hidden"}`;
});

// ---------- T14 ----------
await check("T14", "No demo products shown as real", async () => {
  const all = [];
  for (let pg = 1; ; pg++) {
    const j = await (await fetch(`${BASE}/api/catalogue?page=${pg}&pageSize=60`)).json();
    all.push(...j.items);
    if (all.length >= j.total || !j.items.length) break;
  }
  const realLooking = all.filter((p) => !p.isDemo && (/^DEMO-/i.test(p.panelCode) || p.brand !== "Kastamonu"));
  assert(!realLooking.length, `non-demo products that are not Kastamonu: ${realLooking.map((p) => p.panelCode)}`);
  const demoNoFlag = all.filter((p) => /^(DEMO|QA)-/.test(p.panelCode) && !p.isDemo);
  assert(!demoNoFlag.length, `demo/test codes without isDemo: ${demoNoFlag.map((p) => p.panelCode)}`);
  const invented = all.filter((p) => p.brand === "Kastamonu" && (p.price != null || p.stockStatus || p.textureScale != null || p.roughness != null));
  assert(!invented.length, `Kastamonu records with data not in the PDF: ${invented.map((p) => p.panelCode)}`);
  // In the UI a demo product must be labelled when shown.
  await page.click("[data-testid=region-island_panels]");
  await search(page, "QA-IMPORT-001");
  const label = await page.locator('[data-testid="product-QA-IMPORT-001"]').innerText();
  const disclaimer = await page.locator("[data-testid=demo-disclaimer]").isVisible().catch(() => false);
  assert(/demo/i.test(label) || disclaimer, `demo product not labelled: "${label.replace(/\s+/g, " ")}"`);
  const body = await page.locator("body").innerText();
  assert(!/QAR|\bprice\b|in stock/i.test(body.replace(/No prices?[^.]*\./gi, "")), "price or stock text on page");
  return `${all.length} products: ${all.filter((p) => !p.isDemo).length} real (all Kastamonu, no price/stock/scale/roughness invented), ${all.filter((p) => p.isDemo).length} flagged demo; demo card label "${label.replace(/\s+/g, " ").slice(0, 60)}", disclaimer ${disclaimer ? "visible" : "hidden"}`;
});

await ctx.close();
await browser.close();

console.log("\nConsole / page / network errors during the run:");
const uniq = [...new Set(consoleErrors)];
if (!uniq.length) console.log("  none");
for (const e of uniq) console.log("  " + e);
fs.writeFileSync(path.join(OUT, "qa-results.json"), JSON.stringify({ at: new Date().toISOString(), results, consoleErrors: uniq }, null, 2));
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
