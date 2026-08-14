/**
 * Fictional catalog used for OG preview captures and Google crawler
 * renders. Keeps real show titles/artwork out of screenshots and
 * Search Console live tests while leaving the page chrome + SEO copy
 * unchanged for humans.
 *
 * Preview / crawler landings use {@link getPreviewHome} — a Netflix-
 * style hero + horizontal genre rails. {@link getPreviewCatalog} still
 * exposes a flat ShowConfig list so the data-source facade stays happy.
 *
 * Triggered by:
 *   - `?preview=1` (generate-previews.js, manual QA)
 *   - Search crawler user agents (Googlebot, Bingbot, DuckDuckBot, …)
 */

/** @typedef {import('./shows.js').ShowConfig} ShowConfig */
/** @typedef {import('./movies.js').MovieConfig} MovieConfig */

/**
 * @typedef {Object} PreviewTile
 * @property {string} id
 * @property {string} name
 * @property {string} shortName
 * @property {string} emoji
 * @property {string} accent
 * @property {string} tagline
 * @property {string[]} tags
 */

/**
 * @typedef {Object} PreviewHero
 * @property {string} id
 * @property {string} name
 * @property {string} emoji
 * @property {string} accent
 * @property {string} headline
 * @property {string} tagline
 * @property {string} cta
 */

/**
 * @typedef {Object} PreviewRail
 * @property {string} id
 * @property {string} title
 * @property {PreviewTile[]} items
 */

/**
 * @typedef {Object} PreviewHome
 * @property {PreviewHero} hero
 * @property {PreviewRail[]} rails
 */

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

/** @type {PreviewTile[]} */
const GENRE_TILES = [
  {
    id: 'genre-animation',
    name: 'Animation',
    shortName: 'Animation',
    emoji: '🎨',
    accent: '#f59e0b',
    tagline: 'Hand-drawn classics & Saturday morning',
    tags: ['animation', 'kids', '80s']
  },
  {
    id: 'genre-comedy',
    name: 'Comedy',
    shortName: 'Comedy',
    emoji: '😂',
    accent: '#eab308',
    tagline: 'Sitcoms, sketches & silly hours',
    tags: ['live-action', 'comedy', '90s']
  },
  {
    id: 'genre-sci-fi',
    name: 'Sci-Fi',
    shortName: 'Sci-Fi',
    emoji: '🚀',
    accent: '#3b82f6',
    tagline: 'Rocket ships & far-out futures',
    tags: ['live-action', 'sci-fi', '60s']
  },
  {
    id: 'genre-superhero',
    name: 'Superhero',
    shortName: 'Superhero',
    emoji: '🦸',
    accent: '#ef4444',
    tagline: 'Capes, masks & origin stories',
    tags: ['animation', 'superhero', '90s']
  },
  {
    id: 'genre-anthology',
    name: 'Anthology',
    shortName: 'Anthology',
    emoji: '🎭',
    accent: '#a855f7',
    tagline: 'A new story every week',
    tags: ['live-action', 'anthology', '50s']
  },
  {
    id: 'genre-fantasy',
    name: 'Fantasy',
    shortName: 'Fantasy',
    emoji: '🧙',
    accent: '#8b5cf6',
    tagline: 'Magic, quests & enchanted realms',
    tags: ['live-action', 'fantasy', '80s']
  },
  {
    id: 'genre-action',
    name: 'Action',
    shortName: 'Action',
    emoji: '💥',
    accent: '#f97316',
    tagline: 'Chases, fights & cliffhangers',
    tags: ['animation', 'action', '80s']
  },
  {
    id: 'genre-spy',
    name: 'Spy',
    shortName: 'Spy',
    emoji: '🕵️',
    accent: '#64748b',
    tagline: 'Gadgets, intrigue & cool cars',
    tags: ['live-action', 'spy', '60s']
  },
  {
    id: 'genre-anime',
    name: 'Anime',
    shortName: 'Anime',
    emoji: '🎌',
    accent: '#ec4899',
    tagline: 'Imported animation classics',
    tags: ['animation', 'anime', '90s']
  },
  {
    id: 'genre-kids',
    name: 'Kids',
    shortName: 'Kids',
    emoji: '🧸',
    accent: '#22c55e',
    tagline: 'After-school & Saturday morning',
    tags: ['animation', 'kids', '90s']
  }
];

