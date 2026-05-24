/*
 * Heyming OS — Tailwind theme extension (heyming-engineering).
 *
 * Load AFTER <script src="https://cdn.tailwindcss.com">. The Play CDN
 * owns `window.tailwind` and ignores any pre-existing config on it —
 * setting `tailwind.config` only takes effect after the CDN script has
 * installed itself. This file is also defensive: if `window.tailwind`
 * isn't ready yet when we run, we re-apply the config once it appears,
 * so swapping load order in HTML doesn't silently break us.
 *
 * Phase 1 of the brand pivot: tokens here mirror the new quirky-
 * engineering brand defined in brand.css — paper-cream surfaces,
 * Google '99 four-primary palette, serif display stack, no glass,
 * no squircle radius. See BRAND.md for the full system documentation.
 *
 * Exposes:
 *   - bg-surface-0/1/2 (cream / white / warm-recess)
 *   - text-text-1/2/3, text-text-on-accent
 *   - text-accent-primary, bg-accent-primary, bg-accent-primary-bg
 *   - bg-accent-blue / -red / -yellow / -green (the four primaries)
 *   - border-hairline, border-hairline-strong, border-hairline-accent
 *   - bg-success / -danger / -warning (and -soft variants)
 *   - bg-scrim, bg-scrim-strong (modal backdrops; brand-routed)
 *   - text-pure-white, text-pure-black (canonical literals through brand)
 *   - font-display (serif), font-ui (system-ui sans), font-mono
 *   - rounded-sm/-DEFAULT/-lg/-xl (2/4/8/8px), rounded-pill (999px)
 *
 * Pages using Tailwind utilities can write classes like:
 *   class="bg-surface-1 text-text-1 border border-hairline rounded"
 *
 * Pages using hand-rolled CSS read the same tokens via var() in brand.css.
 * Either way, one source of truth.
 *
 * If you add a token here, mirror it in brand.css and document it in BRAND.md.
 */

