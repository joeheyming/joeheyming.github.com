# joeheyming.github.io — Agent Guide

This is a **static GitHub Pages site** (no backend, no SSR). Every app is a folder served as plain HTML/CSS/JS.  
Live site: <https://joeheyming.github.io>

---

## Quick rules

- **No server.** Everything runs in the browser. No Node/Express, no serverless routes, no same-origin API calls.
- **No TypeScript `any`.** The few `.ts` / `.d.ts` files in the repo follow strict typing.

---

## Adding a new app — checklist

### 1. Create the app folder

```
my-app/
  index.html        # always required
  index.css         # separate when CSS is non-trivial (>~80 lines)
  index.js          # separate when JS is non-trivial (>~100 lines)
  my-app-preview.png  # generated later (step 5)
```

Try not to inline `<style>` and `<script>` in one big `index.html`.
Use `<script type="module" src="index.js">` when the JS file is standalone (it provides its own scope and implicit strict mode, no IIFE needed). Use a plain IIFE for classic inline scripts.

### 2. `index.html` head

Copy the `<head>` from a recent app and adapt the title, description, canonical URL, OG/Twitter tags, and JSON-LD name. Every head needs:

- charset + viewport
- A unique, concise `<title>` using `App Name — Descriptive Phrase [emoji]`; use an em dash, put any emoji last, omit `Joe Heyming` except on `/about/`, and keep `og:title` / `twitter:title` aligned (see `.cursor/rules/page-title-standards.mdc`)
- Emoji favicon (inline SVG data-URL — no image file needed; see any existing app)
- **`meta name="robots" content="index, follow"`** — required for Google indexing (see [Search indexing & SEO](#search-indexing--seo))
- `description`, `og:*`, `twitter:*`, `canonical` pointing to `https://joeheyming.github.io/my-app/`
- `og:image` / `twitter:image` pointing to the preview PNG (generated in step 4)
- The shared scripts in order: async gtag loader, `/analytics.js`, then one `<script src="/site.js">` tag. `site.js` loads nav, feedback, share, and achievements; options go on its tag (`data-nav-size="compact"`, `data-share-fab="off"`, `data-skip="achievements"`). Don't list those four scripts separately; `npm run sync:site-boot` rewrites a page that does, and `tests/site-boot.test.mjs` fails until you run it.
- JSON-LD `SoftwareApplication` + breadcrumb (optional but good for SEO)

### 3. Register in `apps-registry.json`

Add an object to the top-level array. Required fields:

| Field                 | Example                                         | Notes                                                 |
| --------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `id`                  | `"my-app"`                                      | Unique slug, matches folder name                      |
| `name`                | `"My App 🎉"`                                   | Full display name with emoji                          |
| `shortName`           | `"My App"`                                      | Compact label for menus                               |
| `description`         | `"One-line blurb"`                              | Gallery card, share widget                            |
| `detailedDescription` | `"Longer text…"`                                | Launcher menu, search                                 |
| `icon`                | `"🎉"`                                          | Emoji for OS launcher / home cards                    |
| `path`                | `"./my-app/"`                                   | Always `./` prefix, trailing slash                    |
| `category`            | `"utility"`                                     | `"game"`, `"utility"`, or `"entertainment"`           |
| `gradient`            | `"from-blue-500/20 to-indigo-500/20"`           | Tailwind tokens for home gallery                      |
| `border`              | `"border-blue-600/30 hover:border-blue-500/50"` | Launcher card border                                  |
| `taskbarGradient`     | `"from-blue-700 to-indigo-900"`                 | Heyming OS taskbar                                    |
| `taskbarText`         | `"text-white"`                                  | Taskbar text color                                    |
| `defaultWidth`        | `900`                                           | Heyming OS window width                               |
| `defaultHeight`       | `700`                                           | Heyming OS window height                              |
| `tags`                | `["tag1", "tag2"]`                              | Home page search                                      |
| `related`             | `["notepad", "terminal"]`                       | Cross-links via `share.js`                            |
| `shareCategory`       | `"utility"`                                     | Grouping in share widget (usually mirrors `category`) |

Optional fields:

| Field             | Purpose                                                                             |
| ----------------- | ----------------------------------------------------------------------------------- |
| `system`          | `true` → pinned to OS start menu                                                    |
| `desktopIcon`     | `true` → shortcut on Heyming OS desktop                                             |
| `desktopPosition` | `{ "x": 30, "y": 130 }` for fixed placement                                         |
| `handles`         | `["text/*", "image/png"]` for OS "Open with" routing                                |
| `pwaShortcut`     | `{ name, short_name, description }` → included when you run `npm run sync:catalog`  |
| `featured`        | `{ order, headline, blurb, tagsLine, preset, analyticsLabel }` → home featured grid |

### 4. Sync discovery projections + generate the SEO preview

```bash
npm run sync:catalog   # manifest shortcuts + sitemap.xml + missing PAGES rows
```

Then generate the preview PNG:

1. Start a local server on port 8000:
   ```bash
   python3 -m http.server 8000
   ```
2. Run:
   ```bash
   node generate-previews.js        # only generates missing PNGs
   node generate-previews.js --force  # regenerates all
   ```
3. Commit the resulting `<app>/<app>-preview.png`.

Screenshot viewport is **1200×630** (OG standard). Do **not** hand-edit `sitemap.xml` or `PAGES` for a normal new app — `sync:catalog` owns those projections (exclusions for redirect stubs live in `scripts/sync-portfolio-metadata.mjs`).

### 5. After adding a `pwaShortcut`

Already covered by `npm run sync:catalog` in step 4.

---

## Search indexing & SEO

Every public app page should be **crawlable and explicitly indexable**. Google Search Console's live test checks whether a URL can be fetched and whether indexing is allowed — not whether it will rank. A passing live test plus "Request indexing" only queues the URL; [Google still applies quality, duplicate, and manual-action checks](https://support.google.com/webmasters/answer/9012289#will_i_be_indexed).

### Required in every `index.html` `<head>`

These are what GSC looks for on the live test. Missing them is a common reason pages fail indexing or show up as "unknown to Google."

| Tag                                                                                     | Purpose                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<meta name="robots" content="index, follow" />`                                        | **Explicit allow.** Without this (or with `noindex`), GSC may report "Indexing allowed: No." Default browser behavior is indexable, but always set this on pages you want in Search. |
| `<meta name="description" … />`                                                         | Snippet text for Search results and social previews.                                                                                                                                 |
| `<link rel="canonical" href="https://joeheyming.github.io/my-app/" />`                  | Preferred URL. Use the trailing-slash directory form, not `index.html`. Consolidates `/my-app/` and `/my-app/index.html`.                                                            |
| `<meta property="og:url" … />`                                                          | Should match the canonical URL.                                                                                                                                                      |
| `<meta property="og:title" />`, `og:description`, `og:image`                            | Open Graph — used by Google and link unfurlers.                                                                                                                                      |
| `<meta name="twitter:card" />`, `twitter:title`, `twitter:description`, `twitter:image` | Twitter/X cards; mirror OG content.                                                                                                                                                  |
| JSON-LD `SoftwareApplication`                                                           | Structured data; optional breadcrumb `BreadcrumbList` is good practice.                                                                                                              |

Also load the shared scripts listed in step 2 (`analytics.js`, `nav.js`, etc.). OS apps loaded in iframes still need a full `<head>` on their standalone `index.html` — the iframe context does not replace crawl metadata.

**Reference heads:** `notepad/index.html`, `media-player/index.html`, `ascii/index.html`.

### When to use `noindex`

Use `<meta name="robots" content="noindex,follow" />` only when the page should **not** appear in Search:

- **Redirect stubs** (e.g. `legend-of-doom/` → `/doom/?flavor=legend`) — the destination is the canonical indexed page.
- **Internal-only or duplicate surfaces** you deliberately exclude.

Do not put redirect-only or `noindex` URLs in `sitemap.xml`.

### Site-level indexing checklist

When adding or fixing an app for Search:

1. **`index.html` head** — all required tags above; `robots` is `index, follow`.
2. **`apps-registry.json`** — registers the app on the home page.
3. **`npm run sync:catalog`** — updates `sitemap.xml`, `manifest.json` shortcuts, and missing `generate-previews.js` PAGES rows.
4. **`robots.txt`** — site-wide allow (already points to `sitemap.xml` at the root).
5. **Preview PNG** — generate via `generate-previews.js` for `og:image` / `twitter:image`.
6. **After deploy** — URL Inspection in Search Console: **Test live URL** → confirm "Indexing allowed: Yes" → **Request indexing** (~10 requests/day per property). Helper scripts live in `scripts/gsc-inspect-url.sh` and `scripts/gsc-continue.sh`.

### Common live-test failures

| GSC report                                | Typical fix                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `noindex` detected                        | Add or fix `<meta name="robots" content="index, follow" />`; remove accidental `noindex`.     |
| URL is unknown to Google                  | Page never crawled — request indexing after live test passes; ensure URL is in `sitemap.xml`. |
| Duplicate without user-selected canonical | Add `<link rel="canonical">`; prefer `/my-app/` over `/my-app/index.html`.                    |
| Redirect page in sitemap                  | Remove from sitemap; use `noindex` on the stub; index the destination instead.                |
| Bare OS utility `<head>`                  | Add full SEO head even for `system: true` apps (see `media-player/` fix).                     |

---

## Shared utilities

| File               | What it does                                                                                                                                   | When to load                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `/analytics.js`    | GA init, product outcomes, error tracking, INP, and shared-link UTM generation                                                                 | Almost always (with the async gtag loader)                                                                                                |
| `/site.js`         | Loads the shared chrome below in order, without blocking the parser, and forwards `data-nav-size` / `data-share-fab`; `data-skip` drops any     | All standalone pages, right after `/analytics.js`                                                                                         |
| `/nav.js`          | Hamburger toggle (top-left) + left-rail drawer with all apps from `apps-registry.json`; hides itself inside iframes and standalone PWA         | Through `/site.js`                                                                                                                        |
| `/feedback.js`     | `<feedback-button>` web component → Google Form                                                                                                | Through `/site.js`                                                                                                                        |
| `/share.js`        | Related-projects panel from `apps-registry.json` `related` field                                                                               | Through `/site.js` (`data-skip="share"` on pages without `related` entries)                                                               |
| `/shared/lazy.js`  | ES module: `loadScript`, `loadScriptsInOrder`, `once`, `preload`, `preloadOnIntent`, the one just-in-time loader                              | Import (or `import()` from a classic script) wherever code loads on demand; see [Loading code just in time](#loading-code-just-in-time)  |
| `/proxy.js`        | `window.proxyService` — CORS-safe fetch with fallback proxies, caching, circuit breaker                                                        | Only when fetching cross-origin resources (ROMs, APIs, etc.)                                                                              |
| `/gamepad-core.js` | ES-module Gamepad API normalization, standard button/axis names, deadzones, connection lifecycle, and one polling loop                         | Import from app-specific adapters; it deliberately emits no keyboard, mouse, or game actions                                              |
| `/gamepad-keys.js` | ES-module adapter that synthesizes arrow / Enter / Escape for discrete keyboard-driven games; no-op when the Gamepad API is absent             | Opt-in via `type="module"` (see `2048/`). **Never** on native consumers (`emulator/`, `stepmania/`, `doom/`, `pacman/`)                     |

### Nav toggle clearance

The hamburger nav toggle is `position: fixed` at `top: 20px; left: 20px` (desktop) and `top: 12px; left: 12px` (mobile ≤640px). Its rendered size is roughly **44px tall × ~100px wide** on desktop and **40px tall × ~90px wide** on mobile portrait. While the drawer is open the toggle is hidden (`[aria-expanded="true"]` / `[hidden]`), so overlap only matters in the closed state.

**Every app header must clear it.** Common fixes:

- Titles or nav links at top-left: add `padding-left` equal to or greater than the toggle width + gap (≥ 120px desktop, ≥ 100px mobile). See `ascii/index.css` for an example.
- Short app headers: opt into compact mode — the toggle shrinks and drops opacity:
  ```html
  <script src="/site.js" data-nav-size="compact"></script>
  ```
- Full-bleed hero layouts: use `padding-top` ≥ 60px on the first content block so the toggle doesn't land on a heading.

Check the relevant app's source when changing its header. Do not add a
site-wide browser sweep for this shared CSS invariant.

---

## Loading code just in time

There is no bundler, so a page downloads exactly what its HTML and static
`import`s name. Keep that set to what the first screen renders, and load the
rest when the visitor asks for it.

- **First screen only.** A `<script>` tag or a static `import` belongs on a
  page only if the page's first screen uses it. Engines, players, editors,
  and their input layers load on the gesture that needs them.
- **One loader.** Load on demand with `/shared/lazy.js`, not a hand-rolled
  `<script>` injector or a `setInterval` that waits for a global.
  - `once(fn)` memoizes a loader. A failed load clears the memo, so the next
    click retries.
  - `loadScriptsInOrder([...])` loads classic scripts that publish
    `window.*` globals, in order.
  - Use plain `import()` for ES modules. A classic script can call
    `import('/shared/lazy.js')` too.
- **Preload on intent.** `preloadOnIntent(target, urls, { module })` fetches
  the next step when the pointer enters `target` or a key is pressed inside it.
  Focus alone is not intent: pages move focus themselves (initial focus, TV
  roving), so it would preload on page load.
- **Show failures.** If an on-demand load rejects, say so on the page
  ("did not load, try again"). Don't leave a dead button.
- **Budgets.** `tests/eager-load-budget.test.mjs` caps the bytes each large
  page downloads before any interaction, using the static graph in
  `tests/import-graph-helpers.mjs`. When you move code off a page, lower its
  budget to the new total plus a little headroom. Raise a budget only when the
  first screen really needs the new code.
- **Testing lazy paths.** `tests/load-app-script.mjs` runs classic scripts in
  jsdom. Its `/shared/lazy.js` evaluates the requested files from the repo and
  records `window.__loadedScripts` and `window.__preloaded`, so a test can
  check what loaded and when.

Where the big apps draw the line:

| Page                    | First screen                                    | Loaded on demand                                                                                                                                  |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doom/`                 | Flavor picker, lifecycle, COI (`doom/boot.js`)  | `uzdoom-loader.js` graph, touch and gamepad input, and the engine (`doom/engine.js` `ensureEngine`) on launch; moddb and `/proxy.js` in manual mode; live chat at idle |
| `emulator/`             | Console picker                                  | A console's game list (`LISTING_SCRIPTS` in `launch.js`)                                                                                         |
| `emulator/<console>/`   | Game list                                       | `socd.js`, `ejs-mount.js`, `play.js` (`PLAY_SCRIPTS`), preloaded when the pointer enters the list                                                 |
| `stepmania/`            | Song menu                                       | Play engine, library, and JSZip; a `zenius=` link primes the chart through `js/zeniusEntry.js`                                                    |

---

## Console web views (PS5)

The PS5 has no browser app. You reach its hidden WebKit view via Settings → Users and Accounts → Linked Services → YouTube → Use Browser → Terms → the Google footer link, or by opening a URL sent to yourself in a PSN message. The card has **△ Reload**, so cache-busting query params are unnecessary.

Measured on retail PS5 firmware in August 2026, via `/diag/`:

| Capability                                        | Result                                              |
| ------------------------------------------------- | --------------------------------------------------- |
| ES modules, Pointer Events, `new KeyboardEvent()` | **yes**                                             |
| WebAssembly                                       | **missing entirely** — not just `SharedArrayBuffer` |
| WebGL 1 and WebGL 2                               | **both false**                                      |
| `AudioContext` / `webkitAudioContext`             | **neither exists**                                  |
| `navigator.getGamepads`                           | **not a function**                                  |
| Touch Events                                      | false                                               |
| Viewport / DPR                                    | 1540 × 700, ratio 1                                 |

**Input model:** the controller drives a mouse cursor. X is a left click, arriving as `pointerdown` / `mousedown` / `click` with `pointerType=mouse`. The D-pad **does** emit `keydown` / `keyup` in addition to moving the pointer, so keyboard-driven games are reachable — but not through `/gamepad-keys.js`, which correctly no-ops because the Gamepad API is absent. The exact `key` / `code` / `keyCode` values have not yet been recorded. `2048/index.js` defensively resolves all three forms pending a device retest; do not claim a specific field mismatch as the root cause without that log evidence.

What this rules out on that device: everything under `/emulator/` plus `/doom/` and `/dos/` (WASM cores), all of `/play/` (no Web Audio — `getCtx()` throws on every note), and anything WebGL including `/model-viewer/`, `/pacman/`, and `/pacman-infinite/`. DOM-and-CSS apps are fine. HTML5 video also works: shows play in the Watch app when its external proxy succeeds.

Two consequences for code:

- A host callback that throws must not corrupt shared state. `play/shared/pointer-surface.js` records its pointer tracking _before_ invoking `onEnter` / `onLeave` precisely because a throwing synth would otherwise strand keys in a pressed state on this device.
- Feature-detect before promising a platform works. Re-verify with `/diag/` rather than assuming; it is dependency-free (classic script, no imports, no shared site scripts) so it still reports on engines where the normal machinery is what's broken.

---

## Doom assets

Do not commit `.wad` files. `.gitignore` ignores `*.wad`.

Do not commit the gameplay mods `LegendOfDoom-1.1.0.pk3`, `mariodoom.pk3`, `met2.pk3`, `Castlevania.ipk3`, or `sonicdoom-legacy.pk3`. `.gitignore` lists those paths. Each flavor fetches its archive from the commit pinned in `doom/flavors.js` (`MOD_COMMIT`). Keep that SHA: a branch URL 404s once the files leave the tree. The engine packages `uzdoom.pk3`, `game_support.pk3`, `brightmaps.pk3`, `lights.pk3`, and `game_widescreen_gfx.pk3` stay in `doom/`.

Classic DOOM's `doom.wad`, the Super MAYhem 17 map pack, Batman DOOM, the Zombies campaign, Sigil, Sigil II, Witching Hour, DoomCraft, Lego Base, Block Fort, the Roblox joke map, Pokémon DOOM (`pkmnv9r.wad`, from the Internet Archive item, not committed), Simpsons Doom, and Pirate Doom are fetched when that flavor launches. A new flavor is one record in `doom/flavors.js`; cards, menus, and ink colors come from that list. Freedoom Phase 1 and Phase 2 are inside the engine preload, not loose WADs.

## Emulator consoles

Adding a console under `/emulator/` is primarily editing `emulator/consoles.js`, then syncing:

1. Add the console record in `emulator/consoles.js`.
2. `npm run sync:emulator` — regenerates hub picker tiles (between `sync:emulator-picker` markers) and creates any missing `emulator/<id>/index.html` lander (does not overwrite hand-tuned SEO).
3. Add an `apps-registry.json` entry for `./emulator/<id>/`.
4. `npm run sync:catalog` — sitemap, preview PAGES rows, manifest shortcuts.

Optional `seoDescription` on the console cfg is used when generating a new lander.

---

## Heyming OS integration

The same `index.html` is loaded inside an `<iframe>` by `os/WindowManager.js`. Shared scripts auto-hide inside iframes (`nav.js`, `feedback.js`). Registry fields that matter for OS:

- `defaultWidth` / `defaultHeight` — initial window size
- `system`, `desktopIcon`, `desktopPosition` — desktop shortcut placement
- `handles` — MIME types for "Open with" (see `mime-handlers.js`)

Test OS launch via `http://localhost:8000/os/` after registering the app.

---

## Technology choices

### Tailwind CSS

Tailwind is loaded from CDN (`https://cdn.tailwindcss.com`) and is available on some pages — the home page, the OS shell, and a handful of apps use it for layout and utility classes. It is **not a requirement**. Most apps use hand-rolled CSS in `index.css` with CSS custom properties. Prefer hand-rolled CSS for apps with their own visual identity; Tailwind is fine for pages that are primarily structural (dashboards, launchers, content-heavy layouts).

Do not `npm install` Tailwind or add a build step — CDN only.

### Third-party packages

No build step, no bundler, no `node_modules` at runtime. Three patterns for pulling in a library:

1. **CDN `<script>` tag** (non-module, sets a global): pinned to an exact version on `cdn.jsdelivr.net` or `unpkg.com`. Good for libraries that ship a UMD/IIFE build (`marked`, `DOMPurify`, emulator cores, etc.).

   ```html
   <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
   ```

2. **Import map + ESM imports**: for libraries that ship proper ES modules, declare the map in a `<script type="importmap">` and import normally in your module script. Used by `stock/` (Chart.js + Luxon) and `model-viewer/` (Three.js).

   ```html
   <script type="importmap">
     { "imports": { "chart.js/auto": "https://esm.sh/chart.js@4.4.4/auto" } }
   </script>
   ```

3. **Inline / vendored**: for tiny utilities or heavily patched forks, paste the source into the app folder.

Always pin to an exact version. Never leave a `@latest` URL in committed code.

### Web components vs. plain DOM

**Use web components for reusable, encapsulated UI that gets shared across apps.** `feedback-button` (in `feedback.js`) and `stepmania`'s `loading-overlay` / `step-button` are the existing examples — they have shadow DOM, their own styles, and are registered with `customElements.define`.

**Use plain DOM for everything app-specific.** Building a one-off button, dialog, or panel inside a single app doesn't warrant a custom element. Write it as a function that creates/returns DOM nodes, or just inline the HTML and wire it up in JS.

Rule of thumb: if the component will be used in more than one app, or needs style isolation, make it a web component in a shared file. Otherwise, keep it plain.

### `<template>` elements

Avoid. They add indirection without benefit when you already control the JS. Build DOM programmatically or write it directly in HTML.

### File size and splitting

When a file gets unwieldy, split by responsibility — not by arbitrary line count. Natural seams: renderer, state/model, UI wiring, data fetching. Use ES module `import`/`export` to connect them (the root `.eslintrc.js` already sets `sourceType: 'module'`). A good rule of thumb: if you have to scroll past unrelated code to find what you're editing, it's time to split.

---

## Code style & tooling

- **Prettier** (`.prettierrc`): single quotes, 100-char print width, no trailing commas, semicolons.
- **ESLint** (`.eslintrc.js`): `eslint:recommended` + `prettier`, `sourceType: 'module'`.
- Run both before committing on touched files:
  ```bash
  npx prettier --write <app>/index.js <app>/index.css <app>/index.html
  npx eslint <app>/index.js
  ```
- No TypeScript `any`. The shared type definitions live in `types/globals.d.ts`.

---

## Testing

- **Unit/integration tests:** `tests/*.test.mjs` (run with `node --test` or `npm test`).

### Stop: do not add Playwright tests

For the love of god, please no more Playwright tests. This personal static site
previously accumulated 469 browser tests that took more than two minutes and
still did not finish. They were deleted.

- Use `node:test` for behavior and pure logic.
- Use jsdom for HTML structure, metadata, accessibility attributes, and DOM
  behavior that does not require layout.
- Read the relevant HTML/CSS/JS for visual changes and trust the user's report.
- Never launch a browser once per app or viewport to check a shared invariant.
- Do not restore `@playwright/test`, `playwright.config.js`, or `tests/e2e/`.
- Do not sneak browser automation into `npm test`; tests must be local,
  deterministic, and network-free.

The `playwright` package remains only for explicit asset-generation scripts such
as `generate-previews.js`. That is tooling, not a license to add browser tests.
Only add a browser test if the user explicitly requests one in the current task.

---

## Files touched when adding a new app

| File                         | Change                                                                 |
| ---------------------------- | ---------------------------------------------------------------------- |
| `<app>/index.html`           | New                                                                    |
| `<app>/index.css`            | New (if non-trivial styles)                                            |
| `<app>/index.js`             | New (if non-trivial logic)                                             |
| `<app>/<app>-preview.png`    | New — generated by `generate-previews.js`                              |
| `apps-registry.json`         | Add one registry entry                                                 |
| (via `npm run sync:catalog`) | `sitemap.xml`, `generate-previews.js` PAGES, `manifest.json` shortcuts |
| `manifest.json`              | Auto-updated by sync when `pwaShortcut` is set                         |
