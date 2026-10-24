// Imports a Target brand profile PDF (the "Kastamonu Melamine Faced Panels" layout) into the
// catalogue: one product per Item ID, with the swatch printed above it as thumbnail/texture.
//
//   node scripts/import-brand-pdf.mjs <file.pdf> --brand Kastamonu [--slug kastamonu]
//
// Writes:
//   data/brands/<slug>.json                  catalogue records (validated by the app on load)
//   public/brands/<slug>/textures/<decor>.jpg  swatch used as the 3D texture (grain turned upright)
//   public/brands/<slug>/thumbs/<decor>.jpg    192 px catalogue thumbnail
//   docs/imports/<slug>-report.md + .csv       what was matched, and every problem found
//
// Rules: product facts come only from the PDF text. Values the PDF does not state are left
// empty. Values computed from the swatch pixels (plain colour, colour group, grain direction)
// are marked as estimates. A decor with no swatch gets no texture; nothing is substituted.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// ---------------- arguments ----------------
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const pdfPath = args.find((a) => a.toLowerCase().endsWith(".pdf"));
if (!pdfPath) {
  console.error("Usage: node scripts/import-brand-pdf.mjs <file.pdf> --brand <Brand> [--slug <slug>]");
  process.exit(1);
}
const brand = opt("brand");
if (!brand) {
  console.error("--brand is required (e.g. --brand Kastamonu)");
  process.exit(1);
}
const slug = opt("slug", brand.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
const ROOT = process.cwd();
const ASSET_DIR = path.join(ROOT, "public/brands", slug);
const ASSET_URL = `/brands/${slug}`;
for (const d of ["textures", "thumbs"]) fs.mkdirSync(path.join(ASSET_DIR, d), { recursive: true });
fs.mkdirSync(path.join(ROOT, "data/brands"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "docs/imports"), { recursive: true });

// ---------------- helpers ----------------
const ITEM_ID = /^(\d+-\d{3})-T(\d{2})-([A-Z]\d*)-([A-Z])-(\d+)$/;
/** "M E L A M I N E" -> "MELAMINE" (headers are letter-spaced). */
const despace = (s) => (/^(\S ){2,}\S$/.test(s.trim()) ? s.trim().replace(/ /g, "") : s.trim());
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const issues = []; // { level: "error"|"warning"|"info", itemId?, decor?, message }
const issue = (level, message, ref = {}) => issues.push({ level, message, ...ref });

const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

async function readPage(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const tc = await page.getTextContent();
  const texts = tc.items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({ str: i.str.trim(), x: i.transform[4], y: i.transform[5], size: Math.abs(i.transform[0]) }));
  // Walk the operator list to find where each image is painted (its bounding box in points).
  const ops = await page.getOperatorList();
  const images = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const a = ops.argsArray[i];
    if (fn === pdfjs.OPS.save) stack.push(ctm);
    else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === pdfjs.OPS.transform) ctm = mul(ctm, a);
    else if (fn === pdfjs.OPS.paintImageXObject) {
      images.push({ name: a[0], x: ctm[4], y: ctm[5], w: ctm[0], h: ctm[3], page });
    }
  }
  return { pageNumber, page, texts, images };
}

async function imagePixels(img) {
  const obj = await new Promise((resolve) => img.page.objs.get(img.name, resolve));
  const channels = obj.kind === 1 ? 1 : obj.kind === 3 ? 4 : 3; // pdf.js ImageKind
  if (obj.kind === 1) throw new Error("1-bit images are not supported");
  return { width: obj.width, height: obj.height, channels, data: Buffer.from(obj.data.buffer, obj.data.byteOffset, obj.data.byteLength) };
}