(function () {
  // Note: Tailwind CDN uses JIT — declaring a color makes its full
  // utility family (bg-, text-, border-, ring-, etc.) available.
  const SURFACE = {
    0: '#FAFAFA',
    1: '#FFFFFF',
    2: '#F0EEE8'
    // glass intentionally absent — no glass on the new brand
  };

  const TEXT = {
    1: '#1A1A1A',
    2: '#555555',
    3: '#6E6E6E',
    'on-accent': '#FFFFFF'
  };

  // Single-accent system. On light surfaces, foreground (text/icon) and
  // background (button-fill) roles share the same hue.
  //   accent-primary           — brand blue, links, CTAs, focus
  //   accent-primary-bg        — same blue, used on solid fills
  const ACCENT_PRIMARY = {
    DEFAULT: '#1A73E8',
    hover: '#1558B8',
    soft: '#E8F0FE',
    bg: '#1A73E8',
    'bg-hover': '#1558B8'
  };

  // Google '99 four primaries. Used per-letter on the wordmark, as
  // category accents, and as app-window title-bar tints.
  const ACCENT_BLUE = '#1A73E8';
  const ACCENT_RED = '#EA4335';
  const ACCENT_YELLOW = '#FBBC04';
  const ACCENT_GREEN = '#34A853';

  const HAIRLINE = {
    DEFAULT: '#E5E5E0',
    strong: '#C8C8C0',
    accent: 'rgba(26, 115, 232, 0.32)'
  };

  // Status colors — Material-aligned for light surfaces.
  const SUCCESS = { DEFAULT: '#188038', soft: '#E6F4EA' };
  const DANGER = { DEFAULT: '#D93025', soft: '#FCE8E6' };
  const WARNING = { DEFAULT: '#F29900', soft: '#FEF7E0' };

  // Brand-routed canonical pure values.
  const PURE = { white: '#FFFFFF', black: '#000000' };

  // Brand-aligned modal scrim tints — near-black for visibility on cream.
  const SCRIM = {
    DEFAULT: 'rgba(26, 26, 26, 0.45)',
    strong: 'rgba(26, 26, 26, 0.65)'
  };

  // ── Scoped identity palettes ────────────────────────────────────────
  // These are NOT brand colors — they're per-app identity palettes
  // exposed as Tailwind utilities so identity-themed markup (pacman
  // arcade yellow, ghost colors, stepmania arrow keys, ...) can stay
  // markup-pure. Each cluster is namespaced so it can't be confused with
  // brand tokens. These stay as-is across brand pivots.
  const PAC = {
    yellow: '#EAB308',
    'yellow-bright': '#FACC15',
    'yellow-glow': '#FDE047',
    cyan: '#22D3EE',
    'cyan-deep': '#06B6D4',
    'cyan-glow': '#67E8F9',
    red: '#EF4444',
    'red-hot': '#FF3030',
    amber: '#FFAA00',
    'orange-fruit': '#FB923C',
    radioactive: '#82E000'
  };
  const GHOST = {
    pinky: '#FF80FF',
    'pinky-soft': '#F9A8D4',
    pinky300: '#F0ABFC',
    inky: '#67E8F9',
    blinky: '#EF4444',
    clyde: '#FB923C'
  };
  const SM_ARROW = {
    left: '#FCA5A5',
    right: '#FDE68A',
    up: '#86EFAC',
    down: '#93C5FD'
  };

  // ── Category accents — the four primaries, semantic ─────────────────
  // Each app category claims one of the four primaries.
  //   bg-cat-game (red), text-cat-game, border-cat-game, bg-cat-game-soft
  //   bg-cat-utility (green), bg-cat-entertainment (yellow), bg-cat-system (blue)
  const CAT = {
    system: {
      DEFAULT: ACCENT_BLUE,
      soft: '#E8F0FE',
      hairline: 'rgba(26, 115, 232, 0.32)'
    },
    game: {
      DEFAULT: ACCENT_RED,
      soft: '#FCE8E6',
      hairline: 'rgba(234, 67, 53, 0.32)'
    },
    utility: {
      DEFAULT: ACCENT_GREEN,
      soft: '#E6F4EA',
      hairline: 'rgba(52, 168, 83, 0.32)'
    },
    entertainment: {
      DEFAULT: ACCENT_YELLOW,
      soft: '#FEF7E0',
      hairline: 'rgba(251, 188, 4, 0.4)'
    }
  };

  const BRAND_CONFIG = {
    theme: {
      extend: {
        colors: {
          surface: SURFACE,
          text: TEXT,
          'accent-primary': ACCENT_PRIMARY,
          'accent-blue': ACCENT_BLUE,
          'accent-red': ACCENT_RED,
          'accent-yellow': ACCENT_YELLOW,
          'accent-green': ACCENT_GREEN,
          hairline: HAIRLINE,
          success: SUCCESS,
          danger: DANGER,
          warning: WARNING,
          pure: PURE,
          scrim: SCRIM,
          pac: PAC,
          ghost: GHOST,
          'sm-arrow': SM_ARROW,
          cat: CAT
        },
        fontFamily: {
          display: [
            'Source Serif 4',
            'Source Serif Pro',
            'Lora',
            'Georgia',
            'Times New Roman',
            'serif'
          ],
          ui: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Verdana', 'sans-serif'],
          mono: [
            'JetBrains Mono',
            'IBM Plex Mono',
            'ui-monospace',
            'SF Mono',
            'Menlo',
            'Consolas',
            'monospace'
          ]
        },
        borderRadius: {
          sm: '2px',
          DEFAULT: '4px',
          lg: '8px',
          xl: '8px',
          pill: '999px'
          // squircle 22% intentionally deleted — too Apple-coded
        },
        boxShadow: {
          // Dual-ring focus, available as a Tailwind utility for any
          // surface that wants the focus look without :focus-visible.
          'hos-focus': '0 0 0 2px var(--focus-ring-inner), 0 0 0 6px var(--focus-ring-outer)'
        },
        transitionDuration: {
          hover: '150ms',
          modal: '220ms'
        }
      }
    }
  };

  function applyConfig() {
    if (!window.tailwind) return false;
    window.tailwind.config = BRAND_CONFIG;
    return true;
  }

  // Common case: CDN already loaded. Apply now and we're done.
  if (applyConfig()) return;

  // Fallback: page authored with the old load order (brand-tailwind
  // before the CDN). Poll briefly for `window.tailwind` to show up,
  // then apply. Bounded so a missing CDN doesn't spin forever.
  let attempts = 0;
  const interval = setInterval(function () {
    attempts++;
    if (applyConfig() || attempts > 100) {
      clearInterval(interval);
    }
  }, 20);
})();
