"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { closeHoles, createMask, fillPolygon, floodSelect, paintSegment, type Mask, type Point } from "@/lib/photo/mask";
import { applyHomography, homography, isConvexQuad, UNIT_SQUARE, type Quad } from "@/lib/photo/perspective";
import { PHOTO_REGION_COLOURS, PHOTO_REGION_IDS, PHOTO_REGION_LABELS, type PhotoRegionId } from "@/lib/photo/regions";
import type { MaskTarget, PhotoDoc } from "@/lib/photo/state";

export type Tool = "smart" | "brush" | "erase" | "polygon" | "protect" | "guide" | "pan";
export type View = "preview" | "original" | "compare";

interface Props {
  original: ImageData;
  composite: ImageData | null;
  doc: PhotoDoc;
  activeRegion: PhotoRegionId;
  tool: Tool;
  mode: "add" | "remove";
  brushSize: number;
  tolerance: number;
  view: View;
  showOverlay: boolean;
  approximate: boolean;
  /** Regions that already show a panel finish: drawn as an outline so the finish stays visible. */
  applied: ReadonlySet<PhotoRegionId>;
  onEdit: (target: MaskTarget, mask: Mask, mode: "add" | "remove", tool: Tool) => void;
  onGuide: (region: PhotoRegionId, quad: Quad) => void;
  onFullSize: () => void;
  onMessage: (msg: string) => void;
}

const MAX_ZOOM = 8;

/**
 * The photo with its selection overlay, drawing tools, perspective guide handles, zoom/pan and
 * the before/after slider. All coordinates given to the editing callbacks are image pixels.
 */
