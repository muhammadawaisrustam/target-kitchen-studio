// Generates the procedural DEMO textures and thumbnails used by the demo catalogue.
//
// These images are synthetic. They are NOT photographs or scans of genuine Target
// panels and must be replaced by the real product textures before launch.
//
// Every texture is tileable (seamless) so it can repeat across large surfaces, and
// woodgrain is authored with the grain running VERTICALLY (along the image's height).
// The material service rotates textures whose product grainDirection is "horizontal".
//
// Usage: npm run textures:generate
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_TEX = path.join(ROOT, "public/demo-assets/textures");
const OUT_THUMB = path.join(ROOT, "public/demo-assets/thumbs");
const SIZE = 1024;
const THUMB = 192;

// ---------- tileable value noise ----------
function hash(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const fade = (t) => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;

/** Value noise that repeats every px cells in x and py cells in y. */
function noise(x, y, px, py, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = fade(x - x0), fy = fade(y - y0);
  const a = hash(mod(x0, px), mod(y0, py), seed);
  const b = hash(mod(x0 + 1, px), mod(y0, py), seed);
  const c = hash(mod(x0, px), mod(y0 + 1, py), seed);
  const d = hash(mod(x0 + 1, px), mod(y0 + 1, py), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Fractal noise over u,v in [0,1) with integer base periods so the result tiles. */
function fbm(u, v, px, py, octaves, seed) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = 2 ** o;
    sum += amp * noise(u * px * f, v * py * f, px * f, py * f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const mix3 = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

// ---------- recipes ----------
function wood({ light, dark, lines = 16, warp = 0.35, contrast = 1, figure = 1, seed }) {
  const L = hex(light), D = hex(dark);
  return (u, v) => {
    const w = fbm(u, v, 3, 1, 4, seed) - 0.5;
    const t = u * lines + w * warp * lines * 0.25 + (fbm(u, v, 6, 2, 3, seed + 5) - 0.5) * 0.8 * figure;
    const ring = Math.pow(Math.abs(Math.sin(Math.PI * t)), 6);
    const fibre = 0.6 * noise(u * 256, v * 4, 256, 4, seed + 9) + 0.4 * noise(u * 700, v * 12, 700, 12, seed + 13);
    const pore = noise(u * 512, v * 48, 512, 48, seed + 11);
    const broad = fbm(u, v, 2, 2, 3, seed + 3);
    let k = 0.62 + 0.25 * (broad - 0.5) - 0.38 * ring * contrast - 0.12 * (fibre - 0.5) * contrast;
    k -= pore > 0.86 ? 0.12 * contrast : 0;
    return mix3(D, L, clamp01(k));
  };
}
function stone({ base, accent, speck, scale = 3, bands = 0, seed }) {
  const B = hex(base), A = hex(accent), S = hex(speck);
  return (u, v) => {
    let n = fbm(u, v, scale, scale, 6, seed);
    if (bands) n = 0.55 * n + 0.45 * (0.5 + 0.5 * Math.sin(Math.PI * 2 * (v * bands + fbm(u, v, 3, 2, 4, seed + 1) * 0.35)));
    let c = mix3(B, A, clamp01((n - 0.35) * 1.6));
    const s = noise(u * 300, v * 300, 300, 300, seed + 7);
    if (s > 0.93) c = mix3(c, S, 0.55);
    return c;
  };
}
function linen({ base, thread, seed }) {
  const B = hex(base), T = hex(thread);
  return (u, v) => {
    const warpT = 0.5 + 0.5 * Math.sin(Math.PI * 2 * u * 160 + noise(u * 40, v * 4, 40, 4, seed) * 2);
    const weftT = 0.5 + 0.5 * Math.sin(Math.PI * 2 * v * 160 + noise(u * 4, v * 40, 4, 40, seed + 1) * 2);
    const slub = noise(u * 8, v * 160, 8, 160, seed + 2);
    const k = 0.5 * warpT * weftT + 0.3 * slub + 0.2 * fbm(u, v, 4, 4, 3, seed + 3);
    return mix3(B, T, clamp01(k));
  };
}

const RECIPES = {
  "DEMO-WD-001": wood({ light: "#D9B98C", dark: "#9C7247", lines: 14, seed: 11 }),
  "DEMO-WD-002": wood({ light: "#E8DCC6", dark: "#B9A27E", lines: 22, contrast: 0.7, seed: 23 }),
  "DEMO-WD-003": wood({ light: "#CF9A5A", dark: "#8A5728", lines: 16, seed: 31 }),
  "DEMO-WD-004": wood({ light: "#7A5638", dark: "#3A2516", lines: 12, warp: 0.6, figure: 1.4, seed: 47 }),
  "DEMO-WD-005": wood({ light: "#6E5845", dark: "#33271E", lines: 14, contrast: 0.8, seed: 53 }),
  "DEMO-WD-006": wood({ light: "#A8703F", dark: "#6B4122", lines: 26, warp: 0.2, seed: 61 }),
  "DEMO-WD-007": wood({ light: "#B9B4AC", dark: "#7D776F", lines: 12, warp: 0.5, seed: 71 }),
  "DEMO-WD-008": wood({ light: "#54402F", dark: "#140E0A", lines: 30, warp: 0.1, contrast: 1.3, seed: 83 }),
  "DEMO-ST-201": stone({ base: "#B9B6B0", accent: "#8F8B85", speck: "#5F5C58", scale: 3, seed: 101 }),
  "DEMO-ST-202": stone({ base: "#E3D3B8", accent: "#BFA27A", speck: "#F4ECDD", scale: 2, bands: 7, seed: 113 }),
  "DEMO-ST-203": stone({ base: "#3E4144", accent: "#232527", speck: "#6A6E72", scale: 4, seed: 127 }),
  "DEMO-TX-301": linen({ base: "#D4C3A3", thread: "#B19E7C", seed: 131 }),
};

async function render(code, fn, size) {
  const buf = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x / size, y / size);
      const i = (y * size + x) * 3;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
    }
  }
  return sharp(buf, { raw: { width: size, height: size, channels: 3 } });
}

/** Adds a small "DEMO" corner flag to thumbnails so they are never mistaken for real swatches. */
function demoBadge(size) {
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="${size - 28}" width="58" height="28" fill="rgba(0,0,0,0.55)"/>
      <text x="8" y="${size - 9}" font-family="sans-serif" font-size="15" font-weight="700" fill="#fff">DEMO</text>
    </svg>`,
  );
}

const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, "data/demo-catalogue.json"), "utf8"));
fs.mkdirSync(OUT_TEX, { recursive: true });
fs.mkdirSync(OUT_THUMB, { recursive: true });

for (const p of catalogue.products) {
  const code = p.panelCode;
  let thumbImg;
  if (RECIPES[code]) {
    const t0 = Date.now();
    const img = await render(code, RECIPES[code], SIZE);
    const jpg = await img.jpeg({ quality: 84, mozjpeg: true }).toBuffer();
    fs.writeFileSync(path.join(OUT_TEX, `${code}.jpg`), jpg);
    thumbImg = sharp(jpg).resize(THUMB, THUMB);
    console.log(`${code}: texture ${(jpg.length / 1024).toFixed(0)} KB in ${Date.now() - t0} ms`);
  } else if (p.colourHex) {
    const [r, g, b] = hex(p.colourHex);
    thumbImg = sharp({ create: { width: THUMB, height: THUMB, channels: 3, background: { r, g, b } } });
  } else {
    // Test fixture: thumbnail shows a neutral hatch so it is obviously not a real finish.
    thumbImg = await render(code, (u, v) => ((Math.floor((u + v) * 16) % 2) ? [200, 200, 200] : [170, 170, 170]), THUMB);
  }
  const thumb = await sharp(await thumbImg.png().toBuffer())
    .composite([{ input: demoBadge(THUMB), top: 0, left: 0 }])
    .jpeg({ quality: 82 })
    .toBuffer();
  fs.writeFileSync(path.join(OUT_THUMB, `${code}.jpg`), thumb);
}
console.log("Done. Textures are synthetic DEMO assets.");
