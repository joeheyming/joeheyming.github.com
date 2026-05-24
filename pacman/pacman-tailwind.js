/*
 * Pac-Man identity palette — Tailwind extension.
 *
 * Used by /pacman/ and /pacman-infinite/. NOT brand colors. Loaded
 * AFTER /brand-tailwind.js (the order is enforced by both index.html
 * files): brand-tailwind.js installs the global brand config, this
 * file deep-merges the pac.* and ghost.* keys into theme.extend.colors
 * so utility classes like `bg-pac-yellow`, `text-ghost-pinky-300`,
 * `border-pac-cyan/50` compile as expected.
 *
 * Lives here, not in brand-tailwind.js, because these hues belong to
 * Pac-Man's identity, not the Heyming OS brand. The site-wide brand
 * layer should not grow when a new themed app ships.
 *
 * Implementation note — single top-level assignment matters.
 *
 * The Tailwind Play CDN wraps `window.tailwind.config` in a recursive
 * Proxy whose `set` trap fires a full JIT rebuild and inserts a fresh
 * <style> tag. That style insertion is itself a DOM mutation, which the
 * CDN's MutationObserver picks up to schedule another rebuild. Mutating
 * the live config object in place — `cfg.theme = ...; cfg.theme.extend
 * = ...; cfg.theme.extend.colors = ...` — fires the trap on every
 * nested set, producing a cascading rebuild storm that on heavy pages
 * (e.g. /stepmania/, where an inline neon-palette script does the same
 * chained-set pattern after this file) was enough to freeze the tab.
 *
 * The fix: read the current config, build a fresh merged tree off to
 * the side, and assign it via ONE top-level write — exactly like
 * /brand-tailwind.js does. That fires the proxy's `set` once.
 *
 * If you add a new themed app, mirror this pattern: create
 * <app>/<app>-tailwind.js, load it AFTER /brand-tailwind.js in the
 * app's <head>, and keep the brand layer untouched.
 */

(function () {
  // Pac-Man — yellow chomper, cyan dash neon, fruit oranges, the
  // radioactive green from infinite-mode power pellets. red-soft is
  // intentionally generic enough that pacman-infinite uses it for
  // the "Hard" difficulty chip without reaching into another app's
  // palette.
  const PAC = {
    yellow: '#EAB308',
    'yellow-bright': '#FACC15',
    'yellow-glow': '#FDE047',
    cyan: '#22D3EE',
    'cyan-deep': '#06B6D4',
    'cyan-glow': '#67E8F9',
    red: '#EF4444',
    'red-hot': '#FF3030',
    'red-soft': '#FF7070',
    amber: '#FFAA00',
    'orange-fruit': '#FB923C',
    radioactive: '#82E000'
  };

  // Ghosts — Pinky / Inky / Blinky / Clyde with two pink tints for
  // the power-pellet UI in pacman-infinite.
  const GHOST = {
    pinky: '#FF80FF',
    'pinky-soft': '#F9A8D4',
    pinky300: '#F0ABFC',
    inky: '#67E8F9',
    blinky: '#EF4444',
    clyde: '#FB923C'
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
          colors: { ...colors, pac: PAC, ghost: GHOST }
        }
      }
    };
    return true;
  }

  // brand-tailwind.js + the CDN are normally already live by the time
  // we run, since this script loads after both. Defensive poll is for
  // pages that get the load order wrong (the brand layer ships the
  // same fallback).
  if (applyConfig()) return;
  let attempts = 0;
  const interval = setInterval(function () {
    attempts++;
    if (applyConfig() || attempts > 100) {
      clearInterval(interval);
    }
  }, 20);
})();
