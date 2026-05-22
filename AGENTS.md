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
- Emoji favicon (inline SVG data-URL — no image file needed; see any existing app)
- **`meta name="robots" content="index, follow"`** — required for Google indexing (see [Search indexing & SEO](#search-indexing--seo))
- `description`, `og:*`, `twitter:*`, `canonical` pointing to `https://joeheyming.github.io/my-app/`
- `og:image` / `twitter:image` pointing to the preview PNG (generated in step 4)
- The four shared scripts in order: async gtag loader, `/analytics.js`, `/back.js`, `/feedback.js`, `/share.js`
- JSON-LD `SoftwareApplication` + breadcrumb (optional but good for SEO)

### 3. Register in `apps-registry.json`

Add an object to the top-level array. Required fields:

| Field | Example | Notes |
|-------|---------|-------|
| `id` | `"my-app"` | Unique slug, matches folder name |
| `name` | `"My App 🎉"` | Full display name with emoji |
| `shortName` | `"My App"` | Compact label for menus |
| `description` | `"One-line blurb"` | Gallery card, share widget |
| `detailedDescription` | `"Longer text…"` | Launcher menu, search |
| `icon` | `"🎉"` | Emoji for OS launcher / home cards |
| `path` | `"./my-app/"` | Always `./` prefix, trailing slash |
| `category` | `"utility"` | `"game"`, `"utility"`, or `"entertainment"` |
| `gradient` | `"from-blue-500/20 to-indigo-500/20"` | Tailwind tokens for home gallery |
| `border` | `"border-blue-600/30 hover:border-blue-500/50"` | Launcher card border |
| `taskbarGradient` | `"from-blue-700 to-indigo-900"` | Heyming OS taskbar |
| `taskbarText` | `"text-white"` | Taskbar text color |
| `defaultWidth` | `900` | Heyming OS window width |
| `defaultHeight` | `700` | Heyming OS window height |
| `tags` | `["tag1", "tag2"]` | Home page search |
| `related` | `["notepad", "terminal"]` | Cross-links via `share.js` |
| `shareCategory` | `"utility"` | Grouping in share widget (usually mirrors `category`) |

Optional fields:

| Field | Purpose |
|-------|---------|
| `system` | `true` → pinned to OS start menu |
| `desktopIcon` | `true` → shortcut on Heyming OS desktop |
| `desktopPosition` | `{ "x": 30, "y": 130 }` for fixed placement |
| `handles` | `["text/*", "image/png"]` for OS "Open with" routing |
| `pwaShortcut` | `{ name, short_name, description }` → run `npm run sync:manifest` after |
| `featured` | `{ order, headline, blurb, tagsLine, preset, analyticsLabel }` → home featured grid |

### 4. Generate the SEO preview screenshot

1. Start a local server on port 8000:
   ```bash
   python3 -m http.server 8000
   # or: npx serve -p 8000
   ```
2. Add an entry to the `PAGES` array in `generate-previews.js`:
   ```js
   {
     url: `${BASE_URL}/my-app/`,
     output: 'my-app/my-app-preview.png',
     title: 'My App'
   }
   ```
3. Run:
   ```bash
   node generate-previews.js        # only generates missing PNGs
   node generate-previews.js --force  # regenerates all
   ```
4. Commit the resulting `my-app/my-app-preview.png`.

Screenshot viewport is **1200×630** (OG standard).

### 5. After adding a `pwaShortcut`

```bash
npm run sync:manifest
```

This updates `manifest.json` shortcuts from the registry.

---

## Search indexing & SEO

Every public app page should be **crawlable and explicitly indexable**. Google Search Console's live test checks whether a URL can be fetched and whether indexing is allowed — not whether it will rank. A passing live test plus "Request indexing" only queues the URL; [Google still applies quality, duplicate, and manual-action checks](https://support.google.com/webmasters/answer/9012289#will_i_be_indexed).

### Required in every `index.html` `<head>`

These are what GSC looks for on the live test. Missing them is a common reason pages fail indexing or show up as "unknown to Google."

| Tag | Purpose |
|-----|---------|
| `<meta name="robots" content="index, follow" />` | **Explicit allow.** Without this (or with `noindex`), GSC may report "Indexing allowed: No." Default browser behavior is indexable, but always set this on pages you want in Search. |
| `<meta name="description" … />` | Snippet text for Search results and social previews. |
| `<link rel="canonical" href="https://joeheyming.github.io/my-app/" />` | Preferred URL. Use the trailing-slash directory form, not `index.html`. Consolidates `/my-app/` and `/my-app/index.html`. |
| `<meta property="og:url" … />` | Should match the canonical URL. |
| `<meta property="og:title" />`, `og:description`, `og:image` | Open Graph — used by Google and link unfurlers. |
| `<meta name="twitter:card" />`, `twitter:title`, `twitter:description`, `twitter:image` | Twitter/X cards; mirror OG content. |
| JSON-LD `SoftwareApplication` | Structured data; optional breadcrumb `BreadcrumbList` is good practice. |

Also load the shared scripts listed in step 2 (`analytics.js`, `back.js`, etc.). OS apps loaded in iframes still need a full `<head>` on their standalone `index.html` — the iframe context does not replace crawl metadata.

**Reference heads:** `notepad/index.html`, `media-player/index.html`, `ascii/index.html`.

### When to use `noindex`

Use `<meta name="robots" content="noindex,follow" />` only when the page should **not** appear in Search:

- **Redirect stubs** (e.g. `legend-of-doom/` → `/doom/?flavor=legend`) — the destination is the canonical indexed page.
- **Internal-only or duplicate surfaces** you deliberately exclude.

Do not put redirect-only or `noindex` URLs in `sitemap.xml`.

### Site-level indexing checklist

When adding or fixing an app for Search:

1. **`index.html` head** — all required tags above; `robots` is `index, follow`.
2. **`sitemap.xml`** — add a `<url>` entry with `https://joeheyming.github.io/my-app/` (trailing slash, no `index.html`).
3. **`apps-registry.json`** — registers the app on the home page; separate from sitemap but helps discovery.
4. **`robots.txt`** — site-wide allow (already points to `sitemap.xml` at the root).
5. **Preview PNG** — generate via `generate-previews.js` for `og:image` / `twitter:image`.
6. **After deploy** — URL Inspection in Search Console: **Test live URL** → confirm "Indexing allowed: Yes" → **Request indexing** (~10 requests/day per property). Helper scripts live in `scripts/gsc-inspect-url.sh` and `scripts/gsc-continue.sh`.

### Common live-test failures

| GSC report | Typical fix |
|------------|-------------|
| `noindex` detected | Add or fix `<meta name="robots" content="index, follow" />`; remove accidental `noindex`. |
| URL is unknown to Google | Page never crawled — request indexing after live test passes; ensure URL is in `sitemap.xml`. |
| Duplicate without user-selected canonical | Add `<link rel="canonical">`; prefer `/my-app/` over `/my-app/index.html`. |
| Redirect page in sitemap | Remove from sitemap; use `noindex` on the stub; index the destination instead. |
| Bare OS utility `<head>` | Add full SEO head even for `system: true` apps (see `media-player/` fix). |

---

## Shared utilities

| File | What it does | When to load |
|------|-------------|--------------|
| `/analytics.js` | GA init, `trackEvent`, engagement pings, shared-link tracking | Almost always (with the async gtag loader) |
| `/back.js` | Fixed "← Back" button to `/`; hides itself inside iframes and standalone PWA | All standalone pages |
| `/feedback.js` | `<feedback-button>` web component → Google Form | Most apps |
| `/share.js` | Related-projects panel from `apps-registry.json` `related` field | Apps with `related` entries |
| `/proxy.js` | `window.proxyService` — CORS-safe fetch with fallback proxies, caching, circuit breaker | Only when fetching cross-origin resources (ROMs, APIs, etc.) |

**`back.js` tip:** Add `data-back-size="compact"` to the `<script>` tag when the app header is short, to avoid overlap on mobile:
```html
<script src="/back.js" data-back-size="compact"></script>
```

---

## Heyming OS integration

The same `index.html` is loaded inside an `<iframe>` by `os/WindowManager.js`. Shared scripts auto-hide inside iframes (`back.js`, `feedback.js`). Registry fields that matter for OS:

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
- **E2E tests:** `tests/e2e/*.spec.js` under `playwright.config.js`.
  - Prefer adding a spec here over ad-hoc browser sessions.
  - Do **not** use `playwright-cli` for one-off UI checks — read the source instead.

---

## Files touched when adding a new app

| File | Change |
|------|--------|
| `<app>/index.html` | New |
| `<app>/index.css` | New (if non-trivial styles) |
| `<app>/index.js` | New (if non-trivial logic) |
| `<app>/<app>-preview.png` | New — generated by `generate-previews.js` |
| `apps-registry.json` | Add one registry entry |
| `generate-previews.js` | Add one entry to `PAGES` |
| `sitemap.xml` | Add one `<url>` entry (canonical trailing-slash URL) |
| `manifest.json` | Auto-updated by `npm run sync:manifest` (only if `pwaShortcut` added) |