/** Pixel measurements used to judge whether a swatch is usable as a texture. */
function analyse({ width, height, channels, data }) {
  const lum = new Float32Array(width * height);
  let r = 0, g = 0, b = 0;
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    r += data[p];
    g += data[p + 1];
    b += data[p + 2];
    lum[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  const n = width * height;
  const mean = [r / n, g / n, b / n];
  let m = 0;
  for (const v of lum) m += v;
  m /= n;
  let variance = 0;
  for (const v of lum) variance += (v - m) ** 2;
  const std = Math.sqrt(variance / n);
  // Robust spread (5th to 95th percentile) so a few specks of dust don't make a plain colour "patterned".
  const sample = [];
  for (let i = 0; i < n; i += 7) sample.push(lum[i]);
  sample.sort((x, y) => x - y);
  const spread = sample[Math.floor(sample.length * 0.95)] - sample[Math.floor(sample.length * 0.05)];
  // Gradient energy along x and y: woodgrain running vertically changes fast across x.
  let gx = 0, gy = 0, interiorX = 0, interiorY = 0, seamX = 0, seamY = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width - 1; x++) gx += Math.abs(lum[y * width + x + 1] - lum[y * width + x]);
  for (let y = 0; y < height - 1; y++)
    for (let x = 0; x < width; x++) gy += Math.abs(lum[(y + 1) * width + x] - lum[y * width + x]);
  interiorX = gx / (height * (width - 1));
  interiorY = gy / (width * (height - 1));
  // Seams: compare the wrap-around edge (last column -> first column) with a typical neighbour step.
  for (let y = 0; y < height; y++) seamX += Math.abs(lum[y * width] - lum[y * width + width - 1]);
  for (let x = 0; x < width; x++) seamY += Math.abs(lum[x] - lum[(height - 1) * width + x]);
  seamX /= height;
  seamY /= width;
  // 8x8 average hash for near-duplicate detection.
  const hashBits = [];
  for (let by = 0; by < 8; by++)
    for (let bx = 0; bx < 8; bx++) {
      let s = 0, c = 0;
      for (let y = Math.floor((by * height) / 8); y < Math.floor(((by + 1) * height) / 8); y += 4)
        for (let x = Math.floor((bx * width) / 8); x < Math.floor(((bx + 1) * width) / 8); x += 4) {
          s += lum[y * width + x];
          c++;
        }
      hashBits.push(s / c);
    }
  const avg = hashBits.reduce((a, v) => a + v, 0) / 64;
  const ahash = hashBits.map((v) => (v > avg ? "1" : "0")).join("");
  return {
    mean,
    std,
    spread,
    gradX: interiorX,
    gradY: interiorY,
    seamRatioX: interiorX > 0.05 ? seamX / interiorX : 0,
    seamRatioY: interiorY > 0.05 ? seamY / interiorY : 0,
    ahash,
    sha1: crypto.createHash("sha1").update(data).digest("hex"),
  };
}

const hex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return [(h + 360) % 360, s, l * 100];
}

/** Colour group estimated from the swatch's average colour. Labelled as an estimate everywhere. */
function colourGroup(mean, isWood) {
  const [h, , l] = hsl(mean);
  const chroma = Math.max(...mean) - Math.min(...mean);
  if (l < 14) return isWood && chroma > 6 ? "Dark wood" : "Black";
  if (chroma < 16) return l > 88 ? "White" : l > 22 ? "Grey" : "Black";
  if (l < 24 && (h >= 330 || h < 60)) return isWood ? "Dark wood" : "Brown";
  if (h >= 15 && h < 55 || h >= 330 || h < 15) {
    if (isWood) return l > 68 ? "Light wood" : l > 42 ? "Mid wood" : "Dark wood";
    if (h >= 330 || h < 15) return chroma > 60 ? "Red" : l > 72 ? "Beige" : "Brown";
    return l > 72 ? "Beige" : "Brown";
  }
  if (h >= 55 && h < 75) return l > 72 ? "Beige" : "Green";
  if (h >= 75 && h < 170) return "Green";
  if (h >= 170 && h < 260) return "Blue";
  return "Purple";
}

