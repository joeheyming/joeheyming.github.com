// Registry of every console the unified /emulator/ shell supports.
//
// One entry per console. Adding a new console (e.g. SNES, GBA) is just a
// matter of dropping a record in here and pushing a card on the picker —
// every other shared file (rom-browser, launch, internet-archive) reads
// from this object and reconfigures itself automatically.
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
