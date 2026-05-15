import {
  fetchListing,
  fetchModInfo,
  resolveDownloadUrl,
  downloadAndExtract
} from './moddb-browser-net.js';
import {
  SIZE_WARN_BYTES,
  SIZE_HARD_CAP_BYTES,
  MODDB_GAMES,
  formatBytes
} from './moddb-browser-parsers.js';
import { UZDoomLoader } from './uzdoom-loader.js';
import { UZDoomModdbIwad } from './moddb-iwad.js';

// ---- UI ---------------------------------------------------------------

let panelEl = null;
let listingState = {
  page: 1,
  sort: 'visitstotal-desc',
  kw: ''
};

function ensurePanel() {
  if (panelEl) return panelEl;
  panelEl = document.getElementById('moddbBrowser');
  if (!panelEl) {
    panelEl = document.createElement('div');
    panelEl.id = 'moddbBrowser';
    panelEl.className = 'moddb-panel hidden';
    document.body.appendChild(panelEl);
  }
  renderShell();
  return panelEl;
}

function renderShell() {
  panelEl.innerHTML =
    '<div class="moddb-header">' +
    '<div class="moddb-title">' +
    '<span class="moddb-emoji">🛒</span>' +
    '<h2>Browse Doom mods on moddb.com</h2>' +
    '</div>' +
    '<button type="button" class="moddb-close" data-role="close" aria-label="Close">×</button>' +
    '</div>' +
    '<div class="moddb-disclaimer">' +
    'Mods are streamed directly from moddb. ' +
    'Some mods will fail (Cloudflare, dead mirrors, oversize, .rar/.7z, ' +
    'engine incompatibility). Most GZDoom-family mods work; multiplayer ' +
    '(Zandronum) and prboom+ mods may not. Saves and IWAD downloads ' +
    'persist in this browser.' +
    '</div>' +
    '<form class="moddb-search" data-role="search">' +
    '<input type="search" name="kw" placeholder="Search Doom mods…" data-role="kw" />' +
    '<select name="sort" data-role="sort">' +
    '<option value="visitstotal-desc">Most popular</option>' +
    '<option value="ratingscore-desc">Highest rated</option>' +
    '<option value="dateup-desc">Recently updated</option>' +
    '<option value="released-desc">Recently released</option>' +
    '<option value="name-asc">Name (A→Z)</option>' +
    '</select>' +
    '<button type="submit" class="btn primary">Search</button>' +
    '</form>' +
    '<div class="moddb-status" data-role="status">Loading mod listing…</div>' +
    '<div class="moddb-grid" data-role="grid"></div>' +
    '<div class="moddb-pagination" data-role="pagination"></div>' +
    '<div class="moddb-detail hidden" data-role="detail"></div>';

  panelEl.querySelector('[data-role="close"]').addEventListener('click', close);
  panelEl.querySelector('[data-role="search"]').addEventListener('submit', (e) => {
    e.preventDefault();
    listingState.kw = panelEl.querySelector('[data-role="kw"]').value.trim();
    listingState.sort = panelEl.querySelector('[data-role="sort"]').value;
    listingState.page = 1;
    loadAndRenderListing();
  });
}

function setStatus(msg, kind) {
  const el = panelEl && panelEl.querySelector('[data-role="status"]');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'moddb-status' + (kind ? ' ' + kind : '');
}

async function loadAndRenderListing() {
  setStatus('Loading mod listing from moddb…');
  const grid = panelEl.querySelector('[data-role="grid"]');
  grid.innerHTML = '';
  panelEl.querySelector('[data-role="pagination"]').innerHTML = '';

  try {
    const result = await fetchListing(listingState);
    renderGrid(result.mods);
    renderPagination(result.pagination);
    setStatus(
      result.mods.length === 0
        ? 'No mods found. Try a different search.'
        : 'Showing ' + result.mods.length + ' mod(s).'
    );
  } catch (e) {
    console.warn('[moddb] listing failed:', e);
    setStatus(
      'Could not load mod listing: ' +
        (e.message || e) +
        ' — moddb is intermittent; try again in a minute.',
      'err'
    );
  }
}

