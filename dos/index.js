// dos/index.js — UI orchestration for the DOS Player.
//
// Surface model:
//   • Catalog grid — primary, one-click launchers for curated archive.org
//     items (see catalog.js). Each card knows its archiveId and an
//     optional bootHint; click → fetch → repack → cache → launch.
//   • Your library — only shows games loaded via the advanced URL /
//     file inputs. Catalog games stay represented by their card (a
//     "Cached" badge appears when their bundle is in IDB), so a single
//     game can't appear in both places.
//   • Add a custom game (disclosure) — collapsed by default. Houses the
//     URL paste box and the file dropzone for power users.

import {
  listBundles,
  getBundle,
  putBundle,
  deleteBundle,
  touchBundle,
  getSave,
  putSave,
  idFromUrl,
  idFromFile
} from './idb.js';
import { parseArchiveId, fetchArchiveItem } from './archive-org.js';
import { repackToJsdos } from './repack.js';
import { launchJsDos } from './jsdos-host.js';
import { CATALOG, bundleIdFor } from './catalog.js';

const els = {
  app: /** @type {HTMLElement} */ (document.getElementById('app')),
  launcher: /** @type {HTMLElement} */ (document.getElementById('launcher')),
  player: /** @type {HTMLElement} */ (document.getElementById('player')),
  status: /** @type {HTMLElement} */ (document.getElementById('status')),
  catalog: /** @type {HTMLElement} */ (document.getElementById('catalog')),
  librarySection: /** @type {HTMLElement} */ (document.getElementById('librarySection')),
  library: /** @type {HTMLElement} */ (document.getElementById('library')),
  tabs: /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.advanced-tabs .tab')),
  panels: /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('.advanced .tab-panel')
  ),
  urlInput: /** @type {HTMLInputElement} */ (document.getElementById('urlInput')),
  loadUrlBtn: /** @type {HTMLButtonElement} */ (document.getElementById('loadUrlBtn')),
  dropzone: /** @type {HTMLElement} */ (document.getElementById('dropzone')),
  fileInput: /** @type {HTMLInputElement} */ (document.getElementById('fileInput')),
  dosHost: /** @type {HTMLElement} */ (document.getElementById('dosHost')),
  exitBtn: /** @type {HTMLButtonElement} */ (document.getElementById('exitBtn')),
  fullscreenBtn: /** @type {HTMLButtonElement} */ (document.getElementById('fullscreenBtn')),
  playerTitle: /** @type {HTMLElement} */ (document.getElementById('playerTitle'))
};

/** @type {{ id: string, stop: () => Promise<void>, persistPending: Promise<Uint8Array | null> } | null} */
let activeSession = null;

const CATALOG_BY_ID = new Set(CATALOG.map((e) => bundleIdFor(e)));

// ---------- Status ----------

function setStatus(text, tone = '') {
  els.status.textContent = text || '';
  if (tone) els.status.setAttribute('data-tone', tone);
  else els.status.removeAttribute('data-tone');
}

function setStatusError(err) {
  console.error('[dos]', err);
  setStatus((err && err.message) || String(err) || 'Something went wrong.', 'error');
}

// ---------- Tabs (advanced disclosure) ----------

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    els.tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
    els.panels.forEach((p) => p.classList.toggle('is-active', p.dataset.panel === name));
  });
});

// ---------- Catalog rendering ----------

async function renderCatalog() {
  els.catalog.innerHTML = '';
  const bundles = await listBundles();
  const bundleIds = new Set(bundles.map((b) => b.id));

  for (const entry of CATALOG) {
    const card = buildCatalogCard(entry, bundleIds.has(bundleIdFor(entry)));
    els.catalog.appendChild(card);
  }
}

/**
 * @param {import('./catalog.js').CatalogEntry} entry
 * @param {boolean} isCached
 */
