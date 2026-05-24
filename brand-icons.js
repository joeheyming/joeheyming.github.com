/*
 * Heyming OS — chrome icon registry.
 *
 * window.brandIcon('name') returns an SVG string with currentColor fill
 * / stroke. Pages drop the result inline:
 *
 *   element.innerHTML = window.brandIcon('joystick');
 *
 * Why a JS registry instead of an icon font / sprite sheet:
 *   1. Zero network. No extra fetch.
 *   2. currentColor works without filter hacks.
 *   3. Cheap to extend — add a key, ship.
 *   4. Works inside web component shadow DOM (string injection).
 *
 * Stroke icons are Lucide-style: 24x24, stroke-width 1.5, round caps,
 * fill none. Filled icons (social brand marks) are 24x24 paths with
 * fill currentColor.
 *
 * Stroke icons adapted from Lucide (ISC license). Brand marks (GitHub,
 * LinkedIn, X) are the official wordmarks rendered as SVG.
 */

(function () {
  function stroke(d) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" ' +
      'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' +
      d +
      '</svg>'
    );
  }

  function fill(d) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" ' +
      'viewBox="0 0 24 24" fill="currentColor" ' +
      'aria-hidden="true" focusable="false">' +
      d +
      '</svg>'
    );
  }

  const ICONS = {
    // ── Section / chrome ──────────────────────────────────────────────
    joystick: stroke(
      '<path d="M21 17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z"/>' +
        '<path d="M6 11V6a4 4 0 0 1 4-4h0"/>' +
        '<line x1="12" y1="13" x2="12" y2="6"/>' +
        '<circle cx="12" cy="5" r="2"/>'
    ),
    music: stroke(
      '<path d="M9 18V5l12-2v13"/>' +
        '<circle cx="6" cy="18" r="3"/>' +
        '<circle cx="18" cy="16" r="3"/>'
    ),
    wrench: stroke(
      '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.121 2.121 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'
    ),
    sparkles: stroke(
      '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>' +
        '<path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>'
    ),
    star: stroke(
      '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
    ),
    monitor: stroke(
      '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>' +
        '<line x1="8" y1="21" x2="16" y2="21"/>' +
        '<line x1="12" y1="17" x2="12" y2="21"/>'
    ),
    info: stroke(
      '<circle cx="12" cy="12" r="10"/>' +
        '<line x1="12" y1="16" x2="12" y2="12"/>' +
        '<line x1="12" y1="8" x2="12.01" y2="8"/>'
    ),
    play: stroke('<polygon points="6 3 20 12 6 21 6 3"/>'),
    search: stroke(
      '<circle cx="11" cy="11" r="8"/>' + '<line x1="21" y1="21" x2="16.65" y2="16.65"/>'
    ),
    settings: stroke(
      '<circle cx="12" cy="12" r="3"/>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
    ),
    'arrow-right': stroke(
      '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>'
    ),
    x: stroke('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),

    // ── Social brand marks ────────────────────────────────────────────
    linkedin: fill(
      '<path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.23 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.72V1.72C24 .77 23.21 0 22.23 0z"/>'
    ),
    github: fill(
      '<path d="M12 .3a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.1-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.31-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.13-.31-.54-1.54.12-3.21 0 0 1.01-.32 3.3 1.24a11.46 11.46 0 0 1 6 0c2.29-1.56 3.3-1.24 3.3-1.24.66 1.67.24 2.9.12 3.21.77.84 1.24 1.92 1.24 3.23 0 4.62-2.8 5.63-5.48 5.93.43.37.81 1.1.81 2.22v3.29c0 .32.21.69.83.58A12 12 0 0 0 12 .3"/>'
    ),
    'x-twitter': fill(
      '<path d="M18.244 2H21l-6.52 7.45L22 22h-6.18l-4.84-6.34L5.4 22H2.64l6.97-7.96L2 2h6.34l4.37 5.79L18.244 2zm-1.085 18h1.7L7.01 4H5.2l11.96 16z"/>'
    )
  };

  /**
   * @param {string} name
   * @param {{ size?: number, class?: string }} [opts]
   * @returns {string}
   */
  function brandIcon(name, opts) {
    const svg = ICONS[name];
    if (!svg) {
      console.warn('[brandIcon] unknown icon:', name);
      return '';
    }
    let out = svg;
    if (opts && opts.size) {
      out = out.replace(
        /width="\d+" height="\d+"/,
        'width="' + opts.size + '" height="' + opts.size + '"'
      );
    }
    if (opts && opts.class) {
      out = out.replace('<svg ', '<svg class="' + opts.class + '" ');
    }
    return out;
  }

  window.brandIcon = brandIcon;
  window.brandIconNames = Object.keys(ICONS);
})();
