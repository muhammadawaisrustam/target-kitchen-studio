"use client";

import type { Tool, View } from "./PhotoCanvas";

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
  mode: "add" | "remove";
  onMode: (m: "add" | "remove") => void;
  brushSize: number;
  onBrushSize: (n: number) => void;
  maxBrush: number;
  tolerance: number;
  onTolerance: (n: number) => void;
  view: View;
  onView: (v: View) => void;
  showOverlay: boolean;
  onShowOverlay: (v: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  disabled: boolean;
}

const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: "smart", label: "Smart select", title: "Click a cabinet door to select the area of similar colour around it" },
  { id: "brush", label: "Brush", title: "Paint the selected area by hand" },
  { id: "erase", label: "Eraser", title: "Remove parts of the selected area" },
  { id: "polygon", label: "Shape", title: "Click the corners of a door or panel, then close the shape" },
  { id: "protect", label: "Protect", title: "Mark worktops, appliances, handles and walls so they are never recoloured" },
  { id: "guide", label: "Guide", title: "Drag four corners onto a cabinet face so the grain follows its perspective" },
  { id: "pan", label: "Move", title: "Drag to move around when zoomed in" },
];

export default function PhotoToolbar(p: Props) {
  const seg = (active: boolean) => `whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium sm:text-[13px] ${active ? "bg-ink text-white" : "text-ink hover:bg-canvas"}`;
  const small = "whitespace-nowrap rounded-full border border-line px-2.5 py-1 text-xs font-medium hover:bg-canvas disabled:opacity-40";
  const hasMode = p.tool === "smart" || p.tool === "polygon" || p.tool === "protect";
  const hasSize = p.tool === "brush" || p.tool === "erase" || p.tool === "protect";
  return (
    <div className="space-y-1.5 border-b border-line bg-surface px-3 py-2" data-testid="photo-toolbar">
      <div className="flex items-center gap-2 overflow-x-auto">
        <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-line p-0.5" role="toolbar" aria-label="Selection tools">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" title={t.title} aria-pressed={p.tool === t.id} disabled={p.disabled && t.id !== "pan"} onClick={() => p.onTool(t.id)} className={`${seg(p.tool === t.id)} disabled:opacity-40`} data-testid={`tool-${t.id}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button type="button" onClick={p.onUndo} disabled={!p.canUndo} className={small} title="Undo (Ctrl+Z)" data-testid="photo-undo">
            Undo
          </button>
          <button type="button" onClick={p.onRedo} disabled={!p.canRedo} className={small} title="Redo (Ctrl+Shift+Z)" data-testid="photo-redo">
            Redo
          </button>
          <button type="button" onClick={p.onReset} disabled={p.disabled} className={small} title="Remove all selections and finishes and show the original photo" data-testid="photo-reset">
            Reset
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {hasMode && (
          <div className="flex items-center gap-0.5 rounded-full border border-line p-0.5" role="group" aria-label="Add or remove">
            <button type="button" aria-pressed={p.mode === "add"} onClick={() => p.onMode("add")} className={seg(p.mode === "add")} data-testid="mode-add">
              Add
            </button>
            <button type="button" aria-pressed={p.mode === "remove"} onClick={() => p.onMode("remove")} className={seg(p.mode === "remove")} data-testid="mode-remove">
              Remove
            </button>
          </div>
        )}
        {hasSize && (
          <label className="flex items-center gap-1.5 text-muted">
            Size
            <input type="range" min={2} max={p.maxBrush} value={p.brushSize} onChange={(e) => p.onBrushSize(Number(e.target.value))} className="w-24" data-testid="brush-size" />
            <span className="w-8 tabular-nums text-ink">{p.brushSize}px</span>
          </label>
        )}
        {p.tool === "smart" && (
          <label className="flex items-center gap-1.5 text-muted" title="How different a colour can be from the clicked spot and still be selected">
            Colour range
            <input type="range" min={2} max={60} value={p.tolerance} onChange={(e) => p.onTolerance(Number(e.target.value))} className="w-24" data-testid="tolerance" />
            <span className="w-6 tabular-nums text-ink">{p.tolerance}</span>
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-muted">
            <input type="checkbox" checked={p.showOverlay} onChange={(e) => p.onShowOverlay(e.target.checked)} data-testid="toggle-overlay" />
            Show selections
          </label>
          <div className="flex items-center gap-0.5 rounded-full border border-line p-0.5" role="group" aria-label="View">
            {(
              [
                ["preview", "Preview"],
                ["original", "Original"],
                ["compare", "Compare"],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={p.view === v} onClick={() => p.onView(v)} className={seg(p.view === v)} data-testid={`view-${v}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
