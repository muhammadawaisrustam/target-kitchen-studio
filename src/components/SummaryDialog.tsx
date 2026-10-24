"use client";

import { useEffect, useMemo, useState } from "react";
import type { Product } from "@/lib/catalogue/schema";
import { fetchCatalogue } from "@/lib/catalogue/client";
import type { SavedDesign, Selections } from "@/lib/designs/model";
import { buildSummary, summaryToCsv, summaryToText } from "@/lib/designs/summary";
import { getModel } from "@/lib/models/registry";
import { REGION_IDS, REGION_LABELS, type RegionId } from "@/lib/models/regions";
import Dialog from "./Dialog";

interface Props {
  regions: RegionId[];
  selections: Selections;
  products: Record<string, Product>;
  layoutName: string;
  designName?: string;
  variantName?: string;
  shareUrl: string;
  design?: SavedDesign;
  dirty: boolean;
  onProducts: (list: Product[]) => void;
  onQuote: () => void;
  onClose: () => void;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileSafe = (s: string) => s.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "kitchen";

export default function SummaryDialog({ regions, selections, products, layoutName, designName, variantName, shareUrl, design, dirty, onProducts, onQuote, onClose }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const rows = buildSummary(regions, selections, products);
  const meta = { designName, variantName, layout: layoutName, shareUrl };
  const compare = design && design.variants.length > 1;

  // Make sure product details exist for every code used by any variant (for the comparison).
  const allCodes = useMemo(() => [...new Set((design?.variants ?? []).flatMap((v) => Object.values(v.selections)))].filter((c): c is string => !!c), [design]);
  useEffect(() => {
    const missing = allCodes.filter((c) => !products[c]);
    if (!missing.length) return;
    const ctrl = new AbortController();
    fetchCatalogue({ codes: missing.slice(0, 60), pageSize: 60 }, ctrl.signal).then((r) => onProducts(r.items), () => undefined);
    return () => ctrl.abort();
  }, [allCodes, products, onProducts]);

  const copy = async (what: string, text: string) => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2500);
    } catch {
      setCopyError("Your browser blocked copying. Select the text and copy it manually.");
    }
  };

  const compareRegions = REGION_IDS.filter((r) => design?.variants.some((v) => v.selections[r] || getModel(v.modelId)?.defaults[r]));

  return (
    <Dialog
      title="Panel summary"
      onClose={onClose}
      testId="summary-dialog"
      wide
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => copy("summary", summaryToText(rows, meta))} className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-canvas" data-testid="copy-summary">
            {copied === "summary" ? "Copied ✓" : "Copy as text"}
          </button>
          <button type="button" onClick={() => download(`${fileSafe(designName ?? "kitchen")}-panels.csv`, summaryToCsv(rows, meta), "text/csv;charset=utf-8")} className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-canvas" data-testid="download-summary">
            Download CSV
          </button>
          <button type="button" onClick={() => window.print()} className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-canvas" data-testid="print-summary">
            Print
          </button>
          <button type="button" onClick={onQuote} className="ml-auto rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white" data-testid="summary-quote">
            Request a quote
          </button>
        </div>
      }
    >
      <p className="text-sm text-muted">
        <span className="font-medium text-ink">{designName ?? "Unsaved design"}</span>
        {variantName && <> · {variantName}</>} · {layoutName}
        {dirty && designName && <span className="ml-1 text-warn">(includes unsaved changes)</span>}
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm" data-testid="summary-table">
          <thead className="text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="py-2 pr-3 font-semibold">Region</th>
              <th className="py-2 pr-3 font-semibold">Item ID</th>
              <th className="py-2 pr-3 font-semibold">Decor</th>
              <th className="py-2 pr-3 font-semibold">Board</th>
              <th className="py-2 pr-3 font-semibold">Finish</th>
              <th className="py-2 font-semibold">Sheet</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.region} data-testid={`summary-row-${r.region}`}>
                <td className="py-2 pr-3">{r.regionLabel}</td>
                <td className="whitespace-nowrap py-2 pr-3 font-mono text-[13px]">{r.panelCode ?? <span className="text-muted">Not selected</span>}</td>
                <td className="py-2 pr-3">
                  {r.productName ?? ""}
                  {r.brand && <span className="text-muted"> · {r.brand}</span>}
                  {r.isDemo && <span className="ml-1 rounded bg-warn-soft px-1 text-[11px] text-warn">DEMO</span>}
                </td>
                <td className="py-2 pr-3">{r.board ?? "—"}</td>
                <td className="py-2 pr-3">{r.finish ?? "—"}</td>
                <td className="whitespace-nowrap py-2">{r.sheet ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Only details printed in the supplier&apos;s documents are shown. Quantities and prices are confirmed by the sales team.</p>

      {compare && (
        <section className="mt-6" aria-label="Compare variants">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Compare saved variants</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm" data-testid="compare-table">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-2 pr-3 font-semibold uppercase tracking-wider">Region</th>
                  {design!.variants.map((v) => (
                    <th key={v.id} className="py-2 pr-3 font-semibold">
                      {v.name}
                      <span className="block font-normal">{getModel(v.modelId)?.name ?? v.modelId}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {compareRegions.map((r) => {
                  const codes = design!.variants.map((v) => v.selections[r]);
                  const differs = new Set(codes.map((c) => c ?? "")).size > 1;
                  return (
                    <tr key={r}>
                      <td className="py-2 pr-3">{REGION_LABELS[r]}</td>
                      {codes.map((c, i) => (
                        <td key={i} className={`py-2 pr-3 ${differs ? "bg-accent-soft/60" : ""}`}>
                          {c ? (
                            <>
                              <span className="whitespace-nowrap font-mono text-[13px]">{c}</span>
                              <span className="block text-xs text-muted">{products[c]?.productName ?? ""}</span>
                            </>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-muted">Shaded rows differ between variants. Saved versions are compared; unsaved changes are not included.</p>
        </section>
      )}

      <section className="no-print mt-6" aria-label="Share">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Share link</h3>
        <div className="flex gap-2">
          <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs" aria-label="Share link" data-testid="share-url" />
          <button type="button" onClick={() => copy("link", shareUrl)} className="shrink-0 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white" data-testid="copy-share">
            {copied === "link" ? "Copied ✓" : "Copy link"}
          </button>
        </div>
        {copyError && (
          <p className="mt-1 text-xs text-warn" role="alert">
            {copyError}
          </p>
        )}
        <p className="mt-1.5 text-xs text-muted">The link contains the layout, the panel codes and the camera view exactly as on screen now. Anyone with the link can open it; no account is needed and nothing is stored on the server.</p>
      </section>
    </Dialog>
  );
}
