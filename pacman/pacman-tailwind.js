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
 * Lives here, not in brand-tailwind.js, because:
 *   - These hues belong to Pac-Man's identity, not the Heyming OS
 *     brand. The site-wide brand layer should not grow when a new
 *     themed app ships.
 *   - The Tailwind Play CDN reads `window.tailwind.config` whenever
 *     it JIT-compiles a utility class; per-app config that mutates
 *     the same object before <body> parses produces identical output
 *     to merging at the brand layer.
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
    const cfg = (window.tailwind.config = window.tailwind.config || {});
    cfg.theme = cfg.theme || {};
    cfg.theme.extend = cfg.theme.extend || {};
    cfg.theme.extend.colors = Object.assign({}, cfg.theme.extend.colors, {
      pac: PAC,
      ghost: GHOST
    });
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
