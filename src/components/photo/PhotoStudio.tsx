"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/lib/catalogue/schema";
import { fetchCatalogue } from "@/lib/catalogue/client";
import { compositeAll, computeShading, type RegionLayer } from "@/lib/photo/composite";
import { blobToImageData, canvasToBlob, imageDataToCanvas, loadPhotoFile, loadProductMaterial, PhotoError, type MaterialResult } from "@/lib/photo/browserImage";
import { countSelected, isEmpty, type Mask } from "@/lib/photo/mask";
import { repeatIsAssumed, surfaceMapping } from "@/lib/photo/materials";
import type { Quad } from "@/lib/photo/perspective";
import { PHOTO_REGION_IDS, PHOTO_REGION_LABELS, type PhotoRegionId } from "@/lib/photo/regions";
import * as S from "@/lib/photo/state";
import { createPhotoDesignMeta, describePanels, panelsToText, type PhotoDesignRecord } from "@/lib/photo/design";
import { deletePhotoDesign, listPhotoDesigns, savePhotoDesign } from "@/lib/photo/designStore";
import { previewDataUrl, renderExportCanvas } from "@/lib/photo/exportImage";
import { getSegmentationService } from "@/lib/photo/segmentation";
import MaterialPanel from "../MaterialPanel";
import QuoteDialog from "../QuoteDialog";
import type { RegionState as PanelState } from "../RegionBar";
import PhotoUpload from "./PhotoUpload";
import PhotoCanvas, { type Tool, type View } from "./PhotoCanvas";
import PhotoToolbar from "./PhotoToolbar";
import PhotoRegionBar from "./PhotoRegionBar";
import PhotoAdjust from "./PhotoAdjust";
import PhotoSummary from "./PhotoSummary";
import { PhotoDesignsDialog, SavePhotoDialog } from "./PhotoDesignsDialogs";
import FullSizeView from "./FullSizeView";

interface Photo {
  image: ImageData;
  fileName: string;
  /** Size as taken, before resizing for editing. */
  originalWidth: number;
  originalHeight: number;
  /** False when reopened from a saved design whose photo was not kept (only its preview). */
  editable: boolean;
}

type Dialog = "save" | "designs" | "quote" | "full" | null;
type Tab = "finish" | "adjust" | "summary";

