"use client";

export type AppMode = "3d" | "photo";

/** Switch between the 3D studio and the photo visualiser. Shown in both headers. */
export default function ModeTabs({ mode, onChange }: { mode: AppMode; onChange: (m: AppMode) => void }) {
  const tab = (m: AppMode, long: string, short: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => mode !== m && onChange(m)}
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition sm:px-3 sm:py-1.5 sm:text-sm ${mode === m ? "bg-ink text-white shadow-sm" : "text-muted hover:text-ink"}`}
      data-testid={`mode-${m}`}
    >
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{long}</span>
    </button>
  );
  return (
    <div role="tablist" aria-label="Studio mode" className="flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-canvas p-0.5">
      {tab("3d", "3D Kitchen Studio", "3D Studio")}
      {tab("photo", "My Kitchen Photo", "My Photo")}
    </div>
  );
}
