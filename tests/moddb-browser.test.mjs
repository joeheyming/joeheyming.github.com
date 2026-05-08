// Unit tests for the HTML parsers in doom/moddb-browser.js.
//
// We can't fetch live moddb pages from a test environment (no network,
// CORS, brittle), so each test feeds a small constructed fixture HTML
// snippet that follows the structure assumed by the SELECTORS table at
// the top of moddb-browser.js. When moddb's DOM drifts and a real
// listing stops parsing, the fix is two-step:
//   1. Update the relevant fixture below to match a captured page.
//   2. Update the selector or parser branch to make the test pass.
//
// The browser script is an IIFE that publishes window.UZDoomModdb. We
// load it once into a shared jsdom and pull parsers off the global.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODDB_JS = readFileSync(join(__dirname, '..', 'doom', 'moddb-browser.js'), 'utf8');

let parsers;
let internal;
before(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://www.moddb.com/mods'
  });
  // The IIFE references DOMParser — exposed by jsdom on the window.
  dom.window.eval(MODDB_JS);
  const ns = dom.window.UZDoomModdb;
  assert.ok(ns, 'moddb-browser.js did not publish window.UZDoomModdb');
  parsers = ns.parsers;
  internal = ns._internal;
});

// ---- Fixtures ----------------------------------------------------------

const LISTING_HTML = `
<!doctype html><html><body>
  <div class="rowcontent">
    <a class="image" href="/mods/brutal-doom"><img src="/cache/images/mods/1/12/11000/thumb_620x2000/1.png"></a>
    <a href="/games/doom" title="Doom"><img src="/icon.gif"></a>
    <h4><a href="/mods/brutal-doom">Brutal Doom</a></h4>
    <p class="summary">A gore-soaked overhaul of classic Doom with new weapons, enemies, and effects.</p>
  </div>
  <div class="rowcontent">
    <a class="image" href="/mods/project-brutality"><img src="/p.png"></a>
    <a href="/games/doom-ii" title="Doom II"><img src="/icon.gif"></a>
    <h4><a href="/mods/project-brutality">Project Brutality</a></h4>
    <p class="summary">Standalone fork of Brutal Doom with deeper customization.</p>
  </div>
  <div class="rowcontent">
    <a class="image" href="/mods/brutal-doom"><img src="/dup.png"></a>
    <h4><a href="/mods/brutal-doom">Brutal Doom (duplicate row should dedupe)</a></h4>
    <p class="summary">dup</p>
  </div>
  <div class="pagination">
    <a href="?game=26&page=1" class="current">1</a>
    <a href="?game=26&page=2">2</a>
    <a href="?game=26&page=3">3</a>
    <a href="?game=26&page=10">10</a>
  </div>
</body></html>
`;

const MOD_PAGE_HTML = `
<!doctype html><html><body>
  <h1>Brutal Doom</h1>
  <div id="profiledescription">
    Brutal Doom is a gameplay overhaul for the Doom franchise that introduces
    new weapons, gore effects, and a punchier combat feel. Requires doom2.wad.
  </div>
  <div class="imagebox"><img src="/screens/1.jpg"></div>
  <div class="row"><img src="/screens/2.jpg"></div>
  <a href="/mods/brutal-doom/downloads">All downloads</a>
  <a href="/mods/some-other/downloads">Other downloads (should be ignored)</a>
</body></html>
`;

const DOWNLOADS_LIST_HTML = `
<!doctype html><html><body>
  <div class="rowcontent">
    <a href="/downloads/brutal-doom-v22-full">Brutal Doom v22 Full Version (zip, 280 MB)</a>
    <span>Full Version</span>
  </div>
  <div class="rowcontent">
    <a href="/downloads/brutal-doom-v22-patch">Brutal Doom v22 Patch (zip)</a>
    <span>Patch</span>
  </div>
  <div class="rowcontent">
    <a href="/downloads/brutal-doom-v21-full">Brutal Doom v21 Full Version (zip)</a>
    <span>Full Version</span>
  </div>
  <div class="rowcontent">
    <a href="/downloads/brutal-doom-demo">Brutal Doom Demo</a>
    <span>Demo</span>
  </div>
  <div class="rowcontent">
    <a href="/mods/brutal-doom/downloads">Back to mod (should be ignored)</a>
  </div>
</body></html>
`;

