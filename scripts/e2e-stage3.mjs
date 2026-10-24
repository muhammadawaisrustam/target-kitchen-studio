// Browser checks for saved designs, variants, share links, the summary, quotation requests and admin.
// Needs a server started with ADMIN_PASSWORD and DATA_DIR set, e.g.
//   ADMIN_PASSWORD=e2e-test-password-123 DATA_DIR=/tmp/tks-e2e npm start
//   E2E_DATA_DIR=/tmp/tks-e2e ADMIN_PASSWORD=e2e-test-password-123 npm run test:e2e:stage3
// Optional: NOADMIN_URL = a second server without ADMIN_PASSWORD, to check admin stays off.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.E2E_OUT || "e2e-screenshots";
const DATA = process.env.E2E_DATA_DIR;
const PASSWORD = process.env.ADMIN_PASSWORD;
const NOADMIN = process.env.NOADMIN_URL;
if (!DATA || !PASSWORD) throw new Error("Set E2E_DATA_DIR and ADMIN_PASSWORD to match the server under test.");
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const ready = async (p) => {
  await p.waitForSelector("[data-testid=viewport][data-status=ready]", { timeout: 120_000 });
};
const waitRegion = (p, r, code) =>
  p.waitForFunction(
    ({ r, code }) => {
      const el = document.querySelector(`[data-testid=region-${r}]`);
      return el?.dataset.panelCode === code && (code === "" || el?.dataset.status === "ok");
    },
    { r, code },
    { timeout: 60_000 },
  );
const regionCodes = (p) =>
  p.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-testid^=region-]")].map((el) => [el.dataset.testid.replace("region-", ""), el.dataset.panelCode ?? ""])));
const texture = (p, r) => p.evaluate((r) => window.__kitchenViewer.inspectRegion(r).textureName, r);
const choose = async (p, region, search, code) => {
  await p.click(`[data-testid=region-${region}]`);
  await p.fill("[data-testid=panel-search]", search);
  await p.click(`[data-testid='product-${code}']`);
  await waitRegion(p, region, code);
  await p.fill("[data-testid=panel-search]", "");
};
const enquiriesOnDisk = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, "enquiries.json"), "utf8")).enquiries;
  } catch {
    return [];
  }
};

await page.goto(BASE);
await ready(page);
await waitRegion(page, "lower_cabinets", "1-026-T18-C-J-1");

await check("Save a named design in the browser", async () => {
  await page.click("[data-testid=open-designs]");
  await page.click("[data-testid=save-new-design]");
  assert((await page.textContent("[data-testid=designs-message]")).includes("name"), "empty name accepted");
  await page.fill("[data-testid=design-name-input]", "Villa 12 kitchen");
  await page.click("[data-testid=save-new-design]");
  await page.waitForSelector("[data-testid=designs-message]:has-text('Saved in this browser')");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tks.designs.v1")));
  assert(stored.length === 1 && stored[0].name === "Villa 12 kitchen", "not in localStorage");
  assert(stored[0].variants[0].selections.lower_cabinets === "1-026-T18-C-J-1", "panels not stored");
  assert((await page.textContent("[data-testid=save-state]")) === "All changes saved", "state");
  await page.click("[data-testid=dialog-close]");
  const status = await page.textContent("[data-testid=design-status]");
  assert(status.includes("Villa 12 kitchen · Variant A"), status);
  return "stored with 5 region codes and camera";
});

