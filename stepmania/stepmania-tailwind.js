/*
 * StepMania identity palette — Tailwind extension.
 *
 * Used by /stepmania/. NOT brand colors. Loaded AFTER /brand-tailwind.js
 * (order enforced in stepmania/index.html): brand-tailwind.js installs
 * the global brand config, this file deep-merges the sm-arrow.* keys
 * into theme.extend.colors so utility classes like `text-sm-arrow-left`,
 * `bg-sm-arrow-up`, `border-sm-arrow-down` compile.
 *
 * Lives here, not in brand-tailwind.js, because the four arrow tints
 * belong to StepMania's identity, not the Heyming OS brand. The
 * site-wide brand layer should not grow when a new themed app ships.
 *
 * See /pacman/pacman-tailwind.js for the same pattern; mirror it for
 * any future themed app.
 */

(function () {
  // StepMania arrow tints — pastel red / yellow / green / blue,
  // mapped to ←/→/↑/↓ on the simfile-input chip. AA-checked against
  // dark-tile backgrounds in stepmania/css/components/.
  const SM_ARROW = {
    left: '#FCA5A5',
    right: '#FDE68A',
    up: '#86EFAC',
    down: '#93C5FD'
  };

  function applyConfig() {
    if (!window.tailwind) return false;
    const cfg = (window.tailwind.config = window.tailwind.config || {});
    cfg.theme = cfg.theme || {};
    cfg.theme.extend = cfg.theme.extend || {};
    cfg.theme.extend.colors = Object.assign({}, cfg.theme.extend.colors, {
      'sm-arrow': SM_ARROW
    });
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
