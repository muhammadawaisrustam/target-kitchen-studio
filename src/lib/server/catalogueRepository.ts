import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { Product } from "@/lib/catalogue/schema";
import { validateCatalogueRecords, type ValidationReport } from "@/lib/catalogue/validate";

/**
 * File-backed catalogue for demo mode. The file is chosen by CATALOGUE_FILE (relative to the
 * project root) and defaults to the DEMO catalogue. Records failing validation are excluded and
 * reported in the server log; they are never silently "fixed".
 */
let cache: { file: string; mtimeMs: number; products: Product[]; report: ValidationReport } | null = null;

export function catalogueFilePath() {
  return path.resolve(process.cwd(), process.env.CATALOGUE_FILE || "data/demo-catalogue.json");
}

export async function loadCatalogue(): Promise<{ products: Product[]; report: ValidationReport }> {
  const file = catalogueFilePath();
  const stat = await fs.stat(file);
  if (cache && cache.file === file && cache.mtimeMs === stat.mtimeMs) return cache;
  const raw = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  const records = Array.isArray(raw) ? raw : ((raw as { products?: unknown[] }).products ?? []);
  const report = validateCatalogueRecords(records);
  if (report.errors.length) console.warn(`[catalogue] ${report.errors.length} invalid record(s) excluded`, report.errors.slice(0, 10));
  cache = { file, mtimeMs: stat.mtimeMs, products: report.valid, report };
  return cache;
}
