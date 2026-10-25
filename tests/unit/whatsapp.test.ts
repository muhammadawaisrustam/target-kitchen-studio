import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWhatsAppText, whatsAppLink, WHATSAPP_NUMBER } from "@/lib/designs/whatsapp";

const rows = [
  { region: "upper_cabinets", regionLabel: "Upper cabinets", panelCode: "1-001-T18-C-J-1", productName: "CORPUS WHITE" },
  { region: "lower_cabinets", regionLabel: "Lower cabinets", panelCode: "1-026-T18-C-J-1", productName: "GARDEN OAK" },
  { region: "island", regionLabel: "Kitchen island", panelCode: null },
] as never[];

test("WhatsApp: Target's number, message lists every chosen code and the design link", () => {
  assert.equal(WHATSAPP_NUMBER, "97477657373");
  const text = buildWhatsAppText({ rows, layoutName: "Galley kitchen", designName: "Villa", shareUrl: "https://s.test/?design=abc", name: " Awais ", notes: "4 m wall & island?" });
  assert.match(text, /Kitchen: Villa · Galley kitchen/);
  assert.match(text, /- Upper cabinets: 1-001-T18-C-J-1 CORPUS WHITE/);
  assert.match(text, /- Lower cabinets: 1-026-T18-C-J-1 GARDEN OAK/);
  assert.ok(!text.includes("Kitchen island"), "unassigned regions are left out");
  assert.match(text, /Name: Awais\n/);
  assert.match(text, /Design: https:\/\/s\.test\/\?design=abc/);
  const url = new URL(whatsAppLink(text));
  assert.equal(url.origin + url.pathname, "https://wa.me/97477657373");
  assert.equal(url.searchParams.get("text"), text, "text survives encoding, including & ? and line breaks");
});

test("WhatsApp: reference included when the enquiry was already sent", () => {
  assert.match(buildWhatsAppText({ rows, layoutName: "L", shareUrl: "u", reference: "ENQ-1" }), /Reference: ENQ-1/);
});
