"use client";

import { useEffect, useState } from "react";
import type { Product } from "@/lib/catalogue/schema";
import { fetchCatalogue, type CatalogueResponse } from "@/lib/catalogue/client";
import type { RegionState } from "./RegionBar";
import Swatch from "./Swatch";

const PAGE_SIZE = 24;

interface Props {
  activeRegionLabel: string;
  selectedCode?: string;
  selectedProduct?: Product;
  selectedState?: RegionState;
  onSelect: (p: Product) => void;
}

type Filters = { brand: string; board: string; category: string; colourFamily: string; finish: string };
const NO_FILTERS: Filters = { brand: "", board: "", category: "", colourFamily: "", finish: "" };

export default function MaterialPanel({ activeRegionLabel, selectedCode, selectedProduct, selectedState, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CatalogueResponse | null>(null);
  const [items, setItems] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Any change to search or filters restarts at page 1.
  useEffect(() => setPage(1), [debounced, filters]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchCatalogue(
      {
        q: debounced,
        category: filters.category ? [filters.category] : [],
        colourFamily: filters.colourFamily ? [filters.colourFamily] : [],
        finish: filters.finish ? [filters.finish] : [],
        brand: filters.brand ? [filters.brand] : [],
        board: filters.board ? [filters.board] : [],
        page,
        pageSize: PAGE_SIZE,
      },
      ctrl.signal,
    )
      .then((res) => {
        setData(res);
        setItems((prev) => (page === 1 ? res.items : [...prev, ...res.items]));
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [debounced, filters, page]);

  const facetSelect = (key: keyof Filters, label: string) => (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-muted">
      {label}
      <select
        value={filters[key]}
        onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm normal-case tracking-normal text-ink"
        data-testid={`filter-${key}`}
      >
        <option value="">All</option>
        {(data?.facets[key] ?? []).map((f) => (
          <option key={f.value} value={f.value}>
            {f.value} ({f.count})
          </option>
        ))}
        {filters[key] && !data?.facets[key].some((f) => f.value === filters[key]) && <option value={filters[key]}>{filters[key]} (0)</option>}
      </select>
    </label>
  );

  const anyFilter = query || Object.values(filters).some(Boolean);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-line px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-lg">Panel finishes</h2>
          <span className="truncate text-xs text-muted">
            Applying to <strong className="font-semibold text-ink" data-testid="active-region-label">{activeRegionLabel}</strong>
          </span>
        </div>

        {selectedProduct && <SelectedDetails product={selectedProduct} state={selectedState} />}

        <div className="relative">
          <label htmlFor="panel-search" className="sr-only">
            Search by panel code or name
          </label>
          <input
            id="panel-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Item ID or name, e.g. 1-669 or walnut"
            className="w-full rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-sm placeholder:text-[#8d877e]"
            autoComplete="off"
            data-testid="panel-search"
          />
        </div>
        <div className="grid grid-cols-3 gap-2 lg:grid-cols-3">
          {(data?.facets.brand.length ?? 0) > 0 && facetSelect("brand", "Brand")}
          {(data?.facets.board.length ?? 0) > 0 && facetSelect("board", "Board")}
          {facetSelect("category", "Collection")}
          {facetSelect("colourFamily", "Colour")}
          {facetSelect("finish", "Finish")}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-busy={loading}>
        {data && !data.isDemo && (
          <p className="mb-3 rounded-lg bg-canvas px-3 py-2 text-[12px] leading-snug text-muted" data-testid="colour-disclaimer">
            Colours may vary on screen. Please check with an original sample before ordering. Colour groups are estimated from the swatch images.
          </p>
        )}
        {data?.isDemo && (
          <p className="mb-3 rounded-lg bg-canvas px-3 py-2 text-[12px] leading-snug text-muted" data-testid="demo-disclaimer">
            <strong className="text-ink">Demonstration catalogue.</strong> Codes marked DEMO, names, textures and specifications are synthetic
            placeholders, not genuine Target products, stock or prices.
          </p>
        )}
        <div className="mb-2 flex items-center justify-between text-xs text-muted" aria-live="polite">
          <span data-testid="result-count">{data ? `${data.total} panel${data.total === 1 ? "" : "s"}` : " "}</span>
          {anyFilter && (
            <button
              type="button"
              className="font-medium text-accent hover:underline"
              onClick={() => {
                setQuery("");
                setFilters(NO_FILTERS);
              }}
            >
              Clear search
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-warn-soft p-3 text-sm text-warn" role="alert">
            {error}{" "}
            <button type="button" className="font-medium underline" onClick={() => setFilters((f) => ({ ...f }))}>
              Retry
            </button>
          </div>
        )}
        {!error && !loading && items.length === 0 && (
          <p className="py-10 text-center text-sm text-muted" data-testid="empty-results">
            No panels match “{debounced || "these filters"}”. Try a different code, name or filter.
          </p>
        )}

        <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-3" data-testid="product-grid">
          {items.map((p) => {
            const selected = p.panelCode === selectedCode;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p)}
                  aria-pressed={selected}
                  data-testid={`product-${p.panelCode}`}
                  className={`group w-full overflow-hidden rounded-xl border text-left transition ${
                    selected ? "border-accent ring-2 ring-accent" : "border-line hover:border-[#c9c1b5] hover:shadow-sm"
                  }`}
                >
                  <span className="relative block aspect-square">
                    <Swatch product={p} className="h-full w-full" />
                    {selected && (
                      <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-[11px] text-white" aria-hidden>
                        ✓
                      </span>
                    )}
                  </span>
                  <span className="block px-2 py-1.5">
                    <span className="block truncate text-[11px] font-semibold tracking-wide">{p.panelCode}</span>
                    <span className="block truncate text-[12px] text-muted">{p.productName}</span>
                    <span className="block truncate text-[11px] text-muted">{p.finish !== "Not stated" ? p.finish : (p.board ?? p.category)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {data && data.page < data.pageCount && (
          <button type="button" onClick={() => setPage((n) => n + 1)} disabled={loading} className="mx-auto mt-4 block rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-canvas disabled:opacity-50">
            {loading ? "Loading…" : `Show more (${data.total - items.length} remaining)`}
          </button>
        )}
        {loading && items.length === 0 && !error && <p className="py-8 text-center text-sm text-muted">Loading catalogue…</p>}
      </div>
    </div>
  );
}

function SelectedDetails({ product: p, state }: { product: Product; state?: RegionState }) {
  const specs: [string, string][] = [];
  if (p.brand) specs.push(["Brand", p.brand]);
  if (p.board) specs.push(["Board", p.board]);
  specs.push(["Collection", p.category]);
  specs.push(["Finish", p.finish]);
  specs.push(["Colour", p.colourFamilySource === "swatch-estimate" ? `${p.colourFamily} (estimated)` : p.colourFamily]);
  if (p.thicknessMm) specs.push(["Thickness", `${p.thicknessMm} mm`]);
  if (p.widthMm && p.heightMm) specs.push(["Sheet", `${p.widthMm} × ${p.heightMm} mm`]);
  if (p.madeIn) specs.push(["Made in", p.madeIn]);
  if (p.sourceDocument) specs.push(["Source", `${p.sourceDocument}${p.sourcePage ? `, p. ${p.sourcePage}` : ""}`]);
  return (
    <div className="flex gap-3 rounded-xl border border-line p-2.5" data-testid="selected-details">
      <Swatch product={p} className="h-11 w-11 shrink-0 rounded-lg lg:h-16 lg:w-16" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {p.panelCode} <span className="font-normal text-muted">· {p.productName}</span>
        </p>
        <p className="truncate text-[12px] text-muted lg:hidden">
          {[p.brand, p.board, p.category, p.widthMm && p.heightMm ? `${p.widthMm}×${p.heightMm} mm` : null].filter(Boolean).join(" · ")}
        </p>
        {/* Full specification list on large screens; phones keep the grid visible instead. */}
        <dl className="mt-1 hidden grid-cols-[auto_1fr] gap-x-2 text-[12px] leading-5 lg:grid">
          {specs.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="truncate">{v}</dd>
            </div>
          ))}
          {state?.roughness !== undefined && (
            <>
              <dt className="text-muted">Sheen</dt>
              <dd className="truncate">
                roughness {state.roughness.toFixed(2)}
                {state.roughnessSource === "finish-default" && <span className="text-muted"> (estimated from finish)</span>}
                {state.roughnessSource === "fallback" && <span className="text-muted"> (estimate: finish not stated)</span>}
              </dd>
            </>
          )}
        </dl>
        {state?.status === "warning" && state.warning && <p className="mt-1.5 text-[12px] font-medium text-warn">⚠ {state.warning}</p>}
        {p.isDemo && <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-accent">Demo product · not for ordering</p>}
      </div>
    </div>
  );
}
