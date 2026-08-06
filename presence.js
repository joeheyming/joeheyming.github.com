// Site-wide presence heartbeats + gviz aggregation for the nav drawer.
//
// Loaded by nav.js (after /presence/config.js). Exposes window.heymingPresence.
// No-ops until presence/config.js placeholders are replaced (see presence/SETUP.md).

(function () {
  'use strict';

  const STORAGE_KEY = 'heyming-presence-id';
  const DEFAULT_HEARTBEAT_MS = 60000;
  const DEFAULT_ACTIVE_MS = 180000;

  function getConfig() {
    return window.HEYMING_PRESENCE_CONFIG || null;
  }

  function isConfigured() {
    if (typeof window.heymingPresenceIsConfigured === 'function') {
      return window.heymingPresenceIsConfigured(getConfig());
    }
    return false;
  }

  function getUuid() {
    try {
      let id = localStorage.getItem(STORAGE_KEY);
      if (id && /^[0-9a-f-]{36}$/i.test(id)) return id;
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
              const r = (Math.random() * 16) | 0;
              const v = c === 'x' ? r : (r & 0x3) | 0x8;
              return v.toString(16);
            });
      localStorage.setItem(STORAGE_KEY, id);
      return id;
    } catch {
      // Private mode / blocked storage — ephemeral id for this page load.
      if (!window.__heymingPresenceEphemeralId) {
        window.__heymingPresenceEphemeralId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
      }
      return window.__heymingPresenceEphemeralId;
    }
  }

  function buildFormBody(page) {
    const cfg = getConfig();
    const body = new URLSearchParams();
    body.set(cfg.entryIds.uuid, getUuid());
    body.set(cfg.entryIds.page, page);
    body.set(cfg.entryIds.honeypot, '');
    return body;
  }

  function ping(page) {
    if (!isConfigured() || !page) return;
    const cfg = getConfig();
    const body = buildFormBody(page);
    try {
      fetch(cfg.formActionUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      }).catch(() => {});
    } catch {
      // Ignore — presence is best-effort.
    }
  }

  function gvizUrl(tab) {
    const cfg = getConfig();
    return (
      'https://docs.google.com/spreadsheets/d/' +
      cfg.sheetId +
      '/gviz/tq?tqx=out:json&sheet=' +
      encodeURIComponent(tab)
    );
  }

  async function fetchPresenceRows() {
    const cfg = getConfig();
    const text = await fetch(gvizUrl(cfg.presenceTab || 'Presence'), {
      cache: 'no-store'
    }).then((r) => r.text());
    const m = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
    if (!m) throw new Error('gviz parse failed');
    const json = JSON.parse(m[1]);
    if (!json.table || !json.table.rows) return [];
    return json.table.rows.map((r) => (r.c || []).map((c) => (c == null ? null : c.v)));
  }

  function parseTs(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') {
      const m = v.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
      if (m) {
        return new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
      }
      const t = Date.parse(v);
      return Number.isNaN(t) ? 0 : t;
    }
    return 0;
  }

  /**
   * @param {string} currentPageKey
   * @returns {Promise<Record<string, number>>} active counts by page;
   *   current page excludes this browser's UUID when present.
   */
  async function fetchCounts(currentPageKey) {
    if (!isConfigured()) return {};
    const cfg = getConfig();
    const activeMs = cfg.activeWindowMs || DEFAULT_ACTIVE_MS;
    const now = Date.now();
    const selfId = getUuid();
    const rows = await fetchPresenceRows();

    /** @type {Map<string, { count: number, includesSelf: boolean }>} */
    const byPage = new Map();

    for (const row of rows) {
      const uuid = row[0] != null ? String(row[0]).trim() : '';
      const page = row[1] != null ? String(row[1]).trim() : '';
      const ts = parseTs(row[2]);
      // Skip header row if gviz returned it as data.
      if (!uuid || uuid.toLowerCase() === 'uuid' || !page || page.toLowerCase() === 'page') {
        continue;
      }
      if (!ts) continue;
      if (now - ts >= activeMs) continue;

      let entry = byPage.get(page);
      if (!entry) {
        entry = { count: 0, includesSelf: false };
        byPage.set(page, entry);
      }
      entry.count += 1;
      if (uuid === selfId) entry.includesSelf = true;
    }

    /** @type {Record<string, number>} */
    const out = {};
    for (const [page, entry] of byPage) {
      let n = entry.count;
      if (page === currentPageKey && entry.includesSelf) n -= 1;
      if (n > 0) out[page] = n;
    }
    return out;
  }

  let started = false;
  let heartbeatTimer = null;
  let currentPage = null;

  function clearHeartbeat() {
    if (heartbeatTimer != null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function scheduleHeartbeat(cfg) {
    clearHeartbeat();
    const ms = cfg.heartbeatMs || DEFAULT_HEARTBEAT_MS;
    heartbeatTimer = setInterval(() => {
      if (!currentPage || !isConfigured()) return;
      if (document.hidden) return;
      // In OS app iframes, only the focused window should claim the UUID.
      if (
        window.self !== window.top &&
        typeof document.hasFocus === 'function' &&
        !document.hasFocus()
      ) {
        return;
      }
      ping(currentPage);
    }, ms);
  }

  function start(pageKey) {
    if (started) {
      setPage(pageKey);
      return;
    }
    started = true;
    currentPage = pageKey || null;
    if (!isConfigured() || !currentPage) return;

    const cfg = getConfig();
    if (!document.hidden) {
      if (
        window.self === window.top ||
        typeof document.hasFocus !== 'function' ||
        document.hasFocus()
      ) {
        ping(currentPage);
      }
    }
    scheduleHeartbeat(cfg);

    document.addEventListener('visibilitychange', () => {
      if (!currentPage || !isConfigured()) return;
      if (!document.hidden) ping(currentPage);
    });

    // OS iframes: claim this app when the user focuses the window.
    if (window.self !== window.top) {
      window.addEventListener('focus', () => {
        if (currentPage && isConfigured() && !document.hidden) ping(currentPage);
      });
      window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;
        if (!event.data || event.data.type !== 'heyming-presence-claim') return;
        if (currentPage && isConfigured() && !document.hidden) ping(currentPage);
      });
    }
  }

  function setPage(pageKey) {
    currentPage = pageKey || null;
    if (started && isConfigured() && currentPage && !document.hidden) {
      ping(currentPage);
    }
  }

  window.heymingPresence = {
    start,
    setPage,
    ping: () => {
      if (currentPage) ping(currentPage);
    },
    fetchCounts,
    getUuid,
    isConfigured
  };
})();
