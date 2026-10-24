import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EnquiryInputSchema } from "@/lib/enquiries/schema";
import { buildEnquiry, EnquiryRejectedError, newReference, shareTokenFrom } from "@/lib/server/enquiries";
import { FileEnquiryStore, StorageUnavailableError, SupabaseEnquiryStore } from "@/lib/server/enquiryStore";
import { encodeShareToken } from "@/lib/designs/share";
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
