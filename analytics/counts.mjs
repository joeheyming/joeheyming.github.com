// Play counts — one Google Form row per started game, mod, or show.
//
// This is the successor to the scrapped presence heartbeats. Presence
// posted an anonymous id every minute so the site could say who was
// online. This posts once, when playback actually starts, and the sheet
// keeps a running total. No visitor id.
//
// Writes — POST to the form's formResponse URL (no-cors).
// Reads  — the Counts tab via the public gviz JSON endpoint.
//
// A page opts in with heymingAnalytics.enable('play-counts'). Loading
// this module is that opt-in; it does not check the URL.
//
// Until the placeholders below are replaced, recording no-ops and the
// public page explains that the form is not wired up yet.
//
// One-time setup (the form and the spreadsheet are both named analytics):
//
// 1. Create a Google Form named analytics with six short-answer questions,
//    titled exactly:
//      app, kind, id, name, parent, website
//    website is the honeypot: not required. parent is not required.
//    The other four are required.
// 2. Responses → link a spreadsheet named analytics.
//    Share the sheet: Anyone with the link → Viewer.
// 3. Extensions → Apps Script → paste analytics/tally.local.gs, save.
//    Run installTrigger once. onFormSubmit tallies Form Responses 1 into
//    the Counts tab, then deletes those rows. Counts is one row per play.
// 4. Send → prefilled link. Copy each entry.NNNNNNNN into entryIds.
//    formActionUrl is https://docs.google.com/forms/d/e/<FORM_ID>/formResponse
//    sheetId is the spreadsheet id between /spreadsheets/d/ and /edit.

const ROM_EXT =
  /\.(zip|7z|chd|pbp|iso|cue|bin|gba|nes|sfc|smc|md|gen|n64|z64|v64|gb|gbc|nds|gg|ngp|ngc|swf|32x)$/i;

const ID_RE = /^[a-z0-9][a-z0-9:_|-]{0,95}$/;

const KINDS = {
  emulator: new Set(['console', 'game']),
  doom: new Set(['flavor']),
  watch: new Set(['movie', 'show', 'episode']),
  stepmania: new Set(['song'])
};

const CACHE_KEY = 'heyming-play-counts-v1';
const CACHE_MS = 120000;
const DEDUPE_MS = 2000;
const SITE_LIMIT = 8;

export const CONFIG = {
  formActionUrl:
    'https://docs.google.com/forms/d/e/1FAIpQLScofWTub-sqgHSpV6VbSnBWLCTfnafIAClXHk8nUMmPvUJbpA/formResponse',
  entryIds: {
    app: 'entry.932545744',
    kind: 'entry.477995220',
    id: 'entry.239470660',
    name: 'entry.1258832835',
    parent: 'entry.806446330',
    honeypot: 'entry.593284956'
  },
  sheetId: '1DkHeVQf6C8d636fHyTqlLDTkL8laXtuMUlbnUguos84',
  countsTab: 'Counts'
};

/**
 * @param {typeof CONFIG} [cfg]
 */
export function isConfigured(cfg = CONFIG) {
  return (
    !String(cfg.formActionUrl || '').includes('YOUR_FORM_ID') &&
    !String(cfg.sheetId || '').includes('YOUR_SHEET_ID') &&
    !String(cfg.entryIds && cfg.entryIds.app).includes('111111111')
  );
}

/**
 * @param {string} hostname
 * @param {string} [userAgent]
 */
export function isLocalDevHost(hostname, userAgent = '') {
  const h = String(hostname || '');
  if (h === 'localhost' || h === '::1' || h === '') return true;
  if (
    /^(?:127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+)$/.test(
      h
    )
  ) {
    return true;
  }
  if (/\.local$/.test(h)) return true;
  if (/HeadlessChrome|Playwright/i.test(userAgent)) return true;
  return false;
}

/**
 * @param {string} value
 */
