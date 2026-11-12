// The shared-chrome tag (/site.js) every page loads, and the rewrite that
// replaces a page's separate nav/feedback/share/achievements tags with it.
// Used by scripts/sync-site-boot.mjs, the emulator lander template, and the
// alignment test.

export const SHARED_SCRIPTS = ['nav', 'feedback', 'share', 'achievements'];

const SHARED_TAG =
  /^([ \t]*)<script\b[^>]*\bsrc="\/(nav|feedback|share|achievements)\.js"[^>]*><\/script>[ \t]*\n?/gm;

/**
 * @param {{ navSize?: string | null, shareFab?: string | null, skip?: string[] }} opts
 * @returns {string}
 */
export function siteBootTag(opts = {}) {
  let attrs = '';
  if (opts.navSize) attrs += ` data-nav-size="${opts.navSize}"`;
  if (opts.shareFab) attrs += ` data-share-fab="${opts.shareFab}"`;
  const skip = SHARED_SCRIPTS.filter((name) => opts.skip && opts.skip.includes(name));
  if (skip.length) attrs += ` data-skip="${skip.join(' ')}"`;
  return `<script src="/site.js"${attrs}></script>`;
}

/**
 * Whether a page loads one of the shared scripts, through /site.js or its own tag.
 * @param {string} html
 * @param {string} name one of SHARED_SCRIPTS
 * @returns {boolean}
 */
export function pageLoadsShared(html, name) {
  if (new RegExp(`<script\\b[^>]*\\bsrc=["']/${name}\\.js["']`).test(html)) return true;
  const site = html.match(/<script\b[^>]*\bsrc=["']\/site\.js["'][^>]*>/);
  if (!site) return false;
  const skip = site[0].match(/\bdata-skip="([^"]*)"/);
  return !(skip && skip[1].split(/\s+/).includes(name));
}

/**
 * Replace a page's separate shared-script tags with one /site.js tag at the
 * position of the first. Pages with none of them are returned unchanged.
 * @param {string} html
 * @returns {{ html: string, changed: boolean }}
 */
export function rewriteSiteBoot(html) {
  /** @type {{ index: number, length: number, indent: string, name: string, tag: string }[]} */
  const found = [];
  for (const m of html.matchAll(SHARED_TAG)) {
    found.push({
      index: m.index ?? 0,
      length: m[0].length,
      indent: m[1],
      name: m[2],
      tag: m[0]
    });
  }
  if (!found.length) return { html, changed: false };

  const present = new Set(found.map((f) => f.name));
  const attr = (/** @type {string} */ name, /** @type {string} */ key) => {
    const hit = found.find((f) => f.name === name);
    const m = hit && hit.tag.match(new RegExp(`\\b${key}="([^"]*)"`));
    return m ? m[1] : null;
  };
  const tag = siteBootTag({
    navSize: attr('nav', 'data-nav-size'),
    shareFab: attr('share', 'data-share-fab'),
    skip: SHARED_SCRIPTS.filter((name) => !present.has(name))
  });

  let out = '';
  let cursor = 0;
  found.forEach((f, i) => {
    out += html.slice(cursor, f.index);
    if (i === 0) out += `${f.indent}${tag}\n`;
    cursor = f.index + f.length;
  });
  out += html.slice(cursor);
  return { html: out, changed: out !== html };
}