/** Flags decors whose name names a colour that the swatch clearly is not (possible wrong image). */
function nameColourMismatch(name, group) {
  const checks = [
    [/\bWHITE\b/, ["White", "Beige", "Light wood", "Grey"]],
    [/\bBLACK\b/, ["Black", "Dark wood", "Grey", "Blue"]],
    [/\bGREY\b/, ["Grey", "White", "Black"]],
    [/\bBLUE\b/, ["Blue"]],
    [/\bRED\b/, ["Red"]],
    [/\b(MINT|GREEN)\b/, ["Green"]],
  ];
  for (const [re, ok] of checks) if (re.test(name) && !ok.includes(group)) return true;
  return false;
}

/** Finish, only where the PDF states it (MDF prefixes HG / ST, "SUPER MATT" in the name). */
function finishFor(name, board) {
  const hg = /^HG\b/.test(name);
  const st = /^(HG )?ST\b/.test(name);
  if (hg && st) return { finish: "High gloss / soft touch", note: "Name starts with both HG and ST; finish needs confirming." };
  if (hg) return { finish: "High gloss" };
  if (st) return { finish: "Soft touch" };
  if (/SUPER MATT/.test(name)) return { finish: "Super matt" };
  return { finish: "Not stated", note: board === "MDF" ? "MDF decor without an HG/ST prefix: finish not stated." : undefined };
}

// ---------------- read the PDF ----------------
const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await pdfjs.getDocument({ data, verbosity: 0, isEvalSupported: false }).promise;
const meta = await doc.getMetadata().catch(() => ({ info: {} }));
const pages = [];
for (let p = 1; p <= doc.numPages; p++) pages.push(await readPage(doc, p));

// ---------------- quick order list (authoritative table) ----------------
const listRows = [];
for (const pg of pages) {
  const header = pg.texts.filter((t) => ["DECOR", "ITEMID", "BOARD", "COLLECTION", "SHEETSIZE(MM)", "MADEIN", "PAGE"].includes(despace(t.str).replace(/ /g, "")));
  if (header.length < 6) continue;
  const cols = header.map((t) => ({ key: despace(t.str).replace(/ /g, ""), x: t.x, y: t.y })).sort((a, b) => a.x - b.x);
  const headerY = cols[0].y;
  const rows = new Map();
  for (const t of pg.texts) {
    if (t.y >= headerY - 1) continue;
    const key = Math.round(t.y * 2) / 2;
    const row = [...rows.keys()].find((k) => near(k, key, 1.5));
    rows.set(row ?? key, [...(rows.get(row ?? key) ?? []), t]);
  }
  for (const cells of rows.values()) {
    const rec = {};
    for (const c of cells) {
      const col = [...cols].reverse().find((h) => c.x >= h.x - 2);
      if (col) rec[col.key] = rec[col.key] ? `${rec[col.key]} ${c.str}` : c.str;
    }
    if (rec.ITEMID && ITEM_ID.test(rec.ITEMID)) listRows.push({ ...rec, listPage: pg.pageNumber });
  }
}
const claimed = pages.flatMap((p) => p.texts).find((t) => /\d+ Item IDs/.test(t.str));
const claimedCount = claimed ? Number(claimed.str.match(/(\d+) Item IDs/)[1]) : null;