function renderGrid(mods) {
  const grid = panelEl.querySelector('[data-role="grid"]');
  grid.innerHTML = '';
  mods.forEach((mod) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'moddb-card';
    card.dataset.slug = mod.slug;
    const game = MODDB_GAMES.find((g) => g.slug === mod.gameSlug);
    const badge = game
      ? '<span class="moddb-card-game" title="moddb game: ' +
        escapeAttr(game.name) +
        '">' +
        escapeHtml(game.name) +
        '</span>'
      : '';
    card.innerHTML =
      (mod.thumbUrl
        ? '<img class="moddb-card-thumb" loading="lazy" alt="" src="' +
          escapeAttr(mod.thumbUrl) +
          '" />'
        : '<div class="moddb-card-thumb placeholder">🎮</div>') +
      '<div class="moddb-card-body">' +
      '<div class="moddb-card-title">' +
      escapeHtml(mod.title) +
      badge +
      '</div>' +
      '<div class="moddb-card-summary">' +
      escapeHtml(mod.summary || '') +
      '</div>' +
      '</div>';
    card.addEventListener('click', () => openModDetail(mod));
    grid.appendChild(card);
  });
}

function renderPagination(p) {
  const el = panelEl.querySelector('[data-role="pagination"]');
  el.innerHTML = '';
  if (!p || p.last <= 1) return;
  const cur = listingState.page;

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.textContent = '← Prev';
  prev.disabled = cur <= 1;
  prev.addEventListener('click', () => {
    listingState.page = Math.max(1, cur - 1);
    loadAndRenderListing();
  });
  el.appendChild(prev);

  const label = document.createElement('span');
  label.className = 'moddb-page-label';
  label.textContent = 'Page ' + cur + ' / ' + Math.max(p.last, cur);
  el.appendChild(label);

  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = 'Next →';
  next.disabled = cur >= p.last;
  next.addEventListener('click', () => {
    listingState.page = cur + 1;
    loadAndRenderListing();
  });
  el.appendChild(next);
}

function openModDetail(mod) {
  const detail = panelEl.querySelector('[data-role="detail"]');
  detail.classList.remove('hidden');
  detail.innerHTML =
    '<div class="moddb-detail-header">' +
    '<button type="button" class="moddb-back" data-role="back">← Back to listing</button>' +
    '<a href="' +
    escapeAttr(mod.url) +
    '" target="_blank" rel="noopener" class="moddb-extlink">Open on moddb.com →</a>' +
    '</div>' +
    '<h3>' +
    escapeHtml(mod.title) +
    '</h3>' +
    '<div class="moddb-detail-status" data-role="detail-status">Loading mod details…</div>' +
    '<div class="moddb-detail-body" data-role="detail-body"></div>';
  detail.querySelector('[data-role="back"]').addEventListener('click', () => {
    detail.classList.add('hidden');
    detail.innerHTML = '';
  });
  panelEl.querySelector('[data-role="grid"]').classList.add('dimmed');

  fetchModInfo(mod.url).then(
    (info) => renderModDetail(mod, info),
    (e) => {
      const ds = detail.querySelector('[data-role="detail-status"]');
      if (ds) {
        ds.className = 'moddb-detail-status err';
        ds.textContent = 'Could not load mod page: ' + (e.message || e);
      }
    }
  );
}

function renderModDetail(mod, info) {
  const detail = panelEl.querySelector('[data-role="detail"]');
  const status = detail.querySelector('[data-role="detail-status"]');
  const body = detail.querySelector('[data-role="detail-body"]');
  status.textContent = '';
  status.className = 'moddb-detail-status';

  const iwadHint = guessIwadHint(info.summary);

  body.innerHTML =
    (info.screenshots.length > 0
      ? '<div class="moddb-shots">' +
        info.screenshots
          .slice(0, 4)
          .map((src) => '<img src="' + escapeAttr(src) + '" alt="" loading="lazy" />')
          .join('') +
        '</div>'
      : '') +
    '<p class="moddb-summary">' +
    escapeHtml(info.summary || mod.summary || '') +
    '</p>' +
    '<fieldset class="moddb-iwad">' +
    '<legend>IWAD</legend>' +
    '<label><input type="radio" name="iwad" value="freedoom1" checked /> Freedoom Phase 1 (bundled, free)</label>' +
    '<label><input type="radio" name="iwad" value="doom" /> Classic Doom (doom.wad, side-loaded)</label>' +
    '<label><input type="radio" name="iwad" value="doom2" /> Doom II (doom2.wad, side-loaded)</label>' +
    (iwadHint
      ? '<div class="moddb-iwad-hint">Hint from description: <em>' +
        escapeHtml(iwadHint) +
        '</em></div>'
      : '') +
    '</fieldset>' +
    '<div class="moddb-launch-row">' +
    '<button type="button" class="btn primary moddb-launch" data-role="launch">' +
    'Fetch & launch' +
    '</button>' +
    '<span class="moddb-launch-note" data-role="launch-note">' +
    'Mods are streamed via free CORS proxies — expect occasional failures.' +
    '</span>' +
    '</div>';

  body.querySelector('[data-role="launch"]').addEventListener('click', () => {
    const iwad = body.querySelector('input[name="iwad"]:checked').value;
    runFullLaunchFlow(mod, info, iwad).catch((e) => {
      console.warn('[moddb] launch failed:', e);
    });
  });
}