function buildCatalogCard(entry, isCached) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  card.dataset.accent = entry.accent;
  card.dataset.catalogId = entry.id;
  card.setAttribute('aria-label', `Play ${entry.name}`);

  const icon = document.createElement('div');
  icon.className = 'card-icon';
  icon.textContent = entry.icon;

  const name = document.createElement('h3');
  name.className = 'card-name';
  name.textContent = entry.name;

  const meta = document.createElement('p');
  meta.className = 'card-meta';
  meta.textContent = `${entry.year} · ${entry.genre}`;

  const blurb = document.createElement('p');
  blurb.className = 'card-blurb';
  blurb.textContent = entry.blurb;

  const cta = document.createElement('div');
  cta.className = 'card-cta';

  const action = document.createElement('span');
  action.className = 'card-action';
  action.textContent = isCached ? '▶ Resume' : '▶ Play';

  const badge = document.createElement('span');
  badge.className = 'card-badge';
  if (isCached) {
    badge.dataset.state = 'cached';
    badge.textContent = 'Cached';
  } else {
    badge.textContent = 'Archive.org';
  }

  cta.appendChild(action);
  cta.appendChild(badge);

  card.appendChild(icon);
  card.appendChild(name);
  card.appendChild(meta);
  card.appendChild(blurb);
  card.appendChild(cta);

  card.addEventListener('click', () => {
    loadCatalogEntry(entry, card).catch((err) => {
      revertCardState(card, isCached);
      setStatusError(err);
    });
  });

  return card;
}

/**
 * Swap card chrome between Play/Resume/Loading. Pass through a
 * card-local progress bar so downloads have a per-card affordance.
 *
 * `percent < 0` switches the bar into an indeterminate (animated)
 * state for cases where we can't compute a real percentage — i.e.
 * proxy-buffered downloads.
 */
function setCardLoading(card, label, percent) {
  card.dataset.state = 'loading';
  const action = card.querySelector('.card-action');
  if (action) action.textContent = label;

  let progress = /** @type {HTMLElement | null} */ (card.querySelector('.card-progress'));
  if (!progress) {
    progress = document.createElement('div');
    progress.className = 'card-progress';
    const fill = document.createElement('span');
    progress.appendChild(fill);
    card.appendChild(progress);
  }
  const fill = /** @type {HTMLElement} */ (progress.firstElementChild);
  if (percent < 0) {
    progress.classList.add('is-indeterminate');
    fill.style.width = '';
  } else {
    progress.classList.remove('is-indeterminate');
    fill.style.width = `${Math.max(0, Math.min(100, percent | 0))}%`;
  }
}

function revertCardState(card, isCached) {
  card.removeAttribute('data-state');
  const action = card.querySelector('.card-action');
  if (action) action.textContent = isCached ? '▶ Resume' : '▶ Play';
  const progress = card.querySelector('.card-progress');
  if (progress && progress.parentElement) progress.parentElement.removeChild(progress);
}

/**
 * Catalog click handler. Cached → launch directly. Otherwise we hit
 * archive.org metadata (so we can prefer their `emulator_start` over
 * our auto-detect), download with progress reported on the card, then
 * repack and persist.
 *
 * @param {import('./catalog.js').CatalogEntry} entry
 * @param {HTMLElement} card
 */
async function loadCatalogEntry(entry, card) {
  const bundleId = bundleIdFor(entry);
  const cached = await getBundle(bundleId);
  if (cached) {
    setCardLoading(card, '… Booting', 100);
    await launch(cached);
    return;
  }

  setCardLoading(card, '… Looking up', 5);
  setStatus(`Looking up archive.org/${entry.archiveId}…`);
  const item = await fetchArchiveItem(entry.archiveId);
  if (!item.bestPlayable) {
    throw new Error(`No playable file in archive.org item "${entry.archiveId}".`);
  }

  setCardLoading(card, '… Downloading', 10);
  setStatus(`Downloading "${entry.name}" from archive.org…`);
  const bytes = await downloadWithProgress(item.bestPlayable.downloadUrl, (pct) => {
    if (pct < 0) {
      // Proxy path — no per-chunk progress; animate the bar instead.
      setCardLoading(card, '… Via CORS proxy', -1);
      setStatus(`Downloading "${entry.name}" via CORS proxy (no progress available)…`);
      return;
    }
    // Map raw download into 10-90% of the card progress; reserve 0-10
    // for the metadata lookup above and 90-100 for repack/cache.
    const scaled = 10 + Math.floor((pct * 80) / 100);
    setCardLoading(card, '… Downloading', scaled);
    setStatus(`Downloading "${entry.name}"… ${pct}%`);
  });

  setCardLoading(card, '… Packing', 92);
  setStatus('Packing as .jsdos bundle…');
  // Catalog's bootHint wins; archive.org's emulator_start is the next
  // best signal; finally fall back to repack's auto-detect heuristic.
  const bootHint = entry.bootHint || item.emulatorStart || undefined;
  const packed = await repackToJsdos(bytes, bootHint ? { bootHint } : {});

  /** @type {import('./idb.js').BundleEntry} */
  const stored = {
    id: bundleId,
    name: entry.name,
    source: item.bestPlayable.downloadUrl,
    sourceLabel: `archive.org: ${item.id}`,
    bootCommand: packed.bootCommand,
    bytes: packed.bytes,
    size: packed.bytes.byteLength,
    addedAt: Date.now(),
    lastPlayedAt: Date.now()
  };
  await putBundle(stored);

  setCardLoading(card, '… Booting', 100);
  setStatus('');
  await launch(stored);
}

