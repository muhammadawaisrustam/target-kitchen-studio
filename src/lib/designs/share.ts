import { z } from "zod";
import { REGION_IDS } from "@/lib/models/regions";
import { CameraSchema, SelectionsSchema, type DesignSnapshot } from "./model";

/**
 * Share links carry the whole design inside the URL (?design=…), so they need no database and
 * cost nothing. Only panel codes, the layout id and the camera are included; the receiving page
 * looks the codes up in its own catalogue and reports any it does not have.
 */
export const SHARE_PARAM = "design";
const MAX_TOKEN_LENGTH = 3000;

// Short keys keep links compact.
const REGION_SHORT: Record<string, string> = { upper_cabinets: "u", lower_cabinets: "l", tall_cabinets: "t", island_panels: "i", open_shelves: "s" };
const SHORT_REGION = Object.fromEntries(Object.entries(REGION_SHORT).map(([k, v]) => [v, k]));

export interface SharedDesign extends DesignSnapshot {
  designName?: string;
  variantName?: string;
}

const WireSchema = z.object({
  v: z.literal(1),
  m: z.string().min(1).max(60),
  s: z.record(z.string(), z.string().min(1).max(40)),
  n: z.string().max(80).optional(),
  vn: z.string().max(60).optional(),
  c: z.array(z.number().finite()).length(6).optional(),
});

const b64urlEncode = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlDecode = (token: string) => {
  const bin = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
};

const round = (n: number) => Math.round(n * 1000) / 1000;

export function encodeShareToken(d: SharedDesign): string {
  const s: Record<string, string> = {};
  for (const r of REGION_IDS) if (d.selections[r]) s[REGION_SHORT[r]!] = d.selections[r]!;
  const wire: z.infer<typeof WireSchema> = { v: 1, m: d.modelId, s };
  if (d.designName) wire.n = d.designName.slice(0, 80);
  if (d.variantName) wire.vn = d.variantName.slice(0, 60);
  if (d.camera) wire.c = [d.camera.alpha, d.camera.beta, d.camera.radius, ...d.camera.target].map(round);
  return b64urlEncode(JSON.stringify(wire));
}

/** Returns null for anything that is not a well-formed share token. */
export function decodeShareToken(token: string | null | undefined): SharedDesign | null {
  if (!token || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const wire = WireSchema.parse(JSON.parse(b64urlDecode(token)));
    const selections = SelectionsSchema.parse(Object.fromEntries(Object.entries(wire.s).map(([k, v]) => [SHORT_REGION[k] ?? k, v])));
    const cam = wire.c ? CameraSchema.safeParse({ alpha: wire.c[0], beta: wire.c[1], radius: wire.c[2], target: wire.c.slice(3) }) : undefined;
    return { modelId: wire.m, selections, designName: wire.n, variantName: wire.vn, camera: cam?.success ? cam.data : undefined };
  } catch {
    return null;
  }
}

export function buildShareUrl(origin: string, d: SharedDesign): string {
  return `${origin.replace(/\/$/, "")}/?${SHARE_PARAM}=${encodeShareToken(d)}`;
}
