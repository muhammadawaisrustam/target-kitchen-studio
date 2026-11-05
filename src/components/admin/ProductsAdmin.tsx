"use client";

import { useCallback, useEffect, useState } from "react";
import type { ValidationIssue } from "@/lib/catalogue/validate";
import { api } from "./AdminApp";

type Source = { file: string; kind: "bundled" | "imported"; slug?: string; label?: string; importedAt?: string; records: number };
type Overview = { sources: Source[]; totalProducts: number; published: number; brands: string[]; isDemo: boolean; errorCount: number; errors: ValidationIssue[] };
type ImportResult = {
  saved: boolean;
  added: number;
  updated: number;
  totalRecords: number;
  validCount: number;
  errors: ValidationIssue[];
  errorCount: number;
  warnings: ValidationIssue[];
  warningCount: number;
  unknownColumns: string[];
};

const issueText = (i: ValidationIssue) => `${i.row ? `Row ${i.row}` : ""}${i.panelCode ? ` ${i.panelCode}` : ""}${i.field ? ` [${i.field}]` : ""}: ${i.message}`.trim();

export default function ProductsAdmin({ onSignedOut, onChanged }: { onSignedOut: () => void; onChanged?: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [checked, setChecked] = useState<{ key: string; result: ImportResult } | null>(null);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const key = `${updateExisting}|${file?.name}|${file?.content.length}`;

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
      const result = await api<ImportResult>("/api/admin/products/import", { method: "POST", body: JSON.stringify({ fileName: file.name, content: file.content, updateExisting, dryRun }) });
      setChecked({ key, result });
      if (!dryRun && result.saved) {
        setDone(`Imported ${result.validCount} panel(s): ${result.added} added, ${result.updated} updated. Published ones are in the studio now.`);
        load();
        onChanged?.();
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
  const canImport = !!file && !!result && result.errorCount === 0 && result.validCount > 0 && !result.saved;

  return (
    <section aria-label="Products" className="space-y-8" data-testid="admin-products">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl">Import, export and sources</h1>
          <span className="ml-auto flex gap-2">
            <a href="/api/admin/products/export?format=csv" className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:bg-canvas" data-testid="export-panels-csv">
              Export all panels (CSV)
            </a>
            <a href="/api/admin/products/export?format=json" className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:bg-canvas" data-testid="export-panels-json">
              Backup (JSON)
            </a>
          </span>
        </div>
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
                    <td className="px-3 py-2">{s.kind === "bundled" ? "Part of the deployed site" : "Older admin import (server file)"}</td>
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
        <p className="mt-2 text-xs text-muted">
          Brand files are deployed with the site. You can edit, hide or delete any of their panels on the Panels tab; the files themselves stay unchanged, so
          a new brand import can be deployed without losing your edits.
        </p>
      </div>

      <form
        className="rounded-2xl border border-line bg-surface p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(true);
        }}
        data-testid="import-form"
      >
        <h2 className="font-display text-xl">Import panels from a spreadsheet</h2>
        <p className="mt-1 text-sm text-muted">
          Use the{" "}
          <a href="/catalogue-template.csv" download className="text-accent underline">
            CSV template
          </a>{" "}
          (one row per panel), a JSON file, or an export from this page edited in a spreadsheet. The file is checked first; nothing is saved until you press Import. If any row has an error nothing is imported, and nothing is filled in automatically.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} data-testid="import-update" />
            <span>
              Update panels that already exist (matched by Item ID)
              <span className="block text-xs text-muted">Off: rows whose Item ID is already in the catalogue are reported as errors.</span>
            </span>
          </label>
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
          <button type="submit" disabled={!file || !!busy} className="rounded-full border border-ink px-4 py-2 text-sm font-medium disabled:opacity-40" data-testid="import-check">
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
              {result.validCount > 0 && ` ${result.added} new, ${result.updated} update(s).`}
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
          Images: use https:// links, paths to images already on the site (for example /brands/kastamonu/textures/1-026.jpg), or upload images on a panel&apos;s edit screen.
        </p>
      </form>
    </section>
  );
}
