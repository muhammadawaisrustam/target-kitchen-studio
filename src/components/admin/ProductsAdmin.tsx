"use client";

import { useCallback, useEffect, useState } from "react";
import type { ValidationIssue } from "@/lib/catalogue/validate";
import { api } from "./AdminApp";

type Source = { file: string; kind: "bundled" | "imported"; slug?: string; label?: string; importedAt?: string; records: number };
type Overview = { sources: Source[]; totalProducts: number; published: number; brands: string[]; isDemo: boolean; errorCount: number; errors: ValidationIssue[] };
type ImportResult = {
  saved: boolean;
  slug: string;
  replacesExisting: boolean;
  totalRecords: number;
  validCount: number;
  errors: ValidationIssue[];
  errorCount: number;
  warnings: ValidationIssue[];
  warningCount: number;
  unknownColumns: string[];
};

const issueText = (i: ValidationIssue) => `${i.row ? `Row ${i.row}` : ""}${i.panelCode ? ` ${i.panelCode}` : ""}${i.field ? ` [${i.field}]` : ""}: ${i.message}`.trim();

export default function ProductsAdmin({ onSignedOut }: { onSignedOut: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [checked, setChecked] = useState<{ key: string; result: ImportResult } | null>(null);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const key = `${label.trim()}|${file?.name}|${file?.content.length}`;

  const load = useCallback(() => {
    api<Overview>("/api/admin/catalogue").then(setOverview, (e: Error & { status?: number }) => (e.status === 401 ? onSignedOut() : setError(e.message)));
  }, [onSignedOut]);
  useEffect(load, [load]);

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? "check" : "import");
    setError(null);
    setDone(null);
    try {
      const result = await api<ImportResult>("/api/admin/catalogue/import", { method: "POST", body: JSON.stringify({ label, fileName: file.name, content: file.content, dryRun }) });
      setChecked({ key, result });
      if (!dryRun && result.saved) {
        setDone(`Imported ${result.validCount} product(s) as "${label.trim()}". They are live in the studio now.`);
        load();
      }
    } catch (e) {
      const err = e as Error & { body?: ImportResult };
      if (err.body?.errors) setChecked({ key, result: err.body });
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (slug: string) => {
    setError(null);
    try {
      await api(`/api/admin/catalogue/import/${slug}`, { method: "DELETE" });
      setDone(`Removed import "${slug}".`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
    setConfirmDelete(null);
  };

  const result = checked?.key === key ? checked.result : null;
  const canImport = !!file && !!label.trim() && !!result && result.errorCount === 0 && result.validCount > 0 && !result.saved;

  return (
    <section aria-label="Products" className="space-y-8" data-testid="admin-products">
      <div>
        <h1 className="font-display text-2xl">Products</h1>
        {overview && (
          <p className="mt-1 text-sm text-muted" data-testid="catalogue-overview">
            {overview.totalProducts} products ({overview.published} published) · Brands: {overview.brands.join(", ") || "none"}
            {overview.isDemo && " · DEMO data"}
            {overview.errorCount > 0 && <span className="text-warn"> · {overview.errorCount} invalid record(s) are hidden</span>}
          </p>
        )}
        {overview && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[600px] text-left text-sm" data-testid="catalogue-sources">
              <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Records</th>
                  <th className="px-3 py-2">Imported</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {overview.sources.map((s) => (
                  <tr key={s.file}>
                    <td className="px-3 py-2">
                      {s.label ?? s.file}
                      <span className="block font-mono text-xs text-muted">{s.file}</span>
                    </td>
                    <td className="px-3 py-2">{s.kind === "bundled" ? "Part of the deployed site" : "Imported here"}</td>
                    <td className="px-3 py-2">{s.records}</td>
                    <td className="px-3 py-2">{s.importedAt ? new Date(s.importedAt).toLocaleString() : "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {s.kind === "imported" &&
                        (confirmDelete === s.slug ? (
                          <span className="whitespace-nowrap">
                            <button type="button" className="rounded-full bg-warn px-3 py-1 text-white" onClick={() => remove(s.slug!)} data-testid={`confirm-remove-${s.slug}`}>
                              Remove {s.records} products
                            </button>
                            <button type="button" className="px-2" onClick={() => setConfirmDelete(null)}>
                              Keep
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="rounded-full border border-line px-3 py-1 hover:bg-canvas" onClick={() => setConfirmDelete(s.slug!)} data-testid={`remove-${s.slug}`}>
                            Remove
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Brand files that are part of the deployed site (such as PDF imports) are changed with the command-line importer and a new deployment, not here.</p>
      </div>

      <form
        className="rounded-2xl border border-line bg-surface p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(true);
        }}
        data-testid="import-form"
      >
        <h2 className="font-display text-xl">Import products from a spreadsheet</h2>
        <p className="mt-1 text-sm text-muted">
          Use the{" "}
          <a href="/catalogue-template.csv" download className="text-accent underline">
            CSV template
          </a>{" "}
          (one row per panel) or a JSON file. The file is checked first; nothing is saved until you press Import. Rows with errors are never imported, and nothing is filled in automatically.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="import-label" className="text-sm font-medium">
              Import name
            </label>
            <input id="import-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="e.g. Egger 2026" className="mt-1 w-full rounded-lg border border-line px-3 py-2" data-testid="import-label" />
            <p className="mt-1 text-xs text-muted">Importing again with the same name replaces that import.</p>
          </div>
          <div>
            <label htmlFor="import-file" className="text-sm font-medium">
              File (.csv or .json, up to 5 MB)
            </label>
            <input
              id="import-file"
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="mt-1 block w-full text-sm"
              data-testid="import-file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setDone(null);
                setError(null);
                if (!f) return setFile(null);
                if (f.size > 5 * 1024 * 1024) return setError("The file is larger than 5 MB.");
                setFile({ name: f.name, content: await f.text() });
              }}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={!file || !label.trim() || !!busy} className="rounded-full border border-ink px-4 py-2 text-sm font-medium disabled:opacity-40" data-testid="import-check">
            {busy === "check" ? "Checking…" : "Check file"}
          </button>
          <button type="button" disabled={!canImport || !!busy} onClick={() => send(false)} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40" data-testid="import-save">
            {busy === "import" ? "Importing…" : result && result.validCount ? `Import ${result.validCount} product(s)` : "Import"}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-warn-soft p-3 text-sm text-warn" role="alert" data-testid="import-error">
            {error}
          </p>
        )}
        {done && (
          <p className="mt-3 rounded-lg bg-[#e9f4ec] p-3 text-sm text-[#2f6b3a]" role="status" data-testid="import-done">
            {done}
          </p>
        )}

        {result && (
          <div className="mt-4 space-y-3 text-sm" data-testid="import-result">
            <p>
              <strong>{result.totalRecords}</strong> row(s): <strong>{result.validCount}</strong> ready, <strong className={result.errorCount ? "text-warn" : ""}>{result.errorCount}</strong> with errors, {result.warningCount} warning(s).
              {result.replacesExisting && " This replaces the earlier import with the same name."}
            </p>
            {result.errorCount > 0 && <p className="text-warn">Fix the errors in the file and check it again. A file with errors is not imported.</p>}
            {result.unknownColumns.length > 0 && <p className="text-muted">Ignored columns: {result.unknownColumns.join(", ")}</p>}
            {result.errors.length > 0 && (
              <ul className="max-h-60 list-disc overflow-y-auto rounded-lg bg-warn-soft py-2 pl-7 pr-3 text-warn" data-testid="import-errors">
                {result.errors.map((i, n) => (
                  <li key={n}>{issueText(i)}</li>
                ))}
              </ul>
            )}
            {result.warnings.length > 0 && (
              <details>
                <summary className="cursor-pointer text-muted">{result.warningCount} warning(s): the products import, but check these</summary>
                <ul className="mt-1 max-h-60 list-disc overflow-y-auto pl-6 text-muted">
                  {result.warnings.map((i, n) => (
                    <li key={n}>{issueText(i)}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <p className="mt-4 text-xs text-muted">
          Images: use https:// links, or paths to images already on the site (for example /brands/kastamonu/textures/1-026.jpg). Uploading new image files here is not supported yet. Imports are stored on this server&apos;s disk (DATA_DIR/catalogue), which serverless hosts do not keep.
        </p>
      </form>
    </section>
  );
}
