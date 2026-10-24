"use client";

import { useEffect, useRef, useState } from "react";
import type { KitchenViewer, LoadReport, ViewPreset } from "@/lib/scene/kitchenViewer";
import type { KitchenModelDefinition } from "@/lib/models/types";
import type { RegionId } from "@/lib/models/regions";

type Status = { kind: "loading"; message: string } | { kind: "ready" } | { kind: "error"; title: string; message: string };

interface Props {
  model: KitchenModelDefinition;
  onViewer: (viewer: KitchenViewer | null) => void;
  onModelLoaded: (report: LoadReport) => void;
  onRegionPicked: (region: RegionId) => void;
  busy: boolean;
}

export default function Viewport({ model, onViewer, onModelLoaded, onRegionPicked, busy }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<KitchenViewer | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading", message: "Starting 3D engine…" });
  const [viewerReady, setViewerReady] = useState(false);
  const callbacks = useRef({ onRegionPicked, onModelLoaded, onViewer });
  callbacks.current = { onRegionPicked, onModelLoaded, onViewer };

  // Create the Babylon viewer once. Babylon is imported dynamically so it never runs on the server
  // and does not block the first paint of the page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@/lib/scene/kitchenViewer");
        if (cancelled || !canvasRef.current) return;
        const viewer = new mod.KitchenViewer(canvasRef.current, {
          onRegionPicked: (r) => callbacks.current.onRegionPicked(r),
          onContextLost: () =>
            setStatus({ kind: "error", title: "3D view interrupted", message: "The graphics context was lost (often after the device sleeps). Reload the page to continue." }),
        });
        viewerRef.current = viewer;
        (window as unknown as { __kitchenViewer?: KitchenViewer }).__kitchenViewer = viewer; // used by automated browser tests
        callbacks.current.onViewer(viewer);
        setViewerReady(true);
      } catch (err) {
        const unsupported = err instanceof Error && err.name === "WebGLUnavailableError";
        setStatus({
          kind: "error",
          title: unsupported ? "3D preview not supported" : "3D preview failed to start",
          message: unsupported
            ? "This browser or device cannot run WebGL. Try a current version of Chrome, Safari, Edge or Firefox, or enable hardware acceleration."
            : (err as Error)?.message ?? "Unknown error",
        });
      }
    })();
    return () => {
      cancelled = true;
      callbacks.current.onViewer(null);
      viewerRef.current?.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !viewerReady) return;
    let cancelled = false;
    setStatus({ kind: "loading", message: `Loading ${model.name}…` });
    viewer
      .loadModel(model)
      .then((report) => {
        if (cancelled) return;
        setStatus({ kind: "ready" });
        callbacks.current.onModelLoaded(report);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus({ kind: "error", title: "Kitchen model could not be loaded", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [model, viewerReady]);

  const act = (fn: (v: KitchenViewer) => void) => () => viewerRef.current && fn(viewerRef.current);
  const views: { id: ViewPreset; label: string }[] = [
    { id: "perspective", label: "3D" },
    { id: "front", label: "Front" },
    { id: "side", label: "Side" },
    { id: "top", label: "Top" },
  ];

  return (
    <div className="relative h-full w-full overflow-hidden rounded-none bg-[#efece7] lg:rounded-2xl" data-testid="viewport" data-status={status.kind}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none"
        tabIndex={0}
        aria-label={`Interactive 3D view of the ${model.name}. Drag to rotate, scroll or pinch to zoom, right-drag or two-finger drag to pan. Arrow keys rotate when focused.`}
        data-testid="kitchen-canvas"
      />

      {model.isPrototype && (
        <div className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-1.5rem)] truncate rounded-full bg-white/85 px-3 py-1 text-[10px] sm:text-[11px] font-medium tracking-wide text-muted shadow-sm backdrop-blur">
          PROTOTYPE MODEL · illustrative, not a manufacturing drawing
        </div>
      )}

      {status.kind === "ready" && (
        <>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-full bg-white/90 p-1 shadow-md backdrop-blur sm:gap-1" role="toolbar" aria-label="Camera controls">
            {views.map((v) => (
              <button key={v.id} type="button" onClick={act((x) => x.setView(v.id))} className="rounded-full px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-canvas sm:px-3" aria-label={`${v.label} view`} data-testid={`view-${v.id}`}>
                {v.label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <button type="button" onClick={act((x) => x.zoom(0.8))} className="h-8 w-8 rounded-full text-lg leading-none hover:bg-canvas" aria-label="Zoom in" data-testid="zoom-in">
              +
            </button>
            <button type="button" onClick={act((x) => x.zoom(1.25))} className="h-8 w-8 rounded-full text-lg leading-none hover:bg-canvas" aria-label="Zoom out" data-testid="zoom-out">
              −
            </button>
            <button type="button" onClick={act((x) => x.resetCamera())} className="rounded-full px-3 py-1.5 text-xs font-medium hover:bg-canvas" aria-label="Reset camera" data-testid="reset-camera">
              Reset<span className="hidden sm:inline"> view</span>
            </button>
          </div>
          <p className="pointer-events-none absolute right-3 top-3 hidden rounded-full bg-white/80 px-3 py-1 text-[11px] text-muted backdrop-blur md:block">
            Drag to rotate · Scroll to zoom · Right-drag to pan · Click a cabinet to select it
          </p>
        </>
      )}

      {busy && status.kind === "ready" && (
        <div className="pointer-events-none absolute right-3 top-12 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs text-muted shadow-sm md:top-12" role="status">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
          Loading texture…
        </div>
      )}

      {status.kind === "loading" && (
        <div className="absolute inset-0 grid place-items-center bg-[#efece7]/80" role="status" aria-live="polite">
          <div className="flex flex-col items-center gap-3 text-sm text-muted">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
            {status.message}
          </div>
        </div>
      )}

      {status.kind === "error" && (
        <div className="absolute inset-0 grid place-items-center bg-canvas p-6" role="alert">
          <div className="max-w-sm text-center">
            <h2 className="font-display text-xl">{status.title}</h2>
            <p className="mt-2 text-sm text-muted">{status.message}</p>
            <button type="button" onClick={() => location.reload()} className="mt-4 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white">
              Reload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