// ---------------- decor cards (swatch + name + Item IDs) ----------------
const cards = [];
for (const pg of pages) {
  if (listRows.some((r) => r.listPage === pg.pageNumber)) continue;
  const idTexts = pg.texts.filter((t) => ITEM_ID.test(t.str));
  const used = new Set();
  for (const idText of idTexts) {
    if (used.has(idText)) continue;
    // The decor name is the line directly above the first Item ID (long names use a smaller font).
    const column = pg.texts.filter((t) => near(t.x, idText.x, 2)).sort((a, b) => b.y - a.y);
    const nameText = column.filter((t) => t.y > idText.y && t.y - idText.y < 16 && !ITEM_ID.test(t.str)).sort((a, b) => a.y - b.y)[0];
    if (!nameText) {
      issue("error", `No decor name found above Item ID ${idText.str} on page ${pg.pageNumber}.`, { itemId: idText.str });
      continue;
    }
    // Item IDs stacked line by line under the name belong to the same decor (e.g. two sheet sizes).
    const myIds = [];
    let lastY = nameText.y;
    for (const t of column.filter((t) => t.y < nameText.y)) {
      if (lastY - t.y > 14) break;
      if (!ITEM_ID.test(t.str)) break;
      myIds.push(t);
      lastY = t.y;
    }
    if (!myIds.includes(idText)) myIds.push(idText);
    myIds.forEach((t) => used.add(t));
    const lowestId = Math.min(...myIds.map((t) => t.y));
    const specRow = pg.texts.filter((t) => t.y < lowestId && lowestId - t.y < 14 && t.x >= idText.x - 2 && t.x < idText.x + 130);
    const specText = specRow.sort((a, b) => a.x - b.x).map((t) => t.str).join(" ");
    const image = pg.images
      .filter((im) => near(im.x, idText.x, 3) && im.y > nameText.y && im.y - nameText.y < 30)
      .sort((a, b) => a.y - b.y)[0];
    const heading = pg.texts
      .filter((t) => t.size >= 14 && t.y > nameText.y)
      .sort((a, b) => a.y - b.y)[0];
    if (!image && !listRows.some((r) => myIds.some((t) => t.str === r.ITEMID) && Number(r.PAGE) === pg.pageNumber)) {
      issue("info", `Ignored Item ID ${myIds.map((t) => t.str).join(", ")} on page ${pg.pageNumber}: no swatch next to it (looks like an example, not a decor card).`);
      continue;
    }
    cards.push({
      page: pg.pageNumber,
      name: nameText.str,
      itemIds: myIds.sort((a, b) => b.y - a.y).map((t) => t.str),
      spec: specText,
      heading: heading?.str,
      image,
    });
  }
}

// ---------------- swatches ----------------
const swatchByDecor = new Map(); // decorCode -> analysis
const hashOwners = new Map();
for (const card of cards) {
  const decorCode = card.itemIds[0].match(ITEM_ID)[1];
  if (!card.image) {
    issue("error", `${card.name} (${card.itemIds.join(", ")}): no swatch image above the decor on page ${card.page}. No texture created.`, { decor: decorCode });
    continue;
  }
  if (swatchByDecor.has(decorCode)) continue;
  const px = await imagePixels(card.image);
  const a = analyse(px);
  const ppi = px.width / (card.image.w / 72);
  const printedMm = (card.image.w / 72) * 25.4;
  const isWood = /wood/i.test(card.heading ?? "");
  const isUni = /\buni\b/i.test(card.heading ?? "");
  // Only uni colours become a flat measured colour; patterned decors always keep their texture,
  // even when the pattern is faint (e.g. dark or white woodgrains).
  const plain = isUni && a.spread < 8;
  // Grain: compare gradient energy across x vs y. Only used for woodgrain decors.
  const ratio = a.gradY > 0 ? a.gradX / a.gradY : 1;
  const grain = !isWood ? "none" : ratio > 1.25 ? "vertical" : ratio < 0.8 ? "horizontal" : "unclear";
  const seam = Math.max(a.seamRatioX, a.seamRatioY);
  const s = { decorCode, ...a, ...px, data: undefined, ppi, printedMm, plain, isWood, grain, seam, grainRatio: ratio };
  swatchByDecor.set(decorCode, s);

  const prev = hashOwners.get(a.sha1);
  if (prev) issue("warning", `${card.name} uses a pixel-identical swatch to ${prev}. Check the PDF has the right image for each decor.`, { decor: decorCode });
  else hashOwners.set(a.sha1, `${card.name} (${decorCode})`);

  // Write files. The texture is turned (only if needed) so grain runs up the image; the PDF stays the original.
  const raw = sharp(px.data, { raw: { width: px.width, height: px.height, channels: px.channels } }).removeAlpha();
  const base = path.join(ASSET_DIR, "%s", `${decorCode}.jpg`);
  await raw.clone().resize(192, 192, { fit: "cover" }).jpeg({ quality: 84 }).toFile(base.replace("%s", "thumbs"));
  if (!plain) {
    await (grain === "horizontal" ? raw.clone().rotate(90) : raw.clone())
      .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
      .toFile(base.replace("%s", "textures"));
  }
}

