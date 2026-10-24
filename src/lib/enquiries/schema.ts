import { z } from "zod";
import { REGION_IDS } from "@/lib/models/regions";

/** What the quotation form sends. Validated again on the server; the browser check is only a convenience. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,19}$/;

export const EnquiryInputSchema = z
  .object({
    name: z.string().trim().min(2, "Please enter your name.").max(100),
    phone: optionalText(25).refine((v) => !v || PHONE_PATTERN.test(v), "Please enter a valid phone number, e.g. +974 5555 1234."),
    email: optionalText(150).refine((v) => !v || z.email().safeParse(v).success, "Please enter a valid email address."),
    company: optionalText(100),
    location: optionalText(100),
    preferredContact: z.enum(["phone", "whatsapp", "email"]).optional(),
    message: optionalText(2000),
    consent: z.literal(true, { error: "Please confirm we may contact you about this enquiry." }),
    /** Hidden field: people leave it empty, simple bots fill it in. */
    website: z.string().max(200).optional(),
    design: z.object({
      modelId: z.string().min(1).max(60),
      designName: optionalText(80),
      variantName: optionalText(60),
      shareUrl: optionalText(3500).refine((v) => !v || /^https?:\/\//.test(v), "invalid link"),
      selections: z
        .partialRecord(z.enum(REGION_IDS), z.string().trim().min(1).max(40))
        .refine((s) => Object.keys(s).length > 0, "Choose at least one panel before requesting a quote."),
    }),
  })
  .superRefine((v, ctx) => {
    if (!v.phone && !v.email) ctx.addIssue({ code: "custom", path: ["phone"], message: "Please give a phone number or an email address." });
    if (v.preferredContact === "email" && !v.email) ctx.addIssue({ code: "custom", path: ["email"], message: "Please add an email address, or choose another way to contact you." });
    if ((v.preferredContact === "phone" || v.preferredContact === "whatsapp") && !v.phone)
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Please add a phone number, or choose another way to contact you." });
  });
export type EnquiryInput = z.infer<typeof EnquiryInputSchema>;

export const ENQUIRY_STATUSES = ["new", "contacted", "quoted", "closed"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export interface EnquiryItem {
  region: string;
  regionLabel: string;
  panelCode: string;
  productName: string;
  brand?: string;
  board?: string;
  finish?: string;
  isDemo: boolean;
}

/** What is stored. Panel details are looked up on the server from the catalogue at submission time. */
export interface Enquiry {
  id: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
  status: EnquiryStatus;
  adminNote?: string;
  contact: { name: string; phone?: string; email?: string; company?: string; location?: string; preferredContact?: string };
  message?: string;
  /** shareToken reopens the design: /?design=<shareToken>. Only a valid token is kept, never a free-form URL. */
  design: { modelId: string; modelName: string; designName?: string; variantName?: string; shareToken?: string; items: EnquiryItem[] };
  containsDemoPanels: boolean;
}

export const EnquiryUpdateSchema = z
  .object({ status: z.enum(ENQUIRY_STATUSES).optional(), adminNote: z.string().trim().max(2000).optional() })
  .refine((v) => v.status !== undefined || v.adminNote !== undefined, "Nothing to update.");
export type EnquiryUpdate = z.infer<typeof EnquiryUpdateSchema>;

/** Flattens zod issues into { field: message } for the form. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] === "design" ? "design" : String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
