// Browser checks for the editable catalogue admin (panels, brands, categories, sizes, import).
// Start a server first:  ADMIN_PASSWORD=some-long-test-password DATA_DIR=/tmp/tks-admin npm start
// Then:                  ADMIN_PASSWORD=some-long-test-password npm run test:e2e:admin
import { chromium } from "playwright";
import fs from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PW = process.env.ADMIN_PASSWORD ?? "some-long-test-password";
const OUT = process.env.E2E_OUT ?? "e2e-screenshots";
await fs.mkdir(OUT, { recursive: true });
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, pass: false, error: String(e?.message ?? e) });
    await page.screenshot({ path: `${OUT}/admin-fail-${results.length}.png` }).catch(() => {});
    console.log("FAIL", name, e?.message ?? e);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// The studio's catalogue is cached for up to 10 s per server instance (serverless hosts run several),
// so a change may take a few seconds to show there. Poll until `ok` holds, for up to 15 s.
const studio = async (q, ok = () => true) => {
  for (let i = 0; ; i++) {
    const r = await (await fetch(`${BASE}/api/catalogue?pageSize=60&q=${encodeURIComponent(q)}`)).json();
    if (ok(r) || i >= 15) return r;
    await new Promise((res) => setTimeout(res, 1000));
  }
};

await page.goto(`${BASE}/admin`);
await page.getByTestId("admin-password").fill(PW);
await page.getByTestId("admin-signin").click();
await page.getByTestId("admin-tab-panels").click();

await check("panels list shows the catalogue with status counts", async () => {
  await page.getByTestId("panels-table").waitFor();
  const rows = await page.locator("[data-testid^=panel-row-]").count();
  assert(rows === 50, `expected 50 rows on page 1, got ${rows}`);
  await page.screenshot({ path: `${OUT}/admin-01-panels.png` });
});

await check("edit a panel's name; the studio shows the new name", async () => {
  await page.getByTestId("panel-search").fill("1-026");
  await page.getByTestId("panel-row-1-026-T18-C-J-1").waitFor();
  await page.getByTestId("panel-row-1-026-T18-C-J-1").getByTestId("edit-panel").click();
  await page.getByTestId("pf-productName").fill("GARDEN OAK EDITED");
  await page.getByTestId("product-editor").screenshot({ path: `${OUT}/admin-02-editor.png` });
  await page.getByTestId("pf-save").click();
  await page.getByTestId("panels-done").waitFor();
  const r = await studio("1-026-T18", (r) => r.items.some((p) => p.productName === "GARDEN OAK EDITED"));
  assert(r.items.some((p) => p.productName === "GARDEN OAK EDITED"), "studio did not get the edit");
});

await check("add a new panel with a new brand and category", async () => {
  await page.getByTestId("panel-search").fill("");
  await page.getByTestId("add-panel").click();
  await page.getByTestId("pf-panelCode").fill("TEST-ADMIN-001");
  await page.getByTestId("pf-productName").fill("Admin Test Walnut");
  await page.getByTestId("pf-brand").fill("Test Brand");
  await page.getByTestId("pf-category").fill("Test Woods");
  await page.getByTestId("pf-finish").fill("Matt");
  await page.getByTestId("pf-colourFamily").fill("Brown");
  await page.getByTestId("pf-colourHex").fill("#6B4A2B");
  await page.getByTestId("pf-size").selectOption({ index: 1 });
  await page.getByTestId("pf-save").click();
  await page.getByTestId("panels-done").waitFor();
  const r = await studio("TEST-ADMIN-001", (r) => r.items.length === 1);
  assert(r.items.length === 1 && r.items[0].brand === "Test Brand" && r.items[0].thicknessMm, "new panel not in studio");
  assert(r.facets.brand.some((f) => f.value === "Test Brand"), "new brand not in the studio filter");
});

await check("duplicate Item ID is refused with a clear message", async () => {
  await page.getByTestId("add-panel").click();
  await page.getByTestId("pf-panelCode").fill("1-001-T18-C-J-1");
  await page.getByTestId("pf-productName").fill("Dup");
  await page.getByTestId("pf-category").fill("x");
  await page.getByTestId("pf-finish").fill("x");
  await page.getByTestId("pf-colourFamily").fill("x");
  await page.getByTestId("pf-save").click();
  const msg = await page.getByTestId("pf-error").innerText();
  assert(/already belongs/.test(msg), msg);
  await page.getByTestId("dialog-close").click();
});

