"use client";

import { useCallback, useEffect, useState } from "react";
import type { TaxonomyEntry, TaxonomyKind } from "@/lib/catalogue/taxonomy";
import { api } from "./AdminApp";

export type Taxonomy = Record<TaxonomyKind, TaxonomyEntry[]>;
export type Storage = { kind: "file" | "supabase"; description: string };
export type TaxonomyResponse = {
  taxonomy: Taxonomy;
  totals: { panels: number; visible: number; edits: number };
  conflicts: { id: string; message: string }[];
  storage: Storage;
};

/** Loads all lists; `reload` after any change. */
export function useTaxonomy(onSignedOut: () => void) {
  const [data, setData] = useState<TaxonomyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api<TaxonomyResponse>("/api/admin/taxonomy").then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e: Error & { status?: number }) => (e.status === 401 ? onSignedOut() : setError(e.message)),
    );
  }, [onSignedOut]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

export const inputCls = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";
export const labelCls = "block text-sm font-medium";
export const btn = "rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:bg-canvas disabled:opacity-40";
export const btnPrimary = "rounded-full bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40";
export const btnDanger = "rounded-full bg-warn px-3 py-1.5 text-sm text-white disabled:opacity-40";

export function Notice({ kind, children, testId }: { kind: "error" | "ok"; children: React.ReactNode; testId?: string }) {
  return (
    <p role={kind === "error" ? "alert" : "status"} data-testid={testId} className={`rounded-lg p-3 text-sm ${kind === "error" ? "bg-warn-soft text-warn" : "bg-[#e9f4ec] text-[#2f6b3a]"}`}>
      {children}
    </p>
  );
}

export function StorageNote({ storage }: { storage?: Storage }) {
  if (!storage) return null;
  return (
    <p className="text-xs text-muted" data-testid="catalogue-storage">
      Changes are saved in: {storage.description}.
      {storage.kind === "file" && " This works on a server with its own disk. On Netlify or Vercel, connect Supabase so changes are kept (see the README)."}
    </p>
  );
}

/** Image link with an upload button. Uploads go to Supabase Storage or the server's disk. */
export function ImageField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setError(null);
    if (file.size > 4 * 1024 * 1024) return setError("The image is larger than 4 MB.");
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/media?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? `Upload failed (${res.status})`);
      onChange(body.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-10 w-10 shrink-0 rounded border border-line object-cover" />
        ) : (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded border border-dashed border-line text-[9px] text-muted">none</span>
        )}
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="/brands/… or https://…" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" data-testid={`${id}-url`} />
        <label className={`${btn} cursor-pointer whitespace-nowrap`}>
          {busy ? "Uploading…" : "Upload"}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} data-testid={`${id}-upload`} />
        </label>
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-warn">{error}</p>}
    </div>
  );
}

/** A text field with suggestions from a list, so a new value can also be typed. */
export function ListInput({ id, label, value, onChange, entries, required, testId }: { id: string; label: string; value: string; onChange: (v: string) => void; entries: TaxonomyEntry[]; required?: boolean; testId?: string }) {
  const known = entries.some((e) => e.name === value);
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label}
        {required && <span className="text-warn"> *</span>}
      </label>
      <input id={id} list={`${id}-list`} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} data-testid={testId ?? id} autoComplete="off" />
      <datalist id={`${id}-list`}>
        {entries.map((e) => (
          <option key={e.id} value={e.name} />
        ))}
      </datalist>
      {value && !known && <p className="mt-1 text-xs text-muted">New {label.toLowerCase()}: it will be added to the list.</p>}
    </div>
  );
}
