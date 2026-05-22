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
  '/nes/',
  '/stepmania/',
  '/stock/',
  '/wordle-finder/',
  '/youtube/',
  '/chat/',
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
];

for (const app of APPS) {
  for (const vp of VIEWPORTS) {
    test(`${app} — no back-button overlap at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(app, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.waitForTimeout(800); // allow back.js to inject

      const btn = page.locator('.back-to-portfolio');
      const btnCount = await btn.count();
      if (btnCount === 0) return;

      const btnBox = await btn.boundingBox();
      if (!btnBox) return;

      const candidates = await page.evaluate(() => {
        const sel =
          'h1, h2, header a, header button, .app-title, [role="banner"] > *, nav > a, nav > button';
        return Array.from(document.querySelectorAll(sel))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              tag: el.tagName,
              text: el.textContent?.trim().slice(0, 40) ?? '',
              top: r.top,
              left: r.left,
              bottom: r.bottom,
              right: r.right,
            };
          })
          .filter((r) => r.bottom > 0 && r.right > 0 && r.top < window.innerHeight);
      });

      const overlaps = candidates.filter(
        (c) =>
          btnBox.x < c.right &&
          btnBox.x + btnBox.width > c.left &&
          btnBox.y < c.bottom &&
          btnBox.y + btnBox.height > c.top &&
          !c.text.includes('Back') &&
          !c.text.includes('←')
      );

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
