# QA report: Target Kitchen Studio

Date: 24 Oct 2026. Tested build: `target-kitchen-studio.zip` from the shared project folder (commit `3c011e9`, "Saved designs, variants, share links, quotes and basic admin"), then the same code with the fixes below.

## Result in one paragraph

All 14 acceptance criteria pass on the fixed build, in headless Chromium with software WebGL. On the build as delivered, 12 of 14 passed. The two that failed were **phone usability** (the panel list was squashed to a 24 px strip on every phone, so customers could not see or pick panels) and **demo products shown as real** (a demo or test product added next to the real Kastamonu panels had no DEMO label on its card). Two smaller bugs were also found and fixed: a 3D texture could be thrown away while still on screen (the region turned black), and an enquiry could store a design link that shows different panels from the ones in the enquiry. Nothing was pushed anywhere.

## How it was tested

- Production build (`npm run build && npm start`), Node 22, Next.js 15.5.28.
- Five servers: real Kastamonu data with admin on (port 3000), 600-record stress catalogue (3001), the builder's designs/quotes/admin suite (3002), DEMO catalogue (3003), admin off (3004). The original, unfixed build was also run (3005) to confirm each bug before fixing it.
- My own browser script, written for this QA and independent of the builder's tests: `scripts/qa-acceptance.mjs` (`npm run test:qa`). It records console errors, page errors, failed requests and HTTP 5xx answers for the whole run.
- The builder's suites were re-run on the fixed build: real data 8/8, DEMO data 20/20, designs/sharing/quotes/admin 18/18, unit tests 33/33 (32 plus 1 new), type check clean, build clean.
- Data check: the 145 Item IDs in `data/brands/kastamonu.json` were compared with the source PDF (`pdftotext`). All 145 codes match, and decor name, board, collection, sheet size, origin and page match the PDF's quick order list for every one.

## Acceptance tests (fixed build)

| # | Test | What was done | Actual result |
| --- | --- | --- | --- |
| T1 | 3D kitchen opens | Load `/`, wait for the WebGL scene, count meshes and regions, screenshot the canvas | Pass. Ready in about 2.4–4 s (software GL), 142 meshes, 5 regions, starting panels applied |
| T2 | Rotate, zoom, reset | Mouse drag, mouse wheel, + and − buttons, arrow key with canvas focused, Top view, Reset view | Pass. Drag alpha −1.05→−1.87, wheel radius 4.70→3.92, buttons and arrow keys move the camera, Reset returns exactly to the default view |
| T3 | Search by code and name | Full Item ID, Item ID without dashes (`1669`), decor code (`1-493`), name (`walnut`, `garden oak`), nonsense text | Pass. 1 result, finds 1-669, 2 Item IDs for decor 1-493, 7 walnut results (all walnut), Garden Oak found, empty-state message for nonsense |
| T4 | Change one region only | Snapshot all regions' materials, put CANALETTO WALNUT on lower cabinets, compare | Pass. Lower uses `1-668.jpg` on its own material; the other 4 regions are byte-for-byte unchanged |
| T5 | Second region keeps the first | Put HG GALAXY BLACK on upper, BLACK on tall, walnut on shelves | Pass. Lower still walnut; upper gloss (roughness 0.10); tall plain #030406; shelves use their own material even with the same panel as lower |
| T6 | Summary shows the right codes | Open Summary & share, compare every row; download the CSV | Pass. 5 rows match the 3D scene; CSV contains all 5 Item IDs |
| T7 | Save and restore a named design | Save "QA Villa kitchen", change a panel, reload the page, reopen the design | Pass. Saved panels come back in the region cards and in the 3D scene |
| T8 | Share link restores | Copy the share link, open it in a fresh browser emulating a Pixel 7; open a damaged link | Pass. Same 5 codes and same camera; marked "not saved"; damaged link shows a warning instead of pretending |
| T9 | Truthful quote confirmation | Submit with the server answering 500, with the network cut, with no contact details, then for real | Pass. 500 and offline both show an error and keep the form filled; no contact = blocked before sending; real submit returns 201 and a reference, and that reference is in `enquiries.json` with the 5 server-checked codes |
| T10 | Missing texture warning | Make the server answer 404 for METALIC WALNUT's texture, pick it | Pass. Hatched "TEXTURE UNAVAILABLE" placeholder, warning naming 1-020-T18-C-J-1, warning on the region card, no other panel substituted; next panel applies normally |
| T11 | 500+ products | Run against the 600-record stress catalogue: load, "Show more", search the last record, apply it | Pass. Ready in about 2.5 s, paging works, last record found in about 0.5 s and applied, API search about 15–70 ms. Note: the 600 records are synthetic DEMO records; only 145 real panels exist |
| T12 | Phone usability | iPhone 13, iPhone SE, iPad: horizontal scroll, how many panel cards are visible, tap region and panel, one-finger rotate, quote and summary dialogs | Pass after fix. No horizontal scroll; 3 full panel cards visible on iPhone 13 and SE, 4 on iPad; tap select and touch rotate work; dialogs fit. **Failed on the delivered build** (see bug 1) |
| T13 | Import without code edits | Upload a CSV in the template's columns through `/admin` → Products, check, import, then use the product in the studio | Pass. "Check file" then "Import 2 product(s)"; products are live in the catalogue API without a restart; imported texture applied in 3D |
| T14 | No demo shown as real | Read every product from the API; check flags, brand, invented fields; look at the card of an imported demo product | Pass after fix. 145 real products, all Kastamonu, none with a price, stock, texture scale or roughness that the PDF does not give; demo product card shows a DEMO badge. **Failed on the delivered build** (see bug 2) |

