/**
 * E-Chords song-page adapter.
 *
 * Why this exists: the Strings page wants to seed the Strum Bar with
 * the chords from a real song, but every popular chord-tab site
 * (Ultimate Guitar, Cifra Club, e-chords) sits behind Cloudflare and
 * rejects direct cross-origin requests from a static GitHub Pages
 * site. We can still get the song page through a public CORS proxy
 * (see proxy.js) — e-chords in particular happens to ship a parseable
 * HTML body even via the proxy, with chord tokens marked up as
 *
 *     <span data-chord="Am">Am</span>
 *
 * inline with the lyric text. That's the cleanest "scrape format"
 * across the candidate sites we surveyed, so this module is e-chords
 * specific by design — adding cifraclub later is a sibling adapter,
 * not a generalisation here.
 *
 * Inputs:  an e-chords song URL (the kind the player gets by clicking
 *          a song from a Google search — e.g.
 *          https://www.e-chords.com/chords/the-animals/the-house-of-the-rising-sun)
 * Outputs: { title, artist, capo, tuning, chordsUsed, chordSequence,
 *            sections, barEntries }
 *          where `barEntries` is a pre-cooked list of
 *          `{ rootPc, qualityId, name }` ready to feed into the page's
 *          existing `pinChordToBar` helper.
 *
 * The parser leans on browser DOMParser so we never have to deal with
 * regex-vs-malformed-HTML edge cases (e.g. the `<TAB>` block, which
 * isn't a real HTML element but the browser tolerates anyway).
 *
 * No legal claim on the content: this module just reformats a page
 * the user's browser is already fetching, the same way Reader Mode
 * does. We don't store or republish.
 */
import { parseChordName } from './chords.js';

const ECHORDS_HOSTS = ['e-chords.com', 'www.e-chords.com'];

/**
 * @typedef {object} EchordsSection
 * @property {string} name        e.g. "Intro", "Verse 1", or "" for unlabelled.
 * @property {string[]} chords    Raw chord names in the order they appear.
 * @property {string} text        Lyric text with chord tokens stripped.
 *
 * @typedef {object} EchordsBarEntry
 * @property {number} rootPc      0..11
 * @property {string} qualityId   matches QUALITIES[].id in chords.js
 * @property {string} name        formatted chord name (Em, Cmaj7…)
 * @property {string} original    the raw token from the page
 *
 * @typedef {object} EchordsSong
 * @property {string} url
 * @property {string} title
 * @property {string} artist
 * @property {string} capo            e.g. "Capo on 2nd fret" or ""
 * @property {string} tuning          e.g. "Standard" or ""
 * @property {string[]} chordsUsed    de-duped set, in palette order
 * @property {string[]} chordSequence in song order, with repeats
 * @property {EchordsSection[]} sections
 * @property {EchordsBarEntry[]} barEntries  ready for pinChordToBar
 * @property {string[]} skipped       raw chord tokens we couldn't parse
 */

/**
 * Quick host check so we can reject a wrong-site paste with a clear
 * error instead of a confusing parse failure 5 seconds later.
 */
export function isEchordsUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url.trim());
    return ECHORDS_HOSTS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Strip the decorations that `parseChordName` doesn't understand so a
 * real-world chord token like `D/F#`, `Cadd9`, `A7sus4`, `Cmaj9` still
 * lands on a playable triad/seventh. Anything we can't simplify is
 * returned as-is and the caller decides whether to drop it.
 *
 * The substitutions here intentionally mirror what most teachers
 * recommend for beginners — "play the bass-less version", "drop the
 * extension", "treat 9 as 7" — so the resulting Strum Bar palette
 * stays useful even when the source sheet is fancy.
 */
