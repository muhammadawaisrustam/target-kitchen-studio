# Target Kitchen Studio (prototype)

A browser-based 3D kitchen visualiser for decorative wood panels. Pick a cabinet region, pick a panel, and the 3D kitchen updates live.

> **Demonstration data only.** Every panel code (`DEMO-…`), name, texture and specification in this repository is synthetic. None of it is a genuine Target Furniture Factory product, stock item or price. The kitchens are illustrative prototypes, not manufacturing drawings. No official Target branding is used.

![Desktop view](docs/screenshots/05-three-regions.jpg)

## What works today

- A real WebGL 3D kitchen (Babylon.js), built from geometry: cabinet carcasses, doors, drawers, handles, plinths, worktops, splashback, hob, sink, hood, oven, island with waterfall ends, open shelves, stools and pendants.
- Two layouts from a model registry: **L-shaped with island** (5 regions) and **Straight** (4 regions).
- Separate material regions: upper cabinets, lower cabinets, tall units, kitchen island, open shelves. Changing a panel only changes the selected region.
- Select a region from the cards under the viewport or by clicking a cabinet in 3D.
- Live material switching with:
  - 12 tileable procedural textures (woodgrain, stone, textile effect) and 8 plain colours, 21 DEMO products in all;
  - texture scale in real-world metres, so grain is not stretched across doors (see "Texture rules");
  - grain direction and rotation per product;
  - roughness from product data, or an estimate from the finish name that the UI labels as an estimate;
  - textures downloaded only when a panel is selected, cached, and released when unused;
  - a hatched "TEXTURE UNAVAILABLE" placeholder and a warning when a texture fails. Another panel is never silently substituted.
- Camera: drag to rotate, scroll or pinch to zoom, right-drag or two-finger drag to pan, arrow keys when the canvas is focused, zoom buttons, reset, and Front / Side / Top / 3D views.
- Searchable catalogue (code with or without dashes, name, category, colour, finish), category/colour/finish filters, and paging served by `/api/catalogue`. Tested with 600 records.
- Responsive layout for desktop, tablet and phone.
- Render-on-demand: the GPU stops drawing about 1.5 s after the last interaction.

Not built yet, on purpose (deferred by the project owner): saved designs, compare, share links, quotation requests, admin screens. No buttons for these exist in the UI.

## Run it locally

Requires Node.js 20.9 or newer. Everything used is free and open source.

```bash
npm install
npm run dev          # http://localhost:3000 (development)
# or
npm run build && npm start   # production build
```

## Tests

```bash
npm test             # unit tests (Node's built-in test runner)
npm run build && npm start   # in one terminal
npm run test:e2e     # browser checks against http://localhost:3000 (set BASE_URL to change)
```

The browser checks need Playwright's Chromium (`npx playwright install chromium` once). Screenshots and `results.json` go to `e2e-screenshots/`.

Latest results (24 Oct 2026, headless Chromium with software WebGL):

| Check | Result |
| --- | --- |
| Browser checks | 20/20 pass |
| Unit tests: catalogue validation, CSV import, 600-record query, material mapping, mesh-to-region mapping, UV projection | 15/15 pass |
| T1 3D kitchen renders (142 meshes, 5 regions) | pass |
| T2 rotate (drag and arrow keys), zoom (wheel and buttons), pan (right-drag), preset views, reset view | pass |
| T3 search by code and by name, empty state, category filter | pass |
| T4 panel changes only the selected region (checked in the scene graph and by canvas pixels) | pass |
| T5 second region keeps the first region's panel | pass |
| T6 region summary shows the right codes | pass |
| T10 missing texture shows a warning and a placeholder, scene keeps working | pass |
| T12 phone 390×844: no horizontal scroll, tap select, one-finger touch rotate | pass |
| T14 every product is DEMO-coded and the disclaimer is shown | pass |
| Click a cabinet in 3D selects its region; reset design; switching layouts; no page errors | pass |

Not verified: real phones and tablets with GPUs (only emulated touch in Chromium), Safari and Firefox, and frame rate on real hardware. In software rendering a frame took about 2 to 4 ms; the 3D engine bundle is about 290 KB gzipped and loads after the page.

## Project structure

