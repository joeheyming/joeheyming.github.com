// dos/catalog.js — curated list of DOS games surfaced as one-click
// launcher cards on the front page.
//
// Each entry points at an Internet Archive item that hosts the game
// publicly; clicking a card fetches the bundle from
// `archive.org/download/<archiveId>/…`, repacks it as a .jsdos zip,
// caches it in IndexedDB, and launches js-dos.
//
// No game files live in this repo. Adding a game is metadata-only:
//
//   {
//     id: 'something-stable',     // local id used for IDB keying
//     archiveId: 'msdos_…',       // the archive.org identifier
//     name: 'Full Title',
//     year: 1993,
//     genre: 'RPG',
//     icon: '🌵',                  // emoji used as the card glyph
//     blurb: 'one-line description',
//     accent: 'amber',            // see ACCENT_STYLES in index.css
//     bootHint: 'GAME.EXE',       // optional — overrides auto-detect
//   }
//
// `bootHint` is rarely needed because we now also honor archive.org's
// `metadata.emulator_start` field (e.g. Arena publishes `ARENA.BAT`),
// but it stays available for items whose metadata is missing or wrong.

/**
 * @typedef {Object} CatalogEntry
 * @property {string} id
 * @property {string} archiveId
 * @property {string} name
 * @property {number} year
 * @property {string} genre
 * @property {string} icon
 * @property {string} blurb
 * @property {'amber' | 'rust' | 'slate' | 'olive' | 'plum' | 'teal' | 'crimson'} accent
 * @property {string} [bootHint]
 */

/** @type {CatalogEntry[]} */
export const CATALOG = [
  {
    id: 'dark-sun-shattered-lands',
    archiveId: 'msdos_Dark_Sun_-_Shattered_Lands_1993',
    name: 'Dark Sun: Shattered Lands',
    year: 1993,
    genre: 'Tactical RPG',
    icon: '🌵',
    blurb: 'Tactical SSI party RPG set on Athas — psionics, gladiators, and a dying desert world.',
    accent: 'rust'
  },
  {
    id: 'elder-scrolls-arena',
    archiveId: 'ARENA_201902',
    name: 'The Elder Scrolls: Arena',
    year: 1994,
    genre: 'First-person RPG',
    icon: '⚔️',
    blurb: "Bethesda's freeware first Elder Scrolls — open-world first-person dungeon crawler.",
    accent: 'slate',
    bootHint: 'ARENA.BAT'
  },
  {
    id: 'civilization',
    archiveId: 'CIVILIZATION_201902',
    name: "Sid Meier's Civilization",
    year: 1991,
    genre: '4X strategy',
    icon: '🏛️',
    blurb: 'The 4X grand-strategy original. Build cities, research tech, race for Alpha Centauri.',
    accent: 'amber',
    bootHint: 'CIV.EXE'
  },
  {
    id: 'colonization',
    // The canonical `msdos_Sid_Meiers_Colonization_1994` IA upload is
    // 304 MB (no chance through any free CORS proxy). `col_20230311`
    // is a user-uploaded slim 3.6 MB zip of the same game with a
    // ready-to-run `colonize.bat` boot entry. Same game, 1% the size.
    archiveId: 'col_20230311',
    name: "Sid Meier's Colonization",
    year: 1994,
    genre: '4X strategy',
    icon: '🚢',
    blurb:
      'Lead a colonial power across the New World — trade goods, found towns, declare independence.',
    accent: 'olive',
    bootHint: 'colonize.bat'
  },
  // NOTE: King's Quest V (msdos_Kings_Quest_V_-_Absence_Makes_the_Heart_Go_Yonder_1990)
  // is intentionally NOT in the catalog. Its upstream zip is ~58 MB,
  // right at the edge of what corsproxy.io / codetabs will reliably
  // pass through — sometimes it works, sometimes it 403s or truncates,
  // and a flaky catalog card is worse than no card at all. Users who
  // want to play it should download the zip from
  // https://archive.org/details/msdos_Kings_Quest_V_-_Absence_Makes_the_Heart_Go_Yonder_1990
  // and drop it into "Add a custom game → From file". If we ever get
  // a self-hosted Cloudflare Worker proxy with no body cap, KQ5 (and
  // other 50–300 MB items) can come back in here.
  {
    id: 'monkey-island',
    archiveId: 'monkey_dos',
    name: 'The Secret of Monkey Island',
    year: 1990,
    genre: 'Point-and-click adventure',
    icon: '🏴\u200d☠️',
    blurb:
      'Guybrush Threepwood wants to be a pirate. Insult-swordfighting, voodoo, one ghostly LeChuck.',
    accent: 'teal',
    bootHint: 'MONKEY.exe'
  },
  {
    id: 'monkey-island-2',
    archiveId: 'msdos_Monkey_Island_2_-_LeChucks_Revenge_1991',
    name: "Monkey Island 2: LeChuck's Revenge",
    year: 1991,
    genre: 'Point-and-click adventure',
    icon: '🦜',
    blurb:
      "LucasArts' SCUMM at its peak — Guybrush hunts the treasure of Big Whoop while LeChuck plots his return.",
    accent: 'crimson',
    bootHint: 'mi2/MONKEY2.EXE'
  }
];

/** Stable IDB bundle id for a catalog entry — independent of the
 *  specific download URL we pick, so re-runs hit the cache even if
 *  archive.org shuffles file ordering. */
export function bundleIdFor(entry) {
  return `catalog-${entry.id}`;
}
