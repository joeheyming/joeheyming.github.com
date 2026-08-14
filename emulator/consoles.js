// Registry of every console the unified /emulator/ shell supports.
//
// One entry per console. Adding a new console (e.g. SNES, GBA) is just a
// matter of dropping a record in here and pushing a card on the picker —
// every other shared file (rom-browser, launch, internet-archive) reads
// from this object and reconfigures itself automatically.
// Consoles that need a system BIOS (Neo Geo, PS1) set `biosRequired` +
// `biosFileName`; launch.js persists the upload in IndexedDB.
// Optional `biosIaBaseUrl` fetches BIOS from a different IA item than
// the game library (PS1: games are local-only, BIOS still auto-loads).
//
// EmulatorJS core IDs come from https://emulatorjs.org/docs/Options#ejs_core.
// `iaBaseUrl` is the Internet Archive collection used by the ROM browser;
// leave it `null` and the ROM browser silently hides itself so the user
// is steered to the local-file picker instead.
(function () {
  'use strict';

  const CONSOLES = {
    nes: {
      id: 'nes',
      title: 'NES',
      subtitle: 'Nintendo Entertainment System',
      emoji: '🕹️',
      // EmulatorJS core (libretro: FCEUmm) — fast WASM 6502 with full mapper coverage.
      ejsCore: 'nes',
      fileAccept: '.nes,.zip,.7z',
      fileExtsLabel: '.nes',
      // Identity accent — Famicom red. Used by both the boot card and
      // the EJS chrome (EJS_color). Sega / GB get their own hue below.
      accentHex: '#dc2626',
      accentGoldHex: '#7c2d12',
      iaBaseUrl: 'https://archive.org/download/nes-collection',
      iaDescriptionPrefix: 'Classic NES game',
      // Keyboard help — EmulatorJS default bindings (EJS_defaultControls = 1).
      controls: [
        { label: 'D-Pad', key: 'Arrow keys' },
        { label: 'A button', key: 'Z' },
        { label: 'B button', key: 'X' },
        { label: 'Select', key: 'V' },
        { label: 'Start', key: 'Enter' },
        { label: 'Save state', key: 'F5' },
        { label: 'Load state', key: 'F9' }
      ]
    },

    sega: {
      id: 'sega',
      title: 'Sega Genesis',
      subtitle: 'Mega Drive Emulator',
      emoji: '🎮',
      // EmulatorJS core: genesis_plus_gx.
      ejsCore: 'segaMD',
      fileAccept: '.md,.bin,.gen,.smd,.zip,.7z',
      fileExtsLabel: '.md / .bin / .gen',
      accentHex: '#e94560',
      accentGoldHex: '#c2410c',
      iaBaseUrl: 'https://archive.org/download/sega-genesis-romset-ultra-usa',
      iaDescriptionPrefix: 'Classic Sega Genesis game',
      controls: [
        { label: 'D-Pad', key: 'Arrow keys' },
        { label: 'A button', key: 'Z' },
        { label: 'B button', key: 'X' },
        { label: 'C button', key: 'C' },
        { label: 'X button', key: 'A' },
        { label: 'Y button', key: 'S' },
        { label: 'Z button', key: 'D' },
        { label: 'Start', key: 'Enter' },
        { label: 'Save state', key: 'F5' },
        { label: 'Load state', key: 'F9' }
      ]
    },

    gg: {
      id: 'gg',
      title: 'Game Gear',
      subtitle: 'Sega handheld',
      emoji: '📟',
      // EmulatorJS core: genesis_plus_gx (same family as Genesis).
      ejsCore: 'segaGG',
      fileAccept: '.gg,.zip,.7z',
      fileExtsLabel: '.gg',
      // Handheld teal — distinct from Genesis pink and GB violet.
      accentHex: '#0d9488',
      accentGoldHex: '#0f766e',
      // No-Intro flat per-game .7z set.
      iaBaseUrl: 'https://archive.org/download/nointro.gg',
      iaDescriptionPrefix: 'Classic Game Gear game',
      iaFileExtensions: ['.7z'],
      iaPreferMetadata: true,
      iaExcludeNames: ['[BIOS] Sega Game Gear (USA)'],
      controls: [
        { label: 'D-Pad', key: 'Arrow keys' },
        { label: 'Button 1', key: 'Z' },
        { label: 'Button 2', key: 'X' },
        { label: 'Start', key: 'Enter' },
        { label: 'Save state', key: 'F5' },
        { label: 'Load state', key: 'F9' }
      ]
    },

    sega32x: {
      id: 'sega32x',
      title: 'Sega 32X',
      subtitle: 'Genesis add-on',
      emoji: '🚀',
      // EmulatorJS core: picodrive.
      ejsCore: 'sega32x',
      fileAccept: '.32x,.bin,.zip,.7z',
      fileExtsLabel: '.32x / .bin',
      // Mars orange — adjacent to Genesis without colliding.
      accentHex: '#ea580c',
      accentGoldHex: '#c2410c',
      iaBaseUrl: 'https://archive.org/download/nointro.32x',
      iaDescriptionPrefix: 'Classic Sega 32X game',
      iaFileExtensions: ['.7z'],
      iaPreferMetadata: true,
      // BIOS dumps + SDK carts aren't playable titles.
      iaExcludeNames: [
        '[BIOS] 32X M68000 (USA)',
        '[BIOS] 32X SH-2 Master (USA)',
        '[BIOS] 32X SH-2 Slave (USA)',
        '32X Sample Program - PWM Sound Demo (Unknown) (SDK Build)',
        'Mars Check Program Version 1.0 (Unknown) (SDK Build) (Set 1)',
        'Mars Check Program Version 1.0 (Unknown) (SDK Build) (Set 2)',
        'Mars Sample Program - Gnu Sierra (Unknown) (SDK Build)',
        'Mars Sample Program - Pharaoh (Unknown) (SDK Build)',
        'Mars Sample Program - Runlength Mode Test (Unknown) (SDK Build)',
        'Mars Sample Program - Texture Test (Unknown) (SDK Build)',
        'Time Warner 32X CMD Download Cartridge (USA) (Program)'
      ],
      controls: [
        { label: 'D-Pad', key: 'Arrow keys' },
        { label: 'A button', key: 'Z' },
        { label: 'B button', key: 'X' },
        { label: 'C button', key: 'C' },
        { label: 'X button', key: 'A' },
        { label: 'Y button', key: 'S' },
        { label: 'Z button', key: 'D' },
        { label: 'Start', key: 'Enter' },
        { label: 'Save state', key: 'F5' },
        { label: 'Load state', key: 'F9' }
      ]
    },

    gb: {
      id: 'gb',
      title: 'Game Boy',
      subtitle: 'Game Boy & Game Boy Color',
      emoji: '👾',
      // EmulatorJS core: gambatte (handles both DMG and GBC).
      ejsCore: 'gb',
      fileAccept: '.gb,.gbc,.zip,.7z',
      fileExtsLabel: '.gb / .gbc',
      accentHex: '#8b5cf6',
      accentGoldHex: '#6d28d9',
      // Pull from two complementary IA items so the library spans both eras
      // gambatte handles. First source wins on dedupe — DMG titles get the
      // pristine no-intro builds, GBC-only games come from the curated
      // gameboycolorsystemcollection. Combined: Pokémon Red/Blue/Yellow,
      // Crystal/Gold/Silver, Metroid II, original Tetris, Super Mario Land
      // 1+2, Wario Land 1/2/3, Kirby's Dream Land 1+2, FF Adventure /
      // Legend, Castlevania I+II, Mega Man I-V, Zelda Link's Awakening +
      // Oracle of Ages / Seasons, etc.
      iaBaseUrl: [
        'https://archive.org/download/theentiregameboycollection',
        'https://archive.org/download/gameboycolorsystemcollection'
      ],
      iaDescriptionPrefix: 'Classic Game Boy / Color game',
      controls: [
        { label: 'D-Pad', key: 'Arrow keys' },
        { label: 'A button', key: 'Z' },
        { label: 'B button', key: 'X' },
        { label: 'Select', key: 'V' },
        { label: 'Start', key: 'Enter' },
        { label: 'Save state', key: 'F5' },
        { label: 'Load state', key: 'F9' }
      ]
    },

    neogeo: {
      id: 'neogeo',
      title: 'Neo Geo',
      subtitle: 'AES / MVS Arcade',
      emoji: '🥊',
      // EmulatorJS arcade core → FinalBurn Neo (handles Neo Geo AES/MVS).
      ejsCore: 'arcade',
      fileAccept: '.zip,.7z',
      fileExtsLabel: '.zip (FBNeo set)',
      // SNK yellow-on-black identity.
      accentHex: '#eab308',
      accentGoldHex: '#a16207',
      // Flat per-game FBNeo zips (includes neogeo.zip BIOS in the same item).
      iaBaseUrl: 'https://archive.org/download/Neo-geoRomCollectionByGhostware',
      iaDescriptionPrefix: 'Neo Geo game',
      // BIOS / system zips live in the collection but aren't playable titles.
      iaExcludeNames: ['neogeo', 'gg-bios'],
      // FBNeo looks up the BIOS by filename; keep this exact.
      biosRequired: true,
      biosFileName: 'neogeo.zip',
      biosStorageKey: 'neogeo',
      biosHelp: 'BIOS auto-loads once from Internet Archive, then stays in this browser.',
      // Short steps on the boot card — keep it terse.
      howto: [
        'Wait for BIOS “ready”.',
        'Use Browse Collection (Internet Archive sets).',
        'Skip random ROM sites — .bin dumps usually fail.'
      ],
      controls: [
        { label: 'D-Pad', key: 'Arrow keys' },
        { label: 'A button', key: 'Z' },
        { label: 'B button', key: 'X' },
        { label: 'C button', key: 'A' },
        { label: 'D button', key: 'S' },
        { label: 'Coin / Select', key: 'V' },
        { label: 'Start', key: 'Enter' },
        { label: 'Save state', key: 'F5' },
        { label: 'Load state', key: 'F9' }
      ]
    },

    snes: {
      id: 'snes',
      title: 'SNES',
      subtitle: 'Super Nintendo',
      emoji: '🟣',
      // EmulatorJS core: snes9x.
      ejsCore: 'snes',
      fileAccept: '.sfc,.smc,.zip,.7z',
      fileExtsLabel: '.sfc / .smc',
      accentHex: '#7c3aed',
      accentGoldHex: '#5b21b6',
      iaBaseUrl: 'https://archive.org/download/snes-collection_202406',
      iaDescriptionPrefix: 'Classic SNES game',
      controls: [
        { label: 'D-Pad', key: 'Arrow keys' },
        { label: 'A button', key: 'X' },
        { label: 'B button', key: 'Z' },
        { label: 'X button', key: 'S' },
        { label: 'Y button', key: 'A' },
        { label: 'L / R', key: 'Q / W' },
        { label: 'Select', key: 'V' },
        { label: 'Start', key: 'Enter' },
        { label: 'Save state', key: 'F5' },
        { label: 'Load state', key: 'F9' }
      ]
    },

    ps1: {
      id: 'ps1',
      title: 'PS1',
      subtitle: 'PlayStation',
      emoji: '💿',
      // EmulatorJS core: pcsx_rearmed.
      ejsCore: 'psx',
      // Prefer single-file disc images; .bin+.cue needs companions and is awkward.
      fileAccept: '.chd,.pbp,.iso,.bin,.cue,.zip,.7z',
      fileExtsLabel: '.chd / .pbp / .iso',
      // PlayStation brand blue (not purple — site bias avoid).
      accentHex: '#0070d1',
      accentGoldHex: '#003791',
      // Curated Redump → CHD set (single-file discs EmulatorJS can load).
      // Raw .iso dumps are rare as flat IA listings; CHD is the searchable stand-in.
      // Disc images are 100–500+ MB — free CORS proxies cannot ferry them, so the
      // browser opens the IA download and the user loads the saved file locally.
      iaBaseUrl: 'https://archive.org/download/CuratedPSXRedumpCHDs',
      iaDescriptionPrefix: 'PlayStation game',
      iaFileExtensions: ['.chd'],
      iaPreferMetadata: true,
      iaExternalDownload: true,
      biosRequired: true,
      // Canonical name for pcsx_rearmed; IA source file is renamed on fetch.
      biosFileName: 'scph5501.bin',
      biosStorageKey: 'ps1',
      // PlayStationBIOSFilesNAEUJP returns 401; nested zip path works.
      biosIaBaseUrl: 'https://archive.org/download/PlayStationBios/PlayStation%20Bios.zip',
      biosIaFileName: 'SCPH-7001.bin',
      biosHelp:
        'US BIOS auto-loads once from Internet Archive, then stays in this browser (IndexedDB). EU/JP: load scph5502.bin / scph5500.bin manually.',
      howto: [
        'Wait for BIOS “ready”.',
        'Browse Collection → pick a title → download from Archive → Load local disc image.',
        'Gamepad recommended.'
      ],
      romHelp:
        'PS1 discs are too large for in-page download. Search the catalog, save the CHD from Internet Archive, then load it here.',
      controls: [
        { label: 'D-Pad', key: 'Arrow keys' },
        { label: '× Cross', key: 'X' },
        { label: '○ Circle', key: 'S' },
        { label: '□ Square', key: 'A' },
        { label: '△ Triangle', key: 'W' },
        { label: 'L1 / R1', key: 'Q / E' },
        { label: 'L2 / R2', key: 'R / F' },
        { label: 'Select', key: 'V' },
        { label: 'Start', key: 'Enter' },
        { label: 'Save state', key: 'F5' },
        { label: 'Load state', key: 'F9' }
      ]
    }
  };

  /**
   * Path landers: /emulator/nes/, /emulator/sega/, …
   * Legacy query: /emulator/?console=nes (rewritten to the path form).
   */
  function getConsoleIdFromPathname(pathname) {
    const parts = String(pathname || '')
      .replace(/\/+$/, '')
      .split('/')
      .filter(Boolean);
    if (parts[0] !== 'emulator' || !parts[1]) return null;
    const id = parts[1].toLowerCase();
    return CONSOLES[id] ? id : null;
  }

  function getConsoleIdFromSearch(search) {
    const params = new URLSearchParams(search || '');
    const requested = (params.get('console') || '').toLowerCase();
    return CONSOLES[requested] ? requested : null;
  }

  // Prefer path landers; fall back to ?console= for old bookmarks / embeds.
  function getConsoleId() {
    return (
      getConsoleIdFromPathname(window.location.pathname) ||
      getConsoleIdFromSearch(window.location.search)
    );
  }

  /** Canonical deep-link path for a console id (`nes` → `/emulator/nes/`). */
  function emulatorConsolePath(id) {
    return `/emulator/${id}/`;
  }

  /**
   * On the hub (`/emulator/`) with `?console=<id>`, replace with the
   * path lander so sitemap/canonical and the live URL match. Preserves
   * other query params (`rom`, `tv`, …) and the hash.
   * @returns {boolean} true if a navigation was started
   */
  function canonicalizeEmulatorConsoleUrl() {
    if (getConsoleIdFromPathname(window.location.pathname)) return false;
    const id = getConsoleIdFromSearch(window.location.search);
    if (!id) return false;
    const norm = String(window.location.pathname || '/')
      .replace(/\/+$/, '')
      .replace(/\/index\.html$/i, '');
    if (norm !== '/emulator') return false;

    const params = new URLSearchParams(window.location.search);
    params.delete('console');
    const qs = params.toString();
    const dest = emulatorConsolePath(id) + (qs ? `?${qs}` : '') + (window.location.hash || '');
    window.location.replace(dest);
    return true;
  }

  window.EMULATOR_CONSOLES = CONSOLES;
  window.getEmulatorConsole = function getEmulatorConsole() {
    const id = getConsoleId();
    return id ? CONSOLES[id] : null;
  };
  window.getEmulatorConsoleId = getConsoleId;
  window.getEmulatorConsoleIdFromPathname = getConsoleIdFromPathname;
  window.emulatorConsolePath = emulatorConsolePath;
  window.canonicalizeEmulatorConsoleUrl = canonicalizeEmulatorConsoleUrl;
})();