// ---------- Custom URL loader ----------

els.loadUrlBtn.addEventListener('click', async () => {
  const raw = els.urlInput.value.trim();
  if (!raw) {
    setStatus('Paste an archive.org URL or a direct .zip / .jsdos link.', 'error');
    return;
  }
  try {
    els.loadUrlBtn.disabled = true;
    await loadFromUrl(raw);
  } catch (err) {
    setStatusError(err);
  } finally {
    els.loadUrlBtn.disabled = false;
  }
});

els.urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.loadUrlBtn.click();
});

/**
 * Resolve a free-form URL to bundle id + download URL + display name.
 * For catalog entries we go through `loadCatalogEntry` instead so the
 * stable `catalog-<id>` key is used.
 */
async function resolveCustomSource(raw) {
  const archiveId = parseArchiveId(raw);
  if (archiveId) {
    setStatus(`Looking up archive.org/${archiveId}…`);
    const item = await fetchArchiveItem(raw);
    if (!item.bestPlayable) {
      throw new Error(`No playable file in archive.org item "${item.id}".`);
    }
    return {
      downloadUrl: item.bestPlayable.downloadUrl,
      id: idFromUrl(item.bestPlayable.downloadUrl),
      name: item.title,
      sourceLabel: `archive.org: ${item.id}`,
      bootHint: item.emulatorStart || undefined
    };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a URL.");
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error('Only http(s) URLs are supported.');
  }
  const last = url.pathname.split('/').filter(Boolean).pop() || 'game';
  return {
    downloadUrl: url.toString(),
    id: idFromUrl(url.toString()),
    name: decodeURIComponent(last).replace(/\.(zip|jsdos)$/i, ''),
    sourceLabel: url.hostname,
    bootHint: undefined
  };
}

async function loadFromUrl(raw) {
  const resolved = await resolveCustomSource(raw);

  const cached = await getBundle(resolved.id);
  if (cached) {
    setStatus(`Loading "${cached.name}" from local cache…`, 'success');
    await launch(cached);
    return;
  }

  setStatus(`Downloading ${resolved.sourceLabel}…`);
  const bytes = await downloadWithProgress(resolved.downloadUrl, (pct) => {
    if (pct < 0) {
      setStatus(`Routing ${resolved.sourceLabel} via CORS proxy…`);
    } else {
      setStatus(`Downloading ${resolved.sourceLabel}… ${pct}%`);
    }
  });

  setStatus('Packing as .jsdos bundle…');
  const packed = await repackToJsdos(
    bytes,
    resolved.bootHint ? { bootHint: resolved.bootHint } : {}
  );

  /** @type {import('./idb.js').BundleEntry} */
  const entry = {
    id: resolved.id,
    name: resolved.name,
    source: resolved.downloadUrl,
    sourceLabel: resolved.sourceLabel,
    bootCommand: packed.bootCommand,
    bytes: packed.bytes,
    size: packed.bytes.byteLength,
    addedAt: Date.now(),
    lastPlayedAt: Date.now()
  };
  await putBundle(entry);
  await launch(entry);
}

// ---------- File loader ----------

els.dropzone.addEventListener('click', () => els.fileInput.click());
els.dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    els.fileInput.click();
  }
});

els.fileInput.addEventListener('change', () => {
  const file = els.fileInput.files && els.fileInput.files[0];
  if (file) handleFile(file).catch(setStatusError);
  els.fileInput.value = '';
});

['dragenter', 'dragover'].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('is-dragging');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('is-dragging');
  })
);
els.dropzone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (!dt || !dt.files || dt.files.length === 0) return;
  handleFile(dt.files[0]).catch(setStatusError);
});

