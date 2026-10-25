import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EnquiryInputSchema } from "@/lib/enquiries/schema";
import { buildEnquiry, EnquiryRejectedError, newReference, shareTokenFrom } from "@/lib/server/enquiries";
import { FileEnquiryStore, StorageUnavailableError, SupabaseEnquiryStore } from "@/lib/server/enquiryStore";
import { decodeShareToken, encodeShareToken } from "@/lib/designs/share";
import { rateLimit } from "@/lib/server/rateLimit";

const products = [
  { id: "a", panelCode: "1-026-T18-C-J-1", productName: "GARDEN OAK", category: "Woodgrains", colourFamily: "Beige", finish: "Not stated", brand: "Kastamonu", board: "Particleboard", isActive: true, isPublished: true, isDemo: false },
  { id: "b", panelCode: "DEMO-WD-001", productName: "Demo oak", category: "Woodgrain", colourFamily: "Light wood", finish: "Matt", isActive: true, isPublished: true, isDemo: true },
] as never[];

const valid = {
  name: "Awais",
  phone: "+974 5555 1234",
  consent: true,
  design: { modelId: "demo-l-island", designName: "Villa", selections: { lower_cabinets: "1-026-t18-c-j-1" }, shareUrl: `https://x.test/?design=${encodeShareToken({ modelId: "demo-l-island", selections: { lower_cabinets: "1-026-T18-C-J-1" } })}` },
};

test("enquiry form: required fields, phone-or-email, consent, at least one panel", () => {
  assert.ok(EnquiryInputSchema.safeParse(valid).success);
  const fails = (patch: object) => !EnquiryInputSchema.safeParse({ ...valid, ...patch }).success;
  assert.ok(fails({ name: " " }));
  assert.ok(fails({ phone: undefined }), "needs phone or email");
  assert.ok(!fails({ phone: "", email: "a@b.qa" }));
  assert.ok(fails({ email: "not-an-email" }));
  assert.ok(fails({ phone: "call me" }));
  assert.ok(fails({ consent: false }));
  assert.ok(fails({ preferredContact: "email" }), "email preferred but missing");
  assert.ok(fails({ design: { ...valid.design, selections: {} } }));
  assert.ok(fails({ design: { ...valid.design, selections: { roof: "x" } } }));
  assert.ok(fails({ design: { ...valid.design, shareUrl: "javascript:alert(1)" } }));
});

test("enquiry: panel details come from the server catalogue; unknown codes are rejected", () => {
  const e = buildEnquiry(EnquiryInputSchema.parse(valid), products);
  assert.match(e.reference, /^ENQ-\d{8}-[A-Z2-9]{6}$/);
  assert.equal(e.status, "new");
  assert.equal(e.design.items[0]!.panelCode, "1-026-T18-C-J-1", "code normalised to the catalogue's spelling");
  assert.equal(e.design.items[0]!.productName, "GARDEN OAK");
  assert.equal(e.containsDemoPanels, false);
  assert.ok(e.design.shareToken);
  assert.throws(() => buildEnquiry(EnquiryInputSchema.parse({ ...valid, design: { ...valid.design, selections: { lower_cabinets: "NOPE-1" } } }), products), EnquiryRejectedError);
  assert.throws(() => buildEnquiry(EnquiryInputSchema.parse({ ...valid, design: { ...valid.design, modelId: "unknown" } }), products), EnquiryRejectedError);
  assert.equal(shareTokenFrom("https://evil.test/?design=notatoken"), undefined);
  assert.notEqual(newReference(), newReference());
});

test("enquiry: stored design link always matches the checked panel codes (QA)", () => {
  // A link that shows different panels from the ones submitted must not be stored as-is.
  const otherLink = `https://x.test/?design=${encodeShareToken({ modelId: "demo-l-island", selections: { lower_cabinets: "DEMO-WD-001" }, camera: { alpha: 1, beta: 1, radius: 3, target: [0, 1, 0] } })}`;
  const e = buildEnquiry(EnquiryInputSchema.parse({ ...valid, design: { ...valid.design, shareUrl: otherLink } }), products);
  const shown = decodeShareToken(e.design.shareToken);
  assert.deepEqual(shown?.selections, { lower_cabinets: "1-026-T18-C-J-1" });
  assert.equal(shown?.camera?.radius, 3, "camera from the visitor's link is kept");
  const noLink = buildEnquiry(EnquiryInputSchema.parse({ ...valid, design: { ...valid.design, shareUrl: undefined } }), products);
  assert.deepEqual(decodeShareToken(noLink.design.shareToken)?.selections, { lower_cabinets: "1-026-T18-C-J-1" });
});

