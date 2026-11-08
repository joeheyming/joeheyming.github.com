// Lean-back mode for /emulator/: TV / console / smart-TV detection,
// input modality, gamepad presence, COI readiness, and roving-tabindex
// for D-pad grids. Classic IIFE — matches the rest of the emulator shell.
(function () {
  'use strict';

  const TV_UA_RE = /PlayStation|Xbox|BRAVIA|SmartTV|SMART-TV|Tizen|Web0S|HbbTV|Silk|Quest/i;

  const KEY_NAVIGATION = new Set([
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Tab',
    'Enter',
    ' ',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'Backspace'
  ]);

  const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

  /**
   * @param {{ search?: string, userAgent?: string }} env
   * @returns {{ isTv: boolean, source: 'queryParam'|'userAgent'|null }}
   */
  function detectMode(env) {
    const params = new URLSearchParams(env.search || '');
    if (params.get('tv') === '1') return { isTv: true, source: 'queryParam' };
    if (TV_UA_RE.test(env.userAgent || '')) return { isTv: true, source: 'userAgent' };
    return { isTv: false, source: null };
  }

  const MODE = detectMode({
    search: window.location.search || '',
    userAgent: navigator.userAgent || ''
  });

  document.documentElement.dataset.mode = MODE.isTv ? 'tv' : 'web';

  let modality = MODE.isTv ? 'key' : 'pointer';
  document.documentElement.dataset.modality = modality;

  function setModality(next) {
    if (modality === next) return;
    modality = next;
    document.documentElement.dataset.modality = next;
  }

  window.addEventListener('keydown', (e) => {
    if (KEY_NAVIGATION.has(e.key)) setModality('key');
  });
  window.addEventListener('mousemove', () => setModality('pointer'), { passive: true });
  window.addEventListener('mousedown', () => setModality('pointer'), { passive: true });
  window.addEventListener('touchstart', () => setModality('pointer'), { passive: true });

  let hasGamepad = false;

  function refreshGamepad() {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      hasGamepad = Array.prototype.some.call(pads || [], (p) => p);
    } catch (_) {
      hasGamepad = false;
    }
    api.hasGamepad = hasGamepad;
    document.documentElement.dataset.gamepad = hasGamepad ? '1' : '0';
    window.dispatchEvent(new CustomEvent('emulator-gamepad-change', { detail: { hasGamepad } }));
  }

  window.addEventListener('gamepadconnected', () => {
    hasGamepad = true;
    api.hasGamepad = true;
    document.documentElement.dataset.gamepad = '1';
    window.dispatchEvent(
      new CustomEvent('emulator-gamepad-change', { detail: { hasGamepad: true } })
    );
  });
  window.addEventListener('gamepaddisconnected', () => refreshGamepad());
  // One deferred poll — some browsers only populate getGamepads() after a gesture,
  // but Xbox/PS often expose pads at load.
  setTimeout(refreshGamepad, 0);

  /**
   * Wait until COI is true or we've given the service worker a chance.
   * Reloads during the COI dance abort this page; soft-fail only after settle.
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>}
   */
  function whenCoiSettled(timeoutMs) {
    const budget = typeof timeoutMs === 'number' ? timeoutMs : 6000;
    return new Promise((resolve) => {
      if (window.crossOriginIsolated) {
        resolve(true);
        return;
      }
      if (!('serviceWorker' in navigator)) {
        resolve(false);
        return;
      }
      const start = Date.now();
      const tick = () => {
        if (window.crossOriginIsolated) {
          resolve(true);
          return;
        }
        if (Date.now() - start >= budget) {
          resolve(!!window.crossOriginIsolated);
          return;
        }
        setTimeout(tick, 250);
      };
      // Brief delay so the SW registration path can schedule a reload first.
      setTimeout(tick, 400);
    });
  }

  /**
   * Roving-tabindex grid navigation (WAI-ARIA pattern). Ported from
   * watch/modules/roving-tabindex.js as a classic-script helper.
   * @param {HTMLElement} grid
   * @param {{ selector?: string, wrap?: boolean }} [options]
   */
  function applyRovingTabindex(grid, options) {
    options = options || {};
    const selector = options.selector || ':scope > *';
    const wrap = options.wrap === true;

    let items = [];
    let cursor = 0;

    const scan = () => {
      items = Array.prototype.slice.call(grid.querySelectorAll(selector));
      if (cursor >= items.length) cursor = Math.max(0, items.length - 1);
      items.forEach((el, i) => {
        el.tabIndex = i === cursor ? 0 : -1;
      });
    };

    const layoutMap = () => {
      const byTop = new Map();
      for (const el of items) {
        const top = el.offsetTop;
        if (!byTop.has(top)) byTop.set(top, []);
        byTop.get(top).push(el);
      }
      const rows = Array.from(byTop.entries())
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1]);
      const rowOf = new Array(items.length);
      const colOf = new Array(items.length);
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          const idx = items.indexOf(rows[r][c]);
          rowOf[idx] = r;
          colOf[idx] = c;
        }
      }
      return { rows, rowOf, colOf };
    };

    const setCursor = (idx) => {
      if (idx === cursor || idx < 0 || idx >= items.length) return;
      items[cursor].tabIndex = -1;
      cursor = idx;
      items[cursor].tabIndex = 0;
      items[cursor].focus({ preventScroll: false });
    };

    // A window listener sees the shadow host, not the card. Follow focus
    // into the shadow, then let remote.js move past the edge of the grid.
    const keyTarget = (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
      let el = path && path.length ? path[0] : event.target;
      let guard = 0;
      while (el && el.shadowRoot && el.shadowRoot.activeElement && guard < 8) {
        el = el.shadowRoot.activeElement;
        guard += 1;
      }
      return el && el.nodeType === 1 ? el : null;
    };

    const itemIndex = (node) => {
      if (!node || node.nodeType !== 1 || !grid.contains(node)) return -1;
      return items.findIndex((el) => el === node || el.contains(node));
    };

    const onKeyDown = (e) => {
      if (!NAV_KEYS.has(e.key) || e.heymingHandled) return;
      if (items.length === 0) return;
      const target = keyTarget(e);
      if (!target) return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const idx = itemIndex(target);
      if (idx < 0) return;
      if (idx !== cursor && items[cursor]) {
        items[cursor].tabIndex = -1;
        cursor = idx;
        items[cursor].tabIndex = 0;
      }

      const { rows, rowOf, colOf } = layoutMap();
      const r = rowOf[cursor];
      const c = colOf[cursor];

      let next = cursor;
      if (e.key === 'ArrowRight') {
        if (c + 1 < rows[r].length) next = items.indexOf(rows[r][c + 1]);
        else if (wrap && r + 1 < rows.length) next = items.indexOf(rows[r + 1][0]);
      } else if (e.key === 'ArrowLeft') {
        if (c > 0) next = items.indexOf(rows[r][c - 1]);
        else if (wrap && r > 0) {
          const prev = rows[r - 1];
          next = items.indexOf(prev[prev.length - 1]);
        }
      } else if (e.key === 'ArrowDown') {
        if (r + 1 < rows.length) {
          const cell = rows[r + 1][Math.min(c, rows[r + 1].length - 1)];
          next = items.indexOf(cell);
        }
      } else if (e.key === 'ArrowUp') {
        if (r > 0) {
          const cell = rows[r - 1][Math.min(c, rows[r - 1].length - 1)];
          next = items.indexOf(cell);
        }
      } else if (e.key === 'Home') {
        next = 0;
      } else if (e.key === 'End') {
        next = items.length - 1;
      }

      if (next !== cursor) {
        e.preventDefault();
        // remote.js runs next, on document, and would skip every
        // tabindex=-1 sibling. Mark the key so it stays in the grid.
        // An arrow with no neighbor stays unmarked and can leave.
        e.heymingHandled = true;
        setCursor(next);
      }
    };

    const onFocusIn = (e) => {
      const idx = items.indexOf(e.target);
      if (idx >= 0 && idx !== cursor) {
        items[cursor].tabIndex = -1;
        cursor = idx;
        items[cursor].tabIndex = 0;
      }
    };

    scan();
    window.addEventListener('keydown', onKeyDown, true);
    grid.addEventListener('focusin', onFocusIn);

    return {
      refresh() {
        scan();
      },
      focusFirst() {
        if (items.length === 0) return;
        let active = document.activeElement;
        let guard = 0;
        while (active && active.shadowRoot && active.shadowRoot.activeElement && guard < 8) {
          active = active.shadowRoot.activeElement;
          guard += 1;
        }
        if (active && grid.contains(active)) return;
        items[cursor].focus({ preventScroll: false });
      },
      dispose() {
        window.removeEventListener('keydown', onKeyDown, true);
        grid.removeEventListener('focusin', onFocusIn);
        items.forEach((el) => {
          el.tabIndex = 0;
        });
      }
    };
  }

  const api = {
    isTv: MODE.isTv,
    source: MODE.source,
    hasGamepad: false,
    get isCoiReady() {
      return !!window.crossOriginIsolated;
    },
    detectMode,
    whenCoiSettled,
    applyRovingTabindex,
    refreshGamepad
  };

  window.emulatorLeanback = api;
})();