export default function PhotoStudio({ modeSwitch, active }: { modeSwitch: React.ReactNode; active: boolean }) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [doc, setDocState] = useState<S.PhotoDoc | null>(null);
  const docRef = useRef<S.PhotoDoc | null>(null);
  const [hist, setHist] = useState<S.History<S.SerializedDoc> | null>(null);
  const [activeRegion, setActiveRegion] = useState<PhotoRegionId>("lower_cabinets");
  const [tool, setTool] = useState<Tool>("smart");
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [brushSize, setBrushSize] = useState(14);
  const [tolerance, setTolerance] = useState(16);
  const [view, setView] = useState<View>("preview");
  const [showOverlay, setShowOverlay] = useState(true);
  const [tab, setTab] = useState<Tab>("finish");
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [materials, setMaterials] = useState<Record<string, MaterialResult>>({});
  const [panelState, setPanelState] = useState<Partial<Record<PhotoRegionId, PanelState>>>({});
  const [composite, setComposite] = useState<ImageData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saved, setSaved] = useState<PhotoDesignRecord[]>([]);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ id: string; name: string; createdAt: string; notes?: string } | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [segMessage, setSegMessage] = useState<string>("");

  const W = photo?.image.width ?? 0, H = photo?.image.height ?? 0;

  useEffect(() => {
    void getSegmentationService()
      .status()
      .then((s) => setSegMessage(s.message));
  }, []);

  const refreshSaved = useCallback(async () => {
    try {
      const { designs, skipped } = await listPhotoDesigns();
      setSaved(designs);
      setSavedError(skipped ? `${skipped} saved photo design(s) were damaged and could not be opened.` : null);
    } catch (err) {
      setSavedError((err as Error).message);
    }
  }, []);
  useEffect(() => void refreshSaved(), [refreshSaved]);

  // ---------- document and history ----------
  const setDoc = (d: S.PhotoDoc | null) => {
    docRef.current = d;
    setDocState(d);
  };
  /** Changes the document and records an undo step. */
  const commit = useCallback((next: S.PhotoDoc) => {
    docRef.current = next;
    setDocState(next);
    setHist((h) => (h ? S.pushHistory(h, S.serializeDoc(next)) : S.startHistory(S.serializeDoc(next))));
  }, []);
  /** Live change while a slider is dragged; `checkpoint` records the undo step when it is released. */
  const preview = useCallback((next: S.PhotoDoc) => {
    docRef.current = next;
    setDocState(next);
  }, []);
  const checkpoint = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    setHist((h) => {
      if (!h) return h;
      const s = S.serializeDoc(d);
      return JSON.stringify(s) === JSON.stringify(h.present) ? h : S.pushHistory(h, s);
    });
  }, []);
  const restore = (h: S.History<S.SerializedDoc>) => {
    setHist(h);
    setDoc(S.deserializeDoc(h.present));
  };
  const canUndo = !!hist?.past.length;
  const canRedo = !!hist?.future.length;
  const doUndo = useCallback(() => hist && hist.past.length && restore(S.undo(hist)), [hist]);
  const doRedo = useCallback(() => hist && hist.future.length && restore(S.redo(hist)), [hist]);

  useEffect(() => {
    if (!active || !photo) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=dialog]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, photo, doUndo, doRedo]);

  // ---------- products and textures ----------
  const remember = useCallback((list: Product[]) => setProducts((prev) => ({ ...prev, ...Object.fromEntries(list.map((p) => [p.panelCode, p])) })), []);

  const ensureMaterial = useCallback(
    async (p: Product): Promise<MaterialResult> => {
      const cached = materials[p.panelCode];
      if (cached?.ok) return cached;
      const res = await loadProductMaterial(p);
      setMaterials((m) => ({ ...m, [p.panelCode]: res }));
      return res;
    },
    [materials],
  );

  const selectProduct = async (p: Product) => {
    const region = activeRegion;
    remember([p]);
    setPanelState((s) => ({ ...s, [region]: { code: p.panelCode, status: "loading" } }));
    const res = await ensureMaterial(p);
    if (!res.ok) {
      // Not applied: the region keeps its previous finish. No other panel is substituted.
      setPanelState((s) => ({ ...s, [region]: { code: p.panelCode, status: "warning", warning: res.reason } }));
      setNotice(res.reason);
      return;
    }
    setPanelState((s) => ({ ...s, [region]: { code: p.panelCode, status: "ok" } }));
    const d = docRef.current;
    if (!d) return;
    commit(S.assignPanel(d, region, p.panelCode));
    if (isEmpty(d.masks[region])) setNotice(`${p.panelCode} is set for ${PHOTO_REGION_LABELS[region]}. Now mark those cabinets on the photo (click a door with Smart select, or paint with the Brush).`);
    else setNotice(null);
  };

  // ---------- compositing ----------
  const shading = useMemo(() => (photo ? computeShading(photo.image, 2) : null), [photo]);

  const layers = useMemo(() => {
    const out: (RegionLayer & { region: PhotoRegionId })[] = [];
    if (!doc) return out;
    for (const r of PHOTO_REGION_IDS) {
      const code = doc.regions[r].panelCode;
      const mat = code ? materials[code] : undefined;
      const product = code ? products[code] : undefined;
      if (!code || !mat?.ok || !product || isEmpty(doc.masks[r])) continue;
      out.push({ region: r, mask: doc.masks[r], material: mat.material, mapping: surfaceMapping(product, doc.regions[r]) });
    }
    return out;
  }, [doc, materials, products]);
  const applied = useMemo(() => new Set(layers.map((l) => l.region)), [layers]);

  useEffect(() => {
    if (!photo || !doc || !shading) return;
    if (!layers.length) {
      setComposite(null);
      return;
    }
    const t = setTimeout(() => {
      const data = compositeAll(photo.image, layers, shading, doc.shadingStrength);
      setComposite(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, photo.image.width, photo.image.height));
    }, 30);
    return () => clearTimeout(t);
  }, [photo, doc, layers, shading]);

  // Read-only hook for the automated browser tests (scripts/e2e-photo.mjs), like window.__kitchenViewer.
  useEffect(() => {
    (window as unknown as { __photoStudio?: object }).__photoStudio = { doc, original: photo?.image ?? null, composite };
  }, [doc, photo, composite]);

  // ---------- loading a photo ----------
  const startWith = (p: Photo, d: S.PhotoDoc) => {
    setPhoto(p);
    setDoc(d);
    setHist(S.startHistory(S.serializeDoc(d)));
    setComposite(null);
    setView("preview");
    setTool("smart");
    setMode("add");
    setBrushSize(Math.max(4, Math.round(Math.max(p.image.width, p.image.height) / 90)));
    setPanelState({});
  };

  const useFile = async (file: File): Promise<string | null> => {
    try {
      const loaded = await loadPhotoFile(file);
      startWith({ image: loaded.image, fileName: loaded.fileName, originalWidth: loaded.originalWidth, originalHeight: loaded.originalHeight, editable: true }, S.createDoc(loaded.image.width, loaded.image.height));
      setCurrent(null);
      setSavedSnapshot(null);
      setNotice(
        `Photo ready (${loaded.image.width} × ${loaded.image.height} px for editing${loaded.originalWidth > loaded.image.width ? `, resized from ${loaded.originalWidth} × ${loaded.originalHeight}` : ""}${loaded.rotatedManually ? ", turned upright" : ""}). Choose an area below, then click a cabinet door.`,
      );
      return null;
    } catch (err) {
      return err instanceof PhotoError ? err.message : `The photo could not be prepared: ${(err as Error).message}`;
    }
  };

  const hasWork = !!doc && PHOTO_REGION_IDS.some((r) => !isEmpty(doc.masks[r]) || doc.regions[r].panelCode);
  const docKey = doc && hist ? JSON.stringify(hist.present) : null;
  const unsaved = hasWork && docKey !== savedSnapshot;

  const removePhoto = () => {
    if (unsaved && !window.confirm("Remove this photo? Selections and finishes that are not saved will be lost.")) return;
    setPhoto(null);
    setDoc(null);
    setHist(null);
    setComposite(null);
    setCurrent(null);
    setNotice(null);
  };

  // ---------- editing callbacks ----------
  const onEdit = useCallback(
    (target: S.MaskTarget, mask: Mask, m: "add" | "remove", usedTool: Tool) => {
      const d = docRef.current;
      if (!d) return;
      if (isEmpty(mask)) return;
      const next = S.applyMaskEdit(d, target, mask, m);
      commit(next);
      const share = countSelected(mask) / (d.width * d.height);
      if (target !== "protect" && m === "add" && countSelected(next.masks[target]) === countSelected(d.masks[target]))
        setNotice("Nothing was added there. The spot may be protected, or already selected.");
      else if (usedTool === "smart" && m === "add" && share > 0.15)
        setNotice(
          `That click selected ${Math.round(share * 100)}% of the photo, which usually means it spread past the cabinet (common on glossy doors and reflections). Press Undo, then lower the colour range, protect the surrounding area, or outline the doors with the Shape tool.`,
        );
    },
    [commit],
  );

  const onGuide = useCallback(
    (region: PhotoRegionId, quad: Quad) => {
      const d = docRef.current;
      if (!d) return;
      try {
        commit(S.updateLook(d, region, { guide: quad, guideAdjusted: true }));
      } catch (err) {
        setNotice((err as Error).message);
      }
    },
    [commit],
  );

  const resetToOriginal = () => {
    if (!photo) return;
    commit(S.createDoc(photo.image.width, photo.image.height));
    setPanelState({});
    setView("preview");
    setNotice("All selections and finishes were removed, so the original photo is shown. Use Undo to bring them back.");
  };

  // ---------- summary, export, save, quote ----------
  const productNames = useMemo(() => Object.fromEntries(Object.values(products).map((p) => [p.panelCode, p.productName])), [products]);
  const panels = doc ? describePanels(doc, productNames) : [];
  const currentImage = composite ?? photo?.image ?? null;

  const download = async () => {
    if (!currentImage) return;
    try {
      const blob = await canvasToBlob(renderExportCanvas(currentImage, panels), "image/jpeg", 0.92);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kitchen-preview-${new Date().toISOString().slice(0, 10)}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setNotice(`The preview could not be exported: ${(err as Error).message}`);
    }
  };

  const save = async (input: { name: string; notes: string; keepOriginal: boolean; asNew: boolean }): Promise<string | null> => {
    if (!photo || !doc || !currentImage) return "Nothing to save yet.";
    try {
      const updating = current && !input.asNew;
      const meta = createPhotoDesignMeta({
        id: updating ? current.id : undefined,
        createdAt: updating ? current.createdAt : undefined,
        name: input.name,
        notes: input.notes,
        keepsOriginal: input.keepOriginal && photo.editable,
        sourceFileName: photo.fileName,
        doc,
        productNames,
      });
      const previewBlob = await canvasToBlob(imageDataToCanvas(currentImage), "image/jpeg", 0.88);
      const original = meta.keepsOriginal ? await canvasToBlob(imageDataToCanvas(photo.image), "image/jpeg", 0.92) : undefined;
      const others = saved.filter((d) => d.id !== meta.id).length;
      await savePhotoDesign({ ...meta, preview: previewBlob, original }, others);
      setCurrent({ id: meta.id, name: meta.name, createdAt: meta.createdAt, notes: meta.notes });
      setSavedSnapshot(docKey);
      await refreshSaved();
      setNotice(`Saved “${meta.name}” in this browser${meta.keepsOriginal ? "" : " (preview only: the photo itself was not kept, so it cannot be edited again later)"}.`);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  };

  const open = async (rec: PhotoDesignRecord) => {
    try {
      const codes = rec.panels.map((p) => p.panelCode);
      const found: Product[] = codes.length ? (await fetchCatalogue({ codes, pageSize: 60 })).items : [];
      remember(found);
      const byCode = new Set(found.map((p) => p.panelCode));
      const lost = codes.filter((c) => !byCode.has(c));
      const mats = await Promise.all(found.map(async (p) => [p.panelCode, await loadProductMaterial(p)] as const));
      setMaterials((m) => ({ ...m, ...Object.fromEntries(mats) }));
      const unusable = mats.filter(([, r]) => !r.ok).map(([c]) => c);
      let d: S.PhotoDoc;
      let image: ImageData;
      const messages: string[] = [];
      if (rec.keepsOriginal && rec.original) {
        image = await blobToImageData(rec.original);
        d = S.deserializeDoc(rec.state, { width: image.width, height: image.height });
        for (const r of PHOTO_REGION_IDS) if (d.regions[r].panelCode && (lost.includes(d.regions[r].panelCode!) || unusable.includes(d.regions[r].panelCode!))) d = S.assignPanel(d, r, undefined);
      } else {
        image = await blobToImageData(rec.preview);
        d = S.createDoc(image.width, image.height);
        messages.push(`The original photo was not kept with this design, so its saved preview is shown and cannot be edited. Panels in it: ${panelsToText(rec.panels).replace(/\n/g, "; ")}.`);
      }
      if (lost.length) messages.push(`Panel ${lost.join(", ")} is no longer in the catalogue, so it was not applied. Choose another panel for that area.`);
      if (unusable.length) messages.push(`The texture for ${unusable.join(", ")} could not be loaded, so it was not applied.`);
      startWith({ image, fileName: rec.sourceFileName ?? rec.name, originalWidth: image.width, originalHeight: image.height, editable: rec.keepsOriginal }, d);
      setCurrent({ id: rec.id, name: rec.name, createdAt: rec.createdAt, notes: rec.notes });
      setSavedSnapshot(lost.length || unusable.length ? null : JSON.stringify(S.serializeDoc(d)));
      setDialog(null);
      setNotice(messages.length ? messages.join(" ") : `Opened “${rec.name}”.`);
    } catch (err) {
      setNotice(`This design could not be opened: ${(err as Error).message}`);
    }
  };

  const remove = async (id: string): Promise<string | null> => {
    try {
      await deletePhotoDesign(id);
      if (current?.id === id) setCurrent(null);
      await refreshSaved();
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  };

  // ---------- rendering ----------
  const btn = "shrink-0 whitespace-nowrap rounded-full border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-canvas disabled:opacity-40 sm:px-3 sm:py-2 sm:text-sm";
  const assignedCode = doc?.regions[activeRegion].panelCode;
  const ps = panelState[activeRegion];
  const activeProduct = assignedCode ? products[assignedCode] : undefined;

  const hint = (() => {
    if (!doc) return "";
    if (!photo?.editable) return "This saved preview cannot be edited because its original photo was not kept.";
    const anyMask = PHOTO_REGION_IDS.some((r) => !isEmpty(doc.masks[r]));
    if (!anyMask) return `Step 1 · Choose an area below, then click a cabinet door with Smart select or paint it with the Brush. Use Protect for worktops, appliances and handles.`;
    if (!panels.length) return "Step 2 · Choose a panel finish for the selected area from the list.";
    if (!doc.regions[activeRegion].guideAdjusted && !isEmpty(doc.masks[activeRegion]))
      return "Step 3 · For realistic grain, use the Guide tool and drag its four corners onto the edges of one cabinet face.";
    return "Compare with the original, then save the design, download the preview or request a quote.";
  })();

  return (
    <>
      <div id="photo-root" className="flex min-h-dvh flex-col lg:h-dvh" data-testid="photo-studio">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-4 py-2.5 lg:px-6">
          <div className="min-w-0 flex-1 sm:flex-none">
            <p className="whitespace-nowrap font-display text-base leading-tight tracking-tight sm:text-xl">Target Kitchen Studio</p>
            <p className="truncate text-[11px] font-medium text-muted" data-testid="photo-design-status">
              {current ? (
                <>
                  {current.name}
                  {unsaved && <span className="text-warn"> · unsaved changes</span>}
                </>
              ) : (
                <span className="uppercase tracking-[0.12em]">My Kitchen Photo{hasWork ? " · not saved" : ""}</span>
              )}
            </p>
          </div>
          {modeSwitch}
          {photo && (
            <button type="button" onClick={() => setDialog("quote")} disabled={!panels.length} className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 sm:order-last sm:px-4 sm:py-2 sm:text-sm" data-testid="photo-open-quote">
              Request a quote
            </button>
          )}
          <nav className="flex w-full items-center gap-1.5 overflow-x-auto sm:ml-auto sm:w-auto sm:gap-2" aria-label="Photo design tools">
            <button type="button" onClick={() => setDialog("designs")} className={btn} data-testid="photo-open-designs">
              Saved photos{saved.length ? ` (${saved.length})` : ""}
            </button>
            {photo && (
              <>
                <button type="button" onClick={() => setDialog("save")} disabled={!hasWork} className={btn} data-testid="photo-save">
                  Save design
                </button>
                <button type="button" onClick={download} className={btn} data-testid="photo-download">
                  Download<span className="hidden sm:inline"> preview</span>
                </button>
                <button type="button" onClick={removePhoto} className={btn} data-testid="photo-new">
                  New photo
                </button>
              </>
            )}
          </nav>
        </header>

        {!photo || !doc ? (
          <div className="flex-1 overflow-y-auto">
            <PhotoUpload onUse={useFile} onOpenSaved={() => setDialog("designs")} savedCount={saved.length} />
          </div>
        ) : (
          <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row lg:gap-4 lg:p-4">
            <main className="sticky top-0 z-20 flex flex-col bg-canvas lg:static lg:min-h-0 lg:min-w-0 lg:flex-1 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line lg:bg-surface">
              <PhotoToolbar
                tool={tool}
                onTool={(t) => {
                  setTool(t);
                  if (t === "guide" && view === "compare") setView("preview");
                }}
                mode={mode}
                onMode={setMode}
                brushSize={brushSize}
                onBrushSize={setBrushSize}
                maxBrush={Math.max(20, Math.round(Math.max(W, H) / 12))}
                tolerance={tolerance}
                onTolerance={setTolerance}
                view={view}
                onView={setView}
                showOverlay={showOverlay}
                onShowOverlay={setShowOverlay}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={doUndo}
                onRedo={doRedo}
                onReset={resetToOriginal}
                disabled={!photo.editable}
              />
              <div className="h-[42svh] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
                <PhotoCanvas
                  original={photo.image}
                  composite={composite}
                  doc={doc}
                  activeRegion={activeRegion}
                  tool={photo.editable ? tool : "pan"}
                  mode={mode}
                  brushSize={brushSize}
                  tolerance={tolerance}
                  view={view}
                  showOverlay={showOverlay}
                  approximate={!!composite}
                  applied={applied}
                  onEdit={onEdit}
                  onGuide={onGuide}
                  onFullSize={() => setDialog("full")}
                  onMessage={setNotice}
                />
              </div>
              <PhotoRegionBar
                doc={doc}
                active={activeRegion}
                onSelect={(r) => {
                  setActiveRegion(r);
                  if (tool === "protect") setTool("smart");
                }}
                products={products}
                state={panelState}
                onClear={() => commit(S.clearTarget(doc, activeRegion))}
                onClearProtect={() => commit(S.clearTarget(doc, "protect"))}
              />
              <p className="border-t border-line bg-surface px-4 py-1.5 text-[12px] leading-snug text-muted" data-testid="photo-hint">
                {hint}
                {segMessage && (
                  <span className="mt-0.5 block text-[11px]" data-testid="segmentation-status">
                    {segMessage.split(". ")[0]}.
                  </span>
                )}
              </p>
            </main>

            <aside className="flex flex-1 flex-col border-t border-line bg-surface lg:min-h-0 lg:w-[400px] lg:flex-none lg:rounded-2xl lg:border lg:shadow-sm xl:w-[440px]">
              {notice && (
                <div className="flex items-start gap-2 border-b border-[#f1d9b5] bg-warn-soft px-4 py-2.5 text-sm text-warn" role="alert" data-testid="photo-notice">
                  <span className="flex-1">{notice}</span>
                  <button type="button" onClick={() => setNotice(null)} className="shrink-0 rounded px-1 font-medium" aria-label="Dismiss message">
                    ✕
                  </button>
                </div>
              )}
              <div role="tablist" aria-label="Photo panels" className="flex gap-1 border-b border-line px-3 pt-2">
                {(
                  [
                    ["finish", "Finishes"],
                    ["adjust", "Adjust"],
                    ["summary", `Summary${panels.length ? ` (${panels.length})` : ""}`],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
                    data-testid={`photo-tab-${id}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === "finish" && (
                <MaterialPanel
                  activeRegionLabel={PHOTO_REGION_LABELS[activeRegion]}
                  selectedCode={assignedCode}
                  selectedProduct={activeProduct}
                  selectedState={ps && ps.code === assignedCode ? ps : undefined}
                  onSelect={(p) => (photo.editable ? void selectProduct(p) : setNotice("This saved preview cannot be edited because its original photo was not kept."))}
                />
              )}
              {tab === "adjust" && (
                <PhotoAdjust
                  doc={doc}
                  region={activeRegion}
                  product={activeProduct}
                  repeatAssumed={activeProduct ? repeatIsAssumed(activeProduct) : false}
                  onLive={preview}
                  onCommit={commit}
                  onCheckpoint={checkpoint}
                  onFitGuide={() => {
                    setTool("guide");
                    if (view === "compare") setView("preview");
                  }}
                />
              )}
              {tab === "summary" && (
                <PhotoSummary
                  doc={doc}
                  panels={panels}
                  products={products}
                  onSelectRegion={(r) => {
                    setActiveRegion(r);
                    setTab("finish");
                  }}
                  onSave={() => setDialog("save")}
                  onDownload={download}
                  onQuote={() => setDialog("quote")}
                />
              )}
            </aside>
          </div>
        )}
      </div>

      {dialog === "designs" && <PhotoDesignsDialog designs={saved} error={savedError} currentId={current?.id} onOpen={open} onDelete={remove} onClose={() => setDialog(null)} />}
      {dialog === "save" && photo && <SavePhotoDialog current={current} editable={photo.editable} onSave={save} onClose={() => setDialog(null)} />}
      {dialog === "full" && currentImage && <FullSizeView image={view === "original" ? photo!.image : currentImage} label={view === "original" || !composite ? "Original photo" : "Approximate visual preview"} onClose={() => setDialog(null)} />}
      {dialog === "quote" && doc && currentImage && (
        <QuoteDialog
          rows={panels.map((p) => ({ region: p.region, regionLabel: p.regionLabel, panelCode: p.panelCode, productName: p.productName, isDemo: products[p.panelCode]?.isDemo }))}
          layoutName="My Kitchen Photo (approximate preview)"
          designName={current?.name}
          photo={{ designId: current?.id, regions: panels.map((p) => ({ region: p.region, panelCode: p.panelCode })), getPreview: async () => previewDataUrl(currentImage, panels) }}
          backLabel="Back to my photo"
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
