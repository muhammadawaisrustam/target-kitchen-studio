/**
 * Builds the downloadable preview: the photo with the panels applied, plus a caption strip that
 * names every panel code by region and says the image is an approximate preview.
 */
import type { PhotoPanel } from "./design";

export function renderExportCanvas(image: ImageData, panels: PhotoPanel[], maxEdge = 4096): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const w = Math.round(image.width * scale), h = Math.round(image.height * scale);
  const font = Math.max(12, Math.round(w / 70));
  const lineH = Math.round(font * 1.45);
  const pad = Math.round(font * 0.9);
  const lines = [
    "Approximate visual preview, not an exact render. Check colours with an original sample before ordering.",
    ...(panels.length ? panels.map((p) => `${p.regionLabel}: ${p.panelCode}${p.productName ? ` · ${p.productName}` : ""}`) : ["No panels applied"]),
  ];
  const strip = pad * 2 + lineH * (lines.length + 1);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h + strip;
  const ctx = canvas.getContext("2d")!;
  const src = document.createElement("canvas");
  src.width = image.width;
  src.height = image.height;
  src.getContext("2d")!.putImageData(image, 0, 0);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, h, w, strip);
  ctx.fillStyle = "#1d1c1a";
  ctx.textBaseline = "top";
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  ctx.fillText(`Target Kitchen Studio · My Kitchen Photo · ${new Date().toLocaleDateString("en-GB")}`, pad, h + pad);
  ctx.font = `${font}px system-ui, sans-serif`;
  lines.forEach((line, i) => {
    ctx.fillStyle = i === 0 ? "#8a4b00" : "#1d1c1a";
    ctx.fillText(line, pad, h + pad + lineH * (i + 1), w - pad * 2);
  });
  return canvas;
}

/** Smaller JPEG for attaching to a quotation request (about 100 to 400 KB). */
export function previewDataUrl(image: ImageData, panels: PhotoPanel[], maxEdge = 1280, quality = 0.82): string {
  return renderExportCanvas(image, panels, maxEdge).toDataURL("image/jpeg", quality);
}
