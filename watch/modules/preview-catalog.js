/**
 * Fictional catalog used for OG preview captures and Google crawler
 * renders. Keeps real show titles/artwork out of screenshots and
 * Search Console live tests while leaving the page chrome + SEO copy
 * unchanged for humans.
 *
 * Tiles are genre / vibe invitations (not fake show titles) so the
 * OG card still sells "classic TV from the Archive" without naming
 * any real series.
 *
 * Triggered by:
 *   - `?preview=1` (generate-previews.js, manual QA)
 *   - Search crawler user agents (Googlebot, Bingbot, DuckDuckBot, …)
 */

/** @typedef {import('./shows.js').ShowConfig} ShowConfig */
/** @typedef {import('./movies.js').MovieConfig} MovieConfig */

/**
 * @typedef {Object} PreviewCatalogOpts
 * @property {string} [userAgent]
 * @property {string} [search]
 */

/**
 * @param {PreviewCatalogOpts} [opts]
 * @returns {boolean}
 */
export function shouldUsePreviewCatalog(opts = {}) {
  const ua = opts.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '');
  const search = opts.search ?? (typeof location !== 'undefined' ? location.search || '' : '');
  if (/Googlebot|Google-InspectionTool|Storebot-Google|GoogleOther|bingbot|DuckDuckBot/i.test(ua)) {
    return true;
  }
  return new URLSearchParams(search).has('preview');
}

/**
 * Genre / vibe tiles. Each row mirrors a real filter chip so the
 * preview grid reads like a streaming home row of moods to browse.
 *
 * @type {Omit<ShowConfig, 'parser' | 'acceptFile' | 'imdbId' | 'posterUrl'>[]}
 */
const PREVIEW_SHOWS = [
  {
    id: 'genre-animation',
    name: 'Animation',
    shortName: 'Animation',
    emoji: '🎨',
    accent: '#f59e0b',
    tags: ['animation', 'kids', '80s'],
    tagline: 'Hand-drawn classics & Saturday morning',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-comedy',
    name: 'Comedy',
    shortName: 'Comedy',
    emoji: '😂',
    accent: '#eab308',
    tags: ['live-action', 'comedy', '90s'],
    tagline: 'Sitcoms, sketches & silly hours',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-sci-fi',
    name: 'Sci-Fi',
    shortName: 'Sci-Fi',
    emoji: '🚀',
    accent: '#3b82f6',
    tags: ['live-action', 'sci-fi', '60s'],
    tagline: 'Rocket ships & far-out futures',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-superhero',
    name: 'Superhero',
    shortName: 'Superhero',
    emoji: '🦸',
    accent: '#ef4444',
    tags: ['animation', 'superhero', '90s'],
    tagline: 'Capes, masks & origin stories',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-anthology',
    name: 'Anthology',
    shortName: 'Anthology',
    emoji: '🎭',
    accent: '#a855f7',
    tags: ['live-action', 'anthology', '50s'],
    tagline: 'A new story every week',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-fantasy',
    name: 'Fantasy',
    shortName: 'Fantasy',
    emoji: '🧙',
    accent: '#8b5cf6',
    tags: ['live-action', 'fantasy', '80s'],
    tagline: 'Magic, quests & enchanted realms',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-action',
    name: 'Action',
    shortName: 'Action',
    emoji: '💥',
    accent: '#f97316',
    tags: ['animation', 'action', '80s'],
    tagline: 'Chases, fights & cliffhangers',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-spy',
    name: 'Spy',
    shortName: 'Spy',
    emoji: '🕵️',
    accent: '#64748b',
    tags: ['live-action', 'spy', '60s'],
    tagline: 'Gadgets, intrigue & cool cars',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-anime',
    name: 'Anime',
    shortName: 'Anime',
    emoji: '🎌',
    accent: '#ec4899',
    tags: ['animation', 'anime', '90s'],
    tagline: 'Imported animation classics',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-kids',
    name: 'Kids',
    shortName: 'Kids',
    emoji: '🧸',
    accent: '#22c55e',
    tags: ['animation', 'kids', '90s'],
    tagline: 'After-school & Saturday morning',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-game-show',
    name: 'Game Shows',
    shortName: 'Game Shows',
    emoji: '🎯',
    accent: '#14b8a6',
    tags: ['live-action', 'game-show', '70s'],
    tagline: 'Buzzers, prizes & panelists',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-satire',
    name: 'Satire',
    shortName: 'Satire',
    emoji: '📰',
    accent: '#06b6d4',
    tags: ['animation', 'satire', '90s'],
    tagline: 'Sharp takes & sideways humor',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-documentary',
    name: 'Documentary',
    shortName: 'Documentary',
    emoji: '🎬',
    accent: '#0ea5e9',
    tags: ['documentary', '70s'],
    tagline: 'Real stories from the Archive',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'genre-sports',
    name: 'Sports',
    shortName: 'Sports',
    emoji: '🏆',
    accent: '#84cc16',
    tags: ['live-action', 'sports', '80s'],
    tagline: 'Highlights, matches & underdogs',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'era-80s',
    name: '80s Classics',
    shortName: '80s',
    emoji: '📼',
    accent: '#d946ef',
    tags: ['live-action', '80s'],
    tagline: 'Neon, synth & rerun gold',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'era-90s',
    name: '90s Cartoons',
    shortName: '90s',
    emoji: '📺',
    accent: '#38bdf8',
    tags: ['animation', 'kids', '90s'],
    tagline: 'After-school channel surfing',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'era-60s',
    name: '60s Retro',
    shortName: '60s',
    emoji: '🕺',
    accent: '#f43f5e',
    tags: ['live-action', '60s'],
    tagline: 'Mod style & black-and-white charm',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  },
  {
    id: 'era-golden',
    name: 'Golden Age',
    shortName: 'Golden Age',
    emoji: '✨',
    accent: '#eab308',
    tags: ['live-action', '50s'],
    tagline: 'Early television treasures',
    iaItem: 'preview-placeholder',
    tvmazeId: 0
  }
];

/**
 * @returns {{ shows: ShowConfig[], movies: MovieConfig[], byId: Map<string, ShowConfig | MovieConfig> }}
 */
export function getPreviewCatalog() {
  /** @type {ShowConfig[]} */
  const shows = PREVIEW_SHOWS.map((s) => ({
    ...s,
    parser: null
  }));
  /** @type {MovieConfig[]} */
  const movies = [];
  /** @type {Map<string, ShowConfig | MovieConfig>} */
  const byId = new Map();
  for (const show of shows) byId.set(show.id, show);
  return { shows, movies, byId };
}
