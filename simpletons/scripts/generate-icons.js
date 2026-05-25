#!/usr/bin/env node
/**
 * Generate PWA + Android TV icon assets for Simpleton TV.
 *
 * Renders three PNGs by spinning up a headless Chromium tab and
 * screenshotting an inline HTML template at exactly the size each
 * platform expects:
 *
 *   simpletons/icons/icon-192.png     PWA "any purpose" icon
 *   simpletons/icons/icon-512.png     PWA "any maskable" icon (centered
 *                                     in an 80% safe zone so Android's
 *                                     dynamic mask shapes don't crop the
 *                                     glyph). Same file is also used as
 *                                     the high-res launcher icon for the
 *                                     TWA app.
 *   simpletons/icons/tv-banner.png    320x180 Android TV banner shown in
 *                                     the Leanback launcher row.
 *
 * Run with `node simpletons/scripts/generate-icons.js`.
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const OUT_DIR = path.resolve(__dirname, '..', 'icons');

const SQUARE_TEMPLATE = ({ size, safeAreaPct }) => `<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  .frame {
    width: ${size}px;
    height: ${size}px;
    display: grid;
    place-items: center;
    background: radial-gradient(ellipse at top, #2a2418 0%, #0f0d08 60%, #07060a 100%);
    position: relative;
    overflow: hidden;
    font-family: 'Apple Color Emoji', 'Segoe UI Emoji', system-ui, sans-serif;
  }
  .frame::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 30% 25%, rgba(255, 184, 0, 0.18), transparent 55%),
      radial-gradient(circle at 75% 80%, rgba(255, 76, 76, 0.10), transparent 60%);
    pointer-events: none;
  }
  .glyph {
    font-size: ${Math.round(size * safeAreaPct * 0.92)}px;
    line-height: 1;
    filter: drop-shadow(0 ${Math.round(size * 0.015)}px ${Math.round(
  size * 0.03
)}px rgba(0, 0, 0, 0.6));
    z-index: 1;
  }
</style></head>
<body><div class="frame"><div class="glyph">📺</div></div></body></html>`;

const BANNER_TEMPLATE = () => `<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  .banner {
    width: 320px;
    height: 180px;
    background: linear-gradient(135deg, #1a1612 0%, #0f0d08 70%, #07060a 100%);
    color: #fafafa;
    display: flex;
    align-items: center;
    padding: 0 18px;
    gap: 14px;
    font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Inter', system-ui, sans-serif;
    position: relative;
    overflow: hidden;
  }
  .banner::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 20% 30%, rgba(255, 184, 0, 0.18), transparent 50%),
      radial-gradient(circle at 80% 75%, rgba(255, 76, 76, 0.10), transparent 55%);
    pointer-events: none;
  }
  .glyph {
    font-size: 96px;
    line-height: 1;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.6));
    z-index: 1;
  }
  .text {
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .title {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.5px;
    line-height: 1.05;
    color: #fafafa;
  }
  .subtitle {
    font-size: 11px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #ffb800;
    font-weight: 600;
  }
  .led {
    position: absolute;
    bottom: 12px;
    right: 14px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ffb800;
    box-shadow: 0 0 12px #ffb800;
  }
</style></head>
<body><div class="banner">
  <div class="glyph">📺</div>
  <div class="text">
    <span class="subtitle">Simpleton</span>
    <span class="title">TV</span>
  </div>
  <div class="led"></div>
</div></body></html>`;

async function renderHtml(page, html, viewport) {
  await page.setViewportSize(viewport);
  await page.setContent(html, { waitUntil: 'load' });
  // Give web fonts / emoji a beat to render so the glyph isn't missing.
  await page.waitForTimeout(100);
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });

    // 192 — "any" purpose, glyph nearly fills the canvas.
    await renderHtml(page, SQUARE_TEMPLATE({ size: 192, safeAreaPct: 0.78 }), {
      width: 192,
      height: 192
    });
    await page.screenshot({
      path: path.join(OUT_DIR, 'icon-192.png'),
      omitBackground: false,
      clip: { x: 0, y: 0, width: 192, height: 192 }
    });

    // 512 — used as both PWA icon AND maskable. Maskable specifies an
    // 80% safe zone (so Android's circle/squircle/rounded-square masks
    // don't crop the glyph).
    await renderHtml(page, SQUARE_TEMPLATE({ size: 512, safeAreaPct: 0.66 }), {
      width: 512,
      height: 512
    });
    await page.screenshot({
      path: path.join(OUT_DIR, 'icon-512.png'),
      omitBackground: false,
      clip: { x: 0, y: 0, width: 512, height: 512 }
    });

    // Android TV banner — exact 320x180, lands on the Leanback launcher.
    await renderHtml(page, BANNER_TEMPLATE(), { width: 320, height: 180 });
    await page.screenshot({
      path: path.join(OUT_DIR, 'tv-banner.png'),
      omitBackground: false,
      clip: { x: 0, y: 0, width: 320, height: 180 }
    });

    console.log('Wrote:');
    for (const file of fs.readdirSync(OUT_DIR)) {
      const stat = fs.statSync(path.join(OUT_DIR, file));
      console.log(`  simpletons/icons/${file}  (${stat.size} bytes)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
