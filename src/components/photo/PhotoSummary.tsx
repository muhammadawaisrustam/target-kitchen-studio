"use client";

import { useState } from "react";
import type { Product } from "@/lib/catalogue/schema";
import { panelsToText, type PhotoPanel } from "@/lib/photo/design";
import { isEmpty } from "@/lib/photo/mask";
import { PHOTO_REGION_COLOURS, PHOTO_REGION_IDS, PHOTO_REGION_LABELS, type PhotoRegionId } from "@/lib/photo/regions";
import type { PhotoDoc } from "@/lib/photo/state";
import Swatch from "../Swatch";

interface Props {
  doc: PhotoDoc;
  panels: PhotoPanel[];
  products: Record<string, Product>;
  onSelectRegion: (r: PhotoRegionId) => void;
  onSave: () => void;
  onDownload: () => void;
  onQuote: () => void;
}

/** Panel codes by area, with what is missing, plus save / download / quote. */
export default function PhotoSummary({ doc, panels, products, onSelectRegion, onSave, onDownload, onQuote }: Props) {
  const [copied, setCopied] = useState(false);
  const rows = PHOTO_REGION_IDS.map((r) => ({ r, code: doc.regions[r].panelCode, hasArea: !isEmpty(doc.masks[r]) })).filter((x) => x.code || x.hasArea);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`My Kitchen Photo (approximate preview)\n${panelsToText(panels)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-3 px-4 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto" data-testid="photo-summary">
      {rows.length === 0 && <p className="text-sm text-muted">Nothing selected yet. Mark an area on the photo and choose a panel for it.</p>}
      <ul className="divide-y divide-line rounded-xl border border-line" data-testid="photo-summary-list">
        {rows.map(({ r, code, hasArea }) => {
          const p = code ? products[code] : undefined;
          const counted = !!code && hasArea;
          return (
            <li key={r}>
              <button type="button" onClick={() => onSelectRegion(r)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-canvas" data-testid={`summary-${r}`} data-panel-code={counted ? code : ""}>
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: `rgb(${PHOTO_REGION_COLOURS[r].join(",")})` }} aria-hidden />
                {p ? <Swatch product={p} className="h-9 w-9 shrink-0 rounded-md" /> : <span className="h-9 w-9 shrink-0 rounded-md bg-canvas" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-muted">{PHOTO_REGION_LABELS[r]}</span>
                  {code ? (
                    <span className="block truncate text-sm">
                      <span className="font-mono font-semibold">{code}</span> {p?.productName}
                    </span>
                  ) : (
                    <span className="block text-sm text-warn">No panel chosen</span>
                  )}
                  {code && !hasArea && <span className="block text-[11px] text-warn">No area marked on the photo, so it is not included.</span>}
                  {p && <span className="block truncate text-[11px] text-muted">{[p.brand, p.board, p.category, p.widthMm && p.heightMm ? `${p.widthMm}×${p.heightMm} mm` : null].filter(Boolean).join(" · ")}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onSave} className="rounded-full border border-line px-3 py-1.5 text-sm font-medium hover:bg-canvas">
          Save design
        </button>
        <button type="button" onClick={onDownload} className="rounded-full border border-line px-3 py-1.5 text-sm font-medium hover:bg-canvas">
          Download preview
        </button>
        <button type="button" onClick={copy} disabled={!panels.length} className="rounded-full border border-line px-3 py-1.5 text-sm font-medium hover:bg-canvas disabled:opacity-40">
          {copied ? "Copied" : "Copy codes"}
        </button>
        <button type="button" onClick={onQuote} disabled={!panels.length} className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50" data-testid="summary-quote">
          Request a quote
        </button>
      </div>
      <div className="rounded-lg bg-canvas px-3 py-2 text-[12px] leading-snug text-muted">
        <p>
          <strong className="text-ink">Approximate visual preview.</strong> Panel textures come from the supplier&apos;s catalogue swatches, which are low resolution and not seamless. Real
          colour, gloss and grain will differ, especially in photos with strong lighting. Please check with an original sample before ordering.
        </p>
      </div>
    </div>
  );
}