const DOWNLOAD_PAGE_HTML = `
<!doctype html><html><body>
  <a class="mirror" href="/start/usa-1?file=brutal-doom-v22.zip">USA Mirror 1</a>
  <a class="mirror" href="/start/eu-1?file=brutal-doom-v22.zip">EU Mirror</a>
  <a class="mirror" href="/start/usa-1?file=brutal-doom-v22.zip">USA Mirror 1 (dup)</a>
  <div class="filename">brutal-doom-v22.zip</div>
  <div class="size">280.4 MB</div>
</body></html>
`;

const CLOUDFLARE_HTML = `
<!doctype html><html><head><title>Just a moment...</title></head><body>
  <div>Checking your browser before accessing moddb.com.</div>
  <div id="cf-browser-verification"></div>
</body></html>
`;

// ---- parseListing ------------------------------------------------------

describe('parseListing', () => {
  it('extracts mod cards with title, slug, url, thumb, summary, gameSlug', () => {
    const result = parsers.parseListing(LISTING_HTML, 'https://www.moddb.com/mods');
    assert.equal(result.mods.length, 2, 'expected 2 unique mods (dedup)');
    const m = result.mods[0];
    assert.equal(m.slug, 'brutal-doom');
    assert.equal(m.title, 'Brutal Doom');
    assert.equal(m.url, 'https://www.moddb.com/mods/brutal-doom');
    assert.match(m.thumbUrl, /^https:\/\/www\.moddb\.com\//);
    assert.match(m.summary, /gore-soaked overhaul/);
    assert.equal(m.gameSlug, 'doom');
    assert.equal(m.gameTitle, 'Doom');
    assert.equal(result.mods[1].gameSlug, 'doom-ii');
  });

  it('extracts gameSlug from real captured global keyword-search HTML', () => {
    // Regression for the user-reported bug: searching "legend of doom"
    // returned no results in our app despite the mod existing on moddb.
    // Root cause: moddb's kw= search ignores game= and returns matches
    // across all games. We need to filter client-side using each row's
    // gameSlug. This fixture is real HTML captured from
    //   https://www.moddb.com/mods?game=26&kw=legend+of+doom
    // via api.allorigins.win — every card is from a non-Doom game
    // (Half-Life, Rome: Total War, Star Wars, etc.).
    const html = readFileSync(
      join(__dirname, 'fixtures', 'moddb-global-kw-legend-of-doom.html'),
      'utf8'
    );
    const r = parsers.parseListing(html, 'https://www.moddb.com/mods');
    assert.ok(r.mods.length >= 5, `expected several rows, got ${r.mods.length}`);

    // Every parsed mod has SOME gameSlug — moddb always renders one.
    for (const m of r.mods) {
      assert.ok(m.gameSlug, `mod ${m.slug} missing gameSlug`);
    }

    // None of these are Doom mods, so client-side filtering against
    // ALLOWED_GAME_SLUGS would correctly leave the result empty.
    const doomish = r.mods.filter((m) => m.gameSlug === 'doom' || m.gameSlug === 'doom-ii');
    assert.equal(doomish.length, 0, 'global kw= results should not be classified as Doom games');

    // Spot-check: at least one of the well-known game slugs is present.
    const slugs = new Set(r.mods.map((m) => m.gameSlug));
    assert.ok(
      slugs.has('half-life') || slugs.has('rome-total-war'),
      `expected a non-Doom game in the captured fixture; got ${[...slugs].join(', ')}`
    );
  });

  it('skips /games/ nav links (add, latest, top, etc.)', () => {
    // Real moddb pages link to /games/add, /games/latest, /games/top in
    // the header; those are global moddb pages, not actual games.
    const html = `
      <!doctype html><html><body>
        <div class="rowcontent">
          <a class="image" href="/mods/some-mod"><img src="/x.png"></a>
          <a href="/games/add">Add a game</a>
          <a href="/games/latest">Latest</a>
          <a href="/games/doom" title="Doom"><img src="/i.gif"></a>
          <h4><a href="/mods/some-mod">Some Mod</a></h4>
          <p class="summary">x</p>
        </div>
      </body></html>
    `;
    const r = parsers.parseListing(html, 'https://www.moddb.com/mods');
    assert.equal(r.mods.length, 1);
    assert.equal(r.mods[0].gameSlug, 'doom', 'must skip nav and pick the real game link');
  });

  it('dedupes by slug', () => {
    const r = parsers.parseListing(LISTING_HTML, 'https://www.moddb.com/mods');
    const slugs = r.mods.map((m) => m.slug);
    const unique = new Set(slugs);
    assert.equal(slugs.length, unique.size);
  });

  it('parses pagination current and last page', () => {
    const r = parsers.parseListing(LISTING_HTML, 'https://www.moddb.com/mods');
    assert.equal(r.pagination.current, 1);
    assert.equal(r.pagination.last, 10);
  });

  it('returns empty mods array on empty body', () => {
    const r = parsers.parseListing(
      '<!doctype html><html><body></body></html>',
      'https://www.moddb.com/mods'
    );
    assert.equal(r.mods.length, 0);
  });
});

// ---- parseModPage ------------------------------------------------------

describe('parseModPage', () => {
  it('extracts title, summary, screenshots, downloads url', () => {
    const r = parsers.parseModPage(MOD_PAGE_HTML, 'https://www.moddb.com/mods/brutal-doom');
    assert.equal(r.title, 'Brutal Doom');
    assert.match(r.summary, /Brutal Doom is a gameplay overhaul/);
    assert.ok(r.screenshots.length >= 2);
    assert.match(r.screenshots[0], /^https:\/\//);
    assert.equal(
      r.downloadsUrl,
      'https://www.moddb.com/mods/brutal-doom/downloads',
      'downloads url should resolve to the same mod, not another mod'
    );
  });

  it('falls back to deriving downloads url from the mod url', () => {
    const html = `<!doctype html><html><body>
      <h1>Foo Mod</h1><div id="profiledescription">x</div>
    </body></html>`;
    const r = parsers.parseModPage(html, 'https://www.moddb.com/mods/foo-mod');
    assert.equal(r.downloadsUrl, 'https://www.moddb.com/mods/foo-mod/downloads');
  });
});

// ---- parseDownloadsList ------------------------------------------------

describe('parseDownloadsList + pickBestDownload', () => {
  it('parses entries and tags isFull / isPatch / isDemo', () => {
    const list = parsers.parseDownloadsList(
      DOWNLOADS_LIST_HTML,
      'https://www.moddb.com/mods/brutal-doom/downloads'
    );
    assert.ok(list.length >= 4);
    const v22 = list.find((d) => /v22 Full/.test(d.title));
    assert.ok(v22);
    assert.equal(v22.isFull, true);
    assert.equal(v22.isPatch, false);
    assert.equal(v22.version, '22');
    assert.equal(v22.ext, 'zip');

    const patch = list.find((d) => /Patch/.test(d.title));
    assert.ok(patch);
    assert.equal(patch.isPatch, true);

    const demo = list.find((d) => /Demo/.test(d.title));
    assert.ok(demo);
    assert.equal(demo.isDemo, true);

    // The "back to mod" link must be filtered out.
    assert.equal(
      list.find((d) => /\/mods\/.+\/downloads$/.test(d.url)),
      undefined
    );
  });

  it('picks newest full release, .zip preferred over patches and demos', () => {
    const list = parsers.parseDownloadsList(
      DOWNLOADS_LIST_HTML,
      'https://www.moddb.com/mods/brutal-doom/downloads'
    );
    const best = parsers.pickBestDownload(list);
    assert.ok(best);
    assert.match(best.title, /v22/);
    assert.equal(best.isFull, true);
    assert.equal(best.isPatch, false);
  });

  it('returns null on empty list', () => {
    assert.equal(parsers.pickBestDownload([]), null);
    assert.equal(parsers.pickBestDownload(null), null);
  });

  it('drops sidebar nav links like /downloads/top', () => {
    // Regression: real moddb downloads pages contain a "popular this
    // week" sidebar with links to /downloads/top, /downloads/popular,
    // etc. Those slugs are global moddb indexes, not mod releases. v1
    // ranked /downloads/top above the actual brutal-doom releases and
    // tried to "play" the moddb top-downloads page.
    const html = `
      <!doctype html><html><body>
        <aside>
          <a href="/downloads/top">Top</a>
          <a href="/downloads/popular">Popular this week</a>
          <a href="/downloads/new">New</a>
        </aside>
        <table><tbody>
          <tr>
            <td><a href="/downloads/brutal-doom-v22-full-version">
              <img alt="Brutal Doom v22 Full Version" src="/x.png">
            </a></td>
            <td>Full Version</td>
          </tr>
        </tbody></table>
      </body></html>
    `;
    const list = parsers.parseDownloadsList(
      html,
      'https://www.moddb.com/mods/brutal-doom/downloads'
    );
    assert.equal(list.length, 1, 'sidebar nav links must be filtered out');
    assert.match(list[0].url, /brutal-doom-v22-full-version/);
    // Title fallback: link text was empty but the nested <img alt="..."> wins.
    assert.match(list[0].title, /Brutal Doom v22/);
  });

  it('drops cross-mod sidebar links (different mod slug)', () => {
    // moddb pages for mod A often link to "popular this week" downloads
    // belonging to mods B/C/D. These would otherwise pollute ranking.
    const html = `
      <!doctype html><html><body>
        <a href="/downloads/some-other-mod-v1">Other mod release</a>
        <a href="/downloads/yet-another-mod">Yet another</a>
        <a href="/downloads/brutal-doom-v22-full">Brutal Doom v22</a>
      </body></html>
    `;
    const list = parsers.parseDownloadsList(
      html,
      'https://www.moddb.com/mods/brutal-doom/downloads'
    );
    assert.equal(list.length, 1, 'only links containing mod slug should pass');
    assert.equal(list[0].slug, 'brutal-doom-v22-full');
  });

  it('still works without baseUrl (no slug filter)', () => {
    // When called without a baseUrl (e.g. from a test harness or future
    // call site), the slug-match filter should be a no-op.
    const html = `
      <!doctype html><html><body>
        <a href="/downloads/some-mod-v1">Some Mod</a>
      </body></html>
    `;
    const list = parsers.parseDownloadsList(html, '');
    assert.equal(list.length, 1);
  });

  it('parses real captured moddb /mods/<slug>/downloads page', () => {
    // Regression for the v1 bug where parseDownloadsList silently dropped
    // every real release because its slug regex only matched the legacy
    // /downloads/<slug> form. Real moddb pages use
    // /mods/<mod-slug>/downloads/<release-slug>, captured via
    // api.allorigins.win/raw?url= against
    // https://www.moddb.com/mods/brutal-doom/downloads.
    //
    // The fixture also contains:
    //   - global nav links (/downloads/top, /downloads/popular) — must drop
    //   - a cross-mod link (/mods/some-other-mod/downloads/...) — must drop
    const html = readFileSync(
      join(__dirname, 'fixtures', 'moddb-brutal-doom-downloads.html'),
      'utf8'
    );
    const list = parsers.parseDownloadsList(
      html,
      'https://www.moddb.com/mods/brutal-doom/downloads'
    );
    assert.ok(list.length >= 4, `expected >= 4 releases, got ${list.length}`);

    // Every entry must belong to brutal-doom.
    for (const d of list) {
      assert.match(
        d.url,
        /\/mods\/brutal-doom\/downloads\//,
        `cross-mod or nav link leaked through: ${d.url}`
      );
    }

    // The "Brutal Doom v22 Beta Test 6" release uses the real moddb
    // pattern of an <a class="image" title="..."> wrapping a thumbnail.
    // Title MUST come from the title attribute, not the empty link text.
    const v22 = list.find((d) => d.slug === 'brutal-doom-v22-beta-test');
    assert.ok(v22, 'expected to find brutal-doom-v22-beta-test');
    assert.match(v22.title, /Brutal Doom v22/i);
    assert.equal(v22.isDemo, true, 'subheading "Demo" must classify as demo');

    // No nav-blacklist or cross-mod links survived.
    assert.equal(
      list.find((d) => /\/downloads\/(top|popular)$/.test(d.url)),
      undefined
    );
    assert.equal(
      list.find((d) => /\/mods\/some-other-mod\//.test(d.url)),
      undefined
    );
  });

  it('handles markup with <table>/<tr> rows (no .rowcontent)', () => {
    // Regression: real moddb pages wrap downloads in tables that don't
    // match the .rowcontent selector. The flat-scan strategy must still
    // find the entries via document-wide a[href*="/downloads/"] queries.
    const html = `
      <!doctype html><html><body>
        <table><tbody>
          <tr>
            <td><a href="/downloads/some-mod-v3-full">Some Mod v3 Full Version (zip, 12 MB)</a></td>
            <td>Full Version</td>
          </tr>
          <tr>
            <td><a href="/downloads/some-mod-v3-patch">Some Mod v3 Patch (zip)</a></td>
            <td>Patch</td>
          </tr>
        </tbody></table>
        <a href="/mods/some-mod/downloads">Back to mod (must NOT appear)</a>
        <a href="/downloads/" title="all downloads (no slug, must NOT appear)">All</a>
      </body></html>
    `;
    const list = parsers.parseDownloadsList(html, 'https://www.moddb.com/mods/some-mod/downloads');
    const titles = list.map((d) => d.title);
    assert.ok(
      titles.some((t) => /v3 Full/.test(t)),
      'should find full release'
    );
    assert.ok(
      titles.some((t) => /v3 Patch/.test(t)),
      'should find patch'
    );
    assert.ok(!titles.some((t) => /Back to mod/.test(t)), 'must filter out the mod-tab back-link');
    assert.ok(!titles.some((t) => t === 'All'), 'must filter out slug-less /downloads/');

    const best = parsers.pickBestDownload(list);
    assert.match(best.title, /Full/);
  });
});

// ---- parseDownloadPage -------------------------------------------------

describe('parseDownloadPage', () => {
  it('extracts unique mirror URLs in document order', () => {
    const r = parsers.parseDownloadPage(
      DOWNLOAD_PAGE_HTML,
      'https://www.moddb.com/downloads/brutal-doom-v22-full'
    );
    assert.equal(r.mirrors.length, 2, 'duplicate USA Mirror 1 should dedupe');
    assert.match(r.mirrors[0].url, /usa-1/);
    assert.match(r.mirrors[1].url, /eu-1/);
    assert.equal(r.filename, 'brutal-doom-v22.zip');
    assert.ok(r.sizeBytes && r.sizeBytes > 200 * 1024 * 1024);
  });

  it('returns empty mirrors when page has none', () => {
    const r = parsers.parseDownloadPage(
      '<!doctype html><html><body>no mirrors here</body></html>',
      'https://www.moddb.com/downloads/x'
    );
    assert.equal(r.mirrors.length, 0);
  });
});

// ---- isCloudflareBlocked -----------------------------------------------

describe('isCloudflareBlocked', () => {
  it('detects the Cloudflare interstitial', () => {
    assert.equal(parsers.isCloudflareBlocked(CLOUDFLARE_HTML), true);
  });
  it('does not false-positive on normal HTML', () => {
    assert.equal(parsers.isCloudflareBlocked(LISTING_HTML), false);
    assert.equal(parsers.isCloudflareBlocked(''), false);
    assert.equal(parsers.isCloudflareBlocked(null), false);
  });
});

// ---- buildListingUrl + helpers ----------------------------------------

describe('internal helpers', () => {
  it('buildListingUrl defaults to game=26 with filter=t when no kw', () => {
    const url = internal.buildListingUrl({});
    assert.match(url, /game=26/);
    assert.match(url, /filter=t/, 'moddb canonical filter form requires filter=t');
  });

  it('buildListingUrl honors gameId override (multi-game fan-out)', () => {
    const url = internal.buildListingUrl({ gameId: 172 });
    assert.match(url, /game=172/);
    assert.ok(!/game=26/.test(url));
  });

  it('buildListingUrl drops game= when kw is set (moddb makes kw global)', () => {
    // Regression: when the user types into the search box, moddb's kw=
    // search ignores game= and returns results across all games. The
    // page even retitles to "Mods for Games". Sending game= alongside
    // kw= still works but is misleading; we strip it and rely on
    // client-side filtering via parseListing's gameSlug.
    const url = internal.buildListingUrl({ kw: 'legend of doom' });
    assert.match(url, /kw=legend\+of\+doom/);
    assert.ok(!/game=/.test(url), 'game= should be omitted on kw= queries');
    assert.ok(!/filter=t/.test(url), 'filter=t is not used on global kw= search');
  });

  it('buildListingUrl includes optional pagination/sort params', () => {
    const url = internal.buildListingUrl({
      page: 3,
      sort: 'visitstotal-desc'
    });
    assert.match(url, /page=3/);
    assert.match(url, /sort=visitstotal-desc/);
  });

  it('exposes MODDB_GAMES with Doom AND Doom II', () => {
    // Regression: v1 only included game id 26 (Doom 1993). Mods like
    // "Legend of Doom" are catalogued under Doom II (id 172) on moddb;
    // a single-game scope silently dropped them from the browser.
    const slugs = internal.MODDB_GAMES.map((g) => g.slug);
    assert.ok(slugs.includes('doom'), 'must include Doom (game id 26)');
    assert.ok(slugs.includes('doom-ii'), 'must include Doom II (game id 172)');
    assert.ok(internal.ALLOWED_GAME_SLUGS.has('doom'));
    assert.ok(internal.ALLOWED_GAME_SLUGS.has('doom-ii'));
  });

  it('parseSizeText handles MB/GB/KB', () => {
    assert.equal(internal.parseSizeText('12 MB'), 12 * 1024 * 1024);
    assert.equal(internal.parseSizeText('1.5 GB'), Math.round(1.5 * 1024 * 1024 * 1024));
    assert.equal(internal.parseSizeText('500 KB'), 500 * 1024);
    assert.equal(internal.parseSizeText('garbage'), null);
  });

  it('parseVersion sorts higher versions higher', () => {
    assert.ok(internal.parseVersion('22.0') > internal.parseVersion('21.5'));
    assert.ok(internal.parseVersion('1.0.1') > internal.parseVersion('1.0.0'));
    assert.equal(internal.parseVersion(null), 0);
  });

  it('extractModSlug pulls the slug out of any moddb URL', () => {
    assert.equal(internal.extractModSlug('https://www.moddb.com/mods/brutal-doom'), 'brutal-doom');
    assert.equal(internal.extractModSlug('/mods/foo-bar/downloads'), 'foo-bar');
    assert.equal(internal.extractModSlug('https://example.com/other'), null);
  });

  it('absolutize resolves relative against base', () => {
    assert.equal(
      internal.absolutize('/mods/x', 'https://www.moddb.com/mods'),
      'https://www.moddb.com/mods/x'
    );
    assert.equal(
      internal.absolutize('https://other.com/y', 'https://www.moddb.com/mods'),
      'https://other.com/y'
    );
  });
});
