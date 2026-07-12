/*
 * StepMania identity palette — Tailwind extension.
 *
 * Used by /stepmania/. NOT brand colors. Loaded AFTER /brand-tailwind.js:
 * brand-tailwind.js installs the global brand config, this file rebuilds
 * the config tree with sm-arrow.* keys merged into theme.extend.colors so
 * utility classes like `text-sm-arrow-left`, `bg-sm-arrow-up`, and
 * `border-sm-arrow-down` compile.
 *
 * Implementation note — single top-level assignment matters.
 *
 * The Tailwind Play CDN wraps `window.tailwind.config` in a recursive
 * Proxy whose `set` trap fires a full JIT rebuild and inserts a fresh
 * <style> tag. That style insertion is itself a DOM mutation, which the
 * CDN's MutationObserver picks up and uses to schedule another rebuild.
 *
 * Because of that, mutating the live proxied config — e.g.
 *   cfg.theme = ...; cfg.theme.extend = ...; cfg.theme.extend.colors = ...
 * — fires the trap on every nested set, producing a cascade of rebuilds
 * per call. Stepmania's existing inline `neon.*` script (loaded after
 * this file) does the same chained-set pattern, and the page's runtime
 * constantly toggles class attributes that the CDN's class-attr observer
 * also reacts to. With the chained-set pattern, the combined storm was
 * heavy enough to freeze the tab during init.
 *
 * The fix here: read the current config (a single get; nested values
 * come back wrapped in proxies, but reads don't trigger Xf), build a
 * fresh merged tree off to the side, and assign it via ONE top-level
 * write. That fires the proxy's `set` once — exactly like
 * /brand-tailwind.js's `window.tailwind.config = BRAND_CONFIG`.
 *
 * See /pacman/pacman-tailwind.js for the same pattern.
 */

(function () {
  // StepMania arrow tints — light-mode defaults; screen.css overrides
  // these via --sm-arrow-* when dark theme is active.
  const SM_ARROW = {
    left: '#dc2626',
    right: '#a16207',
    up: '#15803d',
    down: '#1d4ed8'
  };

  function applyConfig() {
    if (!window.tailwind) return false;
    const cur = window.tailwind.config || {};
    const theme = cur.theme || {};
    const extend = theme.extend || {};
    const colors = extend.colors || {};
    window.tailwind.config = {
      ...cur,
      theme: {
        ...theme,
        extend: {
          ...extend,
          colors: { ...colors, 'sm-arrow': SM_ARROW }
        }
      }
    };
    return true;
  }

  if (applyConfig()) return;
  let attempts = 0;
  const interval = setInterval(function () {
    attempts++;
    if (applyConfig() || attempts > 100) {
      clearInterval(interval);
    }
  }, 20);
})();