await check("Variants keep separate panel choices; switching updates the 3D view", async () => {
  await choose(page, "lower_cabinets", "canaletto", "1-668-T18-C-L-27");
  assert((await page.textContent("[data-testid=design-status]")).includes("unsaved changes"), "no unsaved marker");
  await page.click("[data-testid=open-designs]");
  await page.click("[data-testid=add-variant]");
  await page.waitForSelector("[data-testid=variant-1][aria-current=true]");
  assert((await page.textContent("[data-testid=variant-1]")) === "Variant B", "name");
  assert((await page.textContent("[data-testid=save-state]")) === "All changes saved", "variant not saved");
  await page.click("[data-testid=variant-0]");
  await waitRegion(page, "lower_cabinets", "1-026-T18-C-J-1");
  const a = await texture(page, "lower_cabinets");
  await page.click("[data-testid=variant-1]");
  await waitRegion(page, "lower_cabinets", "1-668-T18-C-L-27");
  const b = await texture(page, "lower_cabinets");
  assert(a.endsWith("1-026.jpg") && b.endsWith("1-668.jpg"), `${a} / ${b}`);
  await page.click("[data-testid=dialog-close]");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/s3-01-variant-b.png` });
  return "Variant A lower 1-026 Garden Oak, Variant B lower 1-668 Canaletto";
});

await check("Unsaved changes are not lost silently when switching variants", async () => {
  await choose(page, "upper_cabinets", "HG RED", "3-191-T18-M-M-1");
  await page.click("[data-testid=open-designs]");
  await page.click("[data-testid=variant-0]");
  await page.waitForSelector("[data-testid=unsaved-confirm]");
  await page.click("[data-testid=discard-and-switch]");
  await waitRegion(page, "upper_cabinets", "1-001-T18-C-J-1");
  await page.click("[data-testid=variant-1]");
  await waitRegion(page, "upper_cabinets", "1-001-T18-C-J-1");
  // now make a change and use "save, then open"
  await page.click("[data-testid=dialog-close]");
  await choose(page, "upper_cabinets", "HG RED", "3-191-T18-M-M-1");
  await page.click("[data-testid=open-designs]");
  await page.click("[data-testid=variant-0]");
  await page.click("[data-testid=save-and-switch]");
  await waitRegion(page, "upper_cabinets", "1-001-T18-C-J-1");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tks.designs.v1"))[0].variants[1].selections.upper_cabinets);
  assert(stored === "3-191-T18-M-M-1", `saved ${stored}`);
  await page.click("[data-testid=dialog-close]");
  return "asked first; discard kept the saved version; save-then-open stored HG RED in Variant B";
});

await check("Saved designs survive a page reload", async () => {
  await page.reload();
  await ready(page);
  await page.click("[data-testid=open-designs]");
  assert((await page.locator("[data-testid=saved-designs] li").count()) === 1, "design missing after reload");
  await page.click("[data-testid='open-design-Villa 12 kitchen']");
  await page.waitForFunction(() => document.querySelector("[data-testid=design-status]")?.textContent.includes("Villa 12 kitchen"));
  await page.click("[data-testid=dialog-close]");
  const status = await page.textContent("[data-testid=design-status]");
  const codes = await regionCodes(page);
  return `${status.trim()}; lower ${codes.lower_cabinets}`;
});

let shareUrl = "";
await check("Summary lists every region's Item ID, compares variants, downloads CSV", async () => {
  await page.click("[data-testid=open-designs]");
  await page.click("[data-testid=variant-1]");
  await waitRegion(page, "upper_cabinets", "3-191-T18-M-M-1");
  await page.click("[data-testid=dialog-close]");
  await page.click("[data-testid=open-summary]");
  await page.waitForSelector("[data-testid=summary-table]");
  const rows = await page.locator("[data-testid=summary-table] tbody tr").allTextContents();
  assert(rows.length === 5, `${rows.length} rows`);
  assert(rows.some((r) => r.includes("3-191-T18-M-M-1") && r.includes("HG RED PVC") && r.includes("MDF")), rows.join(" | "));
  assert(rows.some((r) => r.includes("1-668-T18-C-L-27")), "lower missing");
  const cmp = await page.locator("[data-testid=compare-table] thead th").count();
  assert(cmp === 3, `compare columns ${cmp}`);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=download-summary]")]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  assert(csv.includes("1-668-T18-C-L-27") && csv.includes("Villa 12 kitchen") && csv.includes("Variant B"), csv.slice(0, 200));
  shareUrl = await page.inputValue("[data-testid=share-url]");
  assert(shareUrl.startsWith(`${BASE}/?design=`), shareUrl);
  await page.screenshot({ path: `${OUT}/s3-02-summary.png` });
  await page.click("[data-testid=dialog-close]");
  return `5 rows, 2 variants compared, CSV ${dl.suggestedFilename()}, link ${shareUrl.length} chars`;
});

await check("Share link opens the same design on another device (no saved data)", async () => {
  const cam = await page.evaluate(() => window.__kitchenViewer.getCameraState());
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await fresh.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(shareUrl);
  await ready(p2);
  await waitRegion(p2, "upper_cabinets", "3-191-T18-M-M-1");
  await waitRegion(p2, "lower_cabinets", "1-668-T18-C-L-27");
  const mine = await regionCodes(page);
  const theirs = await regionCodes(p2);
  assert(JSON.stringify(mine) === JSON.stringify(theirs), `${JSON.stringify(mine)} vs ${JSON.stringify(theirs)}`);
  const notice = await p2.textContent("[data-testid=notice]");
  assert(notice.includes("Villa 12 kitchen") && notice.includes("Variant B"), notice);
  assert(!p2.url().includes("design="), "parameter left in URL");
  const cam2 = await p2.evaluate(() => window.__kitchenViewer.getCameraState());
  assert(Math.abs(cam.alpha - cam2.alpha) < 0.01 && Math.abs(cam.radius - cam2.radius) < 0.01, `camera ${JSON.stringify(cam2)}`);
  assert((await p2.evaluate(() => localStorage.getItem("tks.designs.v1"))) === null, "should not auto-save");
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: `${OUT}/s3-03-shared.png` });
  await fresh.close();
  return "same 5 codes and camera; not saved until the visitor chooses to";
});

await check("Share link with an unknown code: reported, nothing substituted", async () => {
  const token = Buffer.from(JSON.stringify({ v: 1, m: "demo-l-island", s: { l: "FAKE-999", u: "1-001-T18-C-J-1" } })).toString("base64url");
  const p3 = await ctx.newPage();
  await p3.goto(`${BASE}/?design=${token}`);
  await ready(p3);
  await waitRegion(p3, "upper_cabinets", "1-001-T18-C-J-1");
  await p3.waitForFunction(() => document.querySelector("[data-testid=notice]")?.textContent.includes("FAKE-999"));
  const codes = await regionCodes(p3);
  assert(!codes.lower_cabinets && !codes.tall_cabinets, JSON.stringify(codes));
  assert((await texture(p3, "lower_cabinets")) === null, "a texture was applied to the unknown region");
  await p3.goto(`${BASE}/?design=not-a-real-token`);
  await ready(p3);
  await p3.waitForFunction(() => document.querySelector("[data-testid=notice]")?.textContent.includes("damaged"));
  await p3.close();
  return "FAKE-999 reported, lower cabinets left unassigned; damaged link reported";
});

await check("Quote form: missing details are flagged and nothing is sent", async () => {
  let posts = 0;
  const count = (r) => r.url().endsWith("/api/enquiries") && r.method() === "POST" && posts++;
  page.on("request", count);
  await page.click("[data-testid=open-quote]");
  await page.click("[data-testid=q-submit]");
  await page.waitForSelector("#name-error");
  const errs = await page.locator("[data-testid=quote-form] [id$=-error]").allTextContents();
  assert(errs.length >= 3, errs.join(" | "));
  assert(posts === 0, "a request was sent");
  page.off("request", count);
  return errs.join(" / ");
});

await check("Quote form: a server failure shows an error, never success", async () => {
  await page.route("**/api/enquiries", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Your enquiry could not be saved right now, so it was not sent." }) }));
  await page.fill("[data-testid=q-name]", "Test Customer");
  await page.fill("[data-testid=q-phone]", "+974 5555 1234");
  await page.check("[data-testid=q-consent]");
  await page.click("[data-testid=q-submit]");
  await page.waitForSelector("[data-testid=quote-error]");
  assert(!(await page.locator("[data-testid=quote-success]").count()), "success shown");
  await page.unroute("**/api/enquiries");
  await page.route("**/api/enquiries", (r) => r.abort("failed"));
  await page.click("[data-testid=q-submit]");
  await page.waitForFunction(() => document.querySelector("[data-testid=quote-error]")?.textContent.includes("Could not reach"));
  assert(!(await page.locator("[data-testid=quote-success]").count()), "success shown after network error");
  await page.unroute("**/api/enquiries");
  assert(enquiriesOnDisk().length === 0, "something was stored");
  return "HTTP 503 and network failure both show an error; form kept";
});

let reference = "";
await check("Quote form: success only after the server stores it, with the panel codes", async () => {
  await page.fill("[data-testid=q-message]", "Kitchen about 4 m wall plus island.");
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/enquiries")), page.click("[data-testid=q-submit]")]);
  assert(res.status() === 201, `status ${res.status()}`);
  await page.waitForSelector("[data-testid=quote-success]");
  reference = (await page.textContent("[data-testid=quote-reference]")).trim();
  const stored = enquiriesOnDisk().find((e) => e.reference === reference);
  assert(stored, "reference not in the server file");
  assert(stored.design.designName === "Villa 12 kitchen" && stored.design.variantName === "Variant B", JSON.stringify(stored.design).slice(0, 200));
  const upper = stored.design.items.find((i) => i.region === "upper_cabinets");
  assert(upper.panelCode === "3-191-T18-M-M-1" && upper.productName === "HG RED PVC" && upper.board === "MDF", JSON.stringify(upper));
  assert(stored.design.items.length === 5 && stored.contact.phone === "+974 5555 1234" && stored.status === "new", "fields");
  await page.screenshot({ path: `${OUT}/s3-04-quote-sent.png` });
  await page.click("[data-testid=dialog-close]");
  return `${reference} saved with 5 panels`;
});

await check("Enquiry API rejects unknown panels and spam without storing them", async () => {
  const before = enquiriesOnDisk().length;
  const post = (body) => page.evaluate((b) => fetch("/api/enquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.status), body);
  const base = { name: "Bot", phone: "+974 5555 0000", consent: true, design: { modelId: "demo-l-island", selections: { lower_cabinets: "1-026-T18-C-J-1" } } };
  const s1 = await post({ ...base, design: { ...base.design, selections: { lower_cabinets: "NOT-REAL" } } });
  const s2 = await post({ ...base, website: "http://spam.example" });
  const s3 = await post({ ...base, consent: false });
  assert(s1 === 422 && s2 === 400 && s3 === 422, `${s1} ${s2} ${s3}`);
  assert(enquiriesOnDisk().length === before, "stored anyway");
  return "unknown code 422, honeypot 400, no consent 422; nothing stored";
});

await check("Admin: blocked without sign-in; wrong password refused", async () => {
  const s = await page.evaluate(() => fetch("/api/admin/enquiries").then((r) => r.status));
  assert(s === 401, `GET enquiries ${s}`);
  await page.goto(`${BASE}/admin`);
  await page.waitForSelector("[data-testid=admin-login]");
  await page.fill("[data-testid=admin-password]", "wrong-password-xyz");
  await page.click("[data-testid=admin-signin]");
  await page.waitForSelector("[data-testid=admin-login-error]");
  const bundle = await page.evaluate(async () => {
    const srcs = [...document.scripts].map((s) => s.src).filter(Boolean);
    const texts = await Promise.all(srcs.map((s) => fetch(s).then((r) => r.text())));
    return texts.join("\n");
  });
  assert(!bundle.includes(process.env.ADMIN_PASSWORD ?? "@@"), "password found in page scripts");
  return "401 without cookie; wrong password rejected; password not in any page script";
});

await check("Admin: sign in, see the enquiry, change status, export CSV", async () => {
  await page.fill("[data-testid=admin-password]", PASSWORD);
  await page.click("[data-testid=admin-signin]");
  await page.waitForSelector(`[data-testid=enquiry-${reference}]`);
  const cookie = (await ctx.cookies()).find((c) => c.name === "tks_admin");
  assert(cookie?.httpOnly && cookie.sameSite === "Strict", JSON.stringify(cookie));
  await page.locator(`[data-testid=enquiry-${reference}] [data-testid=enquiry-status]`).selectOption("contacted");
  await page.waitForTimeout(500);
  const stored = enquiriesOnDisk().find((e) => e.reference === reference);
  assert(stored.status === "contacted", `status ${stored.status}`);
  await page.click(`text=${reference}`);
  await page.waitForSelector("text=Open this design in the studio");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=export-enquiries]")]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  assert(csv.includes(reference) && csv.includes("contacted") && csv.includes("3-191-T18-M-M-1"), csv.slice(0, 300));
  // The same change sent with the admin cookie but from another site is refused.
  const cross = await ctx.request.patch(`${BASE}/api/admin/enquiries/${stored.id}`, { headers: { Origin: "https://evil.example" }, data: { status: "closed" } });
  assert(cross.status() === 403, `cross-site PATCH ${cross.status()}`);
  assert(enquiriesOnDisk().find((e) => e.reference === reference).status === "contacted", "cross-site change applied");
  await page.screenshot({ path: `${OUT}/s3-05-admin-enquiries.png` });
  return "HttpOnly SameSite=Strict cookie; status saved to the server file; CSV export has the enquiry; cross-site change refused (403)";
});

await check("Admin: product import is checked first, errors block it, clean file goes live and can be removed", async () => {
  await page.click("[data-testid=admin-tab-products]");
  await page.waitForSelector("[data-testid=catalogue-sources]");
  const header = "id,panelCode,productName,category,colourFamily,finish,brand,board,textureUrl,thumbnailUrl,colourHex,isActive,isPublished";
  const bad = `${header}\ne2e-1,1-026-T18-C-J-1,Clash,Woodgrains,Beige,Matt,E2E,MDF,,,#ffffff,true,true\ne2e-2,,No code,Plain,White,Matt,E2E,MDF,,,#ffffff,true,true`;
  const good = `${header}\ne2e-1,E2E-001,E2E Test Walnut,Woodgrains,Brown,Matt,E2E Brand,MDF,/brands/kastamonu/textures/1-668.jpg,/brands/kastamonu/thumbs/1-668.jpg,,true,true\ne2e-2,E2E-002,E2E Test White,Uni colors,White,Matt,E2E Brand,MDF,,,#F4F4F0,true,true`;
  await page.fill("[data-testid=import-label]", "E2E brand");
  await page.setInputFiles("[data-testid=import-file]", { name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from(bad) });
  await page.click("[data-testid=import-check]");
  await page.waitForSelector("[data-testid=import-errors]");
  assert(await page.isDisabled("[data-testid=import-save]"), "import allowed with errors");
  await page.setInputFiles("[data-testid=import-file]", { name: "good.csv", mimeType: "text/csv", buffer: Buffer.from(good) });
  await page.click("[data-testid=import-check]");
  await page.waitForSelector("[data-testid=import-save]:not([disabled])");
  await page.click("[data-testid=import-save]");
  await page.waitForSelector("[data-testid=import-done]");
  const live = await page.evaluate(() => fetch("/api/catalogue?q=E2E-001").then((r) => r.json()));
  assert(live.items.length === 1 && live.items[0].productName === "E2E Test Walnut", JSON.stringify(live).slice(0, 200));
  assert(fs.existsSync(path.join(DATA, "catalogue", "e2e-brand.json")), "file not written");
  await page.screenshot({ path: `${OUT}/s3-06-admin-import.png`, fullPage: true });
  await page.click("[data-testid=remove-e2e-brand]");
  await page.click("[data-testid=confirm-remove-e2e-brand]");
  await page.waitForSelector("[data-testid=import-done]:has-text('Removed')");
  const gone = await page.evaluate(() => fetch("/api/catalogue?q=E2E-001").then((r) => r.json()));
  assert(gone.items.length === 0, "still live after removal");
  return "file with a duplicate code and a missing code was blocked; clean file imported 2 products, then removed";
});

