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
      // Per-game .zip listing. `nes-collection` still appears in IA search but
      // metadata/files APIs return empty / "Couldn't locate item" (darked or
      // deranged item). `NintendoEntertainmentSystem` serves a real file list.
      iaBaseUrl: 'https://archive.org/download/NintendoEntertainmentSystem',
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
      audioUnlock: true,
      audioNote:
        'Click the game once if it is silent. 32X music is often missing in the browser; sound effects may still play.',
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

    segacd: {
      id: 'segacd',
      title: 'Sega CD',
      subtitle: 'Mega CD',
      emoji: '📀',
      ejsCore: 'segaCD',
      fileAccept: '.chd,.iso,.bin,.cue,.zip,.7z',
      fileExtsLabel: '.zip / .chd / .iso',
      accentHex: '#0ea5e9',
      accentGoldHex: '#0369a1',
      // Redump set, flat per-game .zip (each ~250-400 MB). `chd_segacd`
      // is `is_dark: true` and 404s through every proxy.
      iaBaseUrl: 'https://archive.org/download/sega_mega-cd_sega-cd',
      iaDescriptionPrefix: 'Sega CD game',
      iaPreferMetadata: true,
      iaExternalDownload: true,
      biosRequired: true,
      biosFileName: 'bios_CD_U.bin',
      biosStorageKey: 'segacd',
      // US Model 1 v1.10 dump is a fixed 128 KiB.
      biosMinBytes: 128 * 1024,
      biosIaBaseUrl: 'https://archive.org/download/SEGACDBIOS/Sega%20Mega%20CD%20BIOS.zip',
      biosIaFileName:
        'Sega%20Mega%20CD%20BIOS%2FSega%20CD%20%28U%29%20-%20Model%201%20v1.10%20%281992%29.bin',
      biosHelp:
        'US BIOS (bios_CD_U.bin) — load once if auto-download fails, then it stays in this browser. EU/JP: bios_CD_E.bin / bios_CD_J.bin.',
      howto: [
        'Wait until BIOS says ready.',
        'These discs are too big to play through the page. Download the .zip from Archive, then Load local disc.',
        'Chromebooks with little disk space may not have room for a full CD image.'
      ],
      romHelp:
        'Too big to load in the page. Download from Archive, then Load local file. School Chromebooks with tiny disks may fail.',
      controls: [
        { label: 'D-Pad', key: 'Arrow keys' },
        { label: 'A button', key: 'Z' },
        { label: 'B button', key: 'X' },
        { label: 'C button', key: 'C' },
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

    gba: {
      id: 'gba',
      title: 'GBA',
      subtitle: 'Game Boy Advance',
      emoji: '🟪',
      ejsCore: 'gba',
      fileAccept: '.gba,.zip,.7z',
      fileExtsLabel: '.gba',
      accentHex: '#7c3aed',
      accentGoldHex: '#6d28d9',
      // Sibling upload to the Game Boy item above: flat per-game .zip.
      // `nointro.gba` looks live but is `is_dark: true`, so every proxy
      // 404s on the directory listing.
      iaBaseUrl: 'https://archive.org/download/theentiregameboyadvancecollection',
      iaDescriptionPrefix: 'Game Boy Advance game',
      iaPreferMetadata: true,
      howto: [
        'This is Game Boy Advance, not Game Boy. For GB/GBC use the Game Boy page.',
        'Tap a game to play, or load your own .gba file.'
      ],
      romHelp:
        'This is GBA, not Game Boy. Carts are small and usually play in the browser. For GB/GBC use the Game Boy page.',
      controls: [
        { label: 'D-Pad', key: 'Arrow keys' },
        { label: 'A button', key: 'Z' },
        { label: 'B button', key: 'X' },
        { label: 'L / R', key: 'Q / W' },
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

    ngp: {
      id: 'ngp',
      title: 'Neo Geo Pocket',
      subtitle: 'NGP & Color',
      emoji: '🟠',
      // EmulatorJS core → mednafen_ngp (original + Color carts).
      ejsCore: 'ngp',
      fileAccept: '.ngp,.ngc,.zip,.7z',
      fileExtsLabel: '.ngp / .ngc',
      // SNK orange — distinct from arcade yellow so the hub tiles don't collide.
      accentHex: '#f97316',
      accentGoldHex: '#c2410c',
      // Flat per-game zips (same Ghostware shape as the arcade Neo Geo item).
      iaBaseUrl: 'https://archive.org/download/Neo-GeoPocketColorRomCollectionByGhostware',
      iaDescriptionPrefix: 'Neo Geo Pocket Color game',
      howto: [
        'This is Neo Geo Pocket / Color — the handheld. For AES/MVS arcade, use Neo Geo.',
        'Tap a game to play, or load your own .ngp / .ngc file.'
      ],
      romHelp:
        'This is Neo Geo Pocket, not the arcade AES/MVS. Carts are small and usually play in the browser. For arcade titles use the Neo Geo page.',
      controls: [
        { label: 'D-Pad', key: 'Arrow keys' },
        { label: 'A button', key: 'Z' },
        { label: 'B button', key: 'X' },
        { label: 'Option', key: 'V' },
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

    n64: {
      id: 'n64',
      title: 'N64',
      subtitle: 'Nintendo 64',
      emoji: '🎲',
      // EmulatorJS resolves `n64` to mupen64plus_next (parallel-n64 on iOS).
      ejsCore: 'n64',
      fileAccept: '.z64,.n64,.v64,.zip,.7z',
      fileExtsLabel: '.z64 / .n64 / .v64',
      // Nintendo 64 logo red and deep blue.
      accentHex: '#e60012',
      accentGoldHex: '#1d4ed8',
      // Flat, per-game BigEndian ROMs. Files are usually 8–64 MB, so try
      // the proxy first but always offer the direct Archive download too.
      iaBaseUrl: 'https://archive.org/download/pack-roms-nintendo-64-eu-us-jap',
      iaDescriptionPrefix: 'Nintendo 64 game',
      iaFileExtensions: ['.z64'],
      iaBinaryTimeout: 180000,
      iaAllowExternalDownload: true,
      howto: [
        'Tap a game, then Play in browser.',
        'If it hangs, tap Download instead, wait for the file, then Load saved ROM.',
        'A gamepad helps. Keyboard still works for menus.'
      ],
      romHelp:
        'These games are big (often 8–64 MB). If Play in browser times out, use Download instead, then Load saved ROM.',
      controls: [
        { label: 'Analog stick', key: 'Arrow keys' },
        { label: 'A / B', key: 'X / Z' },
        { label: 'C buttons', key: 'I / J / K / L' },
        { label: 'L / R', key: 'Q / E' },
        { label: 'Z trigger', key: 'Tab' },
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
      // Disc images are 100–500+ MB. Direct play is best-effort; downloading
      // locally remains available when browser proxies cannot ferry the file.
      iaBaseUrl: 'https://archive.org/download/CuratedPSXRedumpCHDs',
      iaDescriptionPrefix: 'PlayStation game',
      iaFileExtensions: ['.chd'],
      iaPreferMetadata: true,
      iaExternalDownload: true,
      iaAllowInBrowser: true,
      iaBinaryTimeout: 300000,
      iaMaxRetries: 1,
      biosRequired: true,
      // Canonical name for pcsx_rearmed; IA source file is renamed on fetch.
      biosFileName: 'scph5501.bin',
      biosStorageKey: 'ps1',
      // PlayStationBIOSFilesNAEUJP returns 401; nested zip path works.
      biosIaBaseUrl: 'https://archive.org/download/PlayStationBios/PlayStation%20Bios.zip',
      biosIaFileName: 'SCPH-7001.bin',
      biosHelp:
        'US BIOS auto-loads once, then stays in this browser. EU/JP: load scph5502.bin / scph5500.bin manually.',
      howto: [
        'Wait for BIOS “ready”.',
        'Browse Collection → Play in browser, or Download instead then Load local disc.',
        'Use Save (F5) / Load (F9) on the bar — that is a quick save, not the in-game memory card menu.',
        'Gamepad recommended.'
      ],
      romHelp:
        'PS1 discs are large. If Play in browser times out, Download instead, then Load local disc. F5 quick-saves; F9 loads it. That is not the in-game memory card menu.',
      showSaveStates: true,
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
