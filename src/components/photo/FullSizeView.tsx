"use client";

import { useEffect, useRef } from "react";

/** The image at its full editing resolution, scrollable, on a dark background. */
export default function FullSizeView({ image, label, onClose }: { image: ImageData; label: string; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.getContext("2d")?.putImageData(image, 0, 0);
  }, [image]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label={`${label}, full size`} data-testid="full-size-view">
      <div className="flex items-center gap-3 px-4 py-2 text-sm text-white">
        <span className="font-medium">{label}</span>
        <span className="text-white/60">
          {image.width} × {image.height} px
        </span>
        <button ref={closeRef} type="button" onClick={onClose} className="ml-auto rounded-full bg-white/15 px-3 py-1 hover:bg-white/25" data-testid="full-size-close">
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <canvas ref={ref} width={image.width} height={image.height} className="mx-auto block max-w-none" />
      </div>
    </div>
  );
}
