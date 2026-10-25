import { NextResponse } from "next/server";
import { EnquiryInputSchema, fieldErrors, MAX_PREVIEW_DATA_URL } from "@/lib/enquiries/schema";
import { loadCatalogue } from "@/lib/server/catalogueRepository";
import { getEnquiryStore, StorageUnavailableError } from "@/lib/server/enquiryStore";
import { buildEnquiry, decodePreview, EnquiryRejectedError } from "@/lib/server/enquiries";
import { getPreviewStore } from "@/lib/server/previewStore";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/enquiries: stores a quotation request.
 * Responds 201 with the reference only after the store has confirmed the record was saved.
 */
export async function POST(request: Request) {
  const limited = rateLimit(`enquiry:${clientIp(request)}`, 5, 10 * 60_000);
  if (!limited.ok)
    return NextResponse.json({ error: `Too many requests. Please try again in ${Math.ceil(limited.retryAfterSec / 60)} minute(s).` }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } });

  const text = await request.text();
  // Plain enquiries are small. Only a photo enquiry with an attached preview image may be larger.
  if (text.length > MAX_PREVIEW_DATA_URL + 20_000) return NextResponse.json({ error: "The request is too large." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "The request could not be read." }, { status: 400 });
  }
  const parsed = EnquiryInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Please check the highlighted fields.", fields: fieldErrors(parsed.error) }, { status: 422 });
  if (text.length > 20_000 && !parsed.data.photo?.previewJpeg) return NextResponse.json({ error: "The request is too large." }, { status: 413 });
  // Hidden field filled in: treat as spam, store nothing, and do not claim success.
  if (parsed.data.website) return NextResponse.json({ error: "The enquiry could not be accepted." }, { status: 400 });

  try {
    const { products } = await loadCatalogue();
    const enquiry = buildEnquiry(parsed.data, products);
    const preview = decodePreview(parsed.data.photo?.previewJpeg);
    // The preview is stored first; if that fails nothing is saved and the visitor is told.
    if (preview) {
      await getPreviewStore().save(enquiry.id, preview);
      enquiry.photo = { ...enquiry.photo, preview: { contentType: "image/jpeg", bytes: preview.length } };
    }
    let saved;
    try {
      saved = await getEnquiryStore().create(enquiry);
    } catch (err) {
      if (preview) await getPreviewStore().remove(enquiry.id);
      throw err;
    }
    return NextResponse.json({ reference: saved.reference, createdAt: saved.createdAt, previewStored: !!preview }, { status: 201 });
  } catch (err) {
    if (err instanceof EnquiryRejectedError) return NextResponse.json({ error: err.message, fields: { design: err.message } }, { status: 422 });
    if (err instanceof StorageUnavailableError) {
      console.error("[enquiries] storage failed", err.message, err.cause);
      return NextResponse.json({ error: "Your enquiry could not be saved right now, so it was not sent. Please try again later or contact us directly." }, { status: 503 });
    }
    console.error("[enquiries] unexpected error", err);
    return NextResponse.json({ error: "Something went wrong, so your enquiry was not sent. Please try again." }, { status: 500 });
  }
}
