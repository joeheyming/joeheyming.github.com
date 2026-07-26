// @ts-check
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

/** Yandex/Google-style floor for readable mobile body text. */
const MIN_READABLE_PX = 12;

const sitemap = fs.readFileSync(path.join(__dirname, '../../sitemap.xml'), 'utf8');
const pages = Array.from(sitemap.matchAll(/<loc>https:\/\/joeheyming\.github\.io(\/[^<]*)<\/loc>/g))
  .map((match) => match[1])
  .filter((page) => page.endsWith('/'));

for (const app of pages) {
  test(`${app} — mobile-friendly at 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });

    // Match nav-toggle-overlap: wait for CDN styles + nav.js injection.
    const response = await page.goto(app, { waitUntil: 'load', timeout: 20_000 });
    expect(response?.status(), `${app} should respond with 200 OK`).toBe(200);

    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport, `${app} should use the device-width viewport`).toContain('width=device-width');

    await page.waitForTimeout(600);

    const audit = await page.evaluate((minReadablePx) => {
      const viewportWidth = window.innerWidth;
      const overflowingElements = Array.from(document.querySelectorAll('body *'))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${
              element.classList.length ? `.${Array.from(element.classList).join('.')}` : ''
            }`,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width)
          };
        })
        .filter(({ left, right, width }) => width > 0 && (left < -1 || right > viewportWidth + 1))
        .slice(0, 8);

      // Yandex/Google mobile-friendly checks care about readable *content*,
      // not every 10px toolbar label. Flag substantial visible copy only.
      const tinyText = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (text.length < 12) continue;

        const element = node.parentElement;
        if (!element) continue;
        if (
          element.closest(
            '[aria-hidden="true"], [hidden], script, style, noscript, pre, code, kbd, samp, svg, canvas, button, select, option, label, .heyming-nav-drawer, #heyming-nav-drawer, #hamburger-panel'
          )
        ) {
          continue;
        }

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          continue;
        }
        // Micro UI chrome (uppercase badges / captions) is not body copy.
        if (style.textTransform === 'uppercase' && text.length < 28) continue;

        const rect = element.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > viewportWidth) {
          continue;
        }

        const fontSize = parseFloat(style.fontSize);
        if (!Number.isFinite(fontSize) || fontSize >= minReadablePx) continue;

        const tag = element.tagName.toLowerCase();
        const isContentTag = /^(p|h[1-6]|li|td|th|blockquote|a|span|div|em|strong|small|figcaption)$/.test(
          tag
        );
        if (!isContentTag) continue;

        tinyText.push({
          element: `${tag}${element.id ? `#${element.id}` : ''}${
            element.classList.length ? `.${Array.from(element.classList).slice(0, 3).join('.')}` : ''
          }`,
          fontSize: Math.round(fontSize * 10) / 10,
          text: text.slice(0, 40)
        });
        if (tinyText.length >= 8) break;
      }

      return {
        viewportWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        overflowingElements,
        tinyText
      };
    }, MIN_READABLE_PX);

    expect(audit.viewportWidth, `${app} should render at the requested mobile width`).toBe(320);
    expect(
      Math.max(audit.documentWidth, audit.bodyWidth),
      `${app} should not require horizontal document scrolling: ${JSON.stringify(
        audit.overflowingElements
      )}`
    ).toBeLessThanOrEqual(audit.viewportWidth + 1);
    expect(
      audit.tinyText,
      `${app} should keep visible text at least ${MIN_READABLE_PX}px: ${JSON.stringify(audit.tinyText)}`
    ).toHaveLength(0);
  });
}
