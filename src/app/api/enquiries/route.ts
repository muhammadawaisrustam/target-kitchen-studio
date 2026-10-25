import { NextResponse } from "next/server";
import { EnquiryInputSchema, fieldErrors } from "@/lib/enquiries/schema";
import { loadCatalogue } from "@/lib/server/catalogueRepository";
import { getEnquiryStore } from "@/lib/server/enquiryStore";
import { getMailer } from "@/lib/server/mailer";
import { submitEnquiry } from "@/lib/server/submitEnquiry";
import { buildEnquiry, EnquiryRejectedError } from "@/lib/server/enquiries";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/enquiries: stores a quotation request.
 * Responds 201 with the reference only after the enquiry was confirmed saved, emailed, or both.
 */
export async function POST(request: Request) {
  const limited = rateLimit(`enquiry:${clientIp(request)}`, 5, 10 * 60_000);
  if (!limited.ok)
    return NextResponse.json({ error: `Too many requests. Please try again in ${Math.ceil(limited.retryAfterSec / 60)} minute(s).` }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } });

  const text = await request.text();
  if (text.length > 20_000) return NextResponse.json({ error: "The request is too large." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "The request could not be read." }, { status: 400 });
  }
  const parsed = EnquiryInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Please check the highlighted fields.", fields: fieldErrors(parsed.error) }, { status: 422 });
  // Hidden field filled in: treat as spam, store nothing, and do not claim success.
  if (parsed.data.website) return NextResponse.json({ error: "The enquiry could not be accepted." }, { status: 400 });

  try {
    const { products } = await loadCatalogue();
    const enquiry = buildEnquiry(parsed.data, products);
    const origin = new URL(request.url).origin;
    const result = await submitEnquiry(enquiry, getEnquiryStore(), getMailer(), origin);
    if (result.problems.length) console.error(`[enquiries] ${enquiry.reference}:`, result.problems.join(" | "));
    if (!result.stored && !result.emailed)
      return NextResponse.json({ error: "Your enquiry could not be sent right now. Please try again later or contact us directly." }, { status: 503 });
    return NextResponse.json({ reference: enquiry.reference, createdAt: enquiry.createdAt }, { status: 201 });
  } catch (err) {
    if (err instanceof EnquiryRejectedError) return NextResponse.json({ error: err.message, fields: { design: err.message } }, { status: 422 });
    console.error("[enquiries] unexpected error", err);
    return NextResponse.json({ error: "Something went wrong, so your enquiry was not sent. Please try again." }, { status: 500 });
  }
}
