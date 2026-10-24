"use client";

import type { Product } from "@/lib/catalogue/schema";
import { REGION_LABELS, type RegionId } from "@/lib/models/regions";
import Swatch from "./Swatch";

export interface RegionState {
  /** Panel code this status belongs to; a status for an older selection is ignored. */
  code: string;
  status: "loading" | "ok" | "warning";
  warning?: string;
  roughness?: number;
  roughnessSource?: "product" | "finish-default" | "fallback";
}

interface Props {
  regions: RegionId[];
  active: RegionId;
  onSelect: (r: RegionId) => void;
  selections: Partial<Record<RegionId, string>>;
  products: Record<string, Product>;
  state: Partial<Record<RegionId, RegionState>>;
}

/** Region selector that doubles as the design summary: one card per cabinet region. */
export default function RegionBar({ regions, active, onSelect, selections, products, state }: Props) {
  return (
    <section aria-label="Cabinet regions and design summary" className="shrink-0 border-b border-line bg-surface lg:mt-3 lg:rounded-2xl lg:border">
      <div className="flex items-baseline justify-between px-4 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Apply finish to</h2>
        <span className="text-[11px] text-muted">Tip: click a cabinet in the 3D view</span>
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-3 pt-2" role="radiogroup" aria-label="Cabinet region">
        {regions.length === 0 && <p className="py-3 text-sm text-muted">Loading regions…</p>}
        {regions.map((r) => {
          const code = selections[r];
          const product = code ? products[code] : undefined;
          const raw = state[r];
          // Ignore a status left over from the previous panel while the new one is applied.
          const s = raw && raw.code === code ? raw : code ? ({ code, status: "loading" } as RegionState) : undefined;
          const isActive = r === active;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onSelect(r)}
              data-testid={`region-${r}`}
              data-panel-code={code ?? ""}
              data-status={s?.status ?? "none"}
              className={`flex min-w-[168px] flex-1 items-center gap-2.5 rounded-xl border p-2 text-left transition ${
                isActive ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-line hover:border-[#cfc8bd]"
              }`}
            >
              <Swatch product={product} className="h-10 w-10 shrink-0 rounded-lg border border-black/5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{REGION_LABELS[r]}</span>
                <span className="block truncate text-xs text-muted" data-testid={`region-${r}-summary`}>
                  {s?.status === "loading" ? "Loading…" : code ? `${code} · ${product?.productName ?? ""}` : "Original finish"}
                </span>
                {product?.isDemo && <span className="block text-[11px] font-semibold text-warn">DEMO · not a real product</span>}
                {s?.status === "warning" && <span className="block text-[11px] font-medium text-warn">⚠ Texture unavailable</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