await check("Admin: sign out ends access", async () => {
  await page.click("[data-testid=admin-signout]");
  await page.waitForSelector("[data-testid=admin-login]");
  const s = await page.evaluate(() => fetch("/api/admin/enquiries").then((r) => r.status));
  assert(s === 401, `after sign-out ${s}`);
});

if (NOADMIN) {
  await check("Admin stays switched off when no password is set", async () => {
    const p4 = await ctx.newPage();
    await p4.goto(`${NOADMIN}/admin`);
    await p4.waitForSelector("[data-testid=admin-disabled]");
    const s = await p4.evaluate(() => fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "" }) }).then((r) => r.status));
    assert(s === 503, `login ${s}`);
    await p4.close();
  });
}

await check("No page errors", async () => {
  assert(errors.length === 0, errors.join(" | "));
});

const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const mp = await m.newPage();
await check("Phone: header, designs, summary and quote dialogs fit the screen", async () => {
  await mp.goto(BASE);
  await ready(mp);
  const over = () => mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!(await over()), "page overflow");
  await mp.screenshot({ path: `${OUT}/s3-07-mobile.png` });
  for (const d of ["designs", "summary", "quote"]) {
    await mp.click(`[data-testid=open-${d}]`);
    await mp.waitForSelector("[role=dialog]");
    assert(!(await over()), `${d} overflow`);
    if (d === "quote") await mp.screenshot({ path: `${OUT}/s3-08-mobile-quote.png` });
    await mp.click("[data-testid=dialog-close]");
  }
  return "no horizontal scrolling";
});

await browser.close();
fs.writeFileSync(`${OUT}/stage3-results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
