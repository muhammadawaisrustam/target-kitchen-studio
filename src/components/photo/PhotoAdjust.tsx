"use client";

import type { Product } from "@/lib/catalogue/schema";
import { isEmpty } from "@/lib/photo/mask";
import { PHOTO_REGION_LABELS, type PhotoRegionId } from "@/lib/photo/regions";
import * as S from "@/lib/photo/state";

interface Props {
  doc: S.PhotoDoc;
  region: PhotoRegionId;
  product?: Product;
  repeatAssumed: boolean;
  onLive: (d: S.PhotoDoc) => void;
  onCommit: (d: S.PhotoDoc) => void;
  onCheckpoint: () => void;
  onFitGuide: () => void;
}

/** Texture layout for the active area: perspective guide, real size, grain size, rotation, shading. */
export default function PhotoAdjust({ doc, region, product, repeatAssumed, onLive, onCommit, onCheckpoint, onFitGuide }: Props) {
  const look = doc.regions[region];
  const label = PHOTO_REGION_LABELS[region];
  const noArea = isEmpty(doc.masks[region]);
  const live = (patch: Partial<S.RegionState>) => onLive(S.updateLook(doc, region, patch));
  const done = { onPointerUp: onCheckpoint, onKeyUp: onCheckpoint, onBlur: onCheckpoint };
  const scaleToSlider = (s: number) => Math.round(Math.log2(s) * 100);
  const sliderToScale = (v: number) => Math.round(Math.pow(2, v / 100) * 100) / 100;
  const box = "rounded-xl border border-line p-3";

  return (
    <div className="space-y-3 px-4 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto" data-testid="photo-adjust">
      <p className="text-sm">
        Adjusting <strong>{label}</strong>
        {product && (
          <span className="text-muted">
            {" "}
            · {product.panelCode} {product.productName}
          </span>
        )}
      </p>
      {noArea && <p className="rounded-lg bg-canvas px-3 py-2 text-[13px] text-muted">Mark this area on the photo first. These settings apply once it has a selection.</p>}

      <section className={box}>
        <h3 className="text-sm font-semibold">Perspective guide</h3>
        <p className="mt-1 text-[12px] leading-snug text-muted">
          {look.guideAdjusted
            ? "Fitted by hand. The grain follows the four corners you placed."
            : "Automatic: the grain runs straight up the photo. For a more realistic result, drag the four corners onto the edges of one cabinet face (top and bottom edges, left and right sides)."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={onFitGuide} disabled={noArea} className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40" data-testid="fit-guide">
            Fit guide on photo
          </button>
          <button type="button" onClick={() => onCommit(S.resetGuide(doc, region))} disabled={noArea || !look.guideAdjusted} className="rounded-full border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-40" data-testid="reset-guide">
            Back to automatic
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["w", "h"] as const).map((k) => (
            <label key={k} className="text-[12px] text-muted">
              Guide {k === "w" ? "width" : "height"} (cm)
              <input
                type="number"
                min={5}
                max={2000}
                step={1}
                value={Math.round(look.guideSizeCm[k])}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 1 && v <= 2000) live({ guideSizeCm: { ...look.guideSizeCm, [k]: v } });
                }}
                {...done}
                className="mt-0.5 w-full rounded-lg border border-line px-2 py-1 text-sm text-ink"
                data-testid={`guide-${k}`}
              />
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted">The real size of the area inside the guide. Measured sizes give the most accurate grain size; the starting height is a typical cabinet height.</p>
      </section>

      <section className={box}>
        <h3 className="text-sm font-semibold">Texture</h3>
        <label className="mt-2 block text-[12px] text-muted">
          Grain size <span className="tabular-nums text-ink">×{look.scale.toFixed(2)}</span>
          <input type="range" min={-200} max={200} value={scaleToSlider(look.scale)} onChange={(e) => live({ scale: sliderToScale(Number(e.target.value)) })} {...done} className="mt-1 w-full" data-testid="texture-scale" />
        </label>
        {repeatAssumed && (
          <p className="text-[11px] leading-snug text-muted">
            The catalogue does not state the real size of this panel&apos;s texture image, so one image is assumed to cover 1 m (the same assumption as the 3D studio). Grain size is approximate.
          </p>
        )}
        <label className="mt-3 block text-[12px] text-muted">
          Rotation <span className="tabular-nums text-ink">{look.rotationDeg}°</span>
          <input type="range" min={-90} max={90} value={look.rotationDeg} onChange={(e) => live({ rotationDeg: Number(e.target.value) })} {...done} className="mt-1 w-full" data-testid="texture-rotation" />
        </label>
        <div className="mt-1 flex gap-2">
          {[0, 90, -90].map((deg) => (
            <button key={deg} type="button" onClick={() => onCommit(S.updateLook(doc, region, { rotationDeg: deg }))} className="rounded-full border border-line px-2.5 py-1 text-xs">
              {deg === 0 ? "Grain vertical" : deg === 90 ? "Grain horizontal" : "−90°"}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-start gap-2 text-[12px]">
          <input type="checkbox" checked={look.mirror} onChange={(e) => onCommit(S.updateLook(doc, region, { mirror: e.target.checked }))} className="mt-0.5" data-testid="texture-mirror" />
          <span>
            Mirror repeats to hide seams
            <span className="block text-muted">The supplier swatches do not tile seamlessly. Mirroring avoids hard seams but repeats the pattern more visibly.</span>
          </span>
        </label>
      </section>

      <section className={box}>
        <h3 className="text-sm font-semibold">Light and shadow (all areas)</h3>
        <label className="mt-2 block text-[12px] text-muted">
          Keep original shading <span className="tabular-nums text-ink">{Math.round(doc.shadingStrength * 100)}%</span>
          <input type="range" min={0} max={100} value={Math.round(doc.shadingStrength * 100)} onChange={(e) => onLive({ ...doc, shadingStrength: Number(e.target.value) / 100 })} {...done} className="mt-1 w-full" data-testid="shading-strength" />
        </label>
        <p className="text-[11px] leading-snug text-muted">Higher keeps the photo&apos;s shadows and door gaps. Lower shows the panel colour more evenly. Reflections and gloss cannot be recreated.</p>
      </section>
    </div>
  );
}
