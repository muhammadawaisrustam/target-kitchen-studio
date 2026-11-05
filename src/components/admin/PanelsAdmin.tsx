"use client";

import { useCallback, useEffect, useState } from "react";
import Swatch from "@/components/Swatch";
import type { AdminStatus } from "@/lib/catalogue/adminQuery";
import type { AdminProduct } from "@/lib/catalogue/edits";
import { TAXONOMY_LABELS, type TaxonomyKind } from "@/lib/catalogue/taxonomy";
import { api } from "./AdminApp";
import ProductEditor from "./ProductEditor";
import { btn, btnDanger, btnPrimary, inputCls, Notice, StorageNote, type Storage, type Taxonomy } from "./shared";

type ListResponse = { items: AdminProduct[]; total: number; page: number; pageCount: number; counts: Record<AdminStatus, number>; ids: string[]; conflicts: { id: string; message: string }[]; storage: Storage };

const STATUS_TABS: [AdminStatus, string][] = [
  ["all", "All"],
  ["live", "In the studio"],
  ["unpublished", "Unpublished"],
  ["inactive", "Inactive"],
  ["edited", "Edited"],
  ["added", "Added here"],
  ["deleted", "Deleted"],
];
const FILTER_KINDS: TaxonomyKind[] = ["brand", "category", "board", "finish", "size"];
const ORIGIN_BADGE: Record<AdminProduct["origin"], string> = { file: "", edited: "Edited", added: "Added", deleted: "Deleted" };

