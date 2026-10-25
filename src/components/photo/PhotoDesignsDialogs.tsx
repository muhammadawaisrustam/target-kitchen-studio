"use client";

import { useEffect, useMemo, useState } from "react";
import type { PhotoDesignRecord } from "@/lib/photo/design";
import Dialog from "../Dialog";

export function SavePhotoDialog({
  current,
  editable,
  onSave,
  onClose,
}: {
  current: { id: string; name: string; notes?: string } | null;
  editable: boolean;
  onSave: (v: { name: string; notes: string; keepOriginal: boolean; asNew: boolean }) => Promise<string | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState(current?.name ?? "My kitchen photo");
  const [notes, setNotes] = useState(current?.notes ?? "");
  const [keepOriginal, setKeepOriginal] = useState(editable);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (asNew: boolean) => {
    setBusy(true);
    const err = await onSave({ name, notes, keepOriginal, asNew });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Dialog title="Save photo design" onClose={onClose} testId="photo-save-dialog">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void go(!current);
        }}
      >
        <label className="block text-sm font-medium">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-line px-3 py-2 font-normal" data-testid="photo-save-name" />
        </label>
        <label className="block text-sm font-medium">
          Notes <span className="font-normal text-muted">(optional)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-line px-3 py-2 font-normal" data-testid="photo-save-notes" />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={keepOriginal} disabled={!editable} onChange={(e) => setKeepOriginal(e.target.checked)} className="mt-1" data-testid="photo-save-keep" />
          <span>
            Keep my photo with the design
            <span className="block text-xs text-muted">
              Needed to edit the design again later. Untick to keep only the finished preview. Either way it is stored only in this browser on this device, never on our servers.
            </span>
          </span>
        </label>
        {error && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert" data-testid="photo-save-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {current ? (
            <>
              <button type="button" disabled={busy} onClick={() => go(false)} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-60" data-testid="photo-save-update">
                Update “{current.name}”
              </button>
              <button type="button" disabled={busy} onClick={() => go(true)} className="rounded-full border border-line px-4 py-2 text-sm font-medium disabled:opacity-60">
                Save as new
              </button>
            </>
          ) : (
            <button type="submit" disabled={busy} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-60" data-testid="photo-save-confirm">
              {busy ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

export function PhotoDesignsDialog({
  designs,
  error,
  currentId,
  onOpen,
  onDelete,
  onClose,
}: {
  designs: PhotoDesignRecord[];
  error: string | null;
  currentId?: string;
  onOpen: (d: PhotoDesignRecord) => Promise<void>;
  onDelete: (id: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const urls = useMemo(() => Object.fromEntries(designs.map((d) => [d.id, URL.createObjectURL(d.preview)])), [designs]);
  useEffect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return (
    <Dialog title="Saved photo designs" onClose={onClose} testId="photo-designs-dialog" wide>
      <p className="mb-3 text-[13px] text-muted">Saved in this browser only. They are not sent anywhere and are lost if this browser&apos;s site data is cleared.</p>
      {error && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}
      {msg && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{msg}</p>}
      {designs.length === 0 && <p className="py-6 text-center text-sm text-muted">No photo designs saved yet.</p>}
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="photo-designs-list">
        {designs.map((d) => (
          <li key={d.id} className={`overflow-hidden rounded-xl border ${d.id === currentId ? "border-accent" : "border-line"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={urls[d.id]} alt={`Preview of ${d.name}`} className="aspect-[4/3] w-full bg-canvas object-cover" />
            <div className="space-y-1 p-3 text-sm">
              <p className="font-medium">{d.name}</p>
              <p className="text-[11px] text-muted">
                Saved {new Date(d.updatedAt).toLocaleString("en-GB")} · ID {d.id}
                {!d.keepsOriginal && " · preview only"}
              </p>
              <ul className="text-[12px]">
                {d.panels.map((p) => (
                  <li key={p.region}>
                    {p.regionLabel}: <span className="font-mono">{p.panelCode}</span> {p.productName}
                  </li>
                ))}
                {!d.panels.length && <li className="text-muted">No panels applied</li>}
              </ul>
              {d.notes && <p className="whitespace-pre-wrap text-[12px] text-muted">“{d.notes}”</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(d.id);
                    await onOpen(d);
                    setBusy(null);
                  }}
                  className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                  data-testid="photo-design-open"
                >
                  {busy === d.id ? "Opening…" : "Open"}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={async () => {
                    if (!window.confirm(`Delete “${d.name}” from this browser?`)) return;
                    setMsg(await onDelete(d.id));
                  }}
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                  data-testid="photo-design-delete"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
