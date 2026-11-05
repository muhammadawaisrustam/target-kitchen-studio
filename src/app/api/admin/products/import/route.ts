import { parseImportFile } from "@/lib/catalogue/validate";
import { adminRoute, json, readJson } from "@/lib/server/adminRoute";
import { CatalogueEditError, importProducts } from "@/lib/server/liveCatalogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX = 5 * 1024 * 1024;

/** POST { fileName, content, updateExisting, dryRun }: check (dryRun) or import panels from CSV/JSON. */
export const POST = adminRoute(async (request) => {
  const body = await readJson<{ fileName?: unknown; content?: unknown; updateExisting?: unknown; dryRun?: unknown }>(request, MAX * 1.2);
  if (typeof body.fileName !== "string" || typeof body.content !== "string") throw new CatalogueEditError("Choose a .csv or .json file.");
  let parsed;
  try {
    parsed = parseImportFile(body.fileName, body.content);
  } catch (err) {
    throw new CatalogueEditError((err as Error).message);
  }
  if (!parsed.records.length) throw new CatalogueEditError("The file contains no panels.");
  const { report, added, updated, saved } = await importProducts(parsed.records, { updateExisting: body.updateExisting === true, dryRun: body.dryRun !== false });
  return json(
    {
      saved,
      added,
      updated,
      totalRecords: report.totalRecords,
      validCount: report.valid.length,
      errors: report.errors.slice(0, 200),
      errorCount: report.errors.length,
      warnings: report.warnings.slice(0, 200),
      warningCount: report.warnings.length,
      unknownColumns: parsed.unknownColumns,
    },
    body.dryRun === false && !saved ? 422 : 200,
  );
});
