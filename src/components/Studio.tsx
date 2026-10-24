"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/lib/catalogue/schema";
import { fetchCatalogue } from "@/lib/catalogue/client";
import { DEFAULT_MODEL_ID, KITCHEN_MODELS, getModel } from "@/lib/models/registry";
import { REGION_IDS, REGION_LABELS, type RegionId } from "@/lib/models/regions";
import type { KitchenViewer, LoadReport } from "@/lib/scene/kitchenViewer";
import type { CameraState, KitchenModelDefinition } from "@/lib/models/types";
import * as D from "@/lib/designs/model";
import { loadDesigns, storeDesigns } from "@/lib/designs/storage";
import { buildShareUrl, decodeShareToken, SHARE_PARAM } from "@/lib/designs/share";
import { buildSummary } from "@/lib/designs/summary";
import MaterialPanel from "./MaterialPanel";
import RegionBar, { type RegionState } from "./RegionBar";
import Viewport from "./Viewport";
import DesignsDialog, { type DesignActions } from "./DesignsDialog";
import SummaryDialog from "./SummaryDialog";
import QuoteDialog from "./QuoteDialog";

type Selections = D.Selections;
type DialogName = "designs" | "summary" | "quote" | null;

export default function Studio() {
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const model = useMemo(() => getModel(modelId) ?? KITCHEN_MODELS[0]!, [modelId]);
  const [viewer, setViewerState] = useState<KitchenViewer | null>(null);
  const viewerRef = useRef<KitchenViewer | null>(null);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionId[]>([]);
  const [activeRegion, setActiveRegion] = useState<RegionId>("lower_cabinets");
  const [selections, setSelections] = useState<Selections>({});
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [regionState, setRegionState] = useState<Partial<Record<RegionId, RegionState>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const applied = useRef<Partial<Record<RegionId, string>>>({});
  const pendingCamera = useRef<CameraState | null>(null);

  const [designs, setDesigns] = useState<D.SavedDesign[]>([]);
  const [storageError, setStorageError] = useState<string | undefined>();
  const [current, setCurrent] = useState<{ designId?: string; variantId?: string }>({});
  const [sharedName, setSharedName] = useState<{ designName?: string; variantName?: string } | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);

  const setViewer = useCallback((v: KitchenViewer | null) => {
    viewerRef.current = v;
    setViewerState(v);
  }, []);

  const rememberProducts = useCallback((list: Product[]) => {
    setProducts((prev) => {
      if (list.every((p) => prev[p.panelCode] === p)) return prev;
      const next = { ...prev };
      for (const p of list) next[p.panelCode] = p;
      return next;
    });
  }, []);

  /** Picks, per region, the first default candidate that exists in the loaded catalogue. */
  const applyDefaults = useCallback(
    async (m: KitchenModelDefinition) => {
      const candidates = [...new Set(Object.values(m.defaults).flatMap((c) => [...(c ?? [])]))];
      try {
        const res = await fetchCatalogue({ codes: candidates, pageSize: 60 });
        rememberProducts(res.items);
        const found = new Set(res.items.map((p) => p.panelCode));
        const next: Selections = {};
        for (const [region, list] of Object.entries(m.defaults) as [RegionId, readonly string[]][]) {
          const code = list.find((c) => found.has(c));
          if (code) next[region] = code;
        }
        setSelections(next);
      } catch (err) {
        setNotice(`Could not load the starting panels: ${(err as Error).message}`);
      }
    },
    [rememberProducts],
  );

  /** Shows a saved or shared design: layout, panels and camera. Codes not in the catalogue are reported, never replaced. */
  const showSnapshot = useCallback(
    (snap: D.DesignSnapshot) => {
      const m = getModel(snap.modelId);
      if (!m) {
        setNotice(`This design uses a kitchen layout ("${snap.modelId}") that is not available here. The current layout was kept.`);
        return false;
      }
      pendingCamera.current = snap.camera ?? null;
      if (m.id !== modelId) setModelId(m.id);
      else if (snap.camera) viewerRef.current?.setCameraState(snap.camera);
      setSelections({ ...snap.selections });
      return true;
    },
    [modelId],
  );

  // First load: saved designs from this browser, then either a shared link or the default panels.
  useEffect(() => {
    const { designs: stored, error } = loadDesigns();
    setDesigns(stored);
    setStorageError(error);
    const token = new URLSearchParams(window.location.search).get(SHARE_PARAM);
    if (token) {
      const shared = decodeShareToken(token);
      // Remove the parameter so later edits are not mistaken for the shared version.
      window.history.replaceState(null, "", window.location.pathname);
      if (shared && showSnapshot(shared)) {
        setSharedName({ designName: shared.designName, variantName: shared.variantName });
        setNotice(`Opened a shared design${shared.designName ? `: ${shared.designName}` : ""}${shared.variantName ? ` (${shared.variantName})` : ""}. Save it to keep a copy in this browser.`);
        return;
      }
      setNotice("This share link is damaged or incomplete, so the standard design is shown instead.");
    }
    void applyDefaults(model);
    // First load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onModelLoaded = useCallback((report: LoadReport) => {
    applied.current = {};
    const available = REGION_IDS.filter((r) => report.regionMeshCounts[r]);
    setRegions(available);
    setRegionState({});
    setActiveRegion((cur) => (available.includes(cur) ? cur : (available[0] ?? cur)));
    setLoadedModelId(report.modelId);
    if (pendingCamera.current) {
      viewerRef.current?.setCameraState(pendingCamera.current, false);
      pendingCamera.current = null;
    }
    if (report.emptyRegions.length) setNotice(`This model declares regions with no meshes: ${report.emptyRegions.join(", ")}. Check its mesh mapping.`);
  }, []);

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
          setNotice(`Panel ${[...new Set(lost)].join(", ")} is not in the published catalogue, so it was not applied. That region keeps its plain finish until you choose a panel.`);
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
    void applyDefaults(next);
  };

  const resetDesign = () => {
    void applyDefaults(model);
    viewer?.resetCamera();
    setNotice(null);
  };

  // ---------- saved designs ----------
  const currentDesign = designs.find((d) => d.id === current.designId);
  const currentVariant = currentDesign?.variants.find((v) => v.id === current.variantId);
  // Only regions this layout has count; codes for other layouts' regions are ignored.
  const visibleSelections = useMemo(() => {
    if (!regions.length) return selections;
    return Object.fromEntries(Object.entries(selections).filter(([r]) => regions.includes(r as RegionId))) as Selections;
  }, [selections, regions]);
  const dirty = !currentVariant || currentVariant.modelId !== model.id || !D.sameSelections(currentVariant.selections, visibleSelections);

  const snapshot = (): D.DesignSnapshot => ({ modelId: model.id, selections: visibleSelections, camera: viewerRef.current?.getCameraState() });

  /** Writes to browser storage first; the screen only changes if the write succeeded. */
  const commit = (next: D.SavedDesign[]): string | null => {
    const err = storeDesigns(next);
    if (err) return err;
    setDesigns(next);
    setStorageError(undefined);
    return null;
  };
  const guard = (fn: () => string | null): string | null => {
    try {
      return fn();
    } catch (e) {
      return (e as Error).message;
    }
  };

  const designActions: DesignActions = {
    saveNew: (name) =>
      guard(() => {
        const d = D.createDesign(name, snapshot(), sharedName?.variantName || "Variant A");
        const err = commit([d, ...designs]);
        if (!err) {
          setCurrent({ designId: d.id, variantId: d.activeVariantId });
          setSharedName(null);
        }
        return err;
      }),
    saveCurrent: () =>
      guard(() => {
        if (!currentDesign || !current.variantId) return "Nothing to save yet.";
        return commit(designs.map((d) => (d.id === currentDesign.id ? D.updateVariant(d, current.variantId!, snapshot()) : d)));
      }),
    addVariant: (name) =>
      guard(() => {
        if (!currentDesign) return "Save the design first.";
        const next = D.addVariant(currentDesign, snapshot(), name);
        const err = commit(designs.map((d) => (d.id === next.id ? next : d)));
        if (!err) setCurrent({ designId: next.id, variantId: next.activeVariantId });
        return err;
      }),
    open: (designId, variantId) => {
      const d = designs.find((x) => x.id === designId);
      const v = d?.variants.find((x) => x.id === (variantId ?? d.activeVariantId)) ?? d?.variants[0];
      if (!d || !v) return;
      if (showSnapshot(v)) {
        setCurrent({ designId: d.id, variantId: v.id });
        setSharedName(null);
        setNotice(null);
      }
    },
    renameDesign: (id, name) => guard(() => commit(designs.map((d) => (d.id === id ? D.renameDesign(d, name) : d)))),
    renameVariant: (id, vid, name) => guard(() => commit(designs.map((d) => (d.id === id ? D.renameVariant(d, vid, name) : d)))),
    deleteVariant: (id, vid) =>
      guard(() => {
        const d = designs.find((x) => x.id === id);
        if (!d) return null;
        const next = D.deleteVariant(d, vid);
        const err = commit(designs.map((x) => (x.id === id ? next : x)));
        if (!err && current.variantId === vid) designActions.open(id, next.activeVariantId);
        return err;
      }),
    deleteDesign: (id) =>
      guard(() => {
        const err = commit(designs.filter((d) => d.id !== id));
        if (!err && current.designId === id) setCurrent({});
        return err;
      }),
    startNew: () => {
      setCurrent({});
      setSharedName(null);
      resetDesign();
    },
  };

  const designName = currentDesign?.name ?? sharedName?.designName;
  const variantName = currentVariant?.name ?? sharedName?.variantName;
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const shareUrl = dialog
    ? buildShareUrl(origin, { modelId: model.id, selections: visibleSelections, camera: viewerRef.current?.getCameraState(), designName, variantName })
    : "";
  const summaryRows = buildSummary(regions, visibleSelections, products);

  const busy = Object.values(regionState).some((s) => s?.status === "loading");
  const btn = "shrink-0 whitespace-nowrap rounded-full border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-canvas sm:px-3 sm:py-2 sm:text-sm";

  return (
    <>
      <div id="studio-root" className="flex h-dvh flex-col">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-4 py-2.5 lg:px-6">
          <div className="min-w-0 flex-1 sm:flex-none">
            <p className="whitespace-nowrap font-display text-base leading-tight tracking-tight sm:text-xl">Target Kitchen Studio</p>
            <p className="truncate text-[11px] font-medium text-muted" data-testid="design-status">
              {designName ? (
                <>
                  {designName}
                  {variantName && ` · ${variantName}`}
                  {currentDesign && dirty && <span className="text-warn"> · unsaved changes</span>}
                  {!currentDesign && <span className="text-warn"> · not saved</span>}
                </>
              ) : (
                <span className="uppercase tracking-[0.12em]">Prototype · unsaved design</span>
              )}
            </p>
          </div>
          <button type="button" onClick={() => setDialog("quote")} className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white sm:order-last sm:px-4 sm:py-2 sm:text-sm" data-testid="open-quote">
            Request a quote
          </button>
          <nav className="flex w-full items-center gap-1.5 overflow-x-auto sm:ml-auto sm:w-auto sm:gap-2" aria-label="Design tools">
            <button type="button" onClick={() => setDialog("designs")} className={btn} data-testid="open-designs">
              Designs{designs.length ? ` (${designs.length})` : ""}
            </button>
            <button type="button" onClick={() => setDialog("summary")} className={btn} data-testid="open-summary">
              Summary<span className="hidden sm:inline"> &amp; share</span>
            </button>
            <label className="sr-only" htmlFor="layout">
              Kitchen layout
            </label>
            <select id="layout" value={modelId} onChange={(e) => changeModel(e.target.value)} className="min-w-0 max-w-56 flex-1 rounded-full sm:flex-none border border-line bg-surface px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm" data-testid="layout-select">
              {KITCHEN_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={resetDesign} className={btn} data-testid="reset-design">
              Reset<span className="hidden sm:inline"> panels</span>
            </button>
          </nav>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-4 lg:p-4">
          <main className="flex min-h-0 flex-col lg:min-w-0 lg:flex-1">
            <div className="h-[42svh] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
              <Viewport model={model} onViewer={setViewer} onModelLoaded={onModelLoaded} onRegionPicked={selectRegion} busy={busy} />
            </div>
            <RegionBar regions={regions} active={activeRegion} onSelect={selectRegion} selections={selections} products={products} state={regionState} />
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

      {dialog === "designs" && (
        <DesignsDialog designs={designs} currentDesign={currentDesign} currentVariantId={current.variantId} dirty={dirty} storageError={storageError} actions={designActions} onClose={() => setDialog(null)} />
      )}
      {dialog === "summary" && (
        <SummaryDialog
          regions={regions}
          selections={visibleSelections}
          products={products}
          layoutName={model.name}
          designName={designName}
          variantName={variantName}
          shareUrl={shareUrl}
          design={currentDesign}
          dirty={!!currentDesign && dirty}
          onProducts={rememberProducts}
          onQuote={() => setDialog("quote")}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "quote" && (
        <QuoteDialog rows={summaryRows} modelId={model.id} layoutName={model.name} selections={visibleSelections} designName={designName} variantName={variantName} shareUrl={shareUrl} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