export default function PanelsAdmin({ taxonomy, onChanged, onSignedOut }: { taxonomy: Taxonomy; onChanged: () => void; onSignedOut: () => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<AdminStatus>("all");
  const [filters, setFilters] = useState<Partial<Record<TaxonomyKind, string>>>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);
  const [bulk, setBulk] = useState<{ field: TaxonomyKind | ""; value: string }>({ field: "", value: "" });
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [debounced, status, filters]);

  const load = useCallback(() => {
    const params = new URLSearchParams({ status, page: String(page), pageSize: "50" });
    if (debounced) params.set("q", debounced);
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    api<ListResponse>(`/api/admin/products?${params}`).then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e: Error & { status?: number }) => (e.status === 401 ? onSignedOut() : setError(e.message)),
    );
  }, [status, page, debounced, filters, onSignedOut]);
  useEffect(load, [load]);

  const changed = (msg: string) => {
    setDone(msg);
    setEditing(null);
    setSelected(new Set());
    setConfirmBulkDelete(false);
    load();
    onChanged();
  };

  const runBulk = async (action: "update" | "delete" | "restore", patch?: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api<{ changed: number }>("/api/admin/products/bulk", { method: "POST", body: JSON.stringify({ ids: [...selected], action, patch }) });
      changed(`${r.changed} panel(s) ${action === "delete" ? "deleted" : action === "restore" ? "restored from the brand files" : "updated"}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyBulkField = () => {
    if (!bulk.field || !bulk.value) return;
    if (bulk.field === "size") {
      const s = taxonomy.size.find((x) => x.id === bulk.value);
      if (s) void runBulk("update", { widthMm: s.widthMm ?? null, heightMm: s.heightMm ?? null, thicknessMm: s.thicknessMm ?? null });
    } else {
      const e = taxonomy[bulk.field].find((x) => x.id === bulk.value);
      if (e) void runBulk("update", { [bulk.field]: e.name });
    }
  };

  const items = data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((p) => selected.has(p.id));
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));

  return (
    <section aria-label="Panels" className="space-y-4" data-testid="admin-panels">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl">Panels</h1>
        <span className="text-sm text-muted">{data ? `${data.counts.all} panels · ${data.counts.live} in the studio` : ""}</span>
        <button type="button" className={`${btnPrimary} ml-auto`} onClick={() => setEditing("new")} data-testid="add-panel">
          Add panel
        </button>
      </div>
      <StorageNote storage={data?.storage} />

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Status">
        {STATUS_TABS.map(([s, label]) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 text-sm ${status === s ? "bg-ink text-white" : "border border-line bg-surface hover:bg-canvas"}`} data-testid={`status-${s}`}>
            {label} {data && <span className="opacity-70">({data.counts[s]})</span>}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, name, colour…" aria-label="Search panels" className={`${inputCls} mt-0 sm:col-span-3 lg:col-span-1`} data-testid="panel-search" />
        {FILTER_KINDS.map((k) => (
          <select key={k} aria-label={TAXONOMY_LABELS[k].one} value={filters[k] ?? ""} onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value }))} className={`${inputCls} mt-0`} data-testid={`panel-filter-${k}`}>
            <option value="">All {TAXONOMY_LABELS[k].many.toLowerCase()}</option>
            {taxonomy[k].map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.productCount})
              </option>
            ))}
          </select>
        ))}
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {done && <Notice kind="ok" testId="panels-done">{done}</Notice>}
      {!!data?.conflicts.length && (
        <Notice kind="error">
          {data.conflicts.length} added panel(s) use a code that is now also in a brand file, so the brand file&apos;s version is shown: {data.conflicts.map((c) => c.id).join(", ")}
        </Notice>
      )}

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-ink/20 bg-accent-soft p-3 text-sm" data-testid="bulk-bar">
          <strong>{selected.size} selected</strong>
          <button type="button" className={btn} disabled={busy} onClick={() => runBulk("update", { isPublished: true })} data-testid="bulk-publish">
            Publish
          </button>
          <button type="button" className={btn} disabled={busy} onClick={() => runBulk("update", { isPublished: false })} data-testid="bulk-unpublish">
            Unpublish
          </button>
          <span className="flex items-center gap-1">
            <select aria-label="Field to change" value={bulk.field} onChange={(e) => setBulk({ field: e.target.value as TaxonomyKind, value: "" })} className="rounded-lg border border-line bg-surface px-2 py-1">
              <option value="">Change…</option>
              {(["brand", "category", "board", "finish", "colourFamily", "size"] as const).map((k) => (
                <option key={k} value={k}>
                  {TAXONOMY_LABELS[k].one}
                </option>
              ))}
            </select>
            {bulk.field && (
              <select aria-label="New value" value={bulk.value} onChange={(e) => setBulk((b) => ({ ...b, value: e.target.value }))} className="rounded-lg border border-line bg-surface px-2 py-1" data-testid="bulk-value">
                <option value="">to…</option>
                {taxonomy[bulk.field].map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            )}
            {bulk.field && bulk.value && (
              <button type="button" className={btn} disabled={busy} onClick={applyBulkField} data-testid="bulk-apply">
                Apply
              </button>
            )}
          </span>
          {status === "deleted" || status === "edited" ? (
            <button type="button" className={btn} disabled={busy} onClick={() => runBulk("restore")} data-testid="bulk-restore">
              Restore original
            </button>
          ) : null}
          {status !== "deleted" &&
            (confirmBulkDelete ? (
              <button type="button" className={btnDanger} disabled={busy} onClick={() => runBulk("delete")} data-testid="bulk-confirm-delete">
                Delete {selected.size} panel(s)
              </button>
            ) : (
              <button type="button" className={btn} onClick={() => setConfirmBulkDelete(true)} data-testid="bulk-delete">
                Delete
              </button>
            ))}
          <button type="button" className="ml-auto text-sm underline" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {data && !items.length && <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">No panels match.</p>}
      {!!items.length && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[820px] text-left text-sm" data-testid="panels-table">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPage}
                    onChange={() => setSelected((s) => { const n = new Set(s); items.forEach((p) => (allOnPage ? n.delete(p.id) : n.add(p.id))); return n; })}
                  />
                </th>
                <th className="px-2 py-2" />
                <th className="px-3 py-2">Item ID</th>
                <th className="px-3 py-2">Decor</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Board · size</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((p) => (
                <tr key={p.id} className={`align-middle ${p.origin === "deleted" ? "opacity-60" : ""}`} data-testid={`panel-row-${p.panelCode}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Select ${p.panelCode}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Swatch product={p} className="h-9 w-9 rounded" />
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" className="font-mono text-[13px] text-accent hover:underline" onClick={() => setEditing(p)} data-testid="edit-panel">
                      {p.panelCode}
                    </button>
                  </td>
                  <td className="px-3 py-2">{p.productName}</td>
                  <td className="px-3 py-2">{p.brand ?? "—"}</td>
                  <td className="px-3 py-2">{p.category}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {[p.board, p.widthMm && p.heightMm ? `${p.widthMm}×${p.heightMm}` : "", p.thicknessMm ? `${p.thicknessMm} mm` : ""].filter(Boolean).join(" · ")}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.origin === "deleted" ? (
                      <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn">Deleted</span>
                    ) : (
                      <>
                        <span className={`rounded px-1.5 py-0.5 ${p.isPublished && p.isActive ? "bg-[#e9f4ec] text-[#2f6b3a]" : "bg-canvas text-muted"}`}>{!p.isActive ? "Inactive" : p.isPublished ? "Published" : "Unpublished"}</span>
                        {ORIGIN_BADGE[p.origin] && <span className="ml-1 rounded bg-accent-soft px-1.5 py-0.5 text-accent">{ORIGIN_BADGE[p.origin]}</span>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">
            {data.total} match · page {data.page} of {data.pageCount}
          </span>
          {selected.size < data.ids.length && data.total > items.length && (
            <button type="button" className="underline" onClick={() => setSelected(new Set(data.ids))} data-testid="select-all-matching">
              Select all {data.total} matching
            </button>
          )}
          <span className="ml-auto flex gap-2">
            <button type="button" className={btn} disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button type="button" className={btn} disabled={data.page >= data.pageCount} onClick={() => setPage((p) => p + 1)} data-testid="next-page">
              Next
            </button>
          </span>
        </div>
      )}

      {editing && <ProductEditor product={editing === "new" ? undefined : editing} taxonomy={taxonomy} onClose={() => setEditing(null)} onSaved={changed} />}
    </section>
  );
}