```
data/                      demo catalogue (JSON), CSV template
public/demo-assets/        generated DEMO textures, thumbnails, model previews
scripts/
  generate-demo-textures.mjs   procedural texture generator (npm run textures:generate)
  catalogue-cli.ts             validate / import / stress-test catalogues
  e2e.mjs                      browser acceptance checks
src/
  app/                     Next.js pages and the /api/catalogue route
  components/              Studio, Viewport, MaterialPanel, RegionBar, Swatch
  lib/catalogue/           product schema (zod), validation, CSV parser, search/paging
  lib/materials/           product -> material settings (pure, unit-tested)
  lib/models/              region ids, kitchen model registry, mesh-to-region mapping
  lib/scene/               Babylon.js: viewer, procedural kitchens, texture cache, material service, UVs
  lib/server/              file-backed catalogue repository
tests/unit/                unit tests
```

## Adding real panel data

1. Fill in `data/catalogue-template.csv` (one row per panel), or supply JSON in the same shape as `data/demo-catalogue.json`. Leave unknown specifications blank: optional fields stay empty and are never invented.
2. Put texture and thumbnail images under `public/` (JPG, PNG or WebP) and reference them as `/textures/CODE.jpg`, or use `https://` URLs.
3. Validate and import:
   ```bash
   npm run catalogue:validate -- my-panels.csv
   npm run catalogue:import -- my-panels.csv --out data/catalogue.json --check-files
   ```
   The validator rejects missing or duplicate codes, duplicate ids, bad URLs and unsupported image formats, and warns about missing textures, scale or grain direction.
4. Set `CATALOGUE_FILE=data/catalogue.json` (see `.env.example`) and restart. No application code changes are needed.

Field notes: `textureScale` is the real-world size in metres covered by one repeat of the texture; `grainDirection` is `vertical`, `horizontal` or `none`; `roughness` is 0 (mirror) to 1 (fully matt); set `isDemo` to `false` for genuine products. `stockStatus` should only be filled from a reliable live source.

To try a large catalogue: `npm run catalogue:stress -- 600` then `CATALOGUE_FILE=data/stress-catalogue.json npm start`.

## Texture rules

- Texture images must tile seamlessly and be authored with the grain running **up the image** (along its height).
- Cabinet UVs are generated in metres from the geometry ("box projection"), so `textureScale: 1` means one image covers 1 m × 1 m of panel on every door, whatever its size. Each door gets a small random offset so neighbouring doors don't show identical grain.
- Door and panel grain runs vertically; shelf grain runs along the shelf.
- 1024 × 1024 px is enough for a 1 m repeat on screen. Thumbnails are 192 × 192 px.

## Adding a kitchen model

Models live in `src/lib/models/registry.ts`. Each entry has an id, name, source (procedural builder or a `.glb` URL), preview image, region mapping rules, default panel per region and a default camera.

For a GLB file:

1. Put it in `public/models/` and add a registry entry with `source: { type: "gltf", url: "/models/kitchen.glb" }`.
2. Map its meshes to regions with `meshNames`, `meshNamePatterns` (regular expressions) or `materialNames`. Mesh names from 3D tools are often generic, so list the names you need and use the model's material names where they are cleaner. Meshes that match nothing keep their own material.
3. Choose `uvMode`: `"model"` keeps the file's UVs (they must be authored at 1 UV unit = 1 metre for `textureScale` to be correct); `"box-projection"` regenerates metre-based UVs, which suits flat doors and panels but not curved or profiled parts. Those need proper UV unwrapping in Blender or similar before import.

The GLB loading path is implemented but has not yet been exercised with a real model file, because none has been supplied.

## Deployment (free options only)

The app is a standard Next.js server app (pages plus one API route), with no database or paid services.

- **Netlify (free plan):** connect the GitHub repo; Netlify detects Next.js automatically. Build command `npm run build`.
- **Vercel (Hobby, free):** import the repo; no settings needed. Vercel's Hobby plan is limited to non-commercial use, so it fits a private demo but a public company site would need a different plan or host.
- **Any Node.js host or a small VPS:** `npm ci && npm run build && npm start` (port 3000, or set `PORT`).

`data/*.json` is bundled with the API route for serverless hosts (see `outputFileTracingIncludes` in `next.config.ts`).

## Known limitations and next steps

- Demo textures are procedural; real Target textures and codes are needed.
- Metals are approximated as grey non-metallic surfaces because no reflection environment is loaded; gloss shows as highlights rather than reflections.
- Next stages (deferred): saved designs and compare (local storage first), share links, quotation request with a review step, catalogue/admin tools, Supabase (free tier) storage for designs and enquiries.
