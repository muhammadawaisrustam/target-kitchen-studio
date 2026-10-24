import crypto from "node:crypto";
import type { Product } from "@/lib/catalogue/schema";
import { codeKey } from "@/lib/catalogue/schema";
import { getModel } from "@/lib/models/registry";
import { REGION_IDS, REGION_LABELS } from "@/lib/models/regions";
import type { Enquiry, EnquiryInput } from "@/lib/enquiries/schema";
import { decodeShareToken, SHARE_PARAM } from "@/lib/designs/share";

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
  const model = getModel(input.design.modelId);
  if (!model) throw new EnquiryRejectedError("The kitchen layout in this design is not known.");
  const byCode = new Map(products.map((p) => [codeKey(p.panelCode), p]));
  const items = REGION_IDS.flatMap((region) => {
    const code = input.design.selections[region];
    if (!code) return [];
    const p = byCode.get(codeKey(code));
    if (!p) throw new EnquiryRejectedError(`Panel ${code} is not in the current catalogue. Choose another panel for ${REGION_LABELS[region]}.`);
    return [{ region, regionLabel: REGION_LABELS[region], panelCode: p.panelCode, productName: p.productName, brand: p.brand, board: p.board, finish: p.finish, isDemo: p.isDemo }];
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
    design: { modelId: model.id, modelName: model.name, designName: input.design.designName, variantName: input.design.variantName, shareToken: shareTokenFrom(input.design.shareUrl), items },
    containsDemoPanels: items.some((i) => i.isDemo),
  };
}