/** @param {File} file */
async function handleFile(file) {
  if (!/\.(zip|jsdos)$/i.test(file.name)) {
    setStatus('Drop a .zip or .jsdos file.', 'error');
    return;
  }

  const id = await idFromFile(file);
  const cached = await getBundle(id);
  if (cached) {
    setStatus(`Loading "${cached.name}" from local cache…`, 'success');
    await launch(cached);
    return;
  }

  setStatus(`Reading ${file.name}…`);
  const buf = await file.arrayBuffer();

  setStatus('Packing as .jsdos bundle…');
  const packed = await repackToJsdos(buf);

  /** @type {import('./idb.js').BundleEntry} */
  const entry = {
    id,
    name: file.name.replace(/\.(zip|jsdos)$/i, ''),
    sourceLabel: 'local file',
    bootCommand: packed.bootCommand,
    bytes: packed.bytes,
    size: packed.bytes.byteLength,
    addedAt: Date.now(),
    lastPlayedAt: Date.now()
  };
  await putBundle(entry);
  await launch(entry);
}

// ---------- Progress-aware download ----------

/**
 * Stream `response.body` with Content-Length-based progress. Falls
 * back to a single .arrayBuffer() + 100% tick when the response isn't
 * streamable (no body reader, or Content-Length missing).
 *
 * @param {Response} response
 * @param {(pct: number) => void} onProgress
 * @returns {Promise<Uint8Array>}
 */
async function streamResponse(response, onProgress) {
  const totalHeader = response.headers.get('Content-Length');
  const total = totalHeader ? Number(totalHeader) : 0;
  const reader = response.body && response.body.getReader ? response.body.getReader() : null;

  if (!reader || !total) {
    const buf = await response.arrayBuffer();
    onProgress(100);
    return new Uint8Array(buf);
  }

  /** @type {Uint8Array[]} */
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress(Math.min(99, Math.floor((received / total) * 100)));
    }
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  onProgress(100);
  return out;
}

/**
 * Two-stage download: try direct fetch first (so we get per-chunk
 * progress when CORS allows), and fall back to the shared
 * `window.proxyService` proxy chain if the browser blocks the
 * cross-origin request. Archive.org's `/download/{id}/{file}` endpoint
 * does NOT send `Access-Control-Allow-Origin`, so for our catalog
 * clicks the proxy path is the path that actually runs in practice.
 *
 * Crucially, we don't trust 2xx status as proof we got a zip.
 * Free CORS proxies routinely respond with `200 OK` and an HTML
 * error page (rate-limit notice, "request too large", login wall)
 * or a truncated body when the upstream exceeds their body limit.
 * We validate the ZIP local-file-header magic (`PK\x03\x04`, etc.)
 * after each attempt; on mismatch we mark the proxy bad and move on.
 *
 * Progress contract:
 *   • Direct path emits `0..99..100` based on Content-Length.
 *   • Proxy path emits `0..99..100` when the proxy passes through
 *     Content-Length (corsproxy.io usually does), or `-1` (= UI
 *     should switch to an indeterminate animation) when it doesn't.
 *
 * @param {string} url
 * @param {(pct: number) => void} onProgress
 * @returns {Promise<Uint8Array>}
 */
async function downloadWithProgress(url, onProgress) {
  const directBytes = await tryDirectZipFetch(url, onProgress);
  if (directBytes) return directBytes;

  if (!window.proxyService) {
    throw new Error(
      `Couldn't reach ${safeHost(url)} directly and no proxy fallback is configured.`
    );
  }

  console.warn('[dos] direct fetch unavailable, iterating CORS proxy chain');
  return await tryProxiedZipFetch(url, onProgress);
}

/**
 * Direct attempt. Returns the bytes on a clean success, `null` if the
 * network is unreachable (CORS / DNS / non-2xx) and the caller should
 * try proxies, and THROWS for terminal conditions (2xx response whose
 * body isn't actually a zip — that means the upstream is serving
 * something corrupt, and a proxy fetching the same URL won't fix it).
 *
 * Note: archive.org's "Stream Only" gate is checked earlier in
 * `archive-org.js` via the metadata endpoint, so we don't try to
 * detect it here.
 *
 * @param {string} url
 * @param {(pct: number) => void} onProgress
 * @returns {Promise<Uint8Array | null>}
 */
