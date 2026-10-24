"use client";

import { useState } from "react";
import type { SavedDesign } from "@/lib/designs/model";
import { getModel } from "@/lib/models/registry";
import Dialog from "./Dialog";

type Result = string | null; // error message, or null on success

export interface DesignActions {
  saveNew: (name: string) => Result;
  saveCurrent: () => Result;
  addVariant: (name?: string) => Result;
  open: (designId: string, variantId?: string) => void;
  renameDesign: (designId: string, name: string) => Result;
  renameVariant: (designId: string, variantId: string, name: string) => Result;
  deleteVariant: (designId: string, variantId: string) => Result;
  deleteDesign: (designId: string) => Result;
  startNew: () => void;
}

interface Props {
  designs: SavedDesign[];
  currentDesign?: SavedDesign;
  currentVariantId?: string;
  dirty: boolean;
  storageError?: string;
  actions: DesignActions;
  onClose: () => void;
}

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function DesignsDialog({ designs, currentDesign, currentVariantId, dirty, storageError, actions, onClose }: Props) {
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState<{ designId: string; variantId?: string; label: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const variant = currentDesign?.variants.find((v) => v.id === currentVariantId);

  const run = (fn: () => Result, ok?: string) => {
    const err = fn();
    setMessage(err ? { kind: "error", text: err } : ok ? { kind: "ok", text: ok } : null);
    return !err;
  };

  const requestOpen = (designId: string, variantId: string | undefined, label: string) => {
    if (dirty && currentDesign) setPending({ designId, variantId, label });
    else {
      actions.open(designId, variantId);
      setMessage(null);
    }
  };

  return (
    <Dialog title="Designs" onClose={onClose} testId="designs-dialog">
      {storageError && (
        <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
          {storageError}
        </p>
      )}

      {currentDesign ? (
        <section aria-label="Current design" className="space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted" htmlFor="design-name">
            Design name
          </label>
          <input
            id="design-name"
            key={currentDesign.id + currentDesign.name}
            defaultValue={currentDesign.name}
            maxLength={80}
            onBlur={(e) => e.target.value.trim() !== currentDesign.name && run(() => actions.renameDesign(currentDesign.id, e.target.value), "Renamed.")}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-full rounded-lg border border-line px-3 py-2"
            data-testid="design-name"
          />

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Variants</p>
            <div className="flex flex-wrap gap-1.5" role="list">
              {currentDesign.variants.map((v, i) => (
                <button
                  key={v.id}
                  type="button"
                  role="listitem"
                  aria-current={v.id === currentVariantId}
                  onClick={() => v.id !== currentVariantId && requestOpen(currentDesign.id, v.id, v.name)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${v.id === currentVariantId ? "border-accent bg-accent-soft font-medium" : "border-line hover:bg-canvas"}`}
                  data-testid={`variant-${i}`}
                >
                  {v.name}
                </button>
              ))}
              <button type="button" onClick={() => run(() => actions.addVariant(), "New variant created from the current panels.")} className="rounded-full border border-dashed border-accent px-3 py-1.5 text-sm text-accent hover:bg-accent-soft" data-testid="add-variant">
                + New variant
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted">A new variant starts as a copy of what is on screen now. Change panels, then save.</p>
          </div>

          {variant && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="block text-xs text-muted" htmlFor="variant-name">
                  Variant name
                </label>
                <input
                  id="variant-name"
                  key={variant.id + variant.name}
                  defaultValue={variant.name}
                  maxLength={60}
                  onBlur={(e) => e.target.value.trim() !== variant.name && run(() => actions.renameVariant(currentDesign.id, variant.id, e.target.value), "Renamed.")}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="w-full rounded-lg border border-line px-3 py-1.5 text-sm"
                  data-testid="variant-name"
                />
              </div>
              {currentDesign.variants.length > 1 && (
                <button type="button" onClick={() => run(() => actions.deleteVariant(currentDesign.id, variant.id), "Variant deleted.")} className="rounded-full border border-line px-3 py-1.5 text-sm text-muted hover:bg-canvas" data-testid="delete-variant">
                  Delete variant
                </button>
              )}
            </div>
          )}

          {pending && (
            <div className="rounded-lg border border-[#f1d9b5] bg-warn-soft p-3 text-sm text-warn" role="alert" data-testid="unsaved-confirm">
              <p>{variant?.name ?? "This variant"} has unsaved changes.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-full bg-ink px-3 py-1.5 text-white"
                  data-testid="save-and-switch"
                  onClick={() => {
                    if (run(() => actions.saveCurrent())) {
                      actions.open(pending.designId, pending.variantId);
                      setPending(null);
                    }
                  }}
                >
                  Save, then open {pending.label}
                </button>
                <button type="button" className="rounded-full border border-current px-3 py-1.5" data-testid="discard-and-switch" onClick={() => (actions.open(pending.designId, pending.variantId), setPending(null))}>
                  Open without saving
                </button>
                <button type="button" className="px-2 py-1.5" onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" disabled={!dirty} onClick={() => run(() => actions.saveCurrent(), "Saved in this browser.")} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40" data-testid="save-design">
              Save changes
            </button>
            <span className="text-sm text-muted" data-testid="save-state">
              {dirty ? "Unsaved changes" : "All changes saved"}
            </span>
            <button type="button" onClick={() => (actions.startNew(), setMessage(null))} className="ml-auto text-sm text-accent underline-offset-2 hover:underline" data-testid="new-design">
              Start a new design
            </button>
          </div>
        </section>
      ) : (
        <form
          aria-label="Save this design"
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return setMessage({ kind: "error", text: "Please give the design a name." });
            if (run(() => actions.saveNew(newName), "Saved in this browser.")) setNewName("");
          }}
        >
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted" htmlFor="new-design-name">
            Save what is on screen as a design
          </label>
          <div className="flex gap-2">
            <input id="new-design-name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} placeholder="e.g. Al Waab villa kitchen" className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2" data-testid="design-name-input" />
            <button type="submit" className="shrink-0 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white" data-testid="save-new-design">
              Save
            </button>
          </div>
        </form>
      )}

      {message && (
        <p className={`mt-3 text-sm ${message.kind === "ok" ? "text-[#2f6b3a]" : "text-warn"}`} role={message.kind === "error" ? "alert" : "status"} data-testid="designs-message">
          {message.text}
        </p>
      )}

      <section aria-label="Saved designs" className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Saved in this browser ({designs.length})</h3>
        {designs.length === 0 ? (
          <p className="text-sm text-muted">No saved designs yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line" data-testid="saved-designs">
            {designs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {d.name}
                    {d.id === currentDesign?.id && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">open</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {d.variants.length} variant{d.variants.length === 1 ? "" : "s"} · {getModel(d.variants[0]?.modelId)?.name ?? "Unknown layout"} · {fmt(d.updatedAt)}
                  </p>
                </div>
                {confirmDelete === d.id ? (
                  <>
                    <span className="text-sm text-warn">Delete this design?</span>
                    <button type="button" className="rounded-full bg-warn px-3 py-1 text-sm text-white" data-testid="confirm-delete-design" onClick={() => (run(() => actions.deleteDesign(d.id), "Design deleted."), setConfirmDelete(null))}>
                      Delete
                    </button>
                    <button type="button" className="px-2 py-1 text-sm" onClick={() => setConfirmDelete(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    {d.id !== currentDesign?.id && (
                      <button type="button" className="rounded-full border border-line px-3 py-1 text-sm hover:bg-canvas" onClick={() => requestOpen(d.id, undefined, d.name)} data-testid={`open-design-${d.name}`}>
                        Open
                      </button>
                    )}
                    <button type="button" className="rounded-full px-2 py-1 text-sm text-muted hover:bg-canvas" onClick={() => setConfirmDelete(d.id)} aria-label={`Delete ${d.name}`}>
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">Designs are kept in this browser on this device only, and are lost if the browser&apos;s site data is cleared. To move a design to another device or send it to someone, use Share.</p>
      </section>
    </Dialog>
  );
}
