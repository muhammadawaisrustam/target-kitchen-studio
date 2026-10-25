"use client";

import { useState } from "react";
import type { Selections } from "@/lib/designs/model";
import type { PhotoRegionId } from "@/lib/photo/regions";
import Dialog from "./Dialog";

/** One line of the panel list (3D regions or photo regions). */
export interface QuoteRow {
  region: string;
  regionLabel: string;
  panelCode: string | null;
  productName?: string;
  isDemo?: boolean;
}

/** A design made on the customer's own photo. */
export interface PhotoQuote {
  designId?: string;
  regions: { region: PhotoRegionId; panelCode: string }[];
  /** Builds the JPEG preview as a data URL; only called if the customer chooses to attach it. */
  getPreview: () => Promise<string>;
}

interface Props {
  rows: QuoteRow[];
  modelId?: string;
  layoutName: string;
  selections?: Selections;
  designName?: string;
  variantName?: string;
  shareUrl?: string;
  photo?: PhotoQuote;
  onClose: () => void;
  backLabel?: string;
}

type Form = { name: string; phone: string; email: string; company: string; location: string; preferredContact: "" | "phone" | "whatsapp" | "email"; message: string; consent: boolean; website: string };
const EMPTY: Form = { name: "", phone: "", email: "", company: "", location: "", preferredContact: "", message: "", consent: false, website: "" };

type State = { kind: "editing" } | { kind: "sending" } | { kind: "sent"; reference: string; createdAt: string } | { kind: "failed"; message: string };

