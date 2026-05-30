// @ts-check
const { test, expect } = require('@playwright/test');

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'mobile-portrait', width: 390, height: 844 },
  { name: 'mobile-landscape', width: 844, height: 390 },
];

const APPS = [
  '/',
  '/calculator/',
  '/clock/',
  '/countdown/',
  '/ascii/',
  '/starwars/',
  '/notepad/',
  '/todo/',
  '/paint/',
  '/terminal/',
  '/doom/',
  '/emulator/',
  '/stepmania/',
  '/stock/',
  '/wordle-finder/',
  '/youtube/',
  '/chat/',
  '/imagine/',
  '/listen/',
  '/read/',
  '/badapple/',
  '/sayhello/',
  '/sayit/',
  '/model-viewer/',
  '/periodic-speller/',
  '/pbs/',
  '/sadtrombone/',
  '/shadowbox/',
  '/farm/',
  '/awesome/',
  '/accordion-hero/',
  '/play/',
  '/play/piano/',
  '/play/drums/',
  '/play/synth/',
  '/play/metronome/',
  '/play/theremin/',
  '/play/tuner/',
  '/media-player/',
  '/image-viewer/',
];

for (const app of APPS) {
  for (const vp of VIEWPORTS) {
    test(`${app} — no back-button overlap at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Use 'load' so CDN stylesheets (Tailwind, etc.) are applied before we measure layout
      await page.goto(app, { waitUntil: 'load', timeout: 20_000 });
      await page.waitForTimeout(600); // allow back.js to inject

      const btn = page.locator('.back-to-portfolio');
      const btnCount = await btn.count();
      if (btnCount === 0) return;

      const btnBox = await btn.boundingBox();
      if (!btnBox) return;

      const candidates = await page.evaluate((viewportWidth) => {
        const sel = [
          'h1', 'h2',
          'header a', 'header button',
          '.app-title',
          '[role="banner"] > *',
          'nav > a', 'nav > button',
          // toolbar/app-bar interactive elements near the top of the page
          '[role="toolbar"] button', '[role="toolbar"] a',
          '#toolbar button', '#toolbar a',
          '.toolbar button', '.toolbar a',
          '.app-header button', '.app-header a',
        ].join(', ');
        return Array.from(document.querySelectorAll(sel))
          .map((el) => {
            const r = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return {
              tag: el.tagName,
              text: el.textContent?.trim().slice(0, 40) ?? '',
              top: r.top,
              left: r.left,
              bottom: r.bottom,
              right: r.right,
              // detect full-width elements whose content may be centered/right-aligned
              textAlign: style.textAlign,
              isFullWidth: r.right - r.left > viewportWidth * 0.75,
            };
          })
          .filter((r) => r.bottom > 0 && r.right > 0 && r.top < window.innerHeight);
      }, vp.width);

      const overlaps = candidates.filter((c) => {
        // Bounding boxes must intersect
        if (
          !(btnBox.x < c.right &&
            btnBox.x + btnBox.width > c.left &&
            btnBox.y < c.bottom &&
            btnBox.y + btnBox.height > c.top)
        ) return false;
        // Skip the back button's own text
        if (c.text.includes('Back') || c.text.includes('←')) return false;
        // Full-width block elements with centered/right text are false-positives:
        // the back button visually covers empty space, not the actual text.
        if (c.isFullWidth && (c.textAlign === 'center' || c.textAlign === 'right')) return false;
        return true;
      });

      if (overlaps.length > 0) {
        await page.screenshot({
          path: `tests/e2e/screenshots/overlap-${app.replace(/\//g, '_')}-${vp.name}.png`,
        });
      }

      expect(
        overlaps,
        `Back button overlaps at ${app} [${vp.name}]: ${JSON.stringify(overlaps)}`
      ).toHaveLength(0);
    });
  }
}