/** @type {PreviewTile[]} */
const ERA_TILES = [
  {
    id: 'era-80s',
    name: '80s Classics',
    shortName: '80s',
    emoji: '📼',
    accent: '#d946ef',
    tagline: 'Neon, synth & rerun gold',
    tags: ['live-action', '80s']
  },
  {
    id: 'era-90s',
    name: '90s Cartoons',
    shortName: '90s',
    emoji: '📺',
    accent: '#38bdf8',
    tagline: 'After-school channel surfing',
    tags: ['animation', 'kids', '90s']
  },
  {
    id: 'era-60s',
    name: '60s Retro',
    shortName: '60s',
    emoji: '🕺',
    accent: '#f43f5e',
    tagline: 'Mod style & black-and-white charm',
    tags: ['live-action', '60s']
  },
  {
    id: 'era-golden',
    name: 'Golden Age',
    shortName: 'Golden Age',
    emoji: '✨',
    accent: '#eab308',
    tagline: 'Early television treasures',
    tags: ['live-action', '50s']
  },
  {
    id: 'genre-game-show',
    name: 'Game Shows',
    shortName: 'Game Shows',
    emoji: '🎯',
    accent: '#14b8a6',
    tagline: 'Buzzers, prizes & panelists',
    tags: ['live-action', 'game-show', '70s']
  },
  {
    id: 'genre-documentary',
    name: 'Documentary',
    shortName: 'Documentary',
    emoji: '🎬',
    accent: '#0ea5e9',
    tagline: 'Real stories from the Archive',
    tags: ['documentary', '70s']
  }
];

/**
 * Netflix-style home payload for the preview / crawler shell.
 * @returns {PreviewHome}
 */
export function getPreviewHome() {
  const featured = GENRE_TILES.find((t) => t.id === 'genre-sci-fi') || GENRE_TILES[0];
  return {
    hero: {
      id: featured.id,
      name: featured.name,
      emoji: featured.emoji,
      accent: featured.accent,
      headline: 'Classic TV, streaming free',
      tagline: 'Browse decades of animation, sitcoms, and sci-fi from the Internet Archive.',
      cta: 'Play'
    },
    rails: [
      {
        id: 'popular-genres',
        title: 'Popular genres',
        items: GENRE_TILES.slice(0, 8)
      },
      {
        id: 'decades',
        title: 'Decades & more',
        items: ERA_TILES
      }
    ]
  };
}

/**
 * Flat registry used by {@link ./data-source.js} when preview mode is
 * on. Deep links still resolve; the landing UI uses {@link getPreviewHome}.
 *
 * @returns {{ shows: ShowConfig[], movies: MovieConfig[], byId: Map<string, ShowConfig | MovieConfig> }}
 */
export function getPreviewCatalog() {
  const home = getPreviewHome();
  /** @type {Map<string, PreviewTile>} */
  const seen = new Map();
  for (const rail of home.rails) {
    for (const item of rail.items) seen.set(item.id, item);
  }
  // Include the hero tile even if it already appears in a rail.
  seen.set(home.hero.id, {
    id: home.hero.id,
    name: home.hero.name,
    shortName: home.hero.name,
    emoji: home.hero.emoji,
    accent: home.hero.accent,
    tagline: home.hero.tagline,
    tags: ['live-action', 'sci-fi', '60s']
  });

  /** @type {ShowConfig[]} */
  const shows = [...seen.values()].map((t) => ({
    id: t.id,
    name: t.name,
    shortName: t.shortName,
    emoji: t.emoji,
    accent: t.accent,
    tags: t.tags,
    tagline: t.tagline,
    iaItem: 'preview-placeholder',
    tvmazeId: 0,
    parser: null
  }));
  /** @type {MovieConfig[]} */
  const movies = [];
  /** @type {Map<string, ShowConfig | MovieConfig>} */
  const byId = new Map();
  for (const show of shows) byId.set(show.id, show);
  return { shows, movies, byId };
}
