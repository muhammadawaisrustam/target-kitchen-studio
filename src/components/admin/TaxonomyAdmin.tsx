"use client";

import { useState } from "react";
import { TAXONOMY_LABELS, type TaxonomyEntry, type TaxonomyKind } from "@/lib/catalogue/taxonomy";
import { api } from "./AdminApp";
import { btn, btnDanger, btnPrimary, ImageField, inputCls, labelCls, Notice, StorageNote, type Storage, type Taxonomy } from "./shared";

const HELP: Record<TaxonomyKind, string> = {
  brand: "Brands appear in the studio's Brand filter. Switching a brand off hides all its panels from the studio. Renaming a brand renames it on every panel.",
  category: "Categories (collections) appear in the studio's Category filter. Switching one off hides its panels; renaming updates every panel.",
  board: "Core boards, e.g. Particleboard, MDF, HPL. Switching one off hides its panels.",
  finish: "Surface finishes, e.g. Matt, High gloss, Textured.",
  colourFamily: "Colour groups used by the studio's Colour filter.",
  size: "Sheet sizes offered when adding or editing a panel. Changing a size's measurements updates every panel with that size.",
};

type Draft = { name: string; description: string; imageUrl: string; isActive: boolean; widthMm: string; heightMm: string; thicknessMm: string };
const toDraft = (e?: TaxonomyEntry): Draft => ({
  name: e?.name ?? "",
  description: e?.description ?? "",
  imageUrl: e?.imageUrl ?? "",
  isActive: e?.isActive ?? true,
  widthMm: e?.widthMm ? String(e.widthMm) : "",
  heightMm: e?.heightMm ? String(e.heightMm) : "",
  thicknessMm: e?.thicknessMm ? String(e.thicknessMm) : "",
});