// near-duplicates (same average hash) between different decors
const byAhash = new Map();
for (const s of swatchByDecor.values()) if (!s.plain) byAhash.set(s.ahash, [...(byAhash.get(s.ahash) ?? []), s.decorCode]);
for (const [, codes] of byAhash) if (codes.length > 1) issue("warning", `Swatches for decors ${codes.join(", ")} look almost identical. Please confirm they are different decors.`);

// ---------------- build products ----------------
const cardById = new Map();
for (const c of cards) for (const id of c.itemIds) {
  if (cardById.has(id)) issue("error", `Item ID ${id} appears on more than one decor card (pages ${cardById.get(id).page} and ${c.page}).`, { itemId: id });
  cardById.set(id, c);
}
const listById = new Map();
for (const r of listRows) {
  if (listById.has(r.ITEMID)) issue("error", `Item ID ${r.ITEMID} is listed twice in the quick order list.`, { itemId: r.ITEMID });
  listById.set(r.ITEMID, r);
}
if (!cards.length) issue("error", "No decor cards (decor name, Item ID and swatch) were found. This PDF may use a different layout from the one the importer supports.");
if (!listRows.length) issue("error", "No quick order list table (DECOR, ITEM ID, BOARD, COLLECTION, SHEET SIZE, MADE IN, PAGE) was found. Board, collection and sheet size could not be cross-checked.");
if (claimedCount !== null && claimedCount !== listRows.length)
  issue("warning", `The quick order list says ${claimedCount} Item IDs but ${listRows.length} rows were found.`);

const products = [];
const sourceName = path.basename(pdfPath).replace(/^[0-9a-f]{8}-/, "");
const allIds = new Set([...cardById.keys(), ...listById.keys()]);
for (const itemId of [...allIds].sort()) {
  const card = cardById.get(itemId);
  const row = listById.get(itemId);
  const [, decorCode, thick, boardCode, sizeCode] = itemId.match(ITEM_ID);
  if (!row) issue("warning", `${itemId} (${card.name}, page ${card.page}) is on a decor page but missing from the quick order list.`, { itemId });
  if (!card) issue("error", `${itemId} (${row.DECOR}) is in the quick order list but has no decor card or swatch in the PDF.`, { itemId });
  const name = row?.DECOR ?? card.name;
  if (row && card && row.DECOR !== card.name) issue("warning", `${itemId}: name differs between decor page ("${card.name}") and quick order list ("${row.DECOR}"). Using the quick order list.`, { itemId });
  if (row && card && Number(row.PAGE) !== card.page) issue("warning", `${itemId} (${name}): quick order list says page ${row.PAGE}, but the decor is on page ${card.page}.`, { itemId });

  const sheet = (row?.["SHEETSIZE(MM)"] ?? "").match(/(\d+)\s*x\s*(\d+)/);
  if (card && sheet && !card.spec.includes(`${sheet[1]} x ${sheet[2]}`)) issue("warning", `${itemId}: sheet size ${sheet[0]} in the list is not shown on the decor page ("${card.spec}").`, { itemId });
  const madeIn = row?.MADEIN ?? card?.spec.split("|")[1]?.trim();
  const board = row?.BOARD ?? (boardCode.startsWith("M") ? "MDF" : boardCode === "C" ? "Particleboard" : undefined);
  const collection = row?.COLLECTION ?? card?.heading;
  const sw = swatchByDecor.get(decorCode);
  const isWood = /wood/i.test(collection ?? "");
  const { finish, note } = finishFor(name, board);
  if (note) issue("info", `${itemId} (${name}): ${note}`, { itemId });

  const p = {
    id: `${slug}-${itemId.toLowerCase()}`,
    panelCode: itemId,
    productName: name,
    brand,
    category: collection ?? "Uncategorised",
    colourFamily: sw ? colourGroup(sw.mean, isWood) : "Not classified",
    colourFamilySource: sw ? "swatch-estimate" : undefined,
    finish,
    board,
    madeIn,
    decorCode,
    thicknessMm: Number(thick),
    ...(sheet ? { widthMm: Number(sheet[1]), heightMm: Number(sheet[2]) } : {}),
    thumbnailUrl: sw ? `${ASSET_URL}/thumbs/${decorCode}.jpg` : undefined,
    textureUrl: sw && !sw.plain ? `${ASSET_URL}/textures/${decorCode}.jpg` : undefined,
    colourHex: sw?.plain ? hex(sw.mean) : undefined,
    grainDirection: sw ? (sw.isWood ? (sw.grain === "unclear" ? undefined : "vertical") : "none") : undefined,
    isActive: true,
    isPublished: true,
    isDemo: false,
    sourceDocument: sourceName,
    sourcePage: card?.page ?? (row ? Number(row.PAGE) : undefined),
  };
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  products.push(p);
}

