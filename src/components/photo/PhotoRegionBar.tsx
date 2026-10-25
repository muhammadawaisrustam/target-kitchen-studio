"use client";

import { useMemo } from "react";
import type { Product } from "@/lib/catalogue/schema";
import { countSelected } from "@/lib/photo/mask";
import { PHOTO_REGION_COLOURS, PHOTO_REGION_IDS, PHOTO_REGION_LABELS, type PhotoRegionId } from "@/lib/photo/regions";
import type { PhotoDoc } from "@/lib/photo/state";
import type { RegionState } from "../RegionBar";
import Swatch from "../Swatch";

interface Props {
  doc: PhotoDoc;
  active: PhotoRegionId;
  onSelect: (r: PhotoRegionId) => void;
  products: Record<string, Product>;
  state: Partial<Record<PhotoRegionId, RegionState>>;
  onClear: () => void;
  onClearProtect: () => void;
}

/** The cabinet areas on the photo, each with its colour, panel code and selected share of the photo. */
export default function PhotoRegionBar({ doc, active, onSelect, products, state, onClear, onClearProtect }: Props) {
  const total = doc.width * doc.height;
  // Counting pixels is cheap but not free; only redo it when the selections change.
  const areas = useMemo(() => Object.fromEntries(PHOTO_REGION_IDS.map((r) => [r, countSelected(doc.masks[r]) / total])) as Record<PhotoRegionId, number>, [doc.masks, total]);
  const protectedShare = useMemo(() => countSelected(doc.protect) / total, [doc.protect, total]);
  return (
    <div className="border-t border-line bg-surface px-3 py-2">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Cabinet areas">
        {PHOTO_REGION_IDS.map((r) => {
          const code = doc.regions[r].panelCode;
          const p = code ? products[code] : undefined;
          const area = areas[r];
          const st = state[r];
          const c = PHOTO_REGION_COLOURS[r];
          return (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={active === r}
              onClick={() => onSelect(r)}
              className={`flex min-w-[9.5rem] shrink-0 items-center gap-2 rounded-xl border px-2 py-1.5 text-left ${active === r ? "border-ink ring-1 ring-ink" : "border-line hover:border-[#c9c1b5]"}`}
              data-testid={`photo-region-${r}`}
              data-panel-code={code ?? ""}
              data-area={area.toFixed(4)}
            >
              <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md border border-line">
                {p ? <Swatch product={p} className="h-full w-full" /> : <span className="block h-full w-full bg-canvas" />}
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-tl" style={{ background: `rgb(${c.join(",")})` }} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold">{PHOTO_REGION_LABELS[r]}</span>
                <span className="block truncate text-[11px] text-muted">
                  {st?.status === "loading" ? "Loading…" : code ? code : "No panel"}
                  {" · "}
                  {area === 0 ? "no area" : `${(area * 100).toFixed(area < 0.01 ? 1 : 0)}%`}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <button type="button" onClick={onClear} disabled={areas[active] === 0} className="font-medium text-accent hover:underline disabled:text-muted disabled:no-underline disabled:opacity-60" data-testid="clear-region">
          Clear {PHOTO_REGION_LABELS[active].toLowerCase()} area
        </button>
        <span>
          Protected: {protectedShare ? `${(protectedShare * 100).toFixed(1)}% of photo` : "none"}
          {protectedShare > 0 && (
            <button type="button" onClick={onClearProtect} className="ml-1 font-medium text-accent hover:underline">
              clear
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