export default function TaxonomyAdmin({ kinds, taxonomy, storage, onChanged }: { kinds: TaxonomyKind[]; taxonomy: Taxonomy; storage?: Storage; onChanged: () => void }) {
  const [kind, setKind] = useState<TaxonomyKind>(kinds[0]!);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(toDraft());
  const [deleting, setDeleting] = useState<{ id: string; mergeInto: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = taxonomy[kind];
  const label = TAXONOMY_LABELS[kind];

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setDone(await fn());
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const itemFrom = (d: Draft, e?: TaxonomyEntry) => {
    const num = (s: string) => (s.trim() ? Number(s) : undefined);
    const item: Record<string, unknown> = { kind, name: d.name.trim(), isActive: d.isActive, sortOrder: e?.sortOrder };
    if (d.description.trim()) item.description = d.description.trim();
    if (d.imageUrl.trim()) item.imageUrl = d.imageUrl.trim();
    if (kind === "size") Object.assign(item, { widthMm: num(d.widthMm), heightMm: num(d.heightMm), thicknessMm: num(d.thicknessMm) });
    if (kind === "size" && !item.name) item.name = [d.widthMm && d.heightMm ? `${d.widthMm} × ${d.heightMm} mm` : "", d.thicknessMm ? `${d.thicknessMm} mm thick` : ""].filter(Boolean).join(", ");
    return item;
  };

  const save = (e?: TaxonomyEntry) =>
    run(async () => {
      const r = await api<{ productsUpdated: number }>("/api/admin/taxonomy", { method: "POST", body: JSON.stringify({ item: itemFrom(draft, e), previousId: e?.id }) });
      setEditing(null);
      return `${e ? "Saved" : "Added"} ${draft.name || label.one.toLowerCase()}.${r.productsUpdated ? ` ${r.productsUpdated} panel(s) updated to match.` : ""}`;
    });

  const toggleActive = (e: TaxonomyEntry) =>
    run(async () => {
      await api("/api/admin/taxonomy", { method: "POST", body: JSON.stringify({ item: { ...itemFrom(toDraft(e), e), isActive: e.isActive === false }, previousId: e.id }) });
      return e.isActive === false ? `${e.name} is on: its panels show in the studio again.` : `${e.name} is off: its ${e.productCount} panel(s) are hidden from the studio.`;
    });

  const move = (i: number, dir: -1 | 1) =>
    run(async () => {
      const ids = list.map((e) => e.id);
      const j = i + dir;
      if (j < 0 || j >= ids.length) return "";
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      await api("/api/admin/taxonomy/reorder", { method: "POST", body: JSON.stringify({ kind, ids }) });
      return "Order saved.";
    });

  const remove = (e: TaxonomyEntry, mergeInto: string) =>
    run(async () => {
      const r = await api<{ productsUpdated: number }>(`/api/admin/taxonomy?kind=${kind}&id=${encodeURIComponent(e.id)}${mergeInto ? `&mergeInto=${encodeURIComponent(mergeInto)}` : ""}`, { method: "DELETE" });
      setDeleting(null);
      return `Deleted ${e.name}.${r.productsUpdated ? ` ${r.productsUpdated} panel(s) moved.` : ""}`;
    });

  const form = (e?: TaxonomyEntry) => (
    <div className="grid gap-3 rounded-xl border border-line bg-canvas/60 p-4 sm:grid-cols-2" data-testid="taxonomy-form">
      {kind === "size" ? (
        <div className="grid grid-cols-3 gap-2 sm:col-span-2">
          {(["widthMm", "heightMm", "thicknessMm"] as const).map((k) => (
            <div key={k}>
              <label htmlFor={`tx-${k}`} className={labelCls}>
                {k === "widthMm" ? "Width (mm)" : k === "heightMm" ? "Length (mm)" : "Thickness (mm)"}
              </label>
              <input id={`tx-${k}`} type="number" step="0.1" value={draft[k]} onChange={(ev) => setDraft((d) => ({ ...d, [k]: ev.target.value }))} className={inputCls} data-testid={`tx-${k}`} />
            </div>
          ))}
        </div>
      ) : null}
      <div>
        <label htmlFor="tx-name" className={labelCls}>
          {kind === "size" ? "Label (optional)" : "Name"}
        </label>
        <input id="tx-name" value={draft.name} maxLength={60} onChange={(ev) => setDraft((d) => ({ ...d, name: ev.target.value }))} className={inputCls} data-testid="tx-name" />
        {e && e.productCount > 0 && kind !== "size" && draft.name.trim() && draft.name.trim() !== e.name && <p className="mt-1 text-xs text-muted">Renaming updates {e.productCount} panel(s).</p>}
      </div>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" checked={draft.isActive} onChange={(ev) => setDraft((d) => ({ ...d, isActive: ev.target.checked }))} data-testid="tx-active" />
        On (its panels show in the studio)
      </label>
      <div className="sm:col-span-2">
        <label htmlFor="tx-description" className={labelCls}>
          Description (optional)
        </label>
        <textarea id="tx-description" rows={2} maxLength={500} value={draft.description} onChange={(ev) => setDraft((d) => ({ ...d, description: ev.target.value }))} className={inputCls} />
      </div>
      {(kind === "brand" || kind === "category") && (
        <div className="sm:col-span-2">
          <ImageField id="tx-image" label={kind === "brand" ? "Logo (optional)" : "Image (optional)"} value={draft.imageUrl} onChange={(v) => setDraft((d) => ({ ...d, imageUrl: v }))} />
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => save(e)} data-testid="tx-save">
          {busy ? "Saving…" : e ? "Save" : `Add ${label.one.toLowerCase()}`}
        </button>
        <button type="button" className={btn} onClick={() => setEditing(null)}>
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <section aria-label={label.many} className="space-y-4" data-testid={`admin-taxonomy-${kind}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl">{kinds.length > 1 ? "Other lists" : label.many}</h1>
        <button
          type="button"
          className={`${btnPrimary} ml-auto`}
          onClick={() => {
            setDraft(toDraft());
            setEditing("new");
          }}
          data-testid="tx-add"
        >
          Add {label.one.toLowerCase()}
        </button>
      </div>
      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {kinds.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => (setKind(k), setEditing(null), setDeleting(null))} className={`rounded-full px-3 py-1 text-sm ${kind === k ? "bg-ink text-white" : "border border-line bg-surface hover:bg-canvas"}`} data-testid={`tx-kind-${k}`}>
              {TAXONOMY_LABELS[k].many} ({taxonomy[k].length})
            </button>
          ))}
        </div>
      )}
      <p className="text-sm text-muted">{HELP[kind]}</p>
      <StorageNote storage={storage} />
      {error && <Notice kind="error" testId="tx-error">{error}</Notice>}
      {done && <Notice kind="ok" testId="tx-done">{done}</Notice>}
      {editing === "new" && form()}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-left text-sm" data-testid="taxonomy-table">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="w-20 px-3 py-2">Order</th>
              <th className="px-3 py-2">{label.one}</th>
              <th className="px-3 py-2">Panels</th>
              <th className="px-3 py-2">In the studio</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((e, i) => (
              <FragmentRow key={e.id}>
                <tr className="align-middle" data-testid={`tx-row-${e.id}`}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button type="button" className="px-1.5 disabled:opacity-20" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${e.name} up`}>
                      ↑
                    </button>
                    <button type="button" className="px-1.5 disabled:opacity-20" disabled={busy || i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${e.name} down`}>
                      ↓
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {e.imageUrl && <img src={e.imageUrl} alt="" className="h-7 w-7 rounded object-contain" />}
                      <span>
                        {e.name}
                        {e.description && <span className="block max-w-md truncate text-xs text-muted">{e.description}</span>}
                        {!e.stored && <span className="block text-[11px] text-muted">from the panel data</span>}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2">{e.productCount}</td>
                  <td className="px-3 py-2">
                    <button type="button" role="switch" aria-checked={e.isActive !== false} disabled={busy} onClick={() => toggleActive(e)} className={`rounded-full px-2.5 py-0.5 text-xs ${e.isActive !== false ? "bg-[#e9f4ec] text-[#2f6b3a]" : "bg-warn-soft text-warn"}`} data-testid={`tx-toggle-${e.id}`}>
                      {e.isActive !== false ? "On" : "Off"}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      className={btn}
                      onClick={() => {
                        setDraft(toDraft(e));
                        setEditing(e.id);
                        setDeleting(null);
                      }}
                      data-testid={`tx-edit-${e.id}`}
                    >
                      Edit
                    </button>{" "}
                    <button type="button" className={btn} onClick={() => (setDeleting({ id: e.id, mergeInto: "" }), setEditing(null))} data-testid={`tx-delete-${e.id}`}>
                      Delete
                    </button>
                  </td>
                </tr>
                {editing === e.id && (
                  <tr>
                    <td colSpan={5} className="px-3 py-3">
                      {form(e)}
                    </td>
                  </tr>
                )}
                {deleting?.id === e.id && (
                  <tr>
                    <td colSpan={5} className="bg-warn-soft/50 px-3 py-3 text-sm">
                      {e.productCount > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            {e.productCount} panel(s) use {e.name}. Move them to
                          </span>
                          <select value={deleting.mergeInto} onChange={(ev) => setDeleting({ id: e.id, mergeInto: ev.target.value })} className="rounded-lg border border-line bg-surface px-2 py-1" data-testid="tx-merge-into">
                            <option value="">choose…</option>
                            {list.filter((x) => x.id !== e.id).map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                          <button type="button" className={btnDanger} disabled={busy || !deleting.mergeInto} onClick={() => remove(e, deleting.mergeInto)} data-testid="tx-confirm-delete">
                            Move and delete
                          </button>
                          <button type="button" className={btn} onClick={() => setDeleting(null)}>
                            Keep
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span>Delete {e.name}? No panels use it.</span>
                          <button type="button" className={btnDanger} disabled={busy} onClick={() => remove(e, "")} data-testid="tx-confirm-delete">
                            Delete
                          </button>
                          <button type="button" className={btn} onClick={() => setDeleting(null)}>
                            Keep
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </FragmentRow>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