await check("bulk unpublish hides panels from the studio; publish brings them back", async () => {
  await page.getByTestId("panel-search").fill("GARDEN OAK");
  await page.waitForTimeout(600);
  await page.getByRole("checkbox", { name: "Select all on this page" }).check();
  await page.getByTestId("bulk-unpublish").click();
  await page.getByTestId("panels-done").waitFor();
  let r = await studio("garden oak", (r) => r.total === 0);
  assert(r.total === 0, `still ${r.total} in studio`);
  await page.getByTestId("status-unpublished").click();
  await page.getByRole("checkbox", { name: "Select all on this page" }).check();
  await page.getByTestId("bulk-publish").click();
  await page.getByTestId("panels-done").waitFor();
  r = await studio("garden oak", (r) => r.total > 0);
  assert(r.total > 0, "not back");
  await page.getByTestId("status-all").click();
});

await check("delete a brand-file panel, then restore the original", async () => {
  await page.getByTestId("panel-search").fill("1-026-T18-C-J-1");
  await page.getByTestId("panel-row-1-026-T18-C-J-1").getByTestId("edit-panel").click();
  await page.getByTestId("pf-delete").click();
  await page.getByTestId("pf-confirm-delete").click();
  await page.getByTestId("panels-done").waitFor();
  assert((await studio("1-026-T18-C-J-1", (r) => r.total === 0)).total === 0, "deleted panel still in studio");
  await page.getByTestId("status-deleted").click();
  await page.getByTestId("panel-row-1-026-T18-C-J-1").getByTestId("edit-panel").click();
  await page.getByTestId("pf-restore").click();
  await page.getByTestId("panels-done").waitFor();
  const r = await studio("1-026-T18-C-J-1", (r) => r.items[0]?.productName === "GARDEN OAK");
  assert(r.total === 1 && r.items[0].productName === "GARDEN OAK", `restore gave ${r.items[0]?.productName}`);
  await page.getByTestId("status-all").click();
  await page.getByTestId("panel-search").fill("");
});

await check("brands: rename a brand updates its panels; switching off hides them", async () => {
  await page.getByTestId("admin-tab-brands").click();
  await page.getByTestId("tx-edit-test-brand").click();
  await page.getByTestId("tx-name").fill("Renamed Brand");
  await page.getByTestId("tx-save").click();
  await page.getByTestId("tx-done").waitFor();
  let r = await studio("TEST-ADMIN-001", (r) => r.items[0]?.brand === "Renamed Brand");
  assert(r.items[0]?.brand === "Renamed Brand", "rename not applied");
  await page.getByTestId("tx-toggle-renamed-brand").click();
  await page.getByTestId("tx-done").waitFor();
  r = await studio("TEST-ADMIN-001", (r) => r.total === 0);
  assert(r.total === 0, "switched-off brand still shown");
  await page.screenshot({ path: `${OUT}/admin-03-brands.png` });
  await page.getByTestId("tx-toggle-renamed-brand").click();
  await page.getByTestId("tx-done").waitFor();
});

await check("brands: order set in the admin is the studio filter order", async () => {
  // Move Renamed Brand to the top, one step at a time, waiting for each move to be saved and shown.
  const position = () => page.evaluate(() => [...document.querySelectorAll("[data-testid^=tx-row-]")].findIndex((r) => r.dataset.testid === "tx-row-renamed-brand"));
  for (let pos = await position(); pos > 0; pos = await position()) {
    await page.getByRole("button", { name: "Move Renamed Brand up" }).click();
    await page.waitForFunction((p) => [...document.querySelectorAll("[data-testid^=tx-row-]")].findIndex((r) => r.dataset.testid === "tx-row-renamed-brand") === p - 1, pos);
  }
  const r = await studio("", (r) => r.facets.brand[0]?.value === "Renamed Brand");
  assert(r.facets.brand[0].value === "Renamed Brand", `first is ${r.facets.brand[0].value}`);
});

await check("categories: deleting one in use requires moving its panels", async () => {
  await page.getByTestId("admin-tab-categories").click();
  await page.getByTestId("tx-delete-test-woods").click();
  await page.getByTestId("tx-merge-into").selectOption({ label: "Uni colors" });
  await page.getByTestId("tx-confirm-delete").click();
  await page.getByTestId("tx-done").waitFor();
  const r = await studio("TEST-ADMIN-001", (r) => r.items[0]?.category === "Uni colors");
  assert(r.items[0]?.category === "Uni colors", "not moved");
});