test("file store: saves, confirms, lists newest first, updates, survives concurrent writes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tks-"));
  const store = new FileEnquiryStore(path.join(dir, "sub", "enquiries.json"));
  const make = (i: number) => ({ ...buildEnquiry(EnquiryInputSchema.parse(valid), products, new Date(Date.UTC(2026, 9, 1, 0, i))), id: `id-${i}` });
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.create(make(i))));
  const list = await store.list();
  assert.equal(list.length, 20, "no submission lost");
  assert.equal(list[0]!.id, "id-19");
  const updated = await store.update("id-3", { status: "contacted", adminNote: "Called" });
  assert.equal(updated?.status, "contacted");
  assert.equal(await store.update("missing", { status: "closed" }), null);
  const onDisk = JSON.parse(await fs.readFile(path.join(dir, "sub", "enquiries.json"), "utf8"));
  assert.equal(onDisk.enquiries.find((e: { id: string }) => e.id === "id-3").adminNote, "Called");
});

test("file store: an unwritable location fails loudly instead of reporting success", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tks-"));
  await fs.writeFile(path.join(dir, "blocker"), "a file, not a folder");
  const store = new FileEnquiryStore(path.join(dir, "blocker", "enquiries.json"));
  await assert.rejects(store.create(buildEnquiry(EnquiryInputSchema.parse(valid), products)), StorageUnavailableError);
});

test("Supabase store: sends the service key only to the configured URL, and checks the reply", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const rows: unknown[] = [];
  const fake = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (init.method === "POST") {
      const row = JSON.parse(String(init.body));
      rows.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
  const store = new SupabaseEnquiryStore("https://proj.supabase.co/", "service-key", fake);
  const e = buildEnquiry(EnquiryInputSchema.parse(valid), products);
  assert.equal((await store.create(e)).reference, e.reference);
  assert.equal(calls[0]!.url, "https://proj.supabase.co/rest/v1/enquiries");
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer service-key");
  assert.equal((await store.list()).length, 1);

  const failing = new SupabaseEnquiryStore("https://proj.supabase.co", "k", (async () => new Response("denied", { status: 401 })) as typeof fetch);
  await assert.rejects(failing.create(e), StorageUnavailableError);
  const silent = new SupabaseEnquiryStore("https://proj.supabase.co", "k", (async () => new Response("[]", { status: 201 })) as typeof fetch);
  await assert.rejects(silent.create(e), /could not be confirmed/);
});

test("rate limit: blocks after the limit and resets after the window", () => {
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) assert.ok(rateLimit("k1", 3, 1000, t).ok);
  assert.ok(!rateLimit("k1", 3, 1000, t).ok);
  assert.ok(rateLimit("k1", 3, 1000, t + 1001).ok);
});

// ---------- photo designs ("My Kitchen Photo") ----------
import { buildEnquiry as build2, decodePreview, PHOTO_MODEL_ID } from "@/lib/server/enquiries";
import { FilePreviewStore, SupabasePreviewStore } from "@/lib/server/previewStore";

const photoInput = (over: object = {}) => ({
  name: "Awais",
  email: "a@b.qa",
  consent: true,
  photo: { designId: "pd_abc", designName: "Villa photo", regions: [{ region: "upper_cabinets", panelCode: "1-026-t18-c-j-1" }, { region: "other_panels", panelCode: "DEMO-WD-001" }], ...over },
});
const tinyJpeg = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64")}`;

