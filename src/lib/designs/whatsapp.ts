import type { SummaryRow } from "./summary";

/**
 * Target's WhatsApp number in international format, digits only (wa.me needs no "+").
 * It is a public contact number, not a secret. NEXT_PUBLIC_WHATSAPP_NUMBER overrides it at build time.
 */
export const WHATSAPP_NUMBER = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "97477657373").replace(/\D/g, "");

export interface WhatsAppQuote {
  rows: SummaryRow[];
  layoutName: string;
  designName?: string;
  variantName?: string;
  shareUrl: string;
  name?: string;
  location?: string;
  notes?: string;
  reference?: string;
}

/** The ready-to-send message: kitchen, every chosen panel code, the design link and the customer's notes. */
export function buildWhatsAppText(q: WhatsAppQuote): string {
  const chosen = q.rows.filter((r) => r.panelCode);
  const title = [q.designName || "My kitchen", q.variantName, q.layoutName].filter(Boolean).join(" · ");
  return [
    "Hello Target, I would like a quotation for this kitchen.",
    ...(q.reference ? [`Reference: ${q.reference}`] : []),
    ...(q.name?.trim() ? [`Name: ${q.name.trim()}`] : []),
    ...(q.location?.trim() ? [`Area: ${q.location.trim()}`] : []),
    "",
    `Kitchen: ${title}`,
    ...chosen.map((r) => `- ${r.regionLabel}: ${r.panelCode}${r.productName ? ` ${r.productName}` : ""}${r.isDemo ? " (DEMO)" : ""}`),
    "",
    `Design: ${q.shareUrl}`,
    ...(q.notes?.trim() ? ["", `Notes: ${q.notes.trim()}`] : []),
  ].join("\n");
}

export function whatsAppLink(text: string, number = WHATSAPP_NUMBER): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