export default function QuoteDialog({ rows, modelId, layoutName, selections, designName, variantName, shareUrl, photo, onClose, backLabel = "Back to the kitchen" }: Props) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [attachPreview, setAttachPreview] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<State>({ kind: "editing" });
  const chosen = rows.filter((r) => r.panelCode);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const localCheck = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = "Please enter your name.";
    if (!form.phone.trim() && !form.email.trim()) e.phone = "Please give a phone number or an email address.";
    if (!form.consent) e.consent = "Please confirm we may contact you about this enquiry.";
    if (!chosen.length) e.design = "Choose at least one panel before requesting a quote.";
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const local = localCheck();
    setErrors(local);
    if (Object.keys(local).length) return;
    setState({ kind: "sending" });
    let previewJpeg: string | undefined;
    if (photo && attachPreview) {
      try {
        previewJpeg = await photo.getPreview();
      } catch {
        setState({ kind: "failed", message: "The preview image could not be prepared, so nothing was sent. Untick “attach preview” to send without it, or try again." });
        return;
      }
    }
    try {
      const res = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          preferredContact: form.preferredContact || undefined,
          ...(photo
            ? { photo: { designId: photo.designId, designName, regions: photo.regions, previewJpeg } }
            : { design: { modelId, designName, variantName, shareUrl, selections } }),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { reference?: string; createdAt?: string; error?: string; fields?: Record<string, string> };
      // Success only when the server confirms it stored the enquiry (201 + reference).
      if (res.status === 201 && body.reference) {
        setState({ kind: "sent", reference: body.reference, createdAt: body.createdAt ?? "" });
        return;
      }
      setErrors(body.fields ?? {});
      setState({ kind: "failed", message: body.error ?? `The enquiry was not sent (error ${res.status}).` });
    } catch {
      setState({ kind: "failed", message: "Could not reach the server. Your enquiry was not sent. Check your connection and try again." });
    }
  };

  if (state.kind === "sent") {
    return (
      <Dialog title="Enquiry received" onClose={onClose} testId="quote-dialog">
        <div className="space-y-3" role="status" data-testid="quote-success">
          <p>Your quotation request has been saved.</p>
          <p className="rounded-xl bg-accent-soft px-4 py-3">
            Reference <span className="font-mono font-semibold" data-testid="quote-reference">{state.reference}</span>
          </p>
          <p className="text-sm text-muted">Please keep this reference if you contact us about this kitchen. A copy of your panel choices was stored with it.</p>
          <button type="button" onClick={onClose} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white">
            {backLabel}
          </button>
        </div>
      </Dialog>
    );
  }

  const field = "w-full rounded-lg border px-3 py-2 aria-[invalid=true]:border-warn";
  const err = (k: string) =>
    errors[k] ? (
      <p id={`${k}-error`} className="mt-1 text-xs text-warn">
        {errors[k]}
      </p>
    ) : null;
  const a11y = (k: string) => ({ "aria-invalid": !!errors[k], "aria-describedby": errors[k] ? `${k}-error` : undefined });

  return (
    <Dialog title="Request a quote" onClose={onClose} testId="quote-dialog">
      <form onSubmit={submit} noValidate className="space-y-4" data-testid="quote-form">
        <div className="rounded-xl border border-line p-3 text-sm">
          <p className="font-medium">
            {designName ?? "Your kitchen"}
            {variantName && <span className="text-muted"> · {variantName}</span>}
            <span className="text-muted"> · {layoutName}</span>
          </p>
          <ul className="mt-1.5 space-y-0.5 text-muted" data-testid="quote-panels">
            {chosen.map((r) => (
              <li key={r.region}>
                {r.regionLabel}: <span className="font-mono text-[13px] text-ink">{r.panelCode}</span> {r.productName}
                {r.isDemo && <span className="ml-1 rounded bg-warn-soft px-1 text-[11px] text-warn">DEMO</span>}
              </li>
            ))}
          </ul>
          {err("design")}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="q-name" className="text-sm font-medium">
              Name <span className="text-warn">*</span>
            </label>
            <input id="q-name" autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={100} className={field} {...a11y("name")} data-testid="q-name" />
            {err("name")}
          </div>
          <div>
            <label htmlFor="q-phone" className="text-sm font-medium">
              Phone
            </label>
            <input id="q-phone" type="tel" autoComplete="tel" placeholder="+974" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={25} className={field} {...a11y("phone")} data-testid="q-phone" />
            {err("phone")}
          </div>
          <div>
            <label htmlFor="q-email" className="text-sm font-medium">
              Email
            </label>
            <input id="q-email" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={150} className={field} {...a11y("email")} data-testid="q-email" />
            {err("email")}
          </div>
          <p className="-mt-1 text-xs text-muted sm:col-span-2">Give at least a phone number or an email address.</p>
          <div>
            <label htmlFor="q-company" className="text-sm font-medium">
              Company <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="q-company" autoComplete="organization" value={form.company} onChange={(e) => set("company", e.target.value)} maxLength={100} className={field} />
          </div>
          <div>
            <label htmlFor="q-location" className="text-sm font-medium">
              Area or city <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="q-location" value={form.location} onChange={(e) => set("location", e.target.value)} maxLength={100} className={field} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="q-contact" className="text-sm font-medium">
              Preferred contact <span className="font-normal text-muted">(optional)</span>
            </label>
            <select id="q-contact" value={form.preferredContact} onChange={(e) => set("preferredContact", e.target.value as Form["preferredContact"])} className={field}>
              <option value="">No preference</option>
              <option value="phone">Phone call</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="q-message" className="text-sm font-medium">
              Notes <span className="font-normal text-muted">(optional: room size, timing, questions)</span>
            </label>
            <textarea id="q-message" rows={3} value={form.message} onChange={(e) => set("message", e.target.value)} maxLength={2000} className={field} data-testid="q-message" />
          </div>
        </div>

        {/* Hidden from people; simple spam bots fill it in. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="q-website">Website</label>
          <input id="q-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} />
        </div>

        {photo && (
          <div className="rounded-xl border border-line p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={attachPreview} onChange={(e) => setAttachPreview(e.target.checked)} className="mt-1" data-testid="q-attach-preview" />
              <span>
                Attach my preview image <span className="text-muted">(optional)</span>
                <span className="mt-0.5 block text-xs text-muted">
                  The preview shows your kitchen photo with the chosen panels. If you tick this, it is sent with your enquiry and stored privately for our sales team only. If you leave it unticked,
                  only the panel codes are sent. Your original photo is never uploaded.
                </span>
              </span>
            </label>
          </div>
        )}

        <div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={form.consent} onChange={(e) => set("consent", e.target.checked)} className="mt-1" {...a11y("consent")} data-testid="q-consent" />
            <span>I agree that my details and panel choices are stored so the sales team can contact me about this enquiry.</span>
          </label>
          {err("consent")}
        </div>

        {state.kind === "failed" && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert" data-testid="quote-error">
            {state.message}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={state.kind === "sending"} className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white disabled:opacity-60" data-testid="q-submit">
            {state.kind === "sending" ? "Sending…" : "Send enquiry"}
          </button>
          <p className="text-xs text-muted">No price is shown online; the sales team prepares the quotation.</p>
        </div>
      </form>
    </Dialog>
  );
}