test("photo enquiry: panel codes by region are checked against the catalogue; no photo is stored in the record", () => {
  const parsed = EnquiryInputSchema.parse(photoInput());
  const e = build2(parsed, products);
  assert.equal(e.source, "photo");
  assert.equal(e.design.modelId, PHOTO_MODEL_ID);
  assert.deepEqual(
    e.design.items.map((i) => [i.regionLabel, i.panelCode]),
    [
      ["Upper cabinets", "1-026-T18-C-J-1"],
      ["Other panels", "DEMO-WD-001"],
    ],
  );
  assert.equal(e.containsDemoPanels, true);
  assert.equal(e.photo?.designId, "pd_abc");
  assert.equal(e.design.shareToken, undefined);
  assert.ok(!JSON.stringify(e).includes("base64"), "no image data inside the enquiry record");
  assert.throws(() => build2(EnquiryInputSchema.parse(photoInput({ regions: [{ region: "upper_cabinets", panelCode: "NOPE-1" }] })), products), EnquiryRejectedError);
});

test("photo enquiry: validation of regions and the optional preview", () => {
  const ok = (v: object) => EnquiryInputSchema.safeParse(v).success;
  assert.ok(ok(photoInput()));
  assert.ok(ok(photoInput({ previewJpeg: tinyJpeg })));
  assert.ok(!ok(photoInput({ regions: [] })), "at least one region");
  assert.ok(!ok(photoInput({ regions: [{ region: "roof", panelCode: "x" }] })), "unknown region");
  assert.ok(!ok(photoInput({ regions: [{ region: "upper_cabinets", panelCode: "a" }, { region: "upper_cabinets", panelCode: "b" }] })), "duplicate region");
  assert.ok(!ok(photoInput({ previewJpeg: "data:image/png;base64,AAAA" })), "only JPEG previews");
  assert.ok(!ok(photoInput({ previewJpeg: "https://evil.test/x.jpg" })), "no URLs");
  assert.ok(!ok({ ...photoInput(), design: valid.design }), "not both kinds at once");
  assert.ok(!ok({ name: "A b", email: "a@b.qa", consent: true }), "needs a design or a photo");
  assert.ok(decodePreview(tinyJpeg)!.length > 100);
  assert.throws(() => decodePreview(`data:image/jpeg;base64,${Buffer.from("not a jpeg at all, just text............................................................................................").toString("base64")}`), EnquiryRejectedError);
  assert.equal(decodePreview(undefined), undefined);
});

test("preview store (file): private folder, round trip, safe ids, unwritable disk fails loudly", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tks-prev-"));
  const store = new FilePreviewStore(path.join(dir, "previews"));
  const jpeg = decodePreview(tinyJpeg)!;
  await store.save("0d6c7a3e-1111-4222-8333-944445555666", jpeg);
  assert.deepEqual(await store.read("0d6c7a3e-1111-4222-8333-944445555666"), jpeg);
  const mode = (await fs.stat(path.join(dir, "previews", "0d6c7a3e-1111-4222-8333-944445555666.jpg"))).mode & 0o777;
  assert.equal(mode, 0o600, "readable by the server user only");
  assert.equal(await store.read("missing-id"), null);
  await assert.rejects(store.read("../etc/passwd"), StorageUnavailableError);
  await store.remove("0d6c7a3e-1111-4222-8333-944445555666");
  assert.equal(await store.read("0d6c7a3e-1111-4222-8333-944445555666"), null);
  await fs.writeFile(path.join(dir, "blocker"), "x");
  await assert.rejects(new FilePreviewStore(path.join(dir, "blocker", "p")).save("abc", jpeg), StorageUnavailableError);
});

test("preview store (Supabase): uploads to the private bucket with the service key and reports failures", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(init.method === "POST" ? "{}" : "img", { status: 200 });
  }) as typeof fetch;
  const store = new SupabasePreviewStore("https://proj.supabase.co/", "service-key", fake);
  await store.save("abc-123", decodePreview(tinyJpeg)!);
  assert.equal(calls[0]!.url, "https://proj.supabase.co/storage/v1/object/enquiry-previews/abc-123.jpg");
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer service-key");
  assert.ok(await store.read("abc-123"));
  const failing = new SupabasePreviewStore("https://proj.supabase.co", "k", (async () => new Response("no bucket", { status: 404 })) as typeof fetch);
  await assert.rejects(failing.save("abc", decodePreview(tinyJpeg)!), StorageUnavailableError);
  assert.equal(await failing.read("abc"), null);
});
