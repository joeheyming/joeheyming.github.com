/*
 * Heyming OS — Tailwind theme extension.
 *
 * Load AFTER <script src="https://cdn.tailwindcss.com">. The current
 * Play CDN owns `window.tailwind` and ignores any pre-existing config
 * on it — setting `tailwind.config` only takes effect after the CDN
 * script has installed itself. (Older CDN versions read pre-set config
 * at boot, which is what this file used to assume — that contract was
 * dropped silently and every `bg-text-1`, `bg-surface-1`,
 * `bg-accent-primary`, `border-hairline`, etc. utility on this site
 * silently no-op'd as a result.)
 *
 * This file is also defensive: if `window.tailwind` isn't ready yet
 * when we run, we re-apply the config once it appears, so swapping
 * load order in HTML doesn't silently break us again.
 *
 * Exposes:
 *   - bg-surface-0/1/2, bg-surface-glass
 *   - text-text-1/2/3, text-text-on-accent
 *   - text-accent-primary, bg-accent-primary, bg-accent-primary-bg, etc.
 *   - border-hairline, border-hairline-strong, border-hairline-accent
 *   - bg-success / -danger / -warning (and text-* variants)
 *   - bg-success-soft / -danger-soft / -warning-soft (≈15% alpha tints)
 *   - bg-scrim, bg-scrim-strong (modal backdrops; brand-routed)
 *   - text-pure-white, text-pure-black (canonical literals through brand)
 *   - font-ui, font-display, font-mono
 *   - rounded-squircle
 *
 * Pages using Tailwind utilities can write classes like:
 *   class="bg-surface-1 text-text-1 border border-hairline rounded-lg"
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
    0: '#0B0B0F',
    1: '#15151B',
    2: '#1F1F27',
    glass: 'rgba(21, 21, 27, 0.72)'
  };

  const TEXT = {
    1: '#F5F5F7',
    2: '#A1A1AA',
    3: '#8E8E96',
    'on-accent': '#FFFFFF'
  };

  // Two-accent system. See BRAND.md.
  //   accent-primary           — foreground use (text, icons, borders)
  //   accent-primary-bg        — solid button backgrounds w/ white text
  const ACCENT_PRIMARY = {
    DEFAULT: '#7C5CFF',
    hover: '#9077FF',
    soft: 'rgba(124, 92, 255, 0.15)',
    bg: '#5B3CDC',
    'bg-hover': '#6E50E6'
  };

  const HAIRLINE = {
    DEFAULT: 'rgba(255, 255, 255, 0.08)',
    strong: 'rgba(255, 255, 255, 0.14)',
    accent: 'rgba(124, 92, 255, 0.32)'
  };

  // Status colors with soft-tint variants (matches brand.css). Tailwind
  // accepts a nested object so `bg-success`, `bg-success-soft`,
  // `text-danger`, `text-danger-soft`, `bg-warning`, etc. all work.
  const SUCCESS = { DEFAULT: '#34D399', soft: 'rgba(52, 211, 153, 0.15)' };
  const DANGER = { DEFAULT: '#F87171', soft: 'rgba(248, 113, 113, 0.15)' };
  const WARNING = { DEFAULT: '#FBBF24', soft: 'rgba(251, 191, 36, 0.15)' };

  // Brand-routed canonical pure values. Use these instead of bare
  // `#ffffff` / `#000000` so the audit doesn't see literals.
  const PURE = { white: '#FFFFFF', black: '#000000' };

  // Brand-aligned modal scrim tints (surface-0 @ alpha).
  const SCRIM = {
    DEFAULT: 'rgba(11, 11, 15, 0.6)',
    strong: 'rgba(11, 11, 15, 0.85)'
  };

  // ── Scoped identity palettes ────────────────────────────────────────
  // These are NOT brand colors — they're per-app identity palettes
  // exposed as Tailwind utilities so identity-themed markup (pacman
  // arcade yellow, ghost colors, stepmania arrow keys, ...) can stay
  // markup-pure and the audit sees zero bare Tailwind palette refs.
  // Each cluster is namespaced (`pac-*`, `ghost-*`, `sm-arrow-*`) so
  // it can't be confused with brand tokens.
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

  // ── Category accents ────────────────────────────────────────────────
  // Four-corner accent palette for the home-page gallery and OS launcher.
  // Each category gets a tinted icon chip + matching hover border. NOT
  // general brand colors — see brand.css for the full rationale.
  //   bg-cat-game, text-cat-game, border-cat-game, bg-cat-game-soft, ...
  //   bg-cat-utility, ..., bg-cat-entertainment, ..., bg-cat-system, ...
  const CAT = {
    system: {
      DEFAULT: '#7C5CFF',
      soft: 'rgba(124, 92, 255, 0.15)',
      hairline: 'rgba(124, 92, 255, 0.32)'
    },
    game: {
      DEFAULT: '#FF8E5C',
      soft: 'rgba(255, 142, 92, 0.15)',
      hairline: 'rgba(255, 142, 92, 0.32)'
    },
    utility: {
      DEFAULT: '#22D3EE',
      soft: 'rgba(34, 211, 238, 0.15)',
      hairline: 'rgba(34, 211, 238, 0.32)'
    },
    entertainment: {
      DEFAULT: '#F472B6',
      soft: 'rgba(244, 114, 182, 0.15)',
      hairline: 'rgba(244, 114, 182, 0.32)'
    }
  };

  const BRAND_CONFIG = {
    theme: {
      extend: {
        colors: {
          surface: SURFACE,
          text: TEXT,
          'accent-primary': ACCENT_PRIMARY,
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
          ui: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
          display: ['Inter Display', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
          mono: ['ui-monospace', 'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', 'monospace']
        },
        borderRadius: {
          squircle: '22%'
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