export function slugPart(value) {
  return String(value || '')
    .replace(ROM_EXT, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * @param {string} value
 */
export function cleanName(value) {
  let text = '';
  for (const ch of String(value || '')) {
    text += ch.charCodeAt(0) < 32 ? ' ' : ch;
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * @param {string} consoleId
 * @param {string} title
 */
export function gameId(consoleId, title) {
  const console = slugPart(consoleId).slice(0, 24);
  const game = slugPart(title).slice(0, 60) || 'game';
  return `${console}:${game}`;
}

/**
 * @param {number} n
 */
function pad2(n) {
  return String(Number(n) || 0).padStart(2, '0');
}

/**
 * @param {string} showId
 * @param {number} season
 * @param {number} episode
 */
export function episodeId(showId, season, episode) {
  return `${slugPart(showId)}|s${pad2(season)}e${pad2(episode)}`;
}

/**
 * @param {string} pathname
 */
export function consoleIdFromPath(pathname) {
  const m = String(pathname || '').match(/^\/emulator\/([a-z0-9]+)\/?(?:index\.html)?$/);
  if (!m || m[1] === 'index') return '';
  return m[1];
}

/**
 * @param {{ app?: string, kind?: string, id?: string, name?: string, parent?: string }} play
 */
export function isRecordable(play) {
  if (!play) return false;
  const kinds = KINDS[play.app || ''];
  if (!kinds || !kinds.has(play.kind || '')) return false;
  if (!ID_RE.test(play.id || '')) return false;
  if (play.parent && !ID_RE.test(play.parent)) return false;
  if (!play.name || play.name.length > 80) return false;
  return true;
}

/**
 * @param {typeof CONFIG.entryIds} entryIds
 * @param {{ app: string, kind: string, id: string, name: string, parent?: string }} play
 */
export function formBody(entryIds, play) {
  const body = new URLSearchParams();
  body.set(entryIds.app, play.app);
  body.set(entryIds.kind, play.kind);
  body.set(entryIds.id, play.id);
  body.set(entryIds.name, play.name);
  body.set(entryIds.parent, play.parent || '');
  body.set(entryIds.honeypot, '');
  return body;
}

/**
 * @param {string} consoleId
 * @param {string} gameName
 * @param {Record<string, { title?: string }>} [consoles]
 */
export function playsForEmulator(consoleId, gameName, consoles) {
  const id = slugPart(consoleId).slice(0, 24);
  if (!id) return [];
  const known = consoles && consoles[id];
  const consoleName = cleanName((known && known.title) || id) || id;
  const gameTitle = cleanName(String(gameName || '').replace(ROM_EXT, '')) || 'Game';
  return [
    { app: 'emulator', kind: 'console', id, name: consoleName, parent: '' },
    { app: 'emulator', kind: 'game', id: gameId(id, gameTitle), name: gameTitle, parent: id }
  ];
}

/**
 * @param {string} flavorId
 * @param {Array<{ id: string, title?: string, card?: string }>} [flavors]
 */
export function playsForDoom(flavorId, flavors) {
  const id = slugPart(flavorId);
  if (!id) return [];
  const known = (flavors || []).find((f) => f.id === flavorId || slugPart(f.id) === id);
  const name = cleanName((known && (known.title || known.card)) || flavorId) || id;
  return [{ app: 'doom', kind: 'flavor', id, name, parent: '' }];
}

/**
 * @param {{ movie?: boolean, id?: string, name?: string, season?: number, episode?: number, episodeTitle?: string }} input
 */
export function playsForWatch(input) {
  const id = slugPart(input && input.id);
  if (!id) return [];
  const name = cleanName(input.name) || id;
  if (input.movie) {
    return [{ app: 'watch', kind: 'movie', id, name, parent: '' }];
  }
  const epName = cleanName(
    input.episodeTitle
      ? `${name} S${pad2(input.season)}E${pad2(input.episode)} ${input.episodeTitle}`
      : `${name} S${pad2(input.season)}E${pad2(input.episode)}`
  );
  return [
    { app: 'watch', kind: 'show', id, name, parent: '' },
    {
      app: 'watch',
      kind: 'episode',
      id: episodeId(id, input.season, input.episode),
      name: epName || episodeId(id, input.season, input.episode),
      parent: id
    }
  ];
}

/**
 * One play per song start. The id is the song key (zenius_<id>, file_<name>, ...), so every
 * song counts on its own even when several share a pack.
 * @param {string} songKey
 * @param {string} [title]
 */
export function playsForStepmania(songKey, title) {
  const id = slugPart(songKey);
  if (!id) return [];
  const name = cleanName(String(title || '').replace(ROM_EXT, '')) || id;
  return [{ app: 'stepmania', kind: 'song', id, name, parent: '' }];
}

/**
 * @param {Array<{ app: string, kind: string, id: string, name: string, parent?: string }>} plays
 * @param {{ config: typeof CONFIG, isLocal: boolean, fetchImpl: (url: string, init: RequestInit) => Promise<unknown> }} deps
 */
export function submitPlays(plays, deps) {
  if (!isConfigured(deps.config) || deps.isLocal) return 0;
  let sent = 0;
  for (const play of plays) {
    if (!isRecordable(play)) continue;
    const body = formBody(deps.config.entryIds, play);
    Promise.resolve(
      deps.fetchImpl(deps.config.formActionUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
    ).catch(() => {});
    sent += 1;
  }
  return sent;
}

/**
 * @param {string} text
 */
export function countsFromGvizText(text) {
  const match = String(text || '').match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error('gviz parse failed');
  return countsFromGviz(JSON.parse(match[1]));
}

/**
 * @param {{ table?: { cols?: Array<{ label?: string }>, rows?: Array<{ c?: Array<{ v?: unknown } | null> }> } }} json
 */
export function countsFromGviz(json) {
  const table = json && json.table;
  const cols = ((table && table.cols) || []).map((col) =>
    String((col && col.label) || '')
      .trim()
      .toLowerCase()
  );
  const at = (name, fallback) => {
    const index = cols.indexOf(name);
    return index >= 0 ? index : fallback;
  };
  const appAt = at('app', 0);
  const kindAt = at('kind', 1);
  const idAt = at('id', 2);
  const nameAt = at('name', 3);
  const parentAt = at('parent', 4);
  const countAt = at('count', 5);
  /** @type {Array<{ app: string, kind: string, id: string, name: string, parent: string, count: number }>} */
  const out = [];
  for (const row of (table && table.rows) || []) {
    const cells = (row && row.c) || [];
    const value = (index) => {
      const cell = cells[index];
      if (cell == null || cell.v == null) return '';
      return cell.v;
    };
    const app = String(value(appAt)).trim();
    const kind = String(value(kindAt)).trim();
    const id = String(value(idAt)).trim();
    if (!app || app.toLowerCase() === 'app' || id.toLowerCase() === 'id') continue;
    const count = Number(value(countAt));
    if (!KINDS[app] || !KINDS[app].has(kind) || !ID_RE.test(id) || !Number.isFinite(count)) {
      continue;
    }
    const parent = String(value(parentAt) || '').trim();
    out.push({
      app,
      kind,
      id,
      name: cleanName(value(nameAt)) || id,
      parent,
      count: Math.max(0, Math.floor(count))
    });
  }
  return out;
}

/**
 * @param {Array<{ app: string, kind: string, id: string, name: string, parent: string, count: number }>} counts
 * @param {{ app?: string, kind?: string, parent?: string, limit?: number }} filter
 */
export function topCounts(counts, filter) {
  const limit = filter.limit == null ? SITE_LIMIT : filter.limit;
  return (counts || [])
    .filter((row) => row.count > 0)
    .filter((row) => !filter.app || row.app === filter.app)
    .filter((row) => !filter.kind || row.kind === filter.kind)
    .filter((row) => filter.parent == null || filter.parent === '' || row.parent === filter.parent)
    .slice()
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * @param {number} count
 */
export function formatCount(count) {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * @param {number} count
 */
export function playLabel(count) {
  return `${formatCount(count)} ${count === 1 ? 'play' : 'plays'}`;
}

/**
 * @param {Array<{ app: string, kind: string, id: string, count: number }>} counts
 */
function indexCounts(counts) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const row of counts || []) {
    map.set(`${row.app}|${row.kind}|${row.id}`, row.count);
  }
  return map;
}

/**
 * @param {ParentNode} el
 * @param {number} count
 * @param {Document} doc
 */
function setBadge(el, count, doc) {
  const badgeNode = Array.from(el.children).find(
    (node) => node.classList && node.classList.contains('play-count')
  );
  if (!count) {
    if (badgeNode) badgeNode.remove();
    return;
  }
  const text = formatCount(count);
  const label = playLabel(count);
  if (
    badgeNode &&
    badgeNode.textContent === text &&
    badgeNode.getAttribute('aria-label') === label
  ) {
    return;
  }
  const badge = badgeNode || doc.createElement('span');
  badge.className = 'play-count';
  badge.textContent = text;
  badge.setAttribute('aria-label', label);
  if (!badgeNode) el.appendChild(badge);
}

/**
 * @param {Document} doc
 * @param {Element} parent
 * @param {Element | null} before
 * @param {string} id
 * @param {string} title
 */
function ensureTop(doc, parent, before, id, title) {
  let section = doc.getElementById(id);
  if (!section) {
    section = doc.createElement('section');
    section.id = id;
    section.className = 'play-top';
    const heading = doc.createElement('h3');
    heading.textContent = title;
    const list = doc.createElement('ol');
    section.append(heading, list);
    if (before) parent.insertBefore(section, before);
    else parent.appendChild(section);
  }
  return section;
}

/**
 * @param {HTMLOListElement} list
 * @param {Array<{ id: string, name: string, count: number }>} rows
 * @param {Document} doc
 * @param {(row: { id: string, name: string, parent?: string, count: number }) => string} metaFor
 */
function fillList(list, rows, doc, metaFor) {
  const sig = rows.map((row) => `${row.id}:${row.count}:${row.name}`).join('\n');
  if (list.dataset.sig === sig) return;
  list.dataset.sig = sig;
  list.replaceChildren(
    ...rows.map((row) => {
      const item = doc.createElement('li');
      const name = doc.createElement('span');
      name.className = 'play-top-name';
      name.textContent = row.name || row.id;
      item.appendChild(name);
      const meta = metaFor(row);
      if (meta) {
        const metaEl = doc.createElement('span');
        metaEl.className = 'play-top-meta';
        metaEl.textContent = meta;
        item.appendChild(metaEl);
      }
      const count = doc.createElement('span');
      count.className = 'play-count';
      count.textContent = formatCount(row.count);
      count.setAttribute('aria-label', playLabel(row.count));
      item.appendChild(count);
      return item;
    })
  );
}

/**
 * @param {string} parent
 * @param {Record<string, { title?: string }>} consoles
 */
function consoleMeta(parent, consoles) {
  if (!parent) return '';
  const known = consoles && consoles[parent];
  return (known && known.title) || parent;
}

/**
 * @param {Document} doc
 * @param {Array<{ app: string, kind: string, id: string, name: string, parent: string, count: number }>} counts
 * @param {{ path?: string, search?: string, consoles?: Record<string, { title?: string }>, configured?: boolean, ready?: boolean }} env
 */
export function applyCounts(doc, counts, env) {
  const rows = counts || [];
  const lookup = indexCounts(rows);
  const consoles = env.consoles || {};
  const banner = doc.getElementById('play-counts-setup');
  if (banner) banner.hidden = env.configured !== false;

  doc.querySelectorAll('a.picker-tile').forEach((tile) => {
    const explicit = tile.getAttribute('data-console');
    const href = tile.getAttribute('href') || '';
    const fromHref = href.match(/\/emulator\/([a-z0-9]+)\/?$/);
    const id = slugPart(explicit || (fromHref && fromHref[1]) || '');
    if (!id || id === 'index') return;
    setBadge(tile, lookup.get(`emulator|console|${id}`) || 0, doc);
  });

  doc.querySelectorAll('.flavor-card[data-flavor]').forEach((card) => {
    const id = slugPart(card.getAttribute('data-flavor') || '');
    if (!id) return;
    const count = lookup.get(`doom|flavor|${id}`) || 0;
    setBadge(card, count, doc);
    if (!card.hasAttribute('data-play-label')) {
      card.setAttribute('data-play-label', card.getAttribute('aria-label') || '');
    }
    const base = card.getAttribute('data-play-label') || '';
    const label = count && base ? `${base}, ${playLabel(count)}` : base;
    if (base && card.getAttribute('aria-label') !== label) card.setAttribute('aria-label', label);
  });

  doc.querySelectorAll('.tv-show-card[data-show], .tv-show-card[data-movie]').forEach((card) => {
    const movie = card.getAttribute('data-movie');
    const show = card.getAttribute('data-show');
    const kind = movie ? 'movie' : 'show';
    const id = slugPart(movie || show || '');
    if (!id) return;
    const host = card.querySelector('.tv-show-meta') || card;
    setBadge(host, lookup.get(`watch|${kind}|${id}`) || 0, doc);
  });

  const params = new URLSearchParams(env.search || '');
  const showId = slugPart(params.get('show') || '');
  if (showId) {
    doc.querySelectorAll('.tv-ep-card').forEach((card) => {
      const season = Number(card.getAttribute('data-season'));
      const episode = Number(card.getAttribute('data-episode'));
      const id = episodeId(showId, season, episode);
      const host = card.querySelector('.tv-ep-meta') || card;
      setBadge(host, lookup.get(`watch|episode|${id}`) || 0, doc);
    });
  }

  const consoleId = consoleIdFromPath(env.path || '');
  if (consoleId) {
    const host = doc.querySelector('rom-browser');
    const parent = (host && host.parentElement) || doc.getElementById('boot-card');
    const games = topCounts(rows, { app: 'emulator', kind: 'game', parent: consoleId });
    if (parent && games.length) {
      const section = ensureTop(doc, parent, host, 'play-top-console', 'Most played');
      const list = section.querySelector('ol');
      if (list) fillList(list, games, doc, () => '');
    } else {
      doc.getElementById('play-top-console')?.remove();
    }
    doc.getElementById('play-top-games')?.remove();
  } else {
    const grid = doc.querySelector('.picker-grid');
    const games = topCounts(rows, { app: 'emulator', kind: 'game' });
    if (grid && grid.parentElement && games.length) {
      const section = ensureTop(
        doc,
        grid.parentElement,
        null,
        'play-top-games',
        'Most played games'
      );
      if (grid.nextElementSibling !== section) grid.after(section);
      const list = section.querySelector('ol');
      if (list) fillList(list, games, doc, (row) => consoleMeta(row.parent, consoles));
    } else {
      doc.getElementById('play-top-games')?.remove();
    }
    doc.getElementById('play-top-console')?.remove();
  }

  doc.querySelectorAll('[data-play-board]').forEach((board) => {
    const list = board.querySelector('ol');
    const empty = board.querySelector('.empty');
    if (!list) return;
    const ranked = topCounts(rows, {
      app: board.getAttribute('data-app') || '',
      kind: board.getAttribute('data-kind') || '',
      limit: Number(board.getAttribute('data-limit')) || 20
    });
    if (empty) empty.hidden = !(env.ready && env.configured && ranked.length === 0);
    const metaKind = board.getAttribute('data-meta');
    fillList(list, ranked, doc, (row) =>
      metaKind === 'console' ? consoleMeta(row.parent, consoles) : ''
    );
  });
}

/**
 * Badges inside the ROM browser shadow tree. The light-DOM pass cannot see it.
 * @param {ParentNode} root
 * @param {Array<{ app: string, kind: string, id: string, count: number }>} counts
 * @param {{ consoles?: Record<string, { title?: string }> }} [env]
 */
export function paintShadow(root, counts) {
  if (!root) return;
  const host = root.host || root;
  const consoleId = slugPart((host.getAttribute && host.getAttribute('console')) || '').slice(
    0,
    24
  );
  if (!consoleId || !host.ownerDocument) return;
  const lookup = indexCounts(counts);
  const doc = host.ownerDocument;
  root.querySelectorAll('.rom-card').forEach((card) => {
    const title = card.querySelector('.rom-title');
    const id = gameId(consoleId, (title && title.textContent) || '');
    setBadge(card, lookup.get(`emulator|game|${id}`) || 0, doc);
  });
}

const STYLE = `
.play-count {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--text-dim, var(--dim, var(--text-2, #8a8175)));
}
.picker-tile .play-count,
.flavor-card .play-count,
.tv-show-meta .play-count,
.tv-ep-meta .play-count,
.rom-card .play-count {
  margin-top: 4px;
}
.play-top {
  margin: 16px 0;
  text-align: left;
}
.play-top h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-dim, var(--dim, var(--text-2, #8a8175)));
}
.play-top ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
.play-top li,
[data-play-board] li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 4px 0;
  font-size: 14px;
}
.play-top-name { flex: 1 1 auto; min-width: 0; }
.play-top-meta {
  color: var(--text-dim, var(--dim, var(--text-2, #8a8175)));
  font-size: 12px;
}
.play-top .play-count,
[data-play-board] .play-count { margin-left: auto; }
`;

function install() {
  if (window.__heymingCountsInstalled) return;
  window.__heymingCountsInstalled = true;

  if (!document.getElementById('play-counts-style')) {
    const style = document.createElement('style');
    style.id = 'play-counts-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const state = {
    rows: /** @type {Array<{ app: string, kind: string, id: string, name: string, parent: string, count: number }>} */ ([]),
    ready: !isConfigured(CONFIG),
    recent: /** @type {Map<string, number>} */ (new Map())
  };

  function liveEnv() {
    /** @type {Record<string, { title?: string }>} */
    const consoles = {};
    const source = window.EMULATOR_CONSOLES || {};
    for (const id of Object.keys(source)) {
      consoles[id] = { title: source[id].title || id };
    }
    return {
      path: location.pathname,
      search: location.search,
      consoles,
      configured: isConfigured(CONFIG),
      ready: state.ready
    };
  }

  function paint() {
    const env = liveEnv();
    applyCounts(document, state.rows, env);
    document.querySelectorAll('rom-browser').forEach((el) => {
      if (el.shadowRoot) paintShadow(el.shadowRoot, state.rows);
    });
  }

  function allowNow(play) {
    const key = `${play.app}|${play.kind}|${play.id}|${play.parent || ''}`;
    const now = Date.now();
    const prev = state.recent.get(key) || 0;
    if (now - prev < DEDUPE_MS) return false;
    state.recent.set(key, now);
    return true;
  }

  function send(plays) {
    const fresh = plays.filter(allowNow);
    if (!fresh.length) return;
    submitPlays(fresh, { config: CONFIG, isLocal: false, fetchImpl: fetch });
  }

  function readCache(allowStale) {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.rows)) return null;
      if (!allowStale && Date.now() - Number(parsed.at) > CACHE_MS) return null;
      return parsed.rows;
    } catch {
      return null;
    }
  }

  function writeCache(rows) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows }));
    } catch {
      /* private mode */
    }
  }

  async function refresh() {
    if (!isConfigured(CONFIG)) {
      state.ready = true;
      paint();
      return;
    }
    const cached = readCache(false);
    if (cached && cached.length) {
      state.rows = cached;
      state.ready = true;
      paint();
      return;
    }
    try {
      const params = new URLSearchParams({
        tqx: 'out:json',
        sheet: CONFIG.countsTab,
        headers: '1'
      });
      const text = await fetch(
        `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?${params}`,
        { cache: 'no-store' }
      ).then((response) => response.text());
      state.rows = countsFromGvizText(text);
      writeCache(state.rows);
    } catch {
      state.rows = readCache(true) || [];
    }
    state.ready = true;
    paint();
  }

  window.heymingCounts = {
    recordEmulatorPlay(consoleId, gameName) {
      send(playsForEmulator(consoleId, gameName, liveEnv().consoles));
    },
    recordDoomPlay(flavorId) {
      send(playsForDoom(flavorId, window.DOOM_FLAVORS || []));
    },
    /**
     * @param {{ movie?: boolean, id?: string, name?: string, season?: number, episode?: number, episodeTitle?: string }} input
     */
    recordWatchPlay(input) {
      send(playsForWatch(input || {}));
    },
    /**
     * @param {string} songKey
     * @param {string} [title]
     */
    recordStepmaniaPlay(songKey, title) {
      send(playsForStepmania(songKey, title));
    },
    paint,
    paintShadow(root) {
      paintShadow(root, state.rows);
    }
  };

  const start = () => {
    paint();
    let timer = 0;
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(paint, 80);
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
  refresh();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  install();
}
