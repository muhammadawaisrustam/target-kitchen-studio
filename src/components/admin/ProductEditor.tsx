"use client";

import { useState } from "react";
import Dialog from "@/components/Dialog";
import type { AdminProduct } from "@/lib/catalogue/edits";
import { BOOLEAN_FIELDS, NUMERIC_FIELDS, type Product } from "@/lib/catalogue/schema";
import { sizeId } from "@/lib/catalogue/taxonomy";
import { api } from "./AdminApp";
import { btn, btnDanger, btnPrimary, ImageField, inputCls, labelCls, ListInput, Notice, type Taxonomy } from "./shared";

type Form = Record<string, string | boolean>;

const EMPTY: Form = { panelCode: "", productName: "", brand: "", category: "", board: "", finish: "", colourFamily: "", isPublished: true, isActive: true, isDemo: false, grainDirection: "" };

function toForm(p?: Product): Form {
  if (!p) return { ...EMPTY };
  const f: Form = { ...EMPTY };
  for (const [k, v] of Object.entries(p)) if (v !== undefined && k !== "origin") f[k] = typeof v === "boolean" ? v : String(v);
  return f;
}

/** Turns the form into a product: empty fields are left out (never invented), numbers parsed. */
export function fromForm(f: Form): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (BOOLEAN_FIELDS.has(k)) out[k] = v === true;
    else if (typeof v === "string") {
      const s = v.trim();
      if (!s) continue;
      out[k] = NUMERIC_FIELDS.has(k) ? (Number.isFinite(Number(s)) ? Number(s) : s) : s;
    }
  }
  return out;
}

const ORIGIN_TEXT: Record<AdminProduct["origin"], string> = {
  file: "From the brand file, not edited.",
  edited: "From the brand file, edited here. “Restore original” undoes all edits.",
  added: "Added in the admin.",
  deleted: "Deleted. Restore it to show it again.",
};