function guessIwadHint(summary) {
  if (!summary) return null;
  const s = summary.toLowerCase();
  if (/(doom\s*ii|doom2\.wad|doom 2)/i.test(s)) return 'looks like it expects doom2.wad';
  if (/(doom\s*1|the ultimate doom|knee-deep|doom\.wad)/i.test(s))
    return 'looks like it expects doom.wad';
  if (/freedoom/.test(s)) return 'mentions Freedoom — bundled IWAD should work';
  return null;
}

async function runFullLaunchFlow(mod, info, iwadChoice) {
  const detailStatus = panelEl.querySelector('[data-role="detail-status"]');
  detailStatus.className = 'moddb-detail-status';
  const setDetailStatus = (msg, kind) => {
    detailStatus.className = 'moddb-detail-status' + (kind ? ' ' + kind : '');
    detailStatus.textContent = msg || '';
  };

  if (!UZDoomLoader) {
    setDetailStatus('Engine not ready yet. Wait a few seconds and try again.', 'err');
    return;
  }
  if (!UZDoomModdbIwad) {
    setDetailStatus('IWAD helper missing.', 'err');
    return;
  }

  try {
    setDetailStatus('Resolving download from moddb…');
    const resolved = await resolveDownloadUrl(info);

    if (resolved.sizeBytes && resolved.sizeBytes > SIZE_WARN_BYTES) {
      const ok = window.confirm(
        'This mod is ' +
          formatBytes(resolved.sizeBytes) +
          '. Continue? (Mobile devices may run out of memory.)'
      );
      if (!ok) {
        setDetailStatus('Cancelled.', '');
        return;
      }
    }

    setDetailStatus('Fetching IWAD…');
    const iwad = await UZDoomModdbIwad.resolve(iwadChoice, (msg) => {
      setDetailStatus('IWAD: ' + msg);
    });

    setDetailStatus(
      resolved.sizeBytes
        ? 'Downloading mod (' + formatBytes(resolved.sizeBytes) + ')…'
        : 'Downloading mod…'
    );
    const mods = await downloadAndExtract(resolved, {
      allowOversize: resolved.sizeBytes > SIZE_HARD_CAP_BYTES
    });

    setDetailStatus('Priming engine with ' + mods.length + ' file(s)…');
    await UZDoomLoader.primeWith({ iwad, mods });

    setDetailStatus('Launching…');
    // Hide the panel first so the engine reveal/melt can take over.
    close();
    UZDoomLoader.launch();
  } catch (e) {
    console.warn('[moddb] launch failed:', e);
    setDetailStatus(
      'Failed: ' +
        (e.message || e) +
        ' — try downloading the .pk3 from moddb.com and uploading it manually.',
      'err'
    );
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) {
  return escapeHtml(s);
}

// ---- Public API --------------------------------------------------------

function open() {
  ensurePanel();
  panelEl.classList.remove('hidden');
  document.body.classList.add('moddb-open');
  if (!panelEl.dataset.loaded) {
    panelEl.dataset.loaded = '1';
    loadAndRenderListing();
  }
}
function close() {
  if (!panelEl) return;
  panelEl.classList.add('hidden');
  document.body.classList.remove('moddb-open');
  const detail = panelEl.querySelector('[data-role="detail"]');
  if (detail) {
    detail.classList.add('hidden');
    detail.innerHTML = '';
  }
  const grid = panelEl.querySelector('[data-role="grid"]');
  if (grid) grid.classList.remove('dimmed');
}

export { open, close };

export function wireModdbBrowserEntryPoints(openFn) {
  function wireEntryPoints() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('manual') === 'browse') openFn();
    } catch (_) {
      /* malformed query string is non-fatal */
    }
    const btn = document.getElementById('openModdbBrowserBtn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openFn();
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireEntryPoints, { once: true });
  } else {
    wireEntryPoints();
  }
}