async function tryDirectZipFetch(url, onProgress) {
  let response;
  try {
    response = await fetch(url, { mode: 'cors' });
  } catch (err) {
    console.warn('[dos] direct fetch blocked, falling back to proxy chain:', err.message);
    return null;
  }

  if (!response.ok) {
    console.warn(`[dos] direct fetch ${response.status} from ${safeHost(url)}, trying proxies`);
    return null;
  }

  const bytes = await streamResponse(response, onProgress);
  if (!looksLikeZip(bytes)) {
    throw new Error(
      `Direct fetch returned ${bytes.byteLength} bytes of non-zip content ` +
        `from ${safeHost(url)} (starts with: ${previewBytes(bytes, 80)}). ` +
        'The upstream file may be corrupt.'
    );
  }
  return bytes;
}

/**
 * Walk every CORS proxy in the shared scoring order. Each attempt
 * streams `Content-Length`-aware progress (falls back to `-1`
 * indeterminate when the proxy strips the header). A 2xx response
 * whose body doesn't start with a zip magic prefix is treated as
 * a proxy failure, scored down, and the next proxy is tried.
 *
 * @param {string} url
 * @param {(pct: number) => void} onProgress
 * @returns {Promise<Uint8Array>}
 */
async function tryProxiedZipFetch(url, onProgress) {
  const proxyService = window.proxyService;
  const proxies = proxyService.getOrderedProxies();
  /** @type {string[]} */
  const failures = [];

  for (const proxy of proxies) {
    onProgress(-1);
    const proxyUrl = proxy + proxyService.encodeUrlForProxy(url);
    const started = Date.now();

    let response;
    try {
      response = await fetch(proxyUrl, {
        headers: { Accept: 'application/octet-stream,*/*' }
      });
    } catch (err) {
      failures.push(`${proxy} → ${err.message}`);
      proxyService.updateProxyScore(proxy, false);
      continue;
    }

    if (!response.ok) {
      // Don't try to infer "Stream Only" from a 403 here: the 403
      // could equally well come from the proxy itself (rate limit,
      // body-size cap, blocked-host policy). We can't tell upstream
      // 403 apart from proxy 403 from a single proxy attempt. Score
      // this proxy down and move on; if EVERY proxy returns the same
      // status the final error in `downloadWithProgress` will say so.
      failures.push(`${proxy} → HTTP ${response.status}`);
      proxyService.updateProxyScore(proxy, false);
      continue;
    }

    let bytes;
    try {
      bytes = await streamResponse(response, onProgress);
    } catch (err) {
      failures.push(`${proxy} → stream error: ${err.message}`);
      proxyService.updateProxyScore(proxy, false);
      continue;
    }

    if (!looksLikeZip(bytes)) {
      const preview = previewBytes(bytes, 80);
      console.warn(
        `[dos] proxy ${proxy} returned ${bytes.byteLength}B of non-zip content. ` +
          `Preview: ${preview}`
      );
      failures.push(`${proxy} → non-zip (${bytes.byteLength}B: ${preview.slice(0, 30)}…)`);
      proxyService.updateProxyScore(proxy, false);
      continue;
    }

    const took = Date.now() - started;
    proxyService.updateProxyScore(proxy, true, took);
    console.log(`[dos] proxy ${proxy} delivered ${bytes.byteLength}B in ${took}ms`);
    onProgress(100);
    return bytes;
  }

  throw new Error(
    `Couldn't fetch a valid zip from ${safeHost(url)}. ` +
      `Tried ${proxies.length} CORS proxies; all returned errors or non-zip content. ` +
      'This usually means the file is too large for free proxies (~10–50 MB cap), ' +
      'the upstream is corrupt, or the item is access-restricted. ' +
      'You can upload a local copy via "Add a custom game".\n\n' +
      `Proxy attempts: ${failures.join(' | ')}`
  );
}

/**
 * Zip local-file-header / EOCD / data-descriptor magic prefixes.
 * Any valid zip starts with one of these four-byte sequences.
 */
function looksLikeZip(bytes) {
  if (!bytes || bytes.byteLength < 4) return false;
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  // 03 04 = local file header (normal case)
  // 05 06 = end of central directory (empty zip)
  // 07 08 = spanned/split zip marker
  return bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07;
}

/**
 * Best-effort text snippet for diagnostics. Returns single-line UTF-8
 * with replacement chars; truncated at `n` bytes.
 *
 * @param {Uint8Array} bytes
 * @param {number} n
 * @returns {string}
 */