// Per-swatch suitability findings, grouped so the report stays readable.
const decorNames = new Map(products.map((p) => [p.decorCode, p.productName]));
const groupOf = new Map(products.map((p) => [p.decorCode, p.colourFamily]));
const label = (s) => `${decorNames.get(s.decorCode)} (${s.decorCode})`;
const tex = [...swatchByDecor.values()].filter((s) => !s.plain);
const lowRes = tex.filter((s) => s.width < 1024);
if (lowRes.length)
  issue("warning", `${lowRes.length} of ${tex.length} textures come from swatches under 1024 px (${[...new Set(lowRes.map((s) => s.width + "×" + s.height))].join(", ")} px). They work for thumbnails and a room-scale preview, but look soft on close-up views. Original scans of at least 2048 px per decor are recommended.`, { kind: "resolution", count: lowRes.length });
const seams = tex.filter((s) => s.seam > 2.5);
if (seams.length)
  issue("warning", `${seams.length} of ${tex.length} swatches are not seamless (their opposite edges don't match), so where a panel is larger than one repeat a straight line will show. Affected: ${seams.map(label).join(", ")}.`, { kind: "seam", count: seams.length });
for (const s of tex) if (s.isWood && s.grain === "unclear") issue("warning", `${label(s)}: grain direction could not be detected from the swatch; set grainDirection by hand.`, { decor: s.decorCode });
for (const s of tex) if (s.isWood && s.grain === "horizontal") issue("info", `${label(s)}: grain runs across the printed swatch; the texture was rotated 90° so grain runs up the door. The thumbnail keeps the printed orientation.`, { decor: s.decorCode });
for (const s of swatchByDecor.values())
  if (nameColourMismatch(decorNames.get(s.decorCode) ?? "", groupOf.get(s.decorCode)))
    issue("warning", `${label(s)}: the name suggests a different colour from the swatch (average ${hex(s.mean)}, looks ${groupOf.get(s.decorCode)}). Please check the right swatch is shown.`, { decor: s.decorCode });

const catalogue = {
  $comment: `Imported from "${sourceName}" by scripts/import-brand-pdf.mjs. Facts come from the PDF text; colourFamily is estimated from swatch pixels; textureScale is not stated in the PDF and is left empty.`,
  source: sourceName,
  brand,
  pdfTitle: meta.info?.Title,
  importedAt: new Date().toISOString(),
  products,
};
fs.writeFileSync(path.join(ROOT, "data/brands", `${slug}.json`), JSON.stringify(catalogue, null, 2) + "\n");