export function simplifyChordName(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';
  // Drop slash-bass (D/F# → D). The strum bar doesn't model bass
  // notes anyway, so this is lossless for our purposes.
  s = s.split('/')[0].trim();
  // Strip parenthetical decorations: C(add9) → C, A7(b9) → A7.
  s = s.replace(/\([^)]*\)/g, '');
  // Strip explicit "addN" tones: Cadd9 → C, Cmadd9 → Cm.
  s = s.replace(/add\s*\d+/gi, '');
  // Power chord (root + fifth, no third) — fold to plain major triad
  // since the chord library doesn't have a "5" quality and a major
  // shape is the most common stand-in.
  s = s.replace(/^([A-Ga-g][#b]?)5\b/, '$1');
  // 7sus4 / 7sus2 → sus4 / sus2 (drop the 7, keep the suspension).
  s = s.replace(/7sus(2|4)\b/i, 'sus$1');
  // Map extended dominants down to base 7: C9/C11/C13 → C7.
  s = s.replace(/^([A-Ga-g][#b]?)(?:9|11|13)\b/, '$17');
  // Map minor extensions: Cm9/Cm11/Cm13 → Cm7.
  s = s.replace(/^([A-Ga-g][#b]?(?:m|min))(?:9|11|13)\b/, '$17');
  // Map major extensions: Cmaj9/CM9/Cmaj13 → Cmaj7.
  s = s.replace(/^([A-Ga-g][#b]?(?:maj|Maj|M))(?:9|11|13)\b/, '$17');
  return s.trim();
}

/**
 * Convert a raw list of chord-name strings (from the page) into the
 * structured entries the Strum Bar consumes. De-duped so a song that
 * cycles Am-C-D-F-Am-C-D-F doesn't pin Am four times.
 */
export function chordsToBarEntries(rawNames) {
  const seen = new Set();
  /** @type {EchordsBarEntry[]} */
  const out = [];
  /** @type {string[]} */
  const skipped = [];
  for (const raw of rawNames) {
    const simplified = simplifyChordName(raw);
    const parsed = simplified ? parseChordName(simplified) : null;
    if (!parsed) {
      skipped.push(raw);
      continue;
    }
    const key = `${parsed.rootPc}|${parsed.qualityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      rootPc: parsed.rootPc,
      qualityId: parsed.qualityId,
      name: simplified,
      original: raw
    });
  }
  return { entries: out, skipped };
}

/**
 * Walk the song <pre> block and split it into sections. e-chords
 * marks a section header with `<i>Verse 1:</i>` (italic, ends with
 * `:`); the lyric line that follows belongs to that section until
 * the next `<i>` marker or end of <pre>. Pages with no `<i>` markers
 * collapse into a single anonymous section.
 *
 * `<TAB>...</TAB>` blocks are treated as opaque "tab noise" and
 * dropped from both the chord and lyric tracks — they're a separate
 * notation system the strum bar doesn't represent.
 */
function walkSongPre(preEl) {
  /** @type {EchordsSection[]} */
  const sections = [];
  let current = { name: '', chords: [], text: '' };
  sections.push(current);

  /** @param {Node} node */
  const visit = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      current.text += node.nodeValue || '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = /** @type {Element} */ (node);
    const tag = el.tagName.toLowerCase();

    if (tag === 'i') {
      // New section header. Trim trailing `:` and whitespace.
      const label = (el.textContent || '').trim().replace(/:\s*$/, '');
      // If the current section is empty, REPLACE its name (we just
      // started). Otherwise open a fresh section.
      if (!current.name && !current.chords.length && !current.text.trim()) {
        current.name = label;
      } else {
        current = { name: label, chords: [], text: '' };
        sections.push(current);
      }
      return;
    }

    if (tag === 'tab') {
      // Tab block — skip entirely.
      return;
    }

    if (el.hasAttribute('data-chord')) {
      const c = el.getAttribute('data-chord') || '';
      if (c) current.chords.push(c);
      // Keep the chord name in the lyric text too, so the player can
      // see the chord-over-lyric layout in any future debug view.
      current.text += el.textContent || '';
      return;
    }

    // Generic element — recurse.
    for (const child of Array.from(el.childNodes)) visit(child);
  };

  for (const child of Array.from(preEl.childNodes)) visit(child);

  // Trim text and drop empty sections.
  return sections
    .map((s) => ({ ...s, text: s.text.replace(/[ \t]+$/gm, '').trim() }))
    .filter((s) => s.chords.length || s.text);
}

/**
 * Parse a fetched e-chords song-page HTML string into the structured
 * shape the page consumes. Pure function — no fetch, no DOM mutation
 * — so it's trivially testable in Node with a saved fixture.
 *
 * Assumes a browser-style DOMParser is available. The Strings page
 * runs in a real browser, so this is fine; the smoke-test script
 * polyfills via `linkedom` only when running under Node.
 */
export function parseEchordsHtml(html, sourceUrl = '') {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Cloudflare interstitial — title is "Just a moment...". Bail with
  // a clear error so the UI can tell the player to retry.
  const titleTag = doc.querySelector('title');
  const titleText = (titleTag?.textContent || '').trim();
  if (/^just a moment/i.test(titleText)) {
    throw new Error('e-chords is showing a Cloudflare check; try again in a moment.');
  }

  const h1 = doc.querySelector('h1');
  const songTitle = (h1?.textContent || '').trim() || titleText;

  // First <h2> on an e-chords song page is the artist link. Later
  // <h2>s ("Comments", "Related Artists"…) live further down the page.
  const artist = (doc.querySelector('h2')?.textContent || '').trim();

  // <song-chord chords-used="Am C D F E Dm"> is the canonical chord
  // palette for the song — easier to trust than scraping every
  // <span data-chord> in the body, which can include inline
  // chord-name links to chord-shape pages.
  const songChord = doc.querySelector('song-chord, [chords-used]');
  const chordsUsedAttr = songChord?.getAttribute('chords-used') || '';
  const chordsUsed = chordsUsedAttr
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  // Capo / tuning hints — surface them to the player so they know to
  // adjust before strumming along. e-chords renders these as
  // free-form spans, so we just pull whichever element matches.
  const capo =
    (doc.querySelector('song-capo-display, .song-capo, [class*="capo"]')?.textContent || '').trim();
  const tuning =
    (doc.querySelector('song-tuning, [class*="tuning"]')?.textContent || '').trim();

  const pre = doc.querySelector('pre');
  const sections = pre ? walkSongPre(pre) : [];
  const chordSequence = sections.flatMap((s) => s.chords);

  // Prefer the declared palette; fall back to whatever appeared in
  // the body if the declared one is empty (defensive — every song
  // page we surveyed had it, but the markup could change).
  const palette = chordsUsed.length ? chordsUsed : Array.from(new Set(chordSequence));

  const { entries: barEntries, skipped } = chordsToBarEntries(palette);

  return {
    url: sourceUrl,
    title: songTitle,
    artist,
    capo,
    tuning,
    chordsUsed: palette,
    chordSequence,
    sections,
    barEntries,
    skipped
  };
}

/**
 * Fetch + parse an e-chords song page using the page's existing
 * `window.proxyService` chain. Falls back across multiple CORS
 * proxies and applies the proxy module's circuit breaker, so a
 * temporarily-down proxy doesn't strand the user.
 *
 * @param {string} url
 * @returns {Promise<EchordsSong>}
 */
export async function fetchEchordsSong(url) {
  if (!isEchordsUrl(url)) {
    throw new Error('Not an e-chords URL — paste a link from e-chords.com.');
  }
  if (typeof window === 'undefined' || !window.proxyService) {
    throw new Error("Couldn't reach e-chords. Try reloading the page.");
  }
  // skipDirect: e-chords blocks direct CORS, no point spending the
  // 3s direct-attempt budget every load.
  const html = await window.proxyService.fetchWithProxy(url.trim(), {
    skipDirect: true,
    timeout: 15000
  });
  if (!html || typeof html !== 'string') {
    throw new Error("Empty response from e-chords. Try again in a moment.");
  }
  return parseEchordsHtml(html, url.trim());
}

/**
 * @typedef {object} EchordsSearchHit
 * @property {string} title         e.g. "The House Of The Rising Sun"
 * @property {string} artist        e.g. "The Animals"
 * @property {string} url           full chords page URL ready for fetchEchordsSong()
 * @property {number} popularity    QT_HITS — useful for ranking / display
 * @property {string} avatar        artist photo URL (may be empty)
 */

/**
 * Search e-chords' public JSON search API and return the songs that
 * have an actual chord chart (their `songs` section). The endpoint
 * also returns `videos`, `artists`, `albums`, `lyrics`, `composers`
 * — we ignore the rest because the page can only consume chord data.
 *
 * The endpoint sets `Content-Type: application/json` and is served
 * through the same Cloudflare layer as the song pages, so it gets
 * the same CORS-proxy treatment. The proxy already caches responses
 * for an hour by default, so repeated queries are essentially free.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.limit=10]   max results to return
 * @param {AbortSignal} [options.signal] cancel mid-flight (e.g. user kept typing)
 * @returns {Promise<EchordsSearchHit[]>}
 */
export async function searchEchords(query, options = {}) {
  const q = (query || '').trim();
  if (!q) return [];
  if (typeof window === 'undefined' || !window.proxyService) {
    throw new Error("Couldn't reach e-chords. Try reloading the page.");
  }
  const limit = Math.max(1, Math.min(50, options.limit || 10));
  const apiUrl = `https://www.e-chords.com/api/search?q=${encodeURIComponent(q)}`;
  /** @type {any} */
  let json;
  try {
    json = await window.proxyService.fetchJson(apiUrl, {
      timeout: 12000,
      signal: options.signal,
      friendlyError: "Couldn't read the search results. Try again in a moment."
    });
  } catch (err) {
    // Empty body short-circuit: the legacy code returned [] for that
    // case rather than surfacing an error. Preserve that behaviour by
    // distinguishing "no readable response" from real failures.
    if (/didn't return anything readable/.test(err?.message || '')) return [];
    throw err;
  }
  const songs = Array.isArray(json?.songs?.hits) ? json.songs.hits : [];
  // Rank by all-time popularity. Ties broken by weekly hits so a
  // recently-trending cover sits above a forgotten one with the same
  // total. Then trim to the requested page.
  const sorted = songs.slice().sort((a, b) => {
    const ah = Number(a?.QT_HITS) || 0;
    const bh = Number(b?.QT_HITS) || 0;
    if (bh !== ah) return bh - ah;
    return (Number(b?.QT_HITS_SEMANA) || 0) - (Number(a?.QT_HITS_SEMANA) || 0);
  });
  /** @type {EchordsSearchHit[]} */
  const out = [];
  for (const hit of sorted) {
    if (out.length >= limit) break;
    const codArtist = (hit?.COD_ARTISTA || '').trim();
    const codTitle = (hit?.COD_TITULO || '').trim();
    if (!codArtist || !codTitle) continue;
    out.push({
      title: (hit?.TITULO || '').trim(),
      artist: (hit?.ARTISTA || '').trim(),
      url: `https://www.e-chords.com/chords/${codArtist}/${codTitle}`,
      popularity: Number(hit?.QT_HITS) || 0,
      avatar: (hit?.AVATAR || '').trim()
    });
  }
  return out;
}
