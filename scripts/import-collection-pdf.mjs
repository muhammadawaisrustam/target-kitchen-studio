// Imports the multi-brand "Target Panels Collection" PDF into the catalogue: one product per Item ID
// in the quick order list, each with the swatch printed on its own decor card.
//
//   node scripts/import-collection-pdf.mjs <file.pdf>
//
// Writes, per brand (slug = brand name in lower case):
//   data/brands/<slug>.json                     catalogue records (validated by the app on load)
//   public/brands/<slug>/textures/<key>.jpg     swatch used as the 3D texture (grain turned upright)
//   public/brands/<slug>/thumbs/<key>.jpg       192 px catalogue thumbnail
// and one report for the whole collection:
//   docs/imports/collection-report.md + collection-products.csv
//
// Rules (same as scripts/import-brand-pdf.mjs): facts come only from the PDF text. Values the PDF
// does not state are left empty. Values computed from swatch pixels (plain colour, colour group,
// grain direction) are marked as estimates. A product without its own swatch gets no texture.
// Product ids are "<slug>-<item id in lower case>", so re-imports keep the same ids.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const pdfPath = process.argv.slice(2).find((a) => a.toLowerCase().endsWith(".pdf"));
if (!pdfPath) {
  console.error("Usage: node scripts/import-collection-pdf.mjs <file.pdf>");
  process.exit(1);
}
const ROOT = process.cwd();
fs.mkdirSync(path.join(ROOT, "data/brands"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "docs/imports"), { recursive: true });

// ---------------- helpers ----------------
/** Any Item ID printed in the collection: 1-001-T18-C-J-1, 1-001N-…, 1-390-T0.8-HSUD-S-9, 3-706-R37-T18-24 … */
const ITEM_ID = /^\d+-\d{3,4}[A-Z]?-[A-Z0-9.]+(?:-[A-Z0-9.]+){1,4}$/;
const despace = (s) => (/^(\S ){2,}\S$/.test(s.trim()) ? s.trim().replace(/ /g, "") : s.trim());
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const issues = []; // { level: "error"|"warning"|"info", message, brand? }
const issue = (level, message, ref = {}) => issues.push({ level, message, ...ref });
const slugOf = (brand) => brand.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const BOARD_NAMES = {
  MFC: "Particleboard",
  MFM: "MDF",
  "PVC/PET": "PVC/PET",
  HPL: "HPL",
  Compact: "Compact laminate",
  Curved: "Curved panel",
  Polylac: "Polylac",
};

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
    else if (fn === pdfjs.OPS.paintImageXObject) images.push({ name: a[0], x: ctm[4], y: ctm[5], w: ctm[0], h: ctm[3], page });
  }
  return { pageNumber, page, texts, images };
}

async function imagePixels(img) {
  // Images used on several pages are stored once, in the document-wide object store ("g_" names).
  const store = img.name.startsWith("g_") ? img.page.commonObjs : img.page.objs;
  const obj = await new Promise((resolve) => store.get(img.name, resolve));
  if (obj.kind === 1) throw new Error("1-bit images are not supported");
  const channels = obj.kind === 3 ? 4 : 3; // pdf.js ImageKind
  return { width: obj.width, height: obj.height, channels, data: Buffer.from(obj.data.buffer, obj.data.byteOffset, obj.data.byteLength) };
}

