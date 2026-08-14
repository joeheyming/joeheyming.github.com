import { getMovies, getShows, TAG_GROUPS } from '/watch/modules/data-source.js';
import { GENRE_LABELS } from './constants.js';

/**
 * @typedef {Object} CatalogItem
 * @property {'movie'|'show'} kind
 * @property {string} id
 * @property {string} name
 * @property {string} shortName
 * @property {string} emoji
 * @property {string} accent
 * @property {string[]} tags
 * @property {string} tagline
 * @property {string} [posterUrl]
 * @property {number} [tvmazeId]
 */

/**
 * @typedef {Object} Section
 * @property {string} id
 * @property {string} label
 * @property {CatalogItem[]} items
 */

/**
 * Load movies + shows from Watch's data-source and normalize to CatalogItem[].
 * @returns {Promise<CatalogItem[]>}
 */
export async function loadCatalog() {
  const [movies, shows] = await Promise.all([getMovies(), getShows()]);
  return [
    ...movies.map((m) => /** @type {CatalogItem} */ ({ ...m, kind: 'movie' })),
    ...shows.map(
      (s) =>
        /** @type {CatalogItem} */ ({
          kind: 'show',
          id: s.id,
          name: s.name,
          shortName: s.shortName,
          emoji: s.emoji,
          accent: s.accent,
          tags: s.tags || [],
          tagline: s.tagline,
          posterUrl: s.posterUrl,
          tvmazeId: s.tvmazeId
        })
    )
  ];
}

/**
 * Bucket movies by genre; split TV shows into alpha shelves so they
 * don't all live on one face.
 * @param {CatalogItem[]} items
 * @returns {Section[]}
 */
export function buildSections(items) {
  /** @type {Map<string, CatalogItem[]>} */
  const byGenre = new Map();
  /** @type {CatalogItem[]} */
  const tvShows = [];
  /** @type {CatalogItem[]} */
  const untaggedMovies = [];

  const genreTags = new Set(TAG_GROUPS.genre);

  for (const item of items) {
    if (item.kind === 'show') {
      tvShows.push(item);
      continue;
    }
    const genre = (item.tags || []).find((t) => genreTags.has(t));
    if (!genre) {
      untaggedMovies.push(item);
      continue;
    }
    if (!byGenre.has(genre)) byGenre.set(genre, []);
    byGenre.get(genre)?.push(item);
  }

  /** @type {Section[]} */
  const sections = [];

  // TV Series → several A–Z aisle signs (and expandSections may split further)
  sections.push(...splitTvShows(tvShows));

  for (const g of TAG_GROUPS.genre) {
    const list = byGenre.get(g);
    if (!list?.length) continue;
    sections.push({
      id: g,
      label: GENRE_LABELS[g] || g,
      items: list.sort((a, b) => a.name.localeCompare(b.name))
    });
  }

  if (untaggedMovies.length) {
    sections.push({
      id: 'new-releases',
      label: 'New Releases',
      items: untaggedMovies.sort((a, b) => a.name.localeCompare(b.name))
    });
  }

  return sections;
}

/**
 * Curated entrance endcap — Staff Picks / New Releases mix from the catalog.
 * Prefers movies with posters, spreads genres, caps at 12.
 * @param {CatalogItem[]} catalog
 * @returns {Section | null}
 */
export function buildStaffPicksSection(catalog) {
  if (!catalog.length) return null;
  const movies = catalog.filter((i) => i.kind === 'movie');
  const shows = catalog.filter((i) => i.kind === 'show');
  /** @type {CatalogItem[]} */
  const picks = [];
  const seen = new Set();

  /** @param {CatalogItem[]} list */
  function takeDiverse(list) {
    const byTag = new Map();
    for (const item of list) {
      const tag = (item.tags && item.tags[0]) || 'other';
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)?.push(item);
    }
    const queues = [...byTag.values()].map((arr) => [...arr].sort(() => Math.random() - 0.5));
    let guard = 0;
    while (picks.length < 12 && queues.some((q) => q.length) && guard++ < 64) {
      for (const q of queues) {
        if (picks.length >= 12) break;
        const next = q.shift();
        if (!next || seen.has(`${next.kind}:${next.id}`)) continue;
        seen.add(`${next.kind}:${next.id}`);
        picks.push(next);
      }
    }
  }

  // Prefer titled movies first, then fill with shows
  takeDiverse(movies.length ? movies : catalog);
  if (picks.length < 8) takeDiverse(shows);

  if (!picks.length) {
    picks.push(...catalog.slice(0, Math.min(12, catalog.length)));
  }

  return {
    id: 'staff-picks',
    label: 'Staff Picks',
    items: picks.slice(0, 12)
  };
}

/**
 * Split shows into letter-range shelves (classic store aisle signage).
 * @param {CatalogItem[]} shows
 * @returns {Section[]}
 */
export function splitTvShows(shows) {
  if (!shows.length) return [];
  const sorted = [...shows].sort((a, b) => a.name.localeCompare(b.name));
  /** @type {{ id: string, label: string, test: (ch: string) => boolean }[]} */
  const bands = [
    { id: 'tv-a-d', label: 'TV A–D', test: (ch) => ch >= 'a' && ch <= 'd' },
    { id: 'tv-e-h', label: 'TV E–H', test: (ch) => ch >= 'e' && ch <= 'h' },
    { id: 'tv-i-l', label: 'TV I–L', test: (ch) => ch >= 'i' && ch <= 'l' },
    { id: 'tv-m-p', label: 'TV M–P', test: (ch) => ch >= 'm' && ch <= 'p' },
    { id: 'tv-q-t', label: 'TV Q–T', test: (ch) => ch >= 'q' && ch <= 't' },
    { id: 'tv-u-z', label: 'TV U–Z', test: (ch) => ch >= 'u' && ch <= 'z' }
  ];

  /** @type {Section[]} */
  const out = [];
  for (const band of bands) {
    const items = sorted.filter((s) => {
      const ch = (s.name.trim()[0] || '#').toLowerCase();
      return band.test(ch);
    });
    if (items.length) out.push({ id: band.id, label: band.label, items });
  }

  // Titles that don't start with A–Z (digits, symbols)
  const other = sorted.filter((s) => {
    const ch = (s.name.trim()[0] || '').toLowerCase();
    return ch < 'a' || ch > 'z';
  });
  if (other.length) out.push({ id: 'tv-other', label: 'TV #', items: other });

  return out;
}
