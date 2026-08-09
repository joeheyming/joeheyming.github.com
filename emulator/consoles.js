// Registry of every console the unified /emulator/ shell supports.
//
// One entry per console. Adding a new console (e.g. SNES, GBA) is just a
// matter of dropping a record in here and pushing a card on the picker —
// every other shared file (rom-browser, launch, internet-archive) reads
// from this object and reconfigures itself automatically.
// Consoles that need a system BIOS (Neo Geo) set `biosRequired` +
// `biosFileName`; launch.js persists the upload in IndexedDB.
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
    }
  };

  // Read `?console=` query param and resolve it against the registry.
  // Returns null when the param is missing or unknown so the host page
  // can render its picker UI instead of guessing.
  function getConsoleId() {
    const params = new URLSearchParams(window.location.search);
    const requested = (params.get('console') || '').toLowerCase();
    return CONSOLES[requested] ? requested : null;
  }

  window.EMULATOR_CONSOLES = CONSOLES;
  window.getEmulatorConsole = function getEmulatorConsole() {
    const id = getConsoleId();
    return id ? CONSOLES[id] : null;
  };
  window.getEmulatorConsoleId = getConsoleId;
})();
