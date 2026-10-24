/**
 * Catalogue command-line tool.
 *
 *   npm run catalogue:validate -- path/to/file.csv|json
 *   npm run catalogue:import   -- path/to/file.csv|json [--out data/catalogue.json] [--check-files]
 *   npm run catalogue:stress   -- [count] [--out data/stress-catalogue.json]
 *
 * "import" validates the file and writes a clean JSON catalogue. Point CATALOGUE_FILE at the
 * output to serve it. Records with errors are reported and left out; nothing is auto-corrected.
 */
import fs from "node:fs";
import path from "node:path";
import { parseImportFile, validateCatalogueRecords, type ValidationReport } from "../src/lib/catalogue/validate";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const positional = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--out"));

function report(r: ValidationReport) {
  console.log(`${r.totalRecords} record(s): ${r.valid.length} valid, ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
  for (const e of r.errors) console.log(`  ERROR   record ${e.row}${e.panelCode ? ` (${e.panelCode})` : ""}${e.field ? ` [${e.field}]` : ""}: ${e.message}`);
  for (const w of r.warnings) console.log(`  warning record ${w.row}${w.panelCode ? ` (${w.panelCode})` : ""}: ${w.message}`);
}

function load(file: string) {
  const { records, unknownColumns } = parseImportFile(file, fs.readFileSync(file, "utf8"));
  if (unknownColumns.length) console.log(`Ignored unknown column(s): ${unknownColumns.join(", ")}`);
  const r = validateCatalogueRecords(records);
  if (rest.includes("--check-files")) {
    for (const p of r.valid) {
      for (const [field, url] of [["textureUrl", p.textureUrl], ["thumbnailUrl", p.thumbnailUrl]] as const) {
        if (url?.startsWith("/") && !fs.existsSync(path.join("public", url))) {
          r.warnings.push({ row: 0, panelCode: p.panelCode, field, message: `file not found: public${url}` });
        }
      }
    }
  }
  return r;
}

if (cmd === "validate" || cmd === "import") {
  const file = positional[0];
  if (!file) throw new Error("Give a .csv or .json file");
  const r = load(file);
  report(r);
  if (cmd === "import") {
    const out = flag("--out") ?? "data/catalogue.json";
    fs.writeFileSync(out, JSON.stringify({ source: path.basename(file), importedAt: new Date().toISOString(), products: r.valid }, null, 2) + "\n");
    console.log(`Wrote ${r.valid.length} product(s) to ${out}. Set CATALOGUE_FILE=${out} to serve it.`);
  }
  process.exitCode = r.errors.length ? 1 : 0;
} else if (cmd === "stress") {
  const count = Number(positional[0] ?? 600);
  const out = flag("--out") ?? "data/stress-catalogue.json";
  const families = ["White", "Grey", "Beige", "Light wood", "Mid wood", "Dark wood", "Black", "Green", "Blue"];
  const products = Array.from({ length: count }, (_, i) => {
    const hue = (i * 47) % 360;
    const hex = `#${[0, 8, 4].map((n) => { const k = (n + hue / 30) % 12; const v = 0.55 - 0.25 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(v * 255).toString(16).padStart(2, "0"); }).join("")}`;
    return {
      id: `stress-${i}`, panelCode: `DEMO-STRESS-${String(i).padStart(4, "0")}`, productName: `Demo Stress Panel ${i}`,
      category: ["Unicolour", "Woodgrain", "Stone & Concrete"][i % 3], colourFamily: families[i % families.length],
      finish: ["Matt", "Super Matt", "Satin", "High Gloss"][i % 4], colourHex: hex, grainDirection: "none",
      isActive: true, isPublished: true, isDemo: true,
    };
  });
  fs.writeFileSync(out, JSON.stringify({ $comment: "Synthetic DEMO stress-test data. Not real products.", products }, null, 2) + "\n");
  console.log(`Wrote ${count} synthetic DEMO products to ${out}. Run with CATALOGUE_FILE=${out} to try it.`);
} else {
  console.log("Usage: catalogue-cli <validate|import|stress> ...");
  process.exitCode = 1;
}
