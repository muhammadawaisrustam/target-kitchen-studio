import { NextResponse } from "next/server";
import { noStore, requireAdmin } from "@/lib/server/adminAuth";
import { checkImport, MAX_IMPORT_BYTES, saveImport } from "@/lib/server/catalogueRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST { label, fileName, content, dryRun }
 * dryRun=true only validates. Otherwise the file is saved only if it has no errors.
 */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const text = await request.text();
  if (text.length > MAX_IMPORT_BYTES * 1.2) return NextResponse.json({ error: "The file is larger than 5 MB." }, { status: 413 });
  let body: { label?: unknown; fileName?: unknown; content?: unknown; dryRun?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "The request could not be read." }, { status: 400 });
  }
  if (typeof body.label !== "string" || typeof body.fileName !== "string" || typeof body.content !== "string")
    return NextResponse.json({ error: "Give a name and choose a .csv or .json file." }, { status: 422 });
  try {
    const result = body.dryRun === false ? await saveImport(body.label, body.fileName, body.content) : await checkImport(body.label, body.fileName, body.content);
    const saved = body.dryRun === false && result.report.errors.length === 0;
    return NextResponse.json(
      {
        saved,
        slug: result.slug,
        replacesExisting: result.replacesExisting,
        totalRecords: result.report.totalRecords,
        validCount: result.report.valid.length,
        errors: result.report.errors.slice(0, 200),
        errorCount: result.report.errors.length,
        warnings: result.report.warnings.slice(0, 200),
        warningCount: result.report.warnings.length,
        unknownColumns: result.unknownColumns,
      },
      { status: body.dryRun === false && !saved ? 422 : 200, headers: noStore },
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
