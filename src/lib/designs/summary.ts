import type { Product } from "@/lib/catalogue/schema";
import { toSpreadsheetCsv } from "@/lib/catalogue/csv";
import { REGION_LABELS, type RegionId } from "@/lib/models/regions";
import type { Selections } from "./model";

export interface SummaryRow {
  region: RegionId;
  regionLabel: string;
  panelCode: string | null;
  productName?: string;
  brand?: string;
  board?: string;
  finish?: string;
  thicknessMm?: number;
  sheet?: string;
  isDemo?: boolean;
}

/** One row per region of the layout, in layout order. Unknown details stay empty. */
export function buildSummary(regions: readonly RegionId[], selections: Selections, products: Record<string, Product>): SummaryRow[] {
  return regions.map((region) => {
    const code = selections[region] ?? null;
    const p = code ? products[code] : undefined;
    return {
      region,
      regionLabel: REGION_LABELS[region],
      panelCode: code,
      productName: p?.productName,
      brand: p?.brand,
      board: p?.board,
      finish: p?.finish,
      thicknessMm: p?.thicknessMm,
      sheet: p?.widthMm && p?.heightMm ? `${p.widthMm} × ${p.heightMm} mm` : undefined,
      isDemo: p?.isDemo,
    };
  });
}

export function summaryToCsv(rows: SummaryRow[], meta: { designName?: string; variantName?: string; layout: string; shareUrl?: string }): string {
  const header = ["Region", "Item ID", "Decor name", "Brand", "Board", "Finish", "Thickness (mm)", "Sheet size"];
  const body = rows.map((r) => [r.regionLabel, r.panelCode ?? "Not selected", r.productName ?? "", r.brand ?? "", r.board ?? "", r.finish ?? "", r.thicknessMm?.toString() ?? "", r.sheet ?? ""]);
  const info = [
    ["Design", meta.designName ?? "Unsaved design"],
    ["Variant", meta.variantName ?? ""],
    ["Layout", meta.layout],
    ...(meta.shareUrl ? [["Link", meta.shareUrl]] : []),
    [],
  ];
  return toSpreadsheetCsv([...info, header, ...body]);
}

export function summaryToText(rows: SummaryRow[], meta: { designName?: string; variantName?: string; layout: string; shareUrl?: string }): string {
  const lines = [`${meta.designName ?? "Unsaved design"}${meta.variantName ? ` (${meta.variantName})` : ""}`, `Layout: ${meta.layout}`, ""];
  for (const r of rows) lines.push(`${r.regionLabel}: ${r.panelCode ? `${r.panelCode}${r.productName ? ` ${r.productName}` : ""}${r.brand ? ` (${r.brand})` : ""}` : "not selected"}`);
  if (meta.shareUrl) lines.push("", meta.shareUrl);
  return lines.join("\n");
}
