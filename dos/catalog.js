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
  },
  {
    id: 'wolfenstein-3d',
    archiveId: 'msdos_Wolfenstein_3D_1992',
    name: 'Wolfenstein 3D',
    year: 1992,
    genre: 'First-person shooter',
    icon: '🔫',
    blurb: 'id Software invents the FPS — blast Nazis, find the exit, remember the maze.',
    accent: 'crimson',
    bootHint: 'Wolf3D/WOLF3D/WOLF3D/WOLF3D.EXE'
  },
  {
    id: 'heretic',
    archiveId: 'msdos_Heretic_1994',
    name: 'Heretic',
    year: 1994,
    genre: 'First-person shooter',
    icon: '🧙',
    blurb:
      'Doom engine, fantasy weapons — Raven Software throws axes and morphs you into a chicken.',
    accent: 'plum',
    bootHint: 'Heretic/IAFIX.BAT'
  },
  {
    id: 'descent',
    archiveId: 'msdos_Descent_1995',
    name: 'Descent',
    year: 1995,
    genre: '6DOF shooter',
    icon: '🛸',
    blurb: 'Full six-degrees-of-freedom mining tunnels. Vertigo optional, destruction mandatory.',
    accent: 'slate',
    bootHint: 'Descent/descent.exe'
  },
  {
    id: 'prince-of-persia',
    archiveId: 'msdos_Prince_of_Persia_1990',
    name: 'Prince of Persia',
    year: 1990,
    genre: 'Cinematic platformer',
    icon: '🗡️',
    blurb:
      "Jordan Mechner's rotoscoped classic — 60 minutes to escape the dungeon and save the princess.",
    accent: 'amber',
    bootHint: 'Ppersia/PRINCE.EXE'
  },
  {
    id: 'commander-keen-4',
    archiveId: 'msdos_Commander_Keen_4_-_Secret_of_the_Oracle_1991',
    name: 'Commander Keen 4',
    year: 1991,
    genre: 'Platformer',
    icon: '🚀',
    blurb: "Billy Blaze vs. the Shadowlands — id's side-scrolling pogo-stick shareware hit.",
    accent: 'teal',
    bootHint: 'CKeen4/KEEN4E.EXE'
  },
  {
    id: 'jazz-jackrabbit',
    archiveId: 'msdos_Jazz_Jackrabbit_1994',
    name: 'Jazz Jackrabbit',
    year: 1994,
    genre: 'Platformer',
    icon: '🐰',
    blurb: "Epic MegaGames' Sonic answer — a gun-toting bunny tearing across alien worlds.",
    accent: 'olive',
    bootHint: 'JazzJack/JAZZ.EXE'
  },
  {
    id: 'jill-of-the-jungle',
    archiveId: 'msdos_Jill_of_the_Jungle_1992',
    name: 'Jill of the Jungle',
    year: 1992,
    genre: 'Platformer',
    icon: '🏹',
    blurb: 'Epic shareware before Jazz — Jill transforms into animals and explores lush stages.',
    accent: 'olive',
    bootHint: 'JillJung/JILL1.EXE'
  },
  {
    id: 'lemmings',
    archiveId: 'msdos_Lemmings_1991',
    name: 'Lemmings',
    year: 1991,
    genre: 'Puzzle',
    icon: '🐾',
    blurb:
      'Assign jobs, dig tunnels, blow stuff up — save as many of the little walkers as you can.',
    accent: 'teal',
    bootHint: 'lemmings/LEMMINGS.BAT'
  },
  {
    id: 'scorched-earth',
    archiveId: 'msdos_Scorched_Earth_1991',
    name: 'Scorched Earth',
    year: 1991,
    genre: 'Artillery',
    icon: '💥',
    blurb: 'The mother of all games — turn-based tank warfare with absurd weapons and trash talk.',
    accent: 'rust',
    bootHint: 'Scorched/SCORCH.EXE'
  },
  {
    id: 'simcity',
    archiveId: 'msdos_SimCity_1989',
    name: 'SimCity',
    year: 1989,
    genre: 'City builder',
    icon: '🏙️',
    blurb:
      "Will Wright's city-sim original — zone, tax, and pray the monster doesn't flatten downtown.",
    accent: 'slate',
    bootHint: 'SimCity/SIMCITY.EXE'
  },
  {
    id: 'master-of-orion',
    archiveId: 'msdos_Master_of_Orion_1993',
    name: 'Master of Orion',
    year: 1993,
    genre: '4X strategy',
    icon: '🌌',
    blurb: 'Space 4X blueprint — research techs, design fleets, and conquer the galaxy.',
    accent: 'plum',
    bootHint: 'mastori/ORION.EXE'
  },
  {
    id: 'stunts',
    archiveId: 'msdos_Stunts_1990',
    name: 'Stunts',
    year: 1990,
    genre: 'Racing',
    icon: '🏎️',
    blurb: 'Build tracks with loops and corkscrews, then race them in a Lotus or a Porsche.',
    accent: 'crimson',
    bootHint: 'Stunts/STUNTS.COM'
  },
  {
    id: 'one-must-fall-2097',
    archiveId: 'msdos_One_Must_Fall_2097_1994',
    name: 'One Must Fall 2097',
    year: 1994,
    genre: 'Fighting',
    icon: '🤖',
    blurb: 'Pilot giant HAR robots in a tournament fighter with scrap-metal upgrade paths.',
    accent: 'amber',
    bootHint: 'OneMustF/OMF/OMF.EXE'
  },
  {
    id: 'maniac-mansion',
    archiveId: 'msdos_Maniac_Mansion_1987',
    name: 'Maniac Mansion',
    year: 1987,
    genre: 'Point-and-click adventure',
    icon: '🏠',
    blurb:
      'The SCUMM debut — send teens into a mad scientist mansion, and never microwave the hamster.',
    accent: 'rust',
    bootHint: 'MMansion/MANIAC.EXE'
  },
  {
    id: 'zak-mckracken',
    archiveId: 'msdos_Zak_McKracken_and_the_Alien_Mindbenders_1988',
    name: 'Zak McKracken',
    year: 1988,
    genre: 'Point-and-click adventure',
    icon: '📰',
    blurb:
      'Tabloid reporter vs. alien mind control — globe-trotting SCUMM weirdness from Lucasfilm.',
    accent: 'teal',
    bootHint: 'Zak/zak.exe'
  },
  {
    id: 'zork-1',
    archiveId: 'msdos_Zork_I_-_The_Great_Underground_Empire_1980',
    name: 'Zork I',
    year: 1980,
    genre: 'Text adventure',
    icon: '🗝️',
    blurb:
      'West of house. You are standing in an open field — the Infocom classic that started it all.',
    accent: 'olive',
    bootHint: 'runme.bat'
  },
  {
    id: 'ultima-iv',
    archiveId: 'msdos_Ultima_IV_-_Quest_of_the_Avatar_1985',
    name: 'Ultima IV: Quest of the Avatar',
    year: 1985,
    genre: 'CRPG',
    icon: '⚖️',
    blurb:
      "Garriott's virtue system — become the Avatar by living the Eight Virtues, not grinding XP.",
    accent: 'amber',
    bootHint: 'ultima4/ULTIMA.COM'
  },
  {
    id: 'eye-of-the-beholder',
    archiveId: 'msdos_Eye_of_the_Beholder_1991',
    name: 'Eye of the Beholder',
    year: 1991,
    genre: 'Dungeon crawler',
    icon: '👁️',
    blurb:
      'Real-time AD&D under Waterdeep — grid dungeon crawling with party tactics and sticky doors.',
    accent: 'plum',
    bootHint: 'eob1/START.EXE'
  },
  {
    id: 'f19-stealth-fighter',
    archiveId: 'msdos_F-19_Stealth_Fighter_1988',
    name: 'F-19 Stealth Fighter',
    year: 1988,
    genre: 'Flight sim',
    icon: '✈️',
    blurb: "MicroProse's Cold War stealth campaign — fly low, stay quiet, come home with the film.",
    accent: 'slate',
    bootHint: 'F-19Stea/F19.COM'
  }
];

/** Stable IDB bundle id for a catalog entry — independent of the
 *  specific download URL we pick, so re-runs hit the cache even if
 *  archive.org shuffles file ordering. */
export function bundleIdFor(entry) {
  return `catalog-${entry.id}`;
}
