// @ts-check
const { test, expect } = require('@playwright/test');

// Every page that embeds <share-button> from /share.js. The component lives in
// a shadow root, so page CSS mostly can't reach it — except through inherited
// properties, which do cross the shadow boundary. `-webkit-text-fill-color` is
// one of them: /periodic-speller/ puts the button inside a gradient-text <h1>
// (`-webkit-background-clip: text` + `-webkit-text-fill-color: transparent`),
// which rendered the button as a solid accent-colored box with an invisible
// label. share.js now resets the fill color on :host.
const PAGES = [
  '/2048/',
  '/airwave/',
  '/awesome/',
  '/badapple/',
  '/countdown/',
  '/emulator/',
  '/farm/',
  '/minesweeper/',
  '/pacman/',
  '/pacman-infinite/',
  '/pbs/',
  '/periodic-speller/',
  '/sadtrombone/',
  '/sayhello/',
  '/sayit/',
  '/shadowbox/',
  '/starwars/',
  '/stepmania/',
  '/stock/',
  '/sudoku/',
  '/terminal/',
  '/vibe-coding/',
  '/watch/',
  '/weather/',
  '/youtube/'
];

/** Parses an rgb()/rgba() string and returns its alpha channel. */
function alphaOf(color) {
  const match = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (!match) return 1;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length > 3 ? Number(parts[3]) : 1;
}

for (const path of PAGES) {
  test(`${path} — share button label is visible`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });

    const host = page.locator('share-button').first();
    await expect(host).toBeAttached();

    const style = await host.evaluate((el) => {
      const btn = el.shadowRoot?.querySelector('.share-btn');
      if (!btn) return null;
      const computed = getComputedStyle(btn);
      return {
        fill: computed.webkitTextFillColor,
        color: computed.color,
        background: computed.backgroundColor
      };
    });

    expect(style, 'share-button should have rendered its shadow DOM').not.toBeNull();
    expect(alphaOf(style.fill), `text fill color was ${style.fill}`).toBeGreaterThan(0);
    expect(style.fill, 'label should not match its own background').not.toBe(style.background);
  });
}
