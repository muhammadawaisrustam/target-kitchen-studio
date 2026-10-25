import crypto from "node:crypto";
import type { Product } from "@/lib/catalogue/schema";
import { codeKey } from "@/lib/catalogue/schema";
import { getModel } from "@/lib/models/registry";
import { REGION_IDS, REGION_LABELS } from "@/lib/models/regions";
import type { Enquiry, EnquiryInput } from "@/lib/enquiries/schema";
import { decodeShareToken, encodeShareToken, SHARE_PARAM } from "@/lib/designs/share";
import { PHOTO_REGION_IDS, PHOTO_REGION_LABELS } from "@/lib/photo/regions";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function newReference(now = new Date()): string {
  const bytes = crypto.randomBytes(6);
  const tail = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `ENQ-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${tail}`;
}

/** Keeps only the design token from a share link, and only if it decodes to a valid design. */
export function shareTokenFrom(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const token = new URL(url).searchParams.get(SHARE_PARAM);
    return token && decodeShareToken(token) ? token : undefined;
  } catch {
    return undefined;
  }
}

export class EnquiryRejectedError extends Error {
  constructor(message: string, readonly field = "design") {
    super(message);
  }
}

/**
 * Builds the stored enquiry. Panel details come from the server's catalogue, never from the
 * browser, and an Item ID that is not in the catalogue is rejected rather than stored as-is.
 */
export function buildEnquiry(input: EnquiryInput, products: Product[], now = new Date()): Enquiry {
  if (input.photo) return buildPhotoEnquiry(input, products, now);
  if (!input.design) throw new EnquiryRejectedError("Choose at least one panel before requesting a quote.");
  const design = input.design;
  const model = getModel(design.modelId);
  if (!model) throw new EnquiryRejectedError("The kitchen layout in this design is not known.");
  const byCode = new Map(products.map((p) => [codeKey(p.panelCode), p]));
  const items = REGION_IDS.flatMap((region) => {
    const code = design.selections[region];
    if (!code) return [];
    const p = byCode.get(codeKey(code));
    if (!p) throw new EnquiryRejectedError(`Panel ${code} is not in the current catalogue. Choose another panel for ${REGION_LABELS[region]}.`);
    return [{ region, regionLabel: REGION_LABELS[region], panelCode: p.panelCode, productName: p.productName, brand: p.brand, board: p.board, finish: p.finish, isDemo: p.isDemo }];
  });
  // The stored link is rebuilt from the checked panel codes, so "open design" in the admin always shows
  // exactly the panels listed in the enquiry. Only the camera is taken from the visitor's link.
  const camera = design.shareUrl ? decodeShareToken(shareTokenFrom(design.shareUrl))?.camera : undefined;
  const shareToken = encodeShareToken({
    modelId: model.id,
    selections: Object.fromEntries(items.map((i) => [i.region, i.panelCode])),
    camera,
    designName: design.designName,
    variantName: design.variantName,
  });
  const iso = now.toISOString();
  return {
    id: crypto.randomUUID(),
    reference: newReference(now),
    createdAt: iso,
    updatedAt: iso,
    status: "new",
    contact: { name: input.name, phone: input.phone, email: input.email, company: input.company, location: input.location, preferredContact: input.preferredContact },
    message: input.message,
    design: { modelId: model.id, modelName: model.name, designName: design.designName, variantName: design.variantName, shareToken, items },
    containsDemoPanels: items.some((i) => i.isDemo),
    source: "3d",
  };
}

export const PHOTO_MODEL_ID = "photo";
export const PHOTO_MODEL_NAME = "My Kitchen Photo";

/**
 * Builds an enquiry for a design made on the customer's own photo. As with 3D designs, every
 * panel code is checked against the server's catalogue. The photo itself is never part of the
 * record; an attached preview is stored separately (see previewStore.ts).
 */
function buildPhotoEnquiry(input: EnquiryInput, products: Product[], now: Date): Enquiry {
  const photo = input.photo!;
  const byCode = new Map(products.map((p) => [codeKey(p.panelCode), p]));
  const wanted = new Map(photo.regions.map((r) => [r.region, r.panelCode]));
  const items = PHOTO_REGION_IDS.flatMap((region) => {
    const code = wanted.get(region);
    if (!code) return [];
    const p = byCode.get(codeKey(code));
    if (!p) throw new EnquiryRejectedError(`Panel ${code} is not in the current catalogue. Choose another panel for ${PHOTO_REGION_LABELS[region]}.`);
    return [{ region, regionLabel: PHOTO_REGION_LABELS[region], panelCode: p.panelCode, productName: p.productName, brand: p.brand, board: p.board, finish: p.finish, isDemo: p.isDemo }];
  });
  const iso = now.toISOString();
  return {
    id: crypto.randomUUID(),
    reference: newReference(now),
    createdAt: iso,
    updatedAt: iso,
    status: "new",
    contact: { name: input.name, phone: input.phone, email: input.email, company: input.company, location: input.location, preferredContact: input.preferredContact },
    message: input.message,
    design: { modelId: PHOTO_MODEL_ID, modelName: PHOTO_MODEL_NAME, designName: photo.designName, items },
    containsDemoPanels: items.some((i) => i.isDemo),
    source: "photo",
    photo: { designId: photo.designId },
  };
}

/** Decodes and checks an attached preview. Throws EnquiryRejectedError if it is not a real JPEG. */
export function decodePreview(dataUrl: string | undefined): Buffer | undefined {
  if (!dataUrl) return undefined;
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (bytes.length < 100 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new EnquiryRejectedError("The preview image could not be read. Try again, or send the enquiry without it.");
  return bytes;
}