### Console and server errors

During the full run the only browser errors were the ones the tests cause on purpose: the forced HTTP 500 and network failure on `/api/enquiries` (T9) and the forced 404 texture (T10). No uncaught page errors. The server logs show no errors or warnings.

### 3D material mapping (checked by inspecting the scene and by screenshots)

- Each region has its own material (`region:<name>`); a panel change only touches that region's meshes.
- Textured panels use the file for their own decor code (`/brands/kastamonu/textures/<decor>.jpg`); plain colours use the colour measured from the PDF swatch, with no texture.
- Wood grain runs vertically on doors and fronts, along the length on open shelves, and texture size is the same on every door (UVs in metres).
- High-gloss MDF decors (HG prefix) render glossier (roughness 0.10); decors whose finish the PDF does not state use 0.70 and the details panel says it is an estimate.

## Bugs found and fixed

1. **Phones: panel list squashed to 24 px (blocker for T12).** The page was fixed to the screen height, and on phones the 3D view, region cards, details, search and five filters used all of it, leaving 24 px for the list on iPhone SE, iPhone 13, Pixel 7 and Galaxy S9+. The earlier phone check only looked for horizontal scrolling, so it missed this.
   Fix: on phones the page now scrolls; the 3D view and region cards stay pinned at the top, so the customer sees the kitchen change while picking from a full-width list below. Desktop layout is unchanged.
   Files: `src/components/Studio.tsx`, `src/components/MaterialPanel.tsx`.
2. **Demo products not labelled in a mixed catalogue (T14).** The "Demonstration catalogue" notice only appears when *every* product is a demo. A demo or test product imported next to the real panels looked exactly like a real one in the panel grid, region cards and quote form.
   Fix: DEMO badge on the panel card, "DEMO · not a real product" on the region card, DEMO tag in the quote form's panel list (the summary already had one).
   Files: `src/components/MaterialPanel.tsx`, `src/components/RegionBar.tsx`, `src/components/QuoteDialog.tsx`.
3. **A texture still on screen could be discarded (region goes black).** If a customer picked panel A, then B, then A again before B finished downloading, the texture cache stopped counting A as in use. After browsing about 7 more panels it was freed, and that region rendered black. Confirmed on the delivered build (island turned black) and confirmed fixed.
   Fix: the cache counts how many times each region holds a texture instead of a yes/no flag.
   File: `src/lib/scene/textureManager.ts`.
4. **Enquiry could store a design link that disagrees with its panels.** The server checked the panel codes but stored the visitor's share link unchanged, so a crafted request could make the admin's "open design" show different panels from the ones listed in the enquiry.
   Fix: the server rebuilds the stored link from the checked codes (keeping only the camera from the visitor's link). New unit test added.
   Files: `src/lib/server/enquiries.ts`, `tests/unit/enquiries.test.ts`.

Smaller changes:

- Import errors for a missing required column now say "`id` is required but missing or empty (see the CSV template columns)" instead of "Invalid input: expected string, received undefined". File: `src/lib/catalogue/validate.ts`.
- The page description said "Demonstration data only", which is no longer true now that real Kastamonu panels are served. File: `src/app/layout.tsx`.
- Added `scripts/qa-acceptance.mjs` and `npm run test:qa`; README updated; `qa-screenshots/` added to `.gitignore`. Files: `package.json`, `README.md`, `.gitignore`, `docs/qa-report.md`.

## Not tested (no claim either way)

- Real phones and tablets with real GPUs, iOS Safari, Firefox and desktop Safari. Only Chromium with emulated devices and software rendering was used. Frame rate on real hardware is unknown.
- Supabase storage for enquiries (no Supabase project exists), deployment to Netlify or Vercel, and loading a real GLB kitchen model (none supplied).
- Email or WhatsApp notification of enquiries (not built).
- Print layout of the summary (the button exists; the printed page was not checked).

## Remaining blockers and open items

No blocker remains for the 14 acceptance criteria in this test environment. Open items that need the business or the supplier, not code:

- **ST NEW GREY PVC (3-199-T18-M-M-1)** looks beige-brown. The swatch in the PDF (page 16) is also beige-brown, so the app shows the PDF faithfully. Kastamonu should confirm the right swatch.
- **Texture quality:** the PDF swatches are 520 px and 92 of 101 patterned ones do not tile, so seams and softness show up close. Supplier scans would fix this.
- **Texture scale:** the real size of one swatch repeat is not in the PDF; the preview assumes 1 m.
- **Changing kitchen layout** replaces the customer's panel choices with that layout's defaults without asking. Not a criterion; worth deciding whether to keep choices.
- **Phone screens:** on the smallest phone (iPhone SE) about one row of panels is visible at a time below the pinned 3D view. It works, but a collapsible 3D view could be a later improvement.
