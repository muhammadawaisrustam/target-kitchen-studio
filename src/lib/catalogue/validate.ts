import { BOOLEAN_FIELDS, NUMERIC_FIELDS, PRODUCT_FIELDS, ProductSchema, codeKey, type Product } from "./schema";
import { parseCsv } from "./csv";

export interface ValidationIssue {
  /** 1-based record number in the source file (for CSV: data row, excluding the header). */
  row: number;
  panelCode?: string;
  field?: string;
  message: string;
}

export interface ValidationReport {
  valid: Product[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  totalRecords: number;
}

const MAX_RECORDS = 20_000;

/**
 * Validates raw catalogue records.
 * - Rejects records that fail the schema (missing codes, bad URLs, unsupported formats...).
 * - Rejects duplicate panel codes and duplicate ids (within the file and against `existing`).
 * - Warns about records with no way to preview the finish (no texture and no colour).
 * Records with errors are excluded from `valid`; nothing is silently repaired.
 */
export function validateCatalogueRecords(
  records: unknown[],
  options: { existing?: Product[]; allowUpdateOfExisting?: boolean } = {},
): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const valid: Product[] = [];
  if (records.length > MAX_RECORDS) {
    return {
      valid,
      errors: [{ row: 0, message: `File has ${records.length} records; the limit per import is ${MAX_RECORDS}.` }],
      warnings,
      totalRecords: records.length,
    };
  }

  const existingByCode = new Map((options.existing ?? []).map((p) => [codeKey(p.panelCode), p]));
  const seenCodes = new Map<string, number>();
  const seenIds = new Map<string, number>();

  records.forEach((raw, index) => {
    const row = index + 1;
    const rawCode =
      raw && typeof raw === "object" && "panelCode" in raw ? String((raw as { panelCode: unknown }).panelCode ?? "") : "";
    const parsed = ProductSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          row,
          panelCode: rawCode || undefined,
          field: issue.path.join(".") || undefined,
          // "Invalid input: expected string, received undefined" means the column is missing or empty.
          message:
            issue.code === "invalid_type" && /received undefined/.test(issue.message)
              ? `${issue.path.join(".") || "field"} is required but missing or empty (see the CSV template columns)`
              : issue.message,
        });
      }
      return;
    }
    const p = parsed.data;
    const key = codeKey(p.panelCode);

    const dupRow = seenCodes.get(key);
    if (dupRow !== undefined) {
      errors.push({ row, panelCode: p.panelCode, field: "panelCode", message: `duplicate panel code (also on record ${dupRow})` });
      return;
    }
    const dupIdRow = seenIds.get(p.id);
    if (dupIdRow !== undefined) {
      errors.push({ row, panelCode: p.panelCode, field: "id", message: `duplicate id (also on record ${dupIdRow})` });
      return;
    }
    const existing = existingByCode.get(key);
    if (existing && existing.id !== p.id) {
      errors.push({
        row,
        panelCode: p.panelCode,
        field: "panelCode",
        message: `panel code already belongs to product id "${existing.id}"`,
      });
      return;
    }
    if (existing && !options.allowUpdateOfExisting) {
      errors.push({ row, panelCode: p.panelCode, field: "panelCode", message: "product already exists (enable update mode to overwrite)" });
      return;
    }
    seenCodes.set(key, row);
    seenIds.set(p.id, row);

    if (!p.textureUrl && !p.colourHex) {
      warnings.push({ row, panelCode: p.panelCode, message: "no textureUrl or colourHex: the 3D preview will show a 'no texture' placeholder" });
    }
    if (p.textureUrl && p.textureScale === undefined) {
      warnings.push({ row, panelCode: p.panelCode, field: "textureScale", message: "textureScale missing: preview assumes 1 m per texture repeat" });
    }
    if (p.textureUrl && p.grainDirection === undefined) {
      warnings.push({ row, panelCode: p.panelCode, field: "grainDirection", message: "grainDirection missing: preview assumes no grain direction" });
    }
    if (!p.thumbnailUrl) {
      warnings.push({ row, panelCode: p.panelCode, field: "thumbnailUrl", message: "no thumbnail: catalogue card will show a text swatch" });
    }
    valid.push(p);
  });

  return { valid, errors, warnings, totalRecords: records.length };
}

/** Converts CSV text (with a header row of field names) into raw records with typed values. */
export function csvToRecords(text: string): { records: Record<string, unknown>[]; unknownColumns: string[] } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { records: [], unknownColumns: [] };
  const header = rows[0]!.map((h) => h.trim());
  const known = new Set<string>(PRODUCT_FIELDS);
  const unknownColumns = header.filter((h) => h && !known.has(h));
  const records = rows.slice(1).map((cells) => {
    const rec: Record<string, unknown> = {};
    header.forEach((col, i) => {
      if (!known.has(col)) return;
      const value = (cells[i] ?? "").trim();
      if (value === "") return; // empty cell = field not supplied (stays optional)
      if (NUMERIC_FIELDS.has(col)) {
        const n = Number(value);
        rec[col] = Number.isFinite(n) ? n : value; // keep invalid text so validation reports it
      } else if (BOOLEAN_FIELDS.has(col)) {
        const v = value.toLowerCase();
        rec[col] = ["true", "yes", "1", "y"].includes(v) ? true : ["false", "no", "0", "n"].includes(v) ? false : value;
      } else rec[col] = value;
    });
    return rec;
  });
  return { records, unknownColumns };
}

/** Parses an import file (JSON array, JSON {products: []}, or CSV) into raw records. */
export function parseImportFile(fileName: string, text: string): { records: unknown[]; unknownColumns: string[] } {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) {
    const data: unknown = JSON.parse(text);
    const list = Array.isArray(data) ? data : (data as { products?: unknown }).products;
    if (!Array.isArray(list)) throw new Error("JSON must be an array of products or an object with a 'products' array");
    return { records: list, unknownColumns: [] };
  }
  if (lower.endsWith(".csv")) return csvToRecords(text);
  throw new Error("Unsupported import file: use .csv or .json");
}