export default function PhotoCanvas(props: Props) {
  const { original, composite, doc, activeRegion, tool, mode, brushSize, tolerance, view, showOverlay, approximate, applied, onEdit, onGuide, onFullSize, onMessage } = props;
  const W = original.width, H = original.height;
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<HTMLCanvasElement>(null);

  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [poly, setPoly] = useState<Point[]>([]);
  const [dragGuide, setDragGuide] = useState<Quad | null>(null);
  const [split, setSplit] = useState(50);

  const fit = vp.w && vp.h ? Math.min(vp.w / W, vp.h / H) : 0;
  const scale = fit * zoom;
  const left = (vp.w - W * scale) / 2 + off.x;
  const top = (vp.h - H * scale) / 2 + off.y;

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setVp({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // New photo: reset the view.
  useEffect(() => {
    setZoom(1);
    setOff({ x: 0, y: 0 });
    setPoly([]);
  }, [original]);

  useEffect(() => setPoly([]), [tool, activeRegion]);

  // ---------- drawing the layers ----------
  useEffect(() => {
    const ctx = baseRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(view === "original" || !composite ? original : composite, 0, 0);
  }, [original, composite, view]);

  useEffect(() => {
    const ctx = beforeRef.current?.getContext("2d");
    if (ctx && view === "compare") ctx.putImageData(original, 0, 0);
  }, [original, view]);

  useEffect(() => {
    const ctx = overlayRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (!showOverlay || view === "compare") return;
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const p = doc.protect.data;
    const outlineOnly = view === "preview";
    const masks = PHOTO_REGION_IDS.map((r) => [doc.masks[r].data, PHOTO_REGION_COLOURS[r], r === activeRegion ? 120 : 60, outlineOnly && applied.has(r)] as const);
    const edge = (m: Uint8Array, i: number) => {
      const x = i % W;
      return (x > 0 && !m[i - 1]) || (x < W - 1 && !m[i + 1]) || (i >= W && !m[i - W]) || (i < W * (H - 1) && !m[i + W]);
    };
    for (let i = 0, n = W * H; i < n; i++) {
      if (p[i]) {
        const x = i % W, y = (i / W) | 0;
        const stripe = (x + y) % 10 < 4;
        d[i * 4] = 220;
        d[i * 4 + 1] = 38;
        d[i * 4 + 2] = 38;
        d[i * 4 + 3] = stripe ? 150 : 50;
        continue;
      }
      for (const [m, c, a, outline] of masks) {
        if (m[i]) {
          if (outline && !edge(m, i)) break;
          d[i * 4] = c[0];
          d[i * 4 + 1] = c[1];
          d[i * 4 + 2] = c[2];
          d[i * 4 + 3] = outline ? 230 : a;
          break;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [doc, activeRegion, showOverlay, view, applied, W, H]);

  // ---------- pointer handling ----------
  const toImage = useCallback(
    (clientX: number, clientY: number): Point => {
      const r = stageRef.current!.getBoundingClientRect();
      return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
    },
    [W, H],
  );

  const zoomAt = useCallback(
    (next: number, cx: number, cy: number) => {
      const z = Math.min(MAX_ZOOM, Math.max(1, next));
      if (!fit) return;
      const s = fit * zoom, s2 = fit * z;
      const ix = (cx - left) / s, iy = (cy - top) / s;
      const newLeft = cx - ix * s2, newTop = cy - iy * s2;
      setZoom(z);
      setOff(z === 1 ? { x: 0, y: 0 } : { x: newLeft - (vp.w - W * s2) / 2, y: newTop - (vp.h - H * s2) / 2 });
    },
    [fit, zoom, left, top, vp, W, H],
  );

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "stroke"; points: Point[]; target: MaskTarget; mode: "add" | "remove"; radius: number }
    | { kind: "pan"; x: number; y: number; off: { x: number; y: number } }
    | { kind: "pinch"; dist: number; zoom: number; mid: { x: number; y: number }; off: { x: number; y: number } }
    | { kind: "click"; x: number; y: number }
    | { kind: "split" }
    | { kind: "guide"; corner: number; quad: Quad }
    | null
  >(null);

  const strokeStyle = (target: MaskTarget, m: "add" | "remove") => {
    if (m === "remove") return "rgb(20,20,20)";
    const c = target === "protect" ? [220, 38, 38] : PHOTO_REGION_COLOURS[target];
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };

  const drawStroke = (a: Point, b: Point, radius: number, style: string) => {
    const ctx = strokeRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = style;
    ctx.fillStyle = style;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = radius * 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  const clearStroke = () => strokeRef.current?.getContext("2d")?.clearRect(0, 0, W, H);

  const guideFor = (r: PhotoRegionId) => doc.regions[r].guide;

  const finishPolygon = useCallback(
    (pts: Point[]) => {
      if (pts.length < 3) {
        onMessage("A shape needs at least three corners.");
        return;
      }
      const m = createMask(W, H);
      fillPolygon(m, pts, 255);
      onEdit(tool === "protect" ? "protect" : activeRegion, m, mode, tool);
      setPoly([]);
    },
    [W, H, onEdit, tool, activeRegion, mode, onMessage],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    const vpRect = viewportRef.current!.getBoundingClientRect();
    pointers.current.set(e.pointerId, { x: e.clientX - vpRect.left, y: e.clientY - vpRect.top });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      // Two fingers: pinch to zoom and pan. Cancels any stroke in progress.
      clearStroke();
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, off };
      return;
    }
    if (pointers.current.size > 2) return;
    if (view === "compare") {
      gesture.current = { kind: "split" };
      const r = stageRef.current!.getBoundingClientRect();
      setSplit(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
      return;
    }
    if (tool === "pan" || e.button === 1) {
      gesture.current = { kind: "pan", x: e.clientX, y: e.clientY, off };
      return;
    }
    const p = toImage(e.clientX, e.clientY);
    if (tool === "brush" || tool === "erase" || tool === "protect") {
      const target: MaskTarget = tool === "protect" ? "protect" : activeRegion;
      const m: "add" | "remove" = tool === "erase" ? "remove" : tool === "protect" ? mode : "add";
      gesture.current = { kind: "stroke", points: [p], target, mode: m, radius: brushSize };
      drawStroke(p, p, brushSize, strokeStyle(target, m));
      return;
    }
    if (tool === "smart" || tool === "polygon") gesture.current = { kind: "click", x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const vpRect = viewportRef.current!.getBoundingClientRect();
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX - vpRect.left, y: e.clientY - vpRect.top });
    const g = gesture.current;
    if (!g || g.kind === "click") {
      if (e.pointerType !== "touch") setCursor(toImage(e.clientX, e.clientY));
      return;
    }
    if (g.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = Math.min(MAX_ZOOM, Math.max(1, (g.zoom * dist) / Math.max(1, g.dist)));
      setZoom(z);
      setOff(z === 1 ? { x: 0, y: 0 } : { x: g.off.x + (mid.x - g.mid.x), y: g.off.y + (mid.y - g.mid.y) });
      return;
    }
    if (g.kind === "pan") {
      if (zoom > 1) setOff({ x: g.off.x + e.clientX - g.x, y: g.off.y + e.clientY - g.y });
      return;
    }
    if (g.kind === "split") {
      const r = stageRef.current!.getBoundingClientRect();
      setSplit(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
      return;
    }
    if (g.kind === "stroke") {
      const p = toImage(e.clientX, e.clientY);
      const last = g.points[g.points.length - 1]!;
      if (Math.hypot(p.x - last.x, p.y - last.y) < Math.max(1, g.radius / 4)) return;
      g.points.push(p);
      drawStroke(last, p, g.radius, strokeStyle(g.target, g.mode));
      setCursor(p);
      return;
    }
    if (g.kind === "guide") {
      const p = toImage(e.clientX, e.clientY);
      const q = [...g.quad] as Quad;
      q[g.corner] = { x: Math.min(W, Math.max(0, p.x)), y: Math.min(H, Math.max(0, p.y)) };
      g.quad = q;
      setDragGuide(q);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    if (g.kind === "stroke") {
      const m = createMask(W, H);
      for (let i = 0; i < g.points.length; i++) paintSegment(m, g.points[Math.max(0, i - 1)]!, g.points[i]!, g.radius, 255);
      clearStroke();
      onEdit(g.target, m, g.mode, tool);
      return;
    }
    if (g.kind === "guide") {
      setDragGuide(null);
      if (isConvexQuad(g.quad)) onGuide(activeRegion, g.quad);
      else onMessage("The guide corners crossed over, so the change was not kept. Keep the corners in order around the cabinet face.");
      return;
    }
    if (g.kind === "click") {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 8) return; // a drag, not a click
      const p = toImage(e.clientX, e.clientY);
      if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) return;
      if (tool === "smart") {
        if (doc.protect.data[Math.floor(p.y) * W + Math.floor(p.x)] && mode === "add") {
          onMessage("That spot is protected (red stripes). Remove the protection there first, or click another spot.");
          return;
        }
        const sel = closeHoles(floodSelect(original.data, W, H, p, tolerance, doc.protect), 1);
        onEdit(activeRegion, sel, mode, "smart");
        return;
      }
      if (tool === "polygon") {
        const first = poly[0];
        const closeEnough = first && scale > 0 && Math.hypot((p.x - first.x) * scale, (p.y - first.y) * scale) < 14;
        if (closeEnough && poly.length >= 3) finishPolygon(poly);
        else setPoly((pts) => [...pts, p]);
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey && zoom === 1 && e.deltaY > 0) return;
    const r = viewportRef.current!.getBoundingClientRect();
    zoomAt(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top);
  };

  // Keyboard: Escape cancels a shape, Backspace removes its last corner, Enter closes it.
  useEffect(() => {
    if (tool !== "polygon" || !poly.length) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "Escape") setPoly([]);
      else if (e.key === "Backspace") (e.preventDefault(), setPoly((p) => p.slice(0, -1)));
      else if (e.key === "Enter") finishPolygon(poly);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, poly, finishPolygon]);

  // ---------- guide geometry ----------
  const guide = dragGuide ?? guideFor(activeRegion);
  const grid: [Point, Point][] = [];
  if (guide && tool === "guide") {
    const Hm = homography(UNIT_SQUARE, guide);
    if (Hm)
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        grid.push([applyHomography(Hm, { x: t, y: 0 }), applyHomography(Hm, { x: t, y: 1 })]);
        grid.push([applyHomography(Hm, { x: 0, y: t }), applyHomography(Hm, { x: 1, y: t })]);
      }
  }
  // The grid shows while fitting the guide; afterwards only its outline, and only with selections shown.
  const showGuide = !!guide && view !== "compare" && (tool === "guide" || (showOverlay && doc.regions[activeRegion].guideAdjusted));
  const regionColour = PHOTO_REGION_COLOURS[activeRegion];
  const rgb = `rgb(${regionColour.join(",")})`;
  const cursorRadius = tool === "brush" || tool === "erase" || tool === "protect" ? brushSize : 0;
  const cursorStyle = view === "compare" ? "ew-resize" : tool === "pan" ? (zoom > 1 ? "grab" : "default") : tool === "guide" ? "default" : "crosshair";

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-[#2b2925]" ref={viewportRef} onWheel={onWheel} data-testid="photo-viewport">
      <div
        ref={stageRef}
        className="absolute touch-none"
        style={{ left, top, width: W * scale, height: H * scale, cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          gesture.current = null;
          clearStroke();
          setDragGuide(null);
        }}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={() => tool === "polygon" && poly.length >= 3 && finishPolygon(poly)}
        data-testid="photo-stage"
        data-image-width={W}
        data-image-height={H}
      >
        <canvas ref={baseRef} width={W} height={H} className="absolute inset-0 h-full w-full" data-testid="photo-output" aria-label={view === "original" ? "Original photo" : "Preview with selected panels"} role="img" />
        {view === "compare" && (
          <canvas ref={beforeRef} width={W} height={H} className="absolute inset-0 h-full w-full" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} aria-hidden data-testid="photo-before" />
        )}
        <canvas ref={overlayRef} width={W} height={H} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden data-testid="photo-overlay" />
        <canvas ref={strokeRef} width={W} height={H} className="pointer-events-none absolute inset-0 h-full w-full opacity-55" aria-hidden />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {showGuide && guide && (
            <g>
              {grid.map(([a, b], i) => (
                <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="white" strokeOpacity={0.7} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
              ))}
              <polygon points={guide.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={rgb} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </g>
          )}
          {poly.length > 0 && (
            <g>
              <polyline points={[...poly, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(" ")} fill={mode === "remove" ? "rgba(0,0,0,0.25)" : `rgba(${regionColour.join(",")},0.25)`} stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              {poly.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={(i === 0 ? 6 : 4) / Math.max(scale, 0.0001)} fill={i === 0 ? rgb : "white"} stroke="black" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}
          {cursor && cursorRadius > 0 && view !== "compare" && <circle cx={cursor.x} cy={cursor.y} r={cursorRadius} fill="none" stroke="white" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        </svg>
        {showGuide && tool === "guide" && guide && (
          <div className="absolute inset-0">
            {guide.map((p, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Guide corner ${["top left", "top right", "bottom right", "bottom left"][i]}`}
                className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white shadow"
                style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`, background: rgb, cursor: "move" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.currentTarget.parentElement!.parentElement as HTMLElement).setPointerCapture?.(e.pointerId);
                  gesture.current = { kind: "guide", corner: i, quad: [...guide] as Quad };
                }}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 10 : 2;
                  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
                  if (!d) return;
                  e.preventDefault();
                  const q = [...guide] as Quad;
                  q[i] = { x: Math.min(W, Math.max(0, p.x + d[0]!)), y: Math.min(H, Math.max(0, p.y + d[1]!)) };
                  if (isConvexQuad(q)) onGuide(activeRegion, q);
                }}
                data-testid={`guide-corner-${i}`}
              />
            ))}
          </div>
        )}
        {view === "compare" && (
          <div className="pointer-events-none absolute inset-y-0" style={{ left: `${split}%` }}>
            <div className="absolute inset-y-0 -ml-px w-0.5 bg-white shadow" />
            <div className="absolute top-1/2 -ml-4 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white text-xs font-bold shadow">⇔</div>
          </div>
        )}
      </div>

      {/* Labels and controls on top of the photo */}
      <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1.5">
        {view === "compare" ? (
          <>
            <span className="rounded bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">◀ Original</span>
            <span className="rounded bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">Preview ▶</span>
          </>
        ) : (
          <span className="rounded bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white" data-testid="photo-view-label">
            {view === "original" ? "Original photo" : "Preview"}
          </span>
        )}
        {approximate && view !== "original" && (
          <span className="rounded bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn" data-testid="approximate-badge">
            Approximate visual preview
          </span>
        )}
      </div>
      {tool === "polygon" && poly.length > 0 && view !== "compare" && (
        <div className="absolute left-1/2 top-2 flex -translate-x-1/2 gap-1.5">
          <button type="button" onClick={() => finishPolygon(poly)} disabled={poly.length < 3} className="rounded-full bg-white px-3 py-1 text-xs font-medium shadow disabled:opacity-50" data-testid="polygon-finish">
            Close shape ({poly.length})
          </button>
          <button type="button" onClick={() => setPoly((p) => p.slice(0, -1))} className="rounded-full bg-white px-3 py-1 text-xs shadow">
            Undo corner
          </button>
          <button type="button" onClick={() => setPoly([])} className="rounded-full bg-white px-3 py-1 text-xs shadow">
            Cancel
          </button>
        </div>
      )}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-white/95 p-1 shadow" data-testid="zoom-controls">
        <button type="button" onClick={() => zoomAt(zoom / 1.25, vp.w / 2, vp.h / 2)} disabled={zoom <= 1} className="grid h-7 w-7 place-items-center rounded-full text-lg leading-none hover:bg-canvas disabled:opacity-40" aria-label="Zoom out" data-testid="zoom-out">
          −
        </button>
        <span className="w-11 text-center text-xs tabular-nums" data-testid="zoom-level">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" onClick={() => zoomAt(zoom * 1.25, vp.w / 2, vp.h / 2)} disabled={zoom >= MAX_ZOOM} className="grid h-7 w-7 place-items-center rounded-full text-lg leading-none hover:bg-canvas disabled:opacity-40" aria-label="Zoom in" data-testid="zoom-in">
          +
        </button>
        <button type="button" onClick={() => (setZoom(1), setOff({ x: 0, y: 0 }))} className="rounded-full px-2 py-1 text-xs hover:bg-canvas" data-testid="zoom-fit">
          Fit
        </button>
        <button type="button" onClick={onFullSize} className="rounded-full px-2 py-1 text-xs hover:bg-canvas" data-testid="full-size">
          Full size
        </button>
      </div>
      {view === "compare" && (
        <label className="absolute bottom-2 left-2 flex items-center gap-2 rounded-full bg-white/95 px-3 py-1 text-xs shadow">
          <span className="sr-only">Comparison position</span>
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="w-28" data-testid="compare-slider" />
        </label>
      )}
      <p className="sr-only" aria-live="polite">
        Editing {PHOTO_REGION_LABELS[activeRegion]}
      </p>
    </div>
  );
}
