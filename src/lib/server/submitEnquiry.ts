import type { Enquiry } from "@/lib/enquiries/schema";
import type { EnquiryStore } from "./enquiryStore";
import type { Mailer } from "./mailer";

export interface SubmitResult {
  stored: boolean;
  emailed: boolean;
  /** Why each channel failed, for the server log. Never shown to visitors. */
  problems: string[];
}

/**
 * Saves the enquiry and emails it. It counts as received when at least one of them is confirmed:
 * the store wrote it, or the email service accepted the message. On hosts with no writable disk
 * (Netlify, Vercel) the email alone is the record, so email must be set up there.
 */
export async function submitEnquiry(enquiry: Enquiry, store: EnquiryStore, mailer: Mailer | null, siteOrigin: string): Promise<SubmitResult> {
  const problems: string[] = [];
  const [s, m] = await Promise.allSettled([store.create(enquiry), mailer ? mailer.send(enquiry, siteOrigin) : Promise.reject(new Error("no email settings"))]);
  if (s.status === "rejected") problems.push(`store (${store.kind}): ${(s.reason as Error)?.message ?? s.reason}`);
  if (m.status === "rejected") problems.push(`email (${mailer?.kind ?? "not configured"}): ${(m.reason as Error)?.message ?? m.reason}`);
  return { stored: s.status === "fulfilled", emailed: m.status === "fulfilled", problems };
}
