import { z } from "zod";

/**
 * Product data model for decorative panels.
 *
 * Optional fields stay optional: the importer never fills in specifications that the
 * source data does not supply. `isDemo` marks synthetic demonstration records so the UI
 * can label them and they can never be confused with genuine Target stock.
 */

export const SUPPORTED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

/** Site-relative ("/demo-assets/x.jpg") or absolute https URL to a supported image format. */
export const AssetUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((v) => v.startsWith("/") || v.startsWith("https://"), {
    message: "must be a site-relative path starting with / or an https:// URL",
  })
  .refine((v) => !v.includes(".."), { message: "must not contain '..'" })
  .refine(
    (v) => {
      const clean = v.split(/[?#]/)[0] ?? "";
      const ext = clean.slice(clean.lastIndexOf(".") + 1).toLowerCase();
      return (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
    },
    { message: `unsupported file format (use ${SUPPORTED_IMAGE_EXTENSIONS.join(", ")})` },
  );

export const GrainDirectionSchema = z.enum(["vertical", "horizontal", "none"]);
export type GrainDirection = z.infer<typeof GrainDirectionSchema>;

export const StockStatusSchema = z.enum(["in_stock", "low_stock", "out_of_stock", "made_to_order"]);

const dimension = (max: number) => z.number().positive().max(max);

export const ProductSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "may only contain letters, numbers, '.', '_' and '-'"),
  panelCode: z.string().trim().min(1, "panel code is required").max(40),
  productName: z.string().trim().min(1, "product name is required").max(120),
  category: z.string().trim().min(1).max(60),
  colourFamily: z.string().trim().min(1).max(40),
  finish: z.string().trim().min(1).max(60),
  brand: z.string().trim().min(1).max(60).optional(),
  thicknessMm: dimension(200).optional(),
  widthMm: dimension(10000).optional(),
  heightMm: dimension(10000).optional(),
  textureUrl: AssetUrlSchema.optional(),
  thumbnailUrl: AssetUrlSchema.optional(),
  /** Plain colour used for unicolour panels that have no texture image. */
  colourHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "must be a #RRGGBB colour")
    .optional(),
  /** Real-world size, in metres, covered by one repeat of the texture image. */
  textureScale: z.number().positive().max(10).optional(),
  /** Extra rotation of the texture in degrees, applied after grain direction. */
  textureRotation: z.number().min(-360).max(360).optional(),
  grainDirection: GrainDirectionSchema.optional(),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  /** Only populate from a reliable live stock source. */
  stockStatus: StockStatusSchema.optional(),
  isActive: z.boolean(),
  isPublished: z.boolean(),
  isDemo: z.boolean().default(false),
  notes: z.string().max(500).optional(),
  updatedAt: z.string().optional(),
  /** Core board, e.g. "Particleboard" or "MDF", as stated by the supplier. */
  board: z.string().trim().min(1).max(60).optional(),
  madeIn: z.string().trim().min(1).max(60).optional(),
  /** Supplier decor number shared by every sheet size of the same decor (e.g. "1-493"). */
  decorCode: z.string().trim().min(1).max(40).optional(),
  /** "swatch-estimate" when the colour group was computed from the swatch, not supplied. */
  colourFamilySource: z.enum(["supplied", "swatch-estimate"]).optional(),
  /** Where the record came from, so every fact can be traced back. */
  sourceDocument: z.string().max(200).optional(),
  sourcePage: z.number().int().positive().optional(),
});

export type Product = z.infer<typeof ProductSchema>;
export type ProductInput = z.input<typeof ProductSchema>;

/** Fields an importer may supply, in the order used for CSV templates. */
export const PRODUCT_FIELDS = [
  "id",
  "panelCode",
  "productName",
  "category",
  "colourFamily",
  "finish",
  "brand",
  "thicknessMm",
  "widthMm",
  "heightMm",
  "textureUrl",
  "thumbnailUrl",
  "colourHex",
  "textureScale",
  "textureRotation",
  "grainDirection",
  "roughness",
  "metalness",
  "stockStatus",
  "isActive",
  "isPublished",
  "isDemo",
  "notes",
  "board",
  "madeIn",
  "decorCode",
  "colourFamilySource",
  "sourceDocument",
  "sourcePage",
] as const satisfies readonly (keyof Product)[];

export const NUMERIC_FIELDS = new Set<string>([
  "thicknessMm",
  "widthMm",
  "heightMm",
  "textureScale",
  "textureRotation",
  "roughness",
  "metalness",
  "sourcePage",
]);
export const BOOLEAN_FIELDS = new Set<string>(["isActive", "isPublished", "isDemo"]);

/** Normalised key used for duplicate detection and lookups (codes are case-insensitive). */
export const codeKey = (code: string) => code.trim().toUpperCase();
