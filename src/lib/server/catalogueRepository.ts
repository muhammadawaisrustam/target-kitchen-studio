import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { Product } from "@/lib/catalogue/schema";
import { parseImportFile, validateCatalogueRecords, type ValidationIssue, type ValidationReport } from "@/lib/catalogue/validate";
import { BUNDLED_BRAND_FILES, BUNDLED_DEMO_FILE } from "./bundledCatalogue";
import { dataDir } from "./dataDir";

/**
 * File-backed catalogue.
 *
 * Bundled sources, in order of precedence:
 *   1. CATALOGUE_FILE: one path or a comma-separated list (relative to the project root);
 *   2. every brand file in data/brands/*.json (written by scripts/import-brand-pdf.mjs);
 *   3. the DEMO catalogue, only when no real brand file exists.
 * Plus files imported from the admin screen, kept in DATA_DIR/catalogue/*.json.
 * All files are merged and validated together, so a panel code used twice is rejected.
 */
export interface CatalogueSource {
  file: string;
  kind: "bundled" | "imported";
  slug?: string;
  label?: string;
  importedAt?: string;
  records: number;
}
type Cache = { key: string; products: Product[]; report: ValidationReport; files: string[]; sources: CatalogueSource[]; isDemo: boolean };
let cache: Cache | null = null;

export const importDir = () => path.join(dataDir(), "catalogue");

type BundledSource = { file: string; read: () => Promise<unknown>; stamp: () => Promise<string> };

/**
 * Brand files come from the build (static imports, see scripts/bundle-catalogue.mjs) so they
 * work on hosts without a file system. CATALOGUE_FILE still reads the named files from disk.
 */
async function bundledSources(): Promise<BundledSource[]> {
  const root = process.cwd();
  if (process.env.CATALOGUE_FILE) {
    return process.env.CATALOGUE_FILE.split(",").map((f) => f.trim()).filter(Boolean).map((f) => {
      const file = path.resolve(root, f);
      return { file, read: async () => JSON.parse(await fs.readFile(file, "utf8")), stamp: async () => String((await fs.stat(file)).mtimeMs) };
    });
  }
  const list = BUNDLED_BRAND_FILES.length ? BUNDLED_BRAND_FILES : [BUNDLED_DEMO_FILE];
  return list.map((b) => ({ file: path.join(root, b.file), read: async () => b.data, stamp: async () => "bundled" }));
}

async function importedFiles(): Promise<string[]> {
  const dir = importDir();
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  return files.filter((f) => /^[a-z0-9-]+\.json$/.test(f)).sort().map((f) => path.join(dir, f));
}

const recordsOf = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : ((raw as { products?: unknown[] }).products ?? []));

export async function loadCatalogue(): Promise<Cache> {
  const bundled = await bundledSources();
  const imported = await importedFiles();
  const sourcesIn = [
    ...bundled.map((b) => ({ ...b, isImported: false })),
    ...imported.map((file) => ({ file, isImported: true, read: async () => JSON.parse(await fs.readFile(file, "utf8")) as unknown, stamp: async () => String((await fs.stat(file)).mtimeMs) })),
  ];
  const files = sourcesIn.map((s) => s.file);
  const stamps = await Promise.all(sourcesIn.map((s) => s.stamp()));
  const key = files.map((f, i) => `${f}:${stamps[i]}`).join("|");
  if (cache?.key === key) return cache;
  const records: unknown[] = [];
  const sources: CatalogueSource[] = [];
  for (const src of sourcesIn) {
    const raw = (await src.read()) as { label?: string; importedAt?: string };
    const list = recordsOf(raw);
    records.push(...list);
    sources.push({
      file: path.relative(process.cwd(), src.file),
      kind: src.isImported ? "imported" : "bundled",
      slug: src.isImported ? path.basename(src.file, ".json") : undefined,
      label: raw?.label,
      importedAt: raw?.importedAt,
      records: list.length,
    });
  }
  const report = validateCatalogueRecords(records);
  if (report.errors.length) console.warn(`[catalogue] ${report.errors.length} invalid record(s) excluded`, report.errors.slice(0, 10));
  cache = { key, products: report.valid, report, files, sources, isDemo: report.valid.length > 0 && report.valid.every((p) => p.isDemo) };
  return cache;
}

// ---------- admin imports ----------
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function slugify(label: string): string {
  return label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export interface ImportCheck {
  slug: string;
  report: ValidationReport;
  unknownColumns: string[];
  replacesExisting: boolean;
}

/**
 * Validates an uploaded file against the rest of the catalogue (an import with the same name is
 * replaced, so its own codes do not count as duplicates). Local image paths are checked on disk.
 */
export async function checkImport(label: string, fileName: string, content: string): Promise<ImportCheck> {
  const slug = slugify(label);
  if (!slug) throw new Error("Give the import a name using letters or numbers.");
  if (Buffer.byteLength(content) > MAX_IMPORT_BYTES) throw new Error("The file is larger than 5 MB.");
  const { records, unknownColumns } = parseImportFile(fileName, content);
  if (!records.length) throw new Error("The file contains no products.");
  const own = path.join(importDir(), `${slug}.json`);
  const replacesExisting = await fs.stat(own).then(() => true, () => false);

  // Everything except this import's previous version.
  const others: unknown[] = [];
  for (const b of await bundledSources()) others.push(...recordsOf(await b.read()));
  for (const file of await importedFiles()) {
    if (file === own) continue;
    others.push(...recordsOf(JSON.parse(await fs.readFile(file, "utf8"))));
  }
  const existing = validateCatalogueRecords(others).valid;
  const report = validateCatalogueRecords(records, { existing });

  const missing: ValidationIssue[] = [];
  const publicDir = path.join(process.cwd(), "public");
  for (const p of report.valid) {
    for (const [field, url] of [["textureUrl", p.textureUrl], ["thumbnailUrl", p.thumbnailUrl]] as const) {
      if (!url?.startsWith("/")) continue;
      const file = path.join(publicDir, url.split(/[?#]/)[0]!);
      if (!file.startsWith(publicDir) || !(await fs.stat(file).then((s) => s.isFile(), () => false)))
        missing.push({ row: 0, panelCode: p.panelCode, field, message: `image not found on the server: ${url}. The preview will show "texture unavailable".` });
    }
  }
  report.warnings.push(...missing);
  return { slug, report, unknownColumns, replacesExisting };
}

export async function saveImport(label: string, fileName: string, content: string): Promise<ImportCheck> {
  const check = await checkImport(label, fileName, content);
  if (check.report.errors.length) return check;
  const dir = importDir();
  const file = path.join(dir, `${check.slug}.json`);
  const body = JSON.stringify({ label: label.trim(), source: path.basename(fileName), importedAt: new Date().toISOString(), products: check.report.valid }, null, 2);
  try {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${file}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, file);
  } catch (err) {
    throw new Error("The import could not be saved: this server's disk is not writable. Import with the command-line tool and redeploy instead.", { cause: err });
  }
  return check;
}

export async function deleteImport(slug: string): Promise<boolean> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return false;
  return fs.unlink(path.join(importDir(), `${slug}.json`)).then(() => true, () => false);
}