function previewBytes(bytes, n) {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const txt = decoder.decode(bytes.slice(0, n));
    return txt.replace(/\s+/g, ' ').trim();
  } catch {
    return '<binary>';
  }
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'remote';
  }
}

// ---------- Library (custom games only) ----------

async function renderLibrary() {
  const all = await listBundles();
  const custom = all.filter((b) => !CATALOG_BY_ID.has(b.id));

  if (custom.length === 0) {
    els.librarySection.hidden = true;
    els.library.innerHTML = '';
    return;
  }

  els.librarySection.hidden = false;
  els.library.innerHTML = '';
  for (const b of custom) {
    const row = document.createElement('div');
    row.className = 'library-row';

    const name = document.createElement('span');
    name.className = 'library-name';
    name.textContent = b.name;
    name.title = b.sourceLabel ? `${b.name} — ${b.sourceLabel}` : b.name;

    const size = document.createElement('span');
    size.className = 'library-size';
    size.textContent = formatBytes(b.size);

    const actions = document.createElement('div');
    actions.className = 'library-actions';

    const playBtn = document.createElement('button');
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', () => {
      launch(b).catch(setStatusError);
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      if (!confirm(`Remove "${b.name}" and its saves from this device?`)) return;
      await deleteBundle(b.id);
      renderAll();
    });

    actions.appendChild(playBtn);
    actions.appendChild(removeBtn);
    row.appendChild(name);
    row.appendChild(size);
    row.appendChild(actions);
    els.library.appendChild(row);
  }
}

function formatBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function renderAll() {
  await Promise.all([renderCatalog(), renderLibrary()]);
}

// ---------- Launch / teardown ----------

/** @param {import('./idb.js').BundleEntry} entry */
async function launch(entry) {
  if (activeSession) {
    await endActiveSession({ persistFirst: false });
  }

  setStatus(`Booting ${entry.name}…`);
  els.app.classList.add('is-playing');
  document.body.classList.add('is-playing');
  els.launcher.hidden = true;
  els.player.hidden = false;
  els.playerTitle.textContent = entry.name;

  try {
    const save = await getSave(entry.id);
    const handle = await launchJsDos(els.dosHost, entry.bytes, save ? save.bytes : null, (label) =>
      setStatus(label)
    );
    window.heymingAchievements?.unlockForCurrentApp('first-action');
    activeSession = {
      id: entry.id,
      stop: handle.stop,
      persistPending: handle.persist
    };
    await touchBundle(entry.id);
    setStatus('');
  } catch (err) {
    await returnToLauncher();
    setStatusError(err);
  }
}

els.exitBtn.addEventListener('click', () => {
  endActiveSession({ persistFirst: true }).catch(setStatusError);
});

els.fullscreenBtn.addEventListener('click', () => {
  const target = els.dosHost;
  if (!document.fullscreenElement && target.requestFullscreen) {
    target.requestFullscreen().catch((err) => console.warn('[dos] fullscreen failed:', err));
  } else if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {
      /* ignore */
    });
  }
});

async function endActiveSession({ persistFirst }) {
  if (!activeSession) {
    returnToLauncher();
    return;
  }
  const session = activeSession;
  activeSession = null;

  try {
    if (persistFirst) {
      setStatus('Saving game state…');
      const bytes = await session.persistPending;
      if (bytes && bytes.byteLength > 0) {
        await putSave(session.id, bytes);
      }
    }
  } catch (err) {
    console.warn('[dos] save failed:', err);
  }

  try {
    await session.stop();
  } catch (err) {
    console.warn('[dos] stop failed:', err);
  }

  await returnToLauncher();
  setStatus('Saved. Pick another game whenever.', 'success');
}

async function returnToLauncher() {
  els.app.classList.remove('is-playing');
  document.body.classList.remove('is-playing');
  els.player.hidden = true;
  els.launcher.hidden = false;
  await renderAll();
}

// Best-effort: if the tab closes mid-game, kick off persist() so the
// snapshot has a fighting chance to reach IDB before teardown.
window.addEventListener('pagehide', () => {
  if (!activeSession) return;
  const session = activeSession;
  activeSession = null;
  session.persistPending
    .then((bytes) => (bytes && bytes.byteLength ? putSave(session.id, bytes) : null))
    .catch(() => {
      /* nothing we can do */
    });
});

// ---------- First render ----------

renderAll();