await check("sizes: add a size, it is offered in the panel editor", async () => {
  await page.getByTestId("admin-tab-sizes").click();
  await page.getByTestId("tx-add").click();
  await page.getByTestId("tx-widthMm").fill("1220");
  await page.getByTestId("tx-heightMm").fill("2800");
  await page.getByTestId("tx-thicknessMm").fill("8");
  await page.getByTestId("tx-save").click();
  await page.getByTestId("tx-done").waitFor();
  await page.getByTestId("tx-row-1220x2800x8").waitFor();
  await page.screenshot({ path: `${OUT}/admin-04-sizes.png` });
  await page.getByTestId("admin-tab-panels").click();
  await page.getByTestId("add-panel").click();
  const opts = await page.getByTestId("pf-size").locator("option").allInnerTexts();
  assert(opts.some((o) => o.includes("1220 × 2800")), opts.join("|"));
  await page.getByTestId("dialog-close").click();
});

await check("upload an image for a panel thumbnail", async () => {
  await page.getByTestId("panel-search").fill("TEST-ADMIN-001");
  await page.getByTestId("panel-row-TEST-ADMIN-001").getByTestId("edit-panel").click();
  const jpg = await fs.readFile("public/brands/kastamonu/thumbs/1-026.jpg");
  await page.getByTestId("pf-thumbnailUrl-upload").setInputFiles({ name: "my swatch.jpg", mimeType: "image/jpeg", buffer: jpg });
  // Saved to DATA_DIR (/api/media/…) or Supabase Storage (https://…/storage/v1/object/public/…).
  await page.waitForFunction(() => /\/api\/media\/|\/storage\/v1\/object\/public\//.test(document.querySelector("[data-testid=pf-thumbnailUrl-url]")?.value ?? ""));
  await page.getByTestId("pf-save").click();
  await page.getByTestId("panels-done").waitFor();
  const r = await studio("TEST-ADMIN-001", (r) => !!r.items[0]?.thumbnailUrl);
  const res = await fetch(new URL(r.items[0].thumbnailUrl, BASE));
  assert(res.ok && res.headers.get("content-type") === "image/jpeg", `image ${res.status}`);
});

await check("import: check, then update existing panels from a CSV", async () => {
  await page.getByTestId("admin-tab-products").click();
  const csv = "panelCode,productName,category,colourFamily,finish,brand\nTEST-ADMIN-001,Imported Name,Uni colors,Brown,Matt,Renamed Brand\nTEST-ADMIN-002,Second,Uni colors,Grey,Matt,Renamed Brand\n";
  await page.getByTestId("import-file").setInputFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByTestId("import-check").click();
  await page.getByTestId("import-errors").waitFor();
  await page.getByTestId("import-update").check();
  await page.getByTestId("import-check").click();
  await page.waitForFunction(() => !document.querySelector("[data-testid=import-errors]"));
  await page.getByTestId("import-save").click();
  await page.getByTestId("import-done").waitFor();
  const r = await studio("TEST-ADMIN", (r) => r.total === 2);
  assert(r.total === 2 && r.items.some((p) => p.productName === "Imported Name"), JSON.stringify(r.items.map((p) => p.productName)));
});

await check("export CSV contains the edited catalogue", async () => {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-panels-csv").click()]);
  const text = await fs.readFile(await dl.path(), "utf8");
  assert(text.startsWith("id,panelCode") && text.includes("TEST-ADMIN-002"), text.slice(0, 80));
});

await check("admin APIs refuse requests without sign-in", async () => {
  for (const u of ["/api/admin/products", "/api/admin/taxonomy"]) {
    const r = await fetch(`${BASE}${u}`);
    assert(r.status === 401, `${u} ${r.status}`);
  }
  const r = await fetch(`${BASE}/api/admin/media?name=x.jpg`, { method: "POST", body: "x", headers: { origin: BASE } });
  assert(r.status === 401, `media ${r.status}`);
});

await check("phone width: panels tab has no horizontal page scroll", async () => {
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.context().addCookies(await page.context().cookies());
  await m.goto(`${BASE}/admin`);
  await m.getByTestId("admin-tab-panels").click();
  await m.getByTestId("panels-table").waitFor();
  const w = await m.evaluate(() => document.documentElement.scrollWidth);
  await m.screenshot({ path: `${OUT}/admin-05-phone.png` });
  assert(w <= 390, `scrollWidth ${w}`);
  await m.close();
});

await check("no page errors", async () => assert(!errors.length, errors.join("; ")));

await browser.close();
await fs.writeFile(`${OUT}/admin-catalogue-results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
