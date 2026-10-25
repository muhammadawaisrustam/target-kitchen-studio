import type { SummaryRow } from "@/lib/designs/summary";

/** Sales team WhatsApp number, digits only with country code (Qatar). */
export const WHATSAPP_NUMBER = "97477657373";

export interface WhatsAppEnquiry {
  rows: SummaryRow[];
  layoutName: string;
  designName?: string;
  variantName?: string;
  shareUrl?: string;
  /** Set when the enquiry was already saved on the server. */
  reference?: string;
  name?: string;
  location?: string;
  message?: string;
}

/** Plain-text message listing the design and panel codes, ready for WhatsApp. */
export function buildWhatsAppMessage(e: WhatsAppEnquiry): string {
  const lines = ["Hello Target Kitchen Studio, I would like a quotation for this kitchen."];
  if (e.reference) lines.push(`Reference: ${e.reference}`);
  if (e.name?.trim()) lines.push(`Name: ${e.name.trim()}`);
  if (e.location?.trim()) lines.push(`Area: ${e.location.trim()}`);
  const design = [e.designName ?? "My kitchen", e.variantName, e.layoutName].filter(Boolean).join(" · ");
  lines.push("", `Design: ${design}`);
  for (const r of e.rows) {
    if (!r.panelCode) continue;
    lines.push(`- ${r.regionLabel}: ${r.panelCode}${r.productName ? ` ${r.productName}` : ""}${r.isDemo ? " (DEMO)" : ""}`);
  }
  if (e.message?.trim()) lines.push("", `Notes: ${e.message.trim()}`);
  if (e.shareUrl) lines.push("", `View the design: ${e.shareUrl}`);
  return lines.join("\n");
}

export function whatsAppUrl(e: WhatsAppEnquiry, number = WHATSAPP_NUMBER): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(buildWhatsAppMessage(e))}`;
}