export default function ProductEditor({ product, taxonomy, onClose, onSaved }: { product?: AdminProduct; taxonomy: Taxonomy; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState<Form>(() => toForm(product));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isNew = !product;
  const set = (k: string) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const str = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : "");

  const text = (k: string, label: string, opts: { required?: boolean; type?: string; step?: string; placeholder?: string; disabled?: boolean } = {}) => (
    <div>
      <label htmlFor={`pf-${k}`} className={labelCls}>
        {label}
        {opts.required && <span className="text-warn"> *</span>}
      </label>
      <input id={`pf-${k}`} type={opts.type ?? "text"} step={opts.step} value={str(k)} placeholder={opts.placeholder} disabled={opts.disabled} onChange={(e) => set(k)(e.target.value)} className={`${inputCls} disabled:bg-canvas`} data-testid={`pf-${k}`} />
    </div>
  );
  const check = (k: string, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={f[k] === true} onChange={(e) => set(k)(e.target.checked)} data-testid={`pf-${k}`} />
      {label}
    </label>
  );

  const currentSize = sizeId({ widthMm: Number(str("widthMm")) || undefined, heightMm: Number(str("heightMm")) || undefined, thicknessMm: Number(str("thicknessMm")) || undefined });
  const sizes = taxonomy.size.filter((s) => s.isActive !== false || s.id === currentSize);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({ product: fromForm(f) });
      if (isNew) await api("/api/admin/products", { method: "POST", body });
      else await api(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: "PUT", body });
      onSaved(isNew ? `Added ${str("panelCode")}.` : `Saved ${str("panelCode")}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const act = async (action: "delete" | "restore") => {
    if (!product) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/products/bulk", { method: "POST", body: JSON.stringify({ ids: [product.id], action }) });
      onSaved(action === "delete" ? `Deleted ${product.panelCode}.` : `Restored ${product.panelCode} from the brand file.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleted = product?.origin === "deleted";

  return (
    <Dialog
      title={isNew ? "Add a panel" : `${product.panelCode} · ${product.productName}`}
      onClose={onClose}
      wide
      testId="product-editor"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {!deleted && (
            <button type="button" className={btnPrimary} disabled={busy} onClick={save} data-testid="pf-save">
              {busy ? "Saving…" : isNew ? "Add panel" : "Save changes"}
            </button>
          )}
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <span className="ml-auto flex gap-2">
            {(product?.origin === "edited" || deleted) && (
              <button type="button" className={btn} disabled={busy} onClick={() => act("restore")} data-testid="pf-restore">
                Restore original
              </button>
            )}
            {product && !deleted &&
              (confirmDelete ? (
                <button type="button" className={btnDanger} disabled={busy} onClick={() => act("delete")} data-testid="pf-confirm-delete">
                  Yes, delete it
                </button>
              ) : (
                <button type="button" className={btn} onClick={() => setConfirmDelete(true)} data-testid="pf-delete">
                  Delete
                </button>
              ))}
          </span>
        </div>
      }
    >
      <div className="space-y-6">
        {product && <p className="text-xs text-muted">{ORIGIN_TEXT[product.origin]} Id: <span className="font-mono">{product.id}</span></p>}
        {error && <Notice kind="error" testId="pf-error">{error}</Notice>}

        <fieldset className="grid gap-3 sm:grid-cols-2" disabled={deleted}>
          <legend className="mb-2 font-display text-lg">Panel</legend>
          {text("panelCode", "Item ID (panel code)", { required: true, placeholder: "e.g. 1-026-T18-C-J-1" })}
          {text("productName", "Decor name", { required: true })}
          <ListInput id="pf-brand" label="Brand" value={str("brand")} onChange={set("brand")} entries={taxonomy.brand} />
          <ListInput id="pf-category" label="Category / collection" value={str("category")} onChange={set("category")} entries={taxonomy.category} required />
          <ListInput id="pf-board" label="Board" value={str("board")} onChange={set("board")} entries={taxonomy.board} />
          <ListInput id="pf-finish" label="Finish" value={str("finish")} onChange={set("finish")} entries={taxonomy.finish} required />
          <ListInput id="pf-colourFamily" label="Colour group" value={str("colourFamily")} onChange={set("colourFamily")} entries={taxonomy.colourFamily} required />
          {text("decorCode", "Decor number", { placeholder: "shared by every size of a decor" })}
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-3" disabled={deleted}>
          <legend className="mb-2 font-display text-lg">Sheet size</legend>
          <div className="sm:col-span-3">
            <label htmlFor="pf-size" className={labelCls}>
              Choose a size
            </label>
            <select
              id="pf-size"
              className={inputCls}
              value={sizes.some((s) => s.id === currentSize) ? currentSize : ""}
              onChange={(e) => {
                const s = taxonomy.size.find((x) => x.id === e.target.value);
                if (s) setF((x) => ({ ...x, widthMm: s.widthMm ? String(s.widthMm) : "", heightMm: s.heightMm ? String(s.heightMm) : "", thicknessMm: s.thicknessMm ? String(s.thicknessMm) : "" }));
              }}
              data-testid="pf-size"
            >
              <option value="">Custom (type below)</option>
              {sizes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isActive === false ? " (switched off)" : ""}
                </option>
              ))}
            </select>
          </div>
          {text("widthMm", "Width (mm)", { type: "number" })}
          {text("heightMm", "Length (mm)", { type: "number" })}
          {text("thicknessMm", "Thickness (mm)", { type: "number", step: "0.1" })}
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2" disabled={deleted}>
          <legend className="mb-2 font-display text-lg">Look in 3D</legend>
          <ImageField id="pf-thumbnailUrl" label="Thumbnail (catalogue card)" value={str("thumbnailUrl")} onChange={set("thumbnailUrl")} hint="About 192 × 192 px." />
          <ImageField id="pf-textureUrl" label="Texture (3D surface)" value={str("textureUrl")} onChange={set("textureUrl")} hint="Seamless tile, grain running up the image, about 1024 px." />
          <div>
            <label htmlFor="pf-colourHex" className={labelCls}>
              Plain colour (no texture)
            </label>
            <div className="mt-1 flex gap-2">
              <input type="color" aria-label="Pick colour" value={/^#[0-9a-f]{6}$/i.test(str("colourHex")) ? str("colourHex") : "#ffffff"} onChange={(e) => set("colourHex")(e.target.value.toUpperCase())} className="h-9 w-12 rounded border border-line" />
              <input id="pf-colourHex" value={str("colourHex")} onChange={(e) => set("colourHex")(e.target.value)} placeholder="#RRGGBB" className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm" data-testid="pf-colourHex" />
            </div>
          </div>
          <div>
            <label htmlFor="pf-grainDirection" className={labelCls}>
              Grain direction
            </label>
            <select id="pf-grainDirection" value={str("grainDirection")} onChange={(e) => set("grainDirection")(e.target.value)} className={inputCls}>
              <option value="">Not given</option>
              <option value="vertical">Vertical</option>
              <option value="horizontal">Horizontal</option>
              <option value="none">None (plain or stone)</option>
            </select>
          </div>
          {text("textureScale", "Texture repeat size (m)", { type: "number", step: "0.05", placeholder: "preview assumes 1" })}
          {text("textureRotation", "Extra rotation (degrees)", { type: "number" })}
          {text("roughness", "Roughness (0 gloss to 1 matt)", { type: "number", step: "0.05" })}
          {text("metalness", "Metalness (0 to 1)", { type: "number", step: "0.05" })}
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2" disabled={deleted}>
          <legend className="mb-2 font-display text-lg">Status and details</legend>
          <div className="space-y-2 sm:col-span-2">
            {check("isPublished", "Published: shown in the studio")}
            {check("isActive", "Active (untick for discontinued panels)")}
            {check("isDemo", "Demo record (not a real product)")}
          </div>
          <div>
            <label htmlFor="pf-stockStatus" className={labelCls}>
              Stock
            </label>
            <select id="pf-stockStatus" value={str("stockStatus")} onChange={(e) => set("stockStatus")(e.target.value)} className={inputCls}>
              <option value="">Not shown</option>
              <option value="in_stock">In stock</option>
              <option value="low_stock">Low stock</option>
              <option value="out_of_stock">Out of stock</option>
              <option value="made_to_order">Made to order</option>
            </select>
          </div>
          {text("madeIn", "Made in")}
          {text("sourceDocument", "Source document")}
          {text("sourcePage", "Source page", { type: "number" })}
          <div className="sm:col-span-2">
            <label htmlFor="pf-notes" className={labelCls}>
              Notes
            </label>
            <textarea id="pf-notes" rows={2} maxLength={500} value={str("notes")} onChange={(e) => set("notes")(e.target.value)} className={inputCls} />
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}