// ---------------- report ----------------
const swatches = [...swatchByDecor.values()];
const textured = swatches.filter((s) => !s.plain);
const count = (k) => issues.find((i) => i.kind === k)?.count ?? 0;
const lines = [];
lines.push(`# Import report: ${brand}`, "");
lines.push(`Source: \`${sourceName}\` (${doc.numPages} pages${meta.info?.Title ? `, "${meta.info.Title}"` : ""})`, `Imported: ${catalogue.importedAt}`, "");
lines.push("## Summary", "");
lines.push(`| | Count |`, `| --- | --- |`);
lines.push(`| Item IDs (products) imported | ${products.length} |`);
lines.push(`| Quick order list rows | ${listRows.length}${claimedCount !== null ? ` (the PDF says ${claimedCount})` : ""} |`);
lines.push(`| Decor cards found on decor pages | ${cards.length} |`);
lines.push(`| Distinct decors with a swatch | ${swatches.length} |`);
lines.push(`| Plain-colour swatches (used as a measured colour, no texture) | ${swatches.length - textured.length} |`);
lines.push(`| Patterned swatches turned into 3D textures | ${textured.length} |`);
lines.push(`| Swatch size | ${[...new Set(swatches.map((s) => `${s.width}×${s.height} px`))].join(", ")} (printed at about ${Math.round(swatches[0]?.printedMm ?? 0)} mm, ${Math.round(swatches[0]?.ppi ?? 0)} ppi) |`);
lines.push(`| Textures below 1024 px | ${count("resolution")} of ${textured.length} |`);
lines.push(`| Textures with a visible repeat seam | ${count("seam")} of ${textured.length} |`);
lines.push(`| Errors / warnings / notes | ${issues.filter((i) => i.level === "error").length} / ${issues.filter((i) => i.level === "warning").length} / ${issues.filter((i) => i.level === "info").length} |`, "");
lines.push("## Not in the PDF (left empty, not invented)", "");
lines.push("- **Texture scale**: the real-world size a swatch represents is not stated. The 3D preview assumes 1 m per repeat until it is supplied.");
lines.push("- **Finish for particleboard decors** (and MDF decors without an HG/ST prefix): stored as \"Not stated\". Page 14 lists surface textures (Natural, Fabric, Freze, Wood, Stone, Veneer) as available on request, without linking them to decors.");
lines.push("- **Roughness / gloss values, prices, stock**: not in the PDF.");
lines.push("- **Colour group**: not in the PDF. Estimated from each swatch's average colour and marked as an estimate (`colourFamilySource: swatch-estimate`).", "");
const section = (title, level) => {
  const list = issues.filter((i) => i.level === level);
  lines.push(`## ${title} (${list.length})`, "");
  if (!list.length) lines.push("None.", "");
  else lines.push(...list.map((i) => `- ${i.message}`), "");
};
section("Errors", "error");
section("Warnings", "warning");
section("Notes", "info");
lines.push("## Swatch checks per decor", "");
lines.push("| Decor | Name | Plain colour | Size | Seam ratio | Grain | Colour group (estimate) |", "| --- | --- | --- | --- | --- | --- | --- |");
for (const s of swatches.sort((a, b) => a.decorCode.localeCompare(b.decorCode, undefined, { numeric: true }))) {
  const p = products.find((x) => x.decorCode === s.decorCode);
  lines.push(`| ${s.decorCode} | ${decorNames.get(s.decorCode)} | ${s.plain ? hex(s.mean) : "no"} | ${s.width}×${s.height} | ${s.plain ? "–" : s.seam.toFixed(1)} | ${s.isWood ? s.grain : "–"} | ${p?.colourFamily ?? ""} |`);
}
fs.writeFileSync(path.join(ROOT, "docs/imports", `${slug}-report.md`), lines.join("\n") + "\n");

const csvRows = [["panelCode", "productName", "brand", "category", "board", "finish", "colourFamily (estimate)", "widthMm", "heightMm", "thicknessMm", "madeIn", "sourcePage", "textureUrl", "colourHex", "thumbnailUrl"]];
for (const p of products) csvRows.push([p.panelCode, p.productName, p.brand, p.category, p.board, p.finish, p.colourFamily, p.widthMm, p.heightMm, p.thicknessMm, p.madeIn, p.sourcePage, p.textureUrl, p.colourHex, p.thumbnailUrl]);
fs.writeFileSync(path.join(ROOT, "docs/imports", `${slug}-products.csv`), csvRows.map((r) => r.map((v) => (v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n");

console.log(`${products.length} products, ${swatches.length} swatches (${textured.length} textures), ${issues.filter((i) => i.level === "error").length} errors, ${issues.filter((i) => i.level === "warning").length} warnings`);
console.log(`Catalogue: data/brands/${slug}.json\nReport:    docs/imports/${slug}-report.md`);
