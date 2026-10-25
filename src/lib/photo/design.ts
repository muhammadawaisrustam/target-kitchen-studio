/**
 * Saved photo designs. Stored only in this browser (IndexedDB, see designStore.ts). The record
 * keeps everything needed to reopen and keep editing: the photo (if the user chose to keep it),
 * the preview, the selections and the panel codes per region.
 */
import { z } from "zod";
import { newId } from "@/lib/designs/model";
import { SerializedDocSchema, assignedRegions, serializeDoc, type PhotoDoc } from "./state";
import { PHOTO_REGION_IDS } from "./regions";

export const PhotoPanelSchema = z.object({
  region: z.enum(PHOTO_REGION_IDS),
  regionLabel: z.string().max(60),
  panelCode: z.string().trim().min(1).max(40),
  productName: z.string().max(120).optional(),
});
export type PhotoPanel = z.infer<typeof PhotoPanelSchema>;

/** Everything except the image blobs, validated when read back. */
export const PhotoDesignMetaSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  notes: z.string().max(2000).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** True when the uploaded photo (resized for processing) is kept so the design can be edited again. */
  keepsOriginal: z.boolean(),
  sourceFileName: z.string().max(200).optional(),
  panels: z.array(PhotoPanelSchema).max(PHOTO_REGION_IDS.length),
  state: SerializedDocSchema,
});
export type PhotoDesignMeta = z.infer<typeof PhotoDesignMetaSchema>;

export interface PhotoDesignRecord extends PhotoDesignMeta {
  original?: Blob;
  preview: Blob;
}

export function describePanels(doc: PhotoDoc, productNames: Record<string, string | undefined>): PhotoPanel[] {
  return assignedRegions(doc).map((r) => ({ ...r, productName: productNames[r.panelCode] }));
}

export function createPhotoDesignMeta(
  input: { name: string; notes?: string; keepsOriginal: boolean; sourceFileName?: string; doc: PhotoDoc; productNames: Record<string, string | undefined>; id?: string; createdAt?: string },
  now = new Date().toISOString(),
): PhotoDesignMeta {
  const name = input.name.trim();
  if (!name) throw new Error("Please give the design a name.");
  return PhotoDesignMetaSchema.parse({
    version: 1,
    id: input.id ?? newId("pd"),
    name: name.slice(0, 80),
    notes: input.notes?.trim() ? input.notes.trim().slice(0, 2000) : undefined,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    width: input.doc.width,
    height: input.doc.height,
    keepsOriginal: input.keepsOriginal,
    sourceFileName: input.sourceFileName?.slice(0, 200),
    panels: describePanels(input.doc, input.productNames),
    state: serializeDoc(input.doc),
  });
}

/** Validates a record read from storage. Returns null when damaged, so it is skipped rather than guessed. */
export function parsePhotoDesign(raw: unknown): PhotoDesignRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const meta = PhotoDesignMetaSchema.safeParse(r);
  if (!meta.success) return null;
  const isBlob = (v: unknown): v is Blob => typeof Blob !== "undefined" && v instanceof Blob;
  if (!isBlob(r.preview)) return null;
  if (meta.data.keepsOriginal && !isBlob(r.original)) return null;
  return { ...meta.data, preview: r.preview, original: meta.data.keepsOriginal ? (r.original as Blob) : undefined };
}

/** Plain-text summary for copying or the export caption. */
export function panelsToText(panels: PhotoPanel[]): string {
  return panels.map((p) => `${p.regionLabel}: ${p.panelCode}${p.productName ? ` ${p.productName}` : ""}`).join("\n");
}
