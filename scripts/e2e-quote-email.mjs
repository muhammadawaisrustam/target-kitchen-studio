// Browser check that the quote form emails the request when the server has no writable disk (as on Netlify).
// Start a stand-in email API that logs each request as a JSON line to MAIL_LOG, and fails while MAIL_LOG.fail exists.
// Then start the app with RESEND_API_KEY=re_test RESEND_API_URL=<stand-in> and DATA_DIR on a path that cannot be created.
//   BASE_URL=http://localhost:3103 MAIL_LOG=/tmp/mails.jsonl node scripts/e2e-quote-email.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const LOG = process.env.MAIL_LOG;
const OUT = process.env.E2E_OUT || "e2e-screenshots";
if (!LOG) throw new Error("Set MAIL_LOG to the stand-in email API's log file.");
fs.mkdirSync(OUT, { recursive: true });
const mails = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

let failed = 0;
const check = async (name, fn) => {
  try { const d = await fn(); console.log(`PASS  ${name}${d ? `  (${d})` : ""}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}  -> ${e?.message ?? e}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE);
await page.waitForSelector("[data-testid=viewport][data-status=ready]", { timeout: 120_000 });

const fill = async () => {
  await page.click("[data-testid=open-quote]");
  await page.fill("[data-testid=q-name]", "Email Test Customer");
  await page.fill("[data-testid=q-phone]", "+974 5555 1234");
  await page.fill("[data-testid=q-email]", "customer@example.com");
  await page.fill("[data-testid=q-message]", "Please call after 5pm <b>thanks</b>");
  await page.check("[data-testid=q-consent]");
};

await check("Quote is emailed to info@targetqatar.com and shown as sent, with no writable disk", async () => {
  const before = mails().length;
  await fill();
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/enquiries")), page.click("[data-testid=q-submit]")]);
  assert(res.status() === 201, `status ${res.status()}`);
  await page.waitForSelector("[data-testid=quote-success]");
  const ref = (await page.textContent("[data-testid=quote-reference]")).trim();
  const m = mails().slice(before);
  assert(m.length === 1, `${m.length} emails`);
  const { body, auth, url } = m[0];
  assert(url === "/emails" && auth === "Bearer re_test", `${url} ${auth}`);
  assert(JSON.stringify(body.to) === '["info@targetqatar.com"]', JSON.stringify(body.to));
  assert(body.subject.includes(ref) && body.text.includes(ref), "reference missing");
  assert(body.reply_to === "customer@example.com", body.reply_to);
  assert(/\d-\d{3}-T18/.test(body.text), "no Kastamonu panel code in the email");
  assert(body.text.includes("/?design="), "no design link");
  assert(!body.html.includes("<b>thanks</b>") && body.html.includes("&lt;b&gt;"), "customer text not escaped");
  assert((await page.textContent("[data-testid=quote-success]")).includes("sent"), "success wording");
  const after = new URL(await page.getAttribute("[data-testid=q-whatsapp-after]", "href"));
  assert(after.searchParams.get("text").includes(`Reference: ${ref}`), "WhatsApp after sending lacks the reference");
  await page.screenshot({ path: `${OUT}/quote-emailed.png` });
  await page.click("[data-testid=dialog-close]");
  fs.writeFileSync(`${OUT}/quote-email-sample.txt`, `To: ${body.to}\nReply-To: ${body.reply_to}\nSubject: ${body.subject}\n\n${body.text}\n`);
  return `${ref}; ${body.text.split("\n").filter((l) => l.startsWith("- ")).length} panel lines`;
});

await check("WhatsApp button opens a chat with +974 7765 7373 holding the kitchen, codes and design link", async () => {
  await page.click("[data-testid=open-quote]");
  await page.fill("[data-testid=q-name]", "WhatsApp Customer");
  await page.fill("[data-testid=q-message]", "Size 4 m & island?");
  const href = await page.getAttribute("[data-testid=q-whatsapp]", "href");
  const u = new URL(href);
  assert(u.origin + u.pathname === "https://wa.me/97477657373", href.slice(0, 60));
  const text = u.searchParams.get("text");
  const listed = await page.locator("[data-testid=quote-panels] li .font-mono").allTextContents();
  assert(listed.length && listed.every((c) => text.includes(c)), "codes missing from message");
  assert(text.includes("Name: WhatsApp Customer") && text.includes("Notes: Size 4 m & island?") && /Design: http\S+\/\?design=/.test(text), text);
  await page.context().route("https://wa.me/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>wa</title>" }));
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.click("[data-testid=q-whatsapp]")]);
  await popup.waitForLoadState();
  assert(popup.url().startsWith("https://wa.me/97477657373?text="), popup.url().slice(0, 60));
  await popup.close();
  assert(await page.locator("[data-testid=quote-form]").count(), "quote form was closed");
  await page.screenshot({ path: `${OUT}/quote-whatsapp.png` });
  await page.click("[data-testid=dialog-close]");
  fs.writeFileSync(`${OUT}/whatsapp-sample.txt`, text + "\n");
  return `${listed.length} codes, ${href.length}-char link, opens in a new tab`;
});

await check("If the email service refuses and nothing is stored, the visitor sees an error, not success", async () => {
  fs.writeFileSync(LOG + ".fail", "");
  try {
    await fill();
    const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/enquiries")), page.click("[data-testid=q-submit]")]);
    assert(res.status() === 503, `status ${res.status()}`);
    await page.waitForSelector("[data-testid=quote-error]");
    assert(!(await page.locator("[data-testid=quote-success]").count()), "success shown");
    return (await page.textContent("[data-testid=quote-error]")).trim().slice(0, 90);
  } finally { fs.rmSync(LOG + ".fail", { force: true }); }
});

await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