/** Pixel measurements used to judge whether a swatch is usable as a texture. */
function analyse({ width, height, channels, data }) {
  const n = width * height;
  const lum = new Float32Array(n);
  let r = 0, g = 0, b = 0;
  for (let i = 0, p = 0; i < n; i++, p += channels) {
    r += data[p];
    g += data[p + 1];
    b += data[p + 2];
    lum[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  const mean = [r / n, g / n, b / n];
  const sample = [];
  for (let i = 0; i < n; i += 7) sample.push(lum[i]);
  sample.sort((x, y) => x - y);
  const spread = sample[Math.floor(sample.length * 0.95)] - sample[Math.floor(sample.length * 0.05)];
  let gx = 0, gy = 0, seamX = 0, seamY = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width - 1; x++) gx += Math.abs(lum[y * width + x + 1] - lum[y * width + x]);
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width; x++) gy += Math.abs(lum[(y + 1) * width + x] - lum[y * width + x]);
  const interiorX = gx / (height * (width - 1));
  const interiorY = gy / (width * (height - 1));
  for (let y = 0; y < height; y++) seamX += Math.abs(lum[y * width] - lum[y * width + width - 1]);
  for (let x = 0; x < width; x++) seamY += Math.abs(lum[x] - lum[(height - 1) * width + x]);
  seamX /= height;
  seamY /= width;
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
  return {
    mean,
    spread,
    gradX: interiorX,
    gradY: interiorY,
    seamRatioX: interiorX > 0.05 ? seamX / interiorX : 0,
    seamRatioY: interiorY > 0.05 ? seamY / interiorY : 0,
    ahash: hashBits.map((v) => (v > avg ? "1" : "0")).join(""),
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

/** Colour group estimated from the swatch's average colour (same rules as the Kastamonu import). */
function colourGroup(mean, isWood) {
  const [h, , l] = hsl(mean);
  const chroma = Math.max(...mean) - Math.min(...mean);
  if (l < 14) return isWood && chroma > 6 ? "Dark wood" : "Black";
  if (chroma < 16) return l > 88 ? "White" : l > 22 ? "Grey" : "Black";
  if (l < 24 && (h >= 330 || h < 60)) return isWood ? "Dark wood" : "Brown";
  if ((h >= 15 && h < 55) || h >= 330 || h < 15) {
    if (isWood) return l > 68 ? "Light wood" : l > 42 ? "Mid wood" : "Dark wood";
    if (h >= 330 || h < 15) return chroma > 60 ? "Red" : l > 72 ? "Beige" : "Brown";
    return l > 72 ? "Beige" : "Brown";
  }
  if (h >= 55 && h < 75) return l > 72 ? "Beige" : "Green";
  if (h >= 75 && h < 170) return "Green";
  if (h >= 170 && h < 260) return "Blue";
  return "Purple";
}

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

/**
 * HPL surface headings above each group of cards. They are letter-spaced in the PDF
 * ("S U E D E ( S U D )"), so word gaps are lost when the spacing is removed; the names are
 * spelled out here exactly as printed, keyed by the despaced heading.
 */
const FINISH_HEADINGS = {
  "SUEDE(SUD)": ["Suede", "SUD"],
  "HIGHGLOSS(HGLO)": ["High gloss", "HGLO"],
  "HIGHGLOSS2MM(GLS)": ["High gloss 2 mm", "GLS"],
  "TRACE(TRC)": ["Trace", "TRC"],
  "TSTTEXTURE": ["TST texture", "TST"],
  "EDGYASH(ASH)": ["Edgy ash", "ASH"],
  "VERACIOUSBARK(VRB)": ["Veracious bark", "VRB"],
  "ARIA(ARA)": ["Aria", "ARA"],
  "SANTHIA(SAN)": ["Santhia", "SAN"],
  "SYNCHRO(SYN)": ["Synchro", "SYN"],
  "OLMO(OLM)": ["Olmo", "OLM"],
  "STONE(STN)": ["Stone", "STN"],
  "SATIN(SAT)": ["Satin", "SAT"],
  "TXMTEXTURE": ["TXM texture", "TXM"],
  "SPARKLE(SPK)": ["Sparkle", "SPK"],
  "JUPITER(JUP)": ["Jupiter", "JUP"],
  "BRUSHED(BRS)": ["Brushed", "BRS"],
};
const LOOKS_LIKE_HEADING = /^[A-Z0-9]+\([A-Z]{3,4}\)$|^[A-Z]{3}TEXTURE$/;

/** Finish, only where the PDF states it: HPL surface heading, Item ID code, or the decor name prefix. */
function finishFor(row, card, board) {
  const name = row.DECOR;
  if (board === "HPL") {
    const h = card?.finishHeading;
    if (h) {
      const code = row.ITEMID.split("-")[3] ?? "";
      if (!code.includes(h.code)) return { finish: h.name, note: `Surface heading "${h.name} (${h.code})" does not match the finish code ${code} in the Item ID; please check.` };
      return { finish: h.name };
    }
    return { finish: "Not stated", note: "No surface heading found above the decor card." };
  }
  if (board === "Compact laminate") {
    if (/-SUD-/.test(row.ITEMID)) return { finish: "Suede", note: "Finish read from the SUD code in the Item ID (Greenlam legend on page 36: HSUD = suede)." };
    return { finish: "Not stated" };
  }
  const hg = /^HG\b/.test(name);
  const st = /^(HG |MATT )?ST\b/.test(name);
  if (hg && st) return { finish: "High gloss / soft touch", note: "Name starts with both HG and ST; finish needs confirming." };
  if (hg) return { finish: "High gloss" };
  if (st || /^SOFT TOUCH\b/.test(name)) return { finish: "Soft touch" };
  if (/SUPER MATT/.test(name)) return { finish: "Super matt" };
  if (/^MATT\b/.test(name)) return { finish: "Matt" };
  return { finish: "Not stated" };
}

// ---------------- read the PDF ----------------
const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await pdfjs.getDocument({ data, verbosity: 0, isEvalSupported: false }).promise;
const meta = await doc.getMetadata().catch(() => ({ info: {} }));
const pages = [];
for (let p = 1; p <= doc.numPages; p++) pages.push(await readPage(doc, p));
const sourceName = path.basename(pdfPath).replace(/^[0-9a-f]{8}-/, "");

// ---------------- quick order list (authoritative table) ----------------
const HEADER_KEYS = ["DECOR", "ITEMID", "BOARD", "COLLECTION", "SIZE(MM)", "MADEIN/BRAND", "PAGE"];
const listRows = [];
const listPages = new Set();
for (const pg of pages) {
  const headerTexts = pg.texts.filter((t) => HEADER_KEYS.includes(despace(t.str).replace(/ /g, "")));
  if (headerTexts.length < 6) continue;
  listPages.add(pg.pageNumber);
  // A page can hold several tables (one per product category), each with its own header row.
  const headers = new Map();
  for (const t of headerTexts) {
    const key = [...headers.keys()].find((y) => near(y, t.y, 1.5)) ?? t.y;
    headers.set(key, [...(headers.get(key) ?? []), { key: despace(t.str).replace(/ /g, ""), x: t.x }]);
  }
  const headerYs = [...headers.keys()].sort((a, b) => b - a);
  const rows = new Map();
  for (const t of pg.texts) {
    if (t.y >= headerYs[0] - 1) continue;
    const key = [...rows.keys()].find((k) => near(k, t.y, 1.5)) ?? t.y;
    rows.set(key, [...(rows.get(key) ?? []), t]);
  }
  for (const [y, cells] of rows) {
    const hy = headerYs.find((h) => h > y);
    const cols = headers.get(hy).sort((a, b) => a.x - b.x);
    const rec = {};
    for (const c of cells.sort((a, b) => a.x - b.x)) {
      const col = [...cols].reverse().find((h) => c.x >= h.x - 2);
      if (col) rec[col.key] = rec[col.key] ? `${rec[col.key]} ${c.str}` : c.str;
    }
    if (rec.ITEMID && ITEM_ID.test(rec.ITEMID)) listRows.push({ ...rec, listPage: pg.pageNumber });
  }
}
const claimed = pages.flatMap((p) => p.texts).find((t) => /\d+ Item IDs/.test(t.str));
const claimedCount = claimed ? Number(claimed.str.match(/(\d+) Item IDs/)[1]) : null;
const listById = new Map();
for (const r of listRows) {
  if (listById.has(r.ITEMID)) issue("error", `Item ID ${r.ITEMID} is listed twice in the quick order list.`);
  listById.set(r.ITEMID, r);
}
if (claimedCount !== null && claimedCount !== listRows.length)
  issue("warning", `The quick order list says ${claimedCount} Item IDs but ${listRows.length} rows were found.`);

// ---------------- decor cards (swatch + name + Item IDs) ----------------
// A card is an image with the decor name directly under it and one or more Item IDs below the name.
// Each Item ID printed on a decor page is attached to the nearest image above it in the same column.
const cards = [];
const cardById = new Map();
for (const pg of pages) {
  if (listPages.has(pg.pageNumber)) continue;
  const swatchImages = pg.images.filter((im) => im.w >= 60 && im.h >= 60 && im.w < 300);
  const headings = [];
  for (const t of pg.texts) {
    const key = t.str.replace(/ /g, "");
    if (!LOOKS_LIKE_HEADING.test(key)) continue;
    const known = FINISH_HEADINGS[key];
    if (!known) issue("warning", `Unknown surface heading "${t.str}" on page ${pg.pageNumber}; add it to FINISH_HEADINGS.`);
    else headings.push({ y: t.y, name: known[0], code: known[1] });
  }
  const byImage = new Map();
  for (const t of pg.texts) {
    if (!listById.has(t.str)) continue;
    const img = swatchImages
      .filter((im) => t.x >= im.x - 3 && t.x <= im.x + im.w && im.y > t.y && im.y - t.y < 100)
      .sort((a, b) => a.y - b.y)[0];
    if (!img) {
      issue("info", `Item ID ${t.str} on page ${pg.pageNumber} has no swatch above it (not a decor card).`);
      continue;
    }
    byImage.set(img, [...(byImage.get(img) ?? []), t]);
  }
  for (const [image, idTexts] of byImage) {
    // Decor name: the first line under the image, inside the image's width (may be split into parts).
    const under = pg.texts.filter((t) => t.x >= image.x - 1 && t.x < image.x + image.w && t.y < image.y && image.y - t.y < 25 && !ITEM_ID.test(t.str));
    const topY = Math.max(...under.map((t) => t.y));
    const name = under.filter((t) => near(t.y, topY, 1)).sort((a, b) => a.x - b.x).map((t) => t.str).join(" ");
    const spec = pg.texts
      .filter((t) => t.x >= image.x - 1 && t.x < image.x + image.w && t.y < image.y && image.y - t.y < 60 && t.size < 7 && /mm|\||[A-Z][a-z]/.test(t.str))
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((t) => t.str)
      .join(" ");
    const finishHeading = headings.filter((h) => h.y > image.y + image.h).sort((a, b) => a.y - b.y)[0];
    const card = { page: pg.pageNumber, name, spec, image, itemIds: idTexts.sort((a, b) => b.y - a.y).map((t) => t.str), finishHeading };
    cards.push(card);
    for (const id of card.itemIds) {
      if (cardById.has(id)) issue("error", `Item ID ${id} appears on more than one decor card (pages ${cardById.get(id).page} and ${card.page}).`);
      cardById.set(id, card);
    }
  }
}

// ---------------- brands, boards, swatches ----------------
const brandOf = (row) => {
  const parts = row["MADEIN/BRAND"].split("/").map((s) => s.trim());
  return parts.length > 1 ? { brand: parts[1], madeIn: parts[0] } : { brand: parts[0] };
};

/** Swatch analysis per card, computed once. */
const swatchOfCard = new Map();
for (const card of cards) {
  const px = await imagePixels(card.image);
  const a = analyse(px);
  swatchOfCard.set(card, { ...a, width: px.width, height: px.height, px, ppi: px.width / (card.image.w / 72) });
}

// Asset keys (file names), per brand: the decor code of the Item ID, unless the same brand prints
// different images for one decor code (e.g. an HPL decor in suede and in high gloss); then the first
// Item ID of that decor on the card is used. A card can hold Item IDs of two brands (MDF BLACK on
// page 18 is both Target and Kastamonu), so keys are worked out per Item ID, not per card.
const decorOf = (itemId) => itemId.split("-").slice(0, 2).join("-");
const keyOfItem = new Map();
{
  const groups = new Map();
  for (const [itemId, card] of cardById) {
    const row = listById.get(itemId);
    const g = `${slugOf(brandOf(row).brand)}|${decorOf(itemId)}|${row.BOARD === "Curved" ? "curved" : "flat"}`;
    groups.set(g, [...(groups.get(g) ?? []), { itemId, card }]);
  }
  for (const [g, list] of groups) {
    const [slug, decor, kind] = g.split("|");
    const distinct = new Set(list.map(({ card }) => swatchOfCard.get(card).sha1));
    for (const { itemId, card } of list) {
      const first = card.itemIds.find((id) => decorOf(id) === decor && slugOf(brandOf(listById.get(id)).brand) === slug);
      const base = distinct.size > 1 ? first.toLowerCase() : decor;
      keyOfItem.set(itemId, kind === "curved" ? `${base}-curved` : base);
    }
  }
}

// ---------------- build products ----------------
const products = [];
const written = new Set();
const textureFor = new Map(); // `${slug}|${decor}` -> flat texture info (for curved panels in the same decor)
const pending = [];
for (const itemId of [...listById.keys()].sort()) {
  const row = listById.get(itemId);
  const card = cardById.get(itemId);
  const { brand, madeIn } = brandOf(row);
  const slug = slugOf(brand);
  const board = BOARD_NAMES[row.BOARD];
  if (!board) issue("error", `${itemId}: unknown board "${row.BOARD}".`);
  const decorCode = itemId.split("-").slice(0, 2).join("-");
  const collection = row.COLLECTION;
  const isWood = /wood/i.test(collection);
  const isUni = /\buni\b/i.test(collection) || (board === "Compact laminate" && collection === "Colors");
  const notes = [];
  if (!card) issue("error", `${itemId} (${row.DECOR}) is in the quick order list but has no decor card or swatch in the PDF.`, { brand });
  else {
    if (card.name !== row.DECOR) issue("warning", `${itemId}: name differs between decor page ("${card.name}") and quick order list ("${row.DECOR}"). Using the quick order list.`, { brand });
    if (Number(row.PAGE) !== card.page) issue("warning", `${itemId} (${row.DECOR}): quick order list says page ${row.PAGE}, but the decor is on page ${card.page}.`, { brand });
  }

  // Sizes: "1220 x 2440" sheets; curved panels print "R37 x 2745" (radius x length).
  const sheet = row["SIZE(MM)"].match(/^(\d+)\s*x\s*(\d+)$/);
  const curved = row["SIZE(MM)"].match(/^R(\d+)\s*x\s*(\d+)$/);
  if (card && sheet && !card.spec.includes(`${sheet[1]} x ${sheet[2]}`)) issue("warning", `${itemId}: sheet size ${sheet[0]} in the list is not shown on the decor page ("${card.spec}").`, { brand });
  const thick = itemId.match(/-T(\d+(?:\.\d+)?)-/);
  if (curved) notes.push(`Curved panel, radius ${curved[1]} mm, length ${curved[2]} mm.`);

  const { finish, note } = finishFor(row, card, board);
  if (note) issue("info", `${itemId} (${row.DECOR}): ${note}`, { brand });

  const p = {
    id: `${slug}-${itemId.toLowerCase()}`,
    panelCode: itemId,
    productName: row.DECOR,
    brand,
    category: collection,
    colourFamily: "Not classified",
    finish,
    board,
    madeIn,
    decorCode,
    thicknessMm: thick ? Number(thick[1]) : undefined,
    ...(sheet ? { widthMm: Number(sheet[1]), heightMm: Number(sheet[2]) } : curved ? { heightMm: Number(curved[2]) } : {}),
    isActive: true,
    isPublished: true,
    isDemo: false,
    sourceDocument: sourceName,
    sourcePage: card?.page ?? Number(row.PAGE),
  };

  if (card) {
    const sw = swatchOfCard.get(card);
    const key = keyOfItem.get(itemId);
    const base = `/brands/${slug}`;
    const dir = path.join(ROOT, "public/brands", slug);
    const plain = isUni && sw.spread < 8;
    const ratio = sw.gradY > 0 ? sw.gradX / sw.gradY : 1;
    const grain = !isWood ? "none" : ratio > 1.25 ? "vertical" : ratio < 0.8 ? "horizontal" : "unclear";
    const swatchInfo = { ...sw, plain, grain, isWood, key, name: row.DECOR, decorCode, brand, card };
    if (!written.has(`${slug}/${key}`)) {
      written.add(`${slug}/${key}`);
      for (const d of ["textures", "thumbs"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
      const raw = sharp(sw.px.data, { raw: { width: sw.px.width, height: sw.px.height, channels: sw.px.channels } }).removeAlpha();
      await raw.clone().resize(192, 192, { fit: "cover" }).jpeg({ quality: 84 }).toFile(path.join(dir, "thumbs", `${key}.jpg`));
      if (!plain && !curved)
        await (grain === "horizontal" ? raw.clone().rotate(90) : raw.clone())
          .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
          .toFile(path.join(dir, "textures", `${key}.jpg`));
    }
    p.thumbnailUrl = `${base}/thumbs/${key}.jpg`;
    if (curved) {
      // The curved-panel picture is a 3D render of the bent panel, not a flat swatch, so it is only
      // used as the thumbnail. The texture comes from the flat board of the same brand and decor code.
      pending.push({ p, slug, decorCode, swatchInfo });
    } else {
      p.colourFamily = colourGroup(sw.mean, isWood);
      p.colourFamilySource = "swatch-estimate";
      if (plain) p.colourHex = hex(sw.mean);
      else p.textureUrl = `${base}/textures/${key}.jpg`;
      p.grainDirection = isWood ? (grain === "unclear" ? undefined : "vertical") : "none";
      if (!textureFor.has(`${slug}|${decorCode}`)) textureFor.set(`${slug}|${decorCode}`, { p, swatchInfo });
      p._swatch = swatchInfo;
    }
  }
  if (notes.length) p.notes = notes.join(" ");
  products.push(p);
}

for (const { p, slug, decorCode } of pending) {
  const flat = textureFor.get(`${slug}|${decorCode}`);
  if (flat) {
    for (const k of ["textureUrl", "colourHex", "colourFamily", "colourFamilySource", "grainDirection"]) if (flat.p[k] !== undefined) p[k] = flat.p[k];
    p.notes = `${p.notes} Texture taken from the flat ${flat.p.board} panel ${flat.p.panelCode} (${flat.p.productName}), same brand and decor code; the curved panel itself is shown only as a 3D render in the PDF.`;
    issue("info", `${p.panelCode} (${p.productName}): curved panel uses the swatch of flat panel ${flat.p.panelCode}, same brand and decor code ${decorCode}.`, { brand: p.brand });
  } else {
    p.isPublished = false;
    p.notes = `${p.notes} Not published: the PDF shows this decor only as a 3D render of the curved panel, with no flat swatch to use as a texture.`;
    issue("warning", `${p.panelCode} (${p.productName}): no flat swatch for decor ${decorCode} anywhere in the PDF, only a render of the curved panel. Imported but not published; send a flat swatch to show it in 3D.`, { brand: p.brand });
  }
}

// Item IDs that look misprinted: a 4-digit decor number where every other decor has 3 digits.
for (const p of products) {
  if (/^\d+-\d{4}-/.test(p.panelCode)) {
    p.isPublished = false;
    p.notes = `${p.notes ? p.notes + " " : ""}Not published: the decor number has 4 digits, which looks like a misprint; please confirm the Item ID.`;
    issue("warning", `${p.panelCode} (${p.productName}, page ${p.sourcePage}): the decor number has 4 digits, unlike every other Item ID. It looks like a misprint (perhaps of ${p.panelCode.replace(/^(\d+-)\d(\d{3})/, "$1$2")}). Imported but not published until confirmed.`, { brand: p.brand });
  }
}

// ---------------- swatch findings ----------------
const swatches = [];
{
  const seen = new Set();
  for (const p of products) if (p._swatch && !seen.has(`${p.brand}/${p._swatch.key}`)) {
    seen.add(`${p.brand}/${p._swatch.key}`);
    swatches.push(p._swatch);
  }
}
const label = (s) => `${s.name} (${s.brand} ${s.decorCode})`;
const tex = swatches.filter((s) => !s.plain);
const lowRes = tex.filter((s) => s.width < 1024);
if (lowRes.length)
  issue("warning", `${lowRes.length} of ${tex.length} textures come from swatches under 1024 px (${[...new Set(lowRes.map((s) => s.width + "×" + s.height))].join(", ")} px). Fine for thumbnails and a room-scale preview, soft on close-ups. Original scans of at least 2048 px per decor are recommended.`, { kind: "resolution", count: lowRes.length });
const seams = tex.filter((s) => Math.max(s.seamRatioX, s.seamRatioY) > 2.5);
if (seams.length)
  issue("warning", `${seams.length} of ${tex.length} swatches are not seamless (opposite edges don't match), so a straight line can show where a panel is larger than one repeat. Affected: ${seams.map(label).join(", ")}.`, { kind: "seam", count: seams.length });
for (const s of tex) if (s.isWood && s.grain === "unclear") issue("warning", `${label(s)}: grain direction could not be detected from the swatch; set grainDirection by hand.`);
for (const s of tex) if (s.isWood && s.grain === "horizontal") issue("info", `${label(s)}: grain runs across the printed swatch; the texture was rotated 90° so grain runs up the door.`);
for (const s of swatches) {
  const group = products.find((p) => p._swatch === s)?.colourFamily;
  if (nameColourMismatch(s.name, group)) issue("warning", `${label(s)}: the name suggests a different colour from the swatch (average ${hex(s.mean)}, looks ${group}). Please check the right swatch is shown.`);
}
const shaOwners = new Map();
for (const s of swatches) {
  const prev = shaOwners.get(s.sha1);
  if (prev && prev.card === s.card) issue("info", `${label(s)} and ${label(prev)} are printed on one decor card (page ${s.card.page}), so they share its swatch.`);
  else if (prev) issue("warning", `${label(s)} uses a pixel-identical swatch to ${label(prev)}. Check the PDF has the right image for each decor.`);
  else if (!prev) shaOwners.set(s.sha1, s);
}
const polylac = products.filter((p) => p.board === "Polylac");
if (polylac.length)
  issue("warning", `Digital Polylac (${polylac.length} designs): each picture shows a whole printed epoxy-river sheet, not a repeating pattern. The 3D preview tiles it at 1 m per repeat, so the river design repeats across large doors. Use it as an impression only.`);

// ---------------- write brand files ----------------
const byBrand = new Map();
for (const p of products) {
  const clean = { ...p };
  delete clean._swatch;
  for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k];
  byBrand.set(p.brand, [...(byBrand.get(p.brand) ?? []), clean]);
}
const importedAt = new Date().toISOString();
for (const [brand, list] of byBrand) {
  const file = path.join(ROOT, "data/brands", `${slugOf(brand)}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        $comment: `Imported from "${sourceName}" by scripts/import-collection-pdf.mjs. Facts come from the PDF text; colourFamily is estimated from swatch pixels; textureScale is not stated in the PDF and is left empty.`,
        source: sourceName,
        brand,
        pdfTitle: meta.info?.Title,
        importedAt,
        products: list,
      },
      null,
      2,
    ) + "\n",
  );
}

// ---------------- report ----------------
const lines = [];
const count = (k) => issues.find((i) => i.kind === k)?.count ?? 0;
lines.push(`# Import report: ${meta.info?.Title ?? sourceName}`, "");
lines.push(`Source: \`${sourceName}\` (${doc.numPages} pages)`, `Imported: ${importedAt}`, "");
lines.push("## Summary", "");
lines.push("| | Count |", "| --- | --- |");
lines.push(`| Item IDs (products) imported | ${products.length} |`);
lines.push(`| Quick order list rows | ${listRows.length}${claimedCount !== null ? ` (the PDF says ${claimedCount})` : ""} |`);
lines.push(`| Decor cards found on decor pages | ${cards.length} |`);
lines.push(`| Published / not published | ${products.filter((p) => p.isPublished).length} / ${products.filter((p) => !p.isPublished).length} |`);
lines.push(`| Plain-colour swatches (measured colour, no texture) | ${swatches.length - tex.length} |`);
lines.push(`| Patterned swatches turned into 3D textures | ${tex.length} |`);
lines.push(`| Textures below 1024 px | ${count("resolution")} of ${tex.length} |`);
lines.push(`| Textures with a visible repeat seam | ${count("seam")} of ${tex.length} |`);
lines.push(`| Errors / warnings / notes | ${issues.filter((i) => i.level === "error").length} / ${issues.filter((i) => i.level === "warning").length} / ${issues.filter((i) => i.level === "info").length} |`, "");
lines.push("## Per brand and board", "");
lines.push("| Brand | Board | Item IDs | Published |", "| --- | --- | --- | --- |");
const combos = new Map();
for (const p of products) {
  const k = `${p.brand}|${p.board}`;
  const c = combos.get(k) ?? { n: 0, pub: 0 };
  c.n++;
  if (p.isPublished) c.pub++;
  combos.set(k, c);
}
for (const [k, c] of [...combos].sort()) lines.push(`| ${k.split("|").join(" | ")} | ${c.n} | ${c.pub} |`);
lines.push("");
lines.push("## Not in the PDF (left empty, not invented)", "");
lines.push("- **Texture scale**: the real-world size a swatch represents is not stated. The 3D preview assumes 1 m per repeat.");
lines.push("- **Finish** for melamine decors without an HG/ST/MATT prefix and for Digital Polylac: stored as \"Not stated\". HPL finishes come from the surface heading above each card (Suede, High gloss, Veracious bark…).");
lines.push("- **Country of manufacture** where the list prints only the brand (most Glory, all Greenlam and Polylac rows): left empty.");
lines.push("- **Sheet width of curved panels**: the PDF gives radius and length only. The radius is in the product notes.");
lines.push("- **Edgebands** (page 34): no Item IDs or decors are listed, only types and sizes, so nothing was imported.");
lines.push("- **Roughness / gloss values, prices, stock**: not in the PDF.");
lines.push("- **Colour group**: estimated from each swatch's average colour and marked as an estimate (`colourFamilySource: swatch-estimate`).", "");
const section = (title, level) => {
  const list = issues.filter((i) => i.level === level);
  lines.push(`## ${title} (${list.length})`, "");
  lines.push(...(list.length ? list.map((i) => `- ${i.message}`) : ["None."]), "");
};
section("Errors", "error");
section("Warnings", "warning");
section("Notes", "info");
fs.writeFileSync(path.join(ROOT, "docs/imports", "collection-report.md"), lines.join("\n") + "\n");

const csvRows = [["panelCode", "productName", "brand", "category", "board", "finish", "colourFamily (estimate)", "widthMm", "heightMm", "thicknessMm", "madeIn", "sourcePage", "isPublished", "textureUrl", "colourHex", "thumbnailUrl", "notes"]];
for (const p of products) csvRows.push([p.panelCode, p.productName, p.brand, p.category, p.board, p.finish, p.colourFamily, p.widthMm, p.heightMm, p.thicknessMm, p.madeIn, p.sourcePage, p.isPublished, p.textureUrl, p.colourHex, p.thumbnailUrl, p.notes]);
fs.writeFileSync(
  path.join(ROOT, "docs/imports", "collection-products.csv"),
  csvRows.map((r) => r.map((v) => (v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n",
);

console.log(`${products.length} products in ${byBrand.size} brands (${[...byBrand].map(([b, l]) => `${b} ${l.length}`).join(", ")})`);
console.log(`${issues.filter((i) => i.level === "error").length} errors, ${issues.filter((i) => i.level === "warning").length} warnings. Report: docs/imports/collection-report.md`);
