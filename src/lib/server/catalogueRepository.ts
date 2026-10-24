import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { Product } from "@/lib/catalogue/schema";
import { validateCatalogueRecords, type ValidationReport } from "@/lib/catalogue/validate";

/**
 * File-backed catalogue.
 *
 * Sources, in order of precedence:
 *   1. CATALOGUE_FILE: one path or a comma-separated list (relative to the project root);
 *   2. every brand file in data/brands/*.json (written by scripts/import-brand-pdf.mjs);
 *   3. the DEMO catalogue, only when no real brand file exists.
 * All files are merged and validated together, so a panel code used by two brands is rejected.
 */
type Cache = { key: string; products: Product[]; report: ValidationReport; files: string[]; isDemo: boolean };
let cache: Cache | null = null;

async function sourceFiles(): Promise<string[]> {
  const root = process.cwd();
  if (process.env.CATALOGUE_FILE) {
    return process.env.CATALOGUE_FILE.split(",").map((f) => path.resolve(root, f.trim())).filter(Boolean);
  }
  const brandDir = path.join(root, "data/brands");
  const brandFiles = await fs.readdir(brandDir).catch(() => [] as string[]);
  const real = brandFiles.filter((f) => f.endsWith(".json")).sort().map((f) => path.join(brandDir, f));
  return real.length ? real : [path.join(root, "data/demo-catalogue.json")];
}

export async function loadCatalogue(): Promise<Cache> {
  const files = await sourceFiles();
  const stats = await Promise.all(files.map((f) => fs.stat(f)));
  const key = files.map((f, i) => `${f}:${stats[i]!.mtimeMs}`).join("|");
  if (cache?.key === key) return cache;
  const records: unknown[] = [];
  for (const file of files) {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    records.push(...(Array.isArray(raw) ? raw : ((raw as { products?: unknown[] }).products ?? [])));
  }
  const report = validateCatalogueRecords(records);
  if (report.errors.length) console.warn(`[catalogue] ${report.errors.length} invalid record(s) excluded`, report.errors.slice(0, 10));
  cache = { key, products: report.valid, report, files, isDemo: report.valid.length > 0 && report.valid.every((p) => p.isDemo) };
  return cache;
}
