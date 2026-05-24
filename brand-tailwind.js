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
  //
  // Theme-aware tokens are wired to CSS custom properties via var(...)
  // rather than baked literals. brand.css owns the hex values and the
  // dark-theme override block, so utility classes like `bg-surface-1`
  // resolve through the cascade and theme-swap automatically when
  // <html data-theme="dark"> or prefers-color-scheme: dark is in effect.
  // Theme-stable canonical literals (PURE) stay as hex because they
  // don't theme-swap by design. Per-app identity palettes (pac.*,
  // ghost.*, sm-arrow.*) live in <app>/<app>-tailwind.js, loaded
  // after this file. See BRAND.md.
  const SURFACE = {
    0: 'var(--surface-0)',
    1: 'var(--surface-1)',
    2: 'var(--surface-2)'
    // glass intentionally absent — no glass on the new brand
  };

  const TEXT = {
    1: 'var(--text-1)',
    2: 'var(--text-2)',
    3: 'var(--text-3)',
    'on-accent': 'var(--text-on-accent)'
  };

  // Single-accent system. On light surfaces, foreground (text/icon) and
  // background (button-fill) roles share the same hue.
  //   accent-primary           — brand blue, links, CTAs, focus
  //   accent-primary-bg        — same blue, used on solid fills
  const ACCENT_PRIMARY = {
    DEFAULT: 'var(--accent-primary)',
    hover: 'var(--accent-primary-hover)',
    soft: 'var(--accent-primary-soft)',
    bg: 'var(--accent-primary-bg)',
    'bg-hover': 'var(--accent-primary-bg-hover)'
  };

  // Google '99 four primaries. Routed through brand.css so the dark
  // theme can lift them for legibility on near-black surfaces.
  const ACCENT_BLUE = 'var(--accent-blue)';
  const ACCENT_RED = 'var(--accent-red)';
  const ACCENT_YELLOW = 'var(--accent-yellow)';
  const ACCENT_GREEN = 'var(--accent-green)';

  const HAIRLINE = {
    DEFAULT: 'var(--hairline)',
    strong: 'var(--hairline-strong)',
    accent: 'var(--hairline-accent)'
  };

  // Status colors — themed via brand.css (light tier here, dark tier
  // under :root[data-theme="dark"] / prefers-color-scheme: dark).
  const SUCCESS = { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' };
  const DANGER = { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' };
  const WARNING = { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' };

  // Theme-stable canonical pure values — by BRAND.md policy these
  // never get redefined under a theme override; they're for shadow
  // and scrim math, not direct surface use.
  const PURE = { white: '#FFFFFF', black: '#000000' };

  // Modal scrim tints. Theme-aware: cream-page scrims sit at ~45-65%
  // near-black; dark-page scrims drop deeper to keep modals legible.
  const SCRIM = {
    DEFAULT: 'var(--scrim)',
    strong: 'var(--scrim-strong)'
  };

  // ── Category accents — the four primaries, semantic ─────────────────
  // Each app category claims one of the four primaries.
  //   bg-cat-game (red), text-cat-game, border-cat-game, bg-cat-game-soft
  //   bg-cat-utility (green), bg-cat-entertainment (yellow), bg-cat-system (blue)
  // All four tiers route through brand.css, so the soft-tint variants
  // and hairlines theme-swap with the rest of the surface ladder.
  const CAT = {
    system: {
      DEFAULT: 'var(--cat-system)',
      soft: 'var(--cat-system-soft)',
      hairline: 'var(--cat-system-hairline)'
    },
    game: {
      DEFAULT: 'var(--cat-game)',
      soft: 'var(--cat-game-soft)',
      hairline: 'var(--cat-game-hairline)'
    },
    utility: {
      DEFAULT: 'var(--cat-utility)',
      soft: 'var(--cat-utility-soft)',
      hairline: 'var(--cat-utility-hairline)'
    },
    entertainment: {
      DEFAULT: 'var(--cat-entertainment)',
      soft: 'var(--cat-entertainment-soft)',
      hairline: 'var(--cat-entertainment-hairline)'
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
