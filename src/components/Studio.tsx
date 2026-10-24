"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/lib/catalogue/schema";
import { fetchCatalogue } from "@/lib/catalogue/client";
import { DEFAULT_MODEL_ID, KITCHEN_MODELS, getModel } from "@/lib/models/registry";
import { REGION_IDS, REGION_LABELS, type RegionId } from "@/lib/models/regions";
import type { KitchenViewer, LoadReport } from "@/lib/scene/kitchenViewer";
import MaterialPanel from "./MaterialPanel";
import RegionBar, { type RegionState } from "./RegionBar";
import Viewport from "./Viewport";

type Selections = Partial<Record<RegionId, string>>;

export default function Studio() {
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const model = useMemo(() => getModel(modelId) ?? KITCHEN_MODELS[0]!, [modelId]);
  const [viewer, setViewer] = useState<KitchenViewer | null>(null);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionId[]>([]);
  const [activeRegion, setActiveRegion] = useState<RegionId>("lower_cabinets");
  const [selections, setSelections] = useState<Selections>({ ...model.defaults });
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [regionState, setRegionState] = useState<Partial<Record<RegionId, RegionState>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const applied = useRef<Partial<Record<RegionId, string>>>({});

  const rememberProducts = useCallback((list: Product[]) => {
    setProducts((prev) => {
      const next = { ...prev };
      for (const p of list) next[p.panelCode] = p;
      return next;
    });
  }, []);

  const onModelLoaded = useCallback(
    (report: LoadReport) => {
      applied.current = {};
      const available = REGION_IDS.filter((r) => report.regionMeshCounts[r]);
      setRegions(available);
      setRegionState({});
      setActiveRegion((cur) => (available.includes(cur) ? cur : (available[0] ?? cur)));
      setLoadedModelId(report.modelId);
      if (report.emptyRegions.length) setNotice(`This model declares regions with no meshes: ${report.emptyRegions.join(", ")}. Check its mesh mapping.`);
    },
    [],
  );

  // Make sure every selected panel code has its product record (one small request for all).
  useEffect(() => {
    const missing = Object.values(selections).filter((c): c is string => !!c && !products[c]);
    if (!missing.length) return;
    const ctrl = new AbortController();
    fetchCatalogue({ codes: [...new Set(missing)], pageSize: 60 }, ctrl.signal)
      .then((res) => {
        rememberProducts(res.items);
        const found = new Set(res.items.map((p) => p.panelCode));
        const lost = missing.filter((c) => !found.has(c));
        if (lost.length) {
          setNotice(`Panel ${[...new Set(lost)].join(", ")} is not in the published catalogue, so it was not applied.`);
          setSelections((s) => Object.fromEntries(Object.entries(s).filter(([, c]) => !lost.includes(c!))) as Selections);
        }
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setNotice(`Could not load panel details: ${(err as Error).message}`);
      });
    return () => ctrl.abort();
  }, [selections, products, rememberProducts]);

  // Push selections into the 3D scene. Only regions whose panel changed are touched.
  useEffect(() => {
    if (!viewer || loadedModelId !== model.id) return;
    for (const region of regions) {
      const code = selections[region];
      if (applied.current[region] === code) continue;
      if (!code) {
        viewer.resetRegion(region);
        applied.current[region] = undefined;
        setRegionState((s) => ({ ...s, [region]: undefined }));
        continue;
      }
      const product = products[code];
      if (!product) continue; // waits for the catalogue request above
      applied.current[region] = code;
      setRegionState((s) => ({ ...s, [region]: { code, status: "loading" } }));
      viewer.applyProduct(region, product).then((result) => {
        if (result.status === "stale") return;
        setRegionState((s) => ({
          ...s,
          [region]: {
            code,
            status: result.status === "placeholder" ? "warning" : "ok",
            warning: result.warning,
            roughness: result.spec?.roughness,
            roughnessSource: result.spec?.roughnessSource,
          },
        }));
        if (result.warning) setNotice(result.warning);
      });
    }
  }, [viewer, loadedModelId, model.id, regions, selections, products]);

  const selectProduct = (product: Product) => {
    rememberProducts([product]);
    setSelections((s) => ({ ...s, [activeRegion]: product.panelCode }));
  };

  const selectRegion = useCallback(
    (region: RegionId) => {
      setActiveRegion(region);
      viewer?.flashRegion(region);
    },
    [viewer],
  );

  const changeModel = (id: string) => {
    const next = getModel(id);
    if (!next) return;
    setModelId(id);
    setSelections({ ...next.defaults });
  };

  const resetDesign = () => {
    setSelections({ ...model.defaults });
    viewer?.resetCamera();
    setNotice(null);
  };

  const busy = Object.values(regionState).some((s) => s?.status === "loading");

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 lg:px-6">
        <div className="min-w-0">
          <p className="whitespace-nowrap font-display text-base leading-tight tracking-tight sm:text-xl">
            Target Kitchen Studio
          </p>
          <p className="hidden whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.12em] text-muted sm:block">Prototype · demo panels</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="sr-only" htmlFor="layout">
            Kitchen layout
          </label>
          <select
            id="layout"
            value={modelId}
            onChange={(e) => changeModel(e.target.value)}
            className="w-[32vw] max-w-64 rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs sm:w-auto sm:px-3 sm:py-2 sm:text-sm"
            data-testid="layout-select"
          >
            {KITCHEN_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={resetDesign} className="rounded-full border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-canvas sm:px-3 sm:py-2 sm:text-sm" data-testid="reset-design">
            Reset<span className="hidden sm:inline"> design</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-4 lg:p-4">
        <main className="flex min-h-0 flex-col lg:min-w-0 lg:flex-1">
          <div className="h-[46svh] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
            <Viewport model={model} onViewer={setViewer} onModelLoaded={onModelLoaded} onRegionPicked={selectRegion} busy={busy} />
          </div>
          <RegionBar
            regions={regions}
            active={activeRegion}
            onSelect={selectRegion}
            selections={selections}
            products={products}
            state={regionState}
          />
        </main>

        <aside className="flex min-h-0 flex-1 flex-col border-t border-line bg-surface lg:w-[400px] lg:flex-none lg:rounded-2xl lg:border lg:shadow-sm xl:w-[440px]">
          {notice && (
            <div className="flex items-start gap-2 border-b border-[#f1d9b5] bg-warn-soft px-4 py-2.5 text-sm text-warn" role="alert" data-testid="notice">
              <span className="flex-1">{notice}</span>
              <button type="button" onClick={() => setNotice(null)} className="shrink-0 rounded px-1 font-medium" aria-label="Dismiss message">
                ✕
              </button>
            </div>
          )}
          <MaterialPanel
            activeRegionLabel={REGION_LABELS[activeRegion]}
            selectedCode={selections[activeRegion]}
            selectedProduct={selections[activeRegion] ? products[selections[activeRegion]!] : undefined}
            selectedState={regionState[activeRegion]?.code === selections[activeRegion] ? regionState[activeRegion] : undefined}
            onSelect={selectProduct}
          />
        </aside>
      </div>
    </div>
  );
}
