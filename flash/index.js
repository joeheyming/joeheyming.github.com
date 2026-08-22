const IA_BASE_URL = 'https://archive.org/download/banned-from-equestria-daily-1.5';
const PAGE_TITLE = 'Flash Player — Play Classic Flash Games Online ⚡';

const fileInput = document.getElementById('fileInput');
const loadBtn = document.getElementById('loadBtn');
const loadBootBtn = document.getElementById('loadBootBtn');
const browseBtn = document.getElementById('browseBtn');
const browseBootBtn = document.getElementById('browseBootBtn');
const unloadBtn = document.getElementById('unloadBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const loadModal = document.getElementById('loadModal');
const playerWrap = document.getElementById('playerWrap');
const fileLabel = document.getElementById('fileLabel');
const stage = document.getElementById('stage');
const browserModal = document.getElementById('browserModal');
const closeBrowserBtn = document.getElementById('closeBrowserBtn');
const searchInput = document.getElementById('searchInput');
const contentArea = document.getElementById('contentArea');

/** @type {HTMLElement | null} */
let playerEl = null;
/** @type {string | null} */
let objectUrl = null;
/** @type {boolean} */
let isPlaying = false;
/** @type {ReturnType<typeof createIaClient> | null} */
let iaClient = null;
/** @type {Array<{ name: string, title: string, downloadUrl: string, fileExtension?: string, size?: string }>} */
let allSwfs = [];
/** @type {typeof allSwfs} */
let filteredSwfs = [];

function createIaClient() {
  if (!window.InternetArchiveRoms) return null;
  return new window.InternetArchiveRoms({
    baseUrl: IA_BASE_URL,
    descriptionPrefix: 'Classic Flash game',
    fileExtensions: ['.swf'],
    preferMetadata: true,
    binaryTimeout: 120000,
    maxRetries: 4
  });
}

function revokeObjectUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function openLoadModal() {
  if (!loadModal) return;
  loadModal.hidden = false;
}

function closeLoadModal() {
  if (!loadModal) return;
  loadModal.hidden = true;
}

function setPlayingUi(name) {
  isPlaying = true;
  closeLoadModal();
  closeBrowser(false);
  unloadBtn.disabled = false;
  fullscreenBtn.disabled = false;
  fileLabel.textContent = name || 'Loaded';
  document.title = name ? `${name} — Flash Player ⚡` : PAGE_TITLE;
}

function setIdleUi() {
  isPlaying = false;
  destroyPlayer();
  closeBrowser(false);
  openLoadModal();
  unloadBtn.disabled = true;
  fullscreenBtn.disabled = true;
  fileLabel.textContent = 'No file loaded';
  document.title = PAGE_TITLE;
}

function destroyPlayer() {
  revokeObjectUrl();
  if (playerEl && playerEl.parentNode) {
    playerEl.parentNode.removeChild(playerEl);
  }
  playerEl = null;
  playerWrap.replaceChildren();
}

function ensureRuffle() {
  if (!window.RufflePlayer || typeof window.RufflePlayer.newest !== 'function') {
    throw new Error('Ruffle failed to load. Check your network and try again.');
  }
  return window.RufflePlayer.newest();
}

/**
 * @param {Blob} blob
 * @param {string} name
 */
async function loadSwfBlob(blob, name) {
  destroyPlayer();

  const ruffle = ensureRuffle();
  playerEl = ruffle.createPlayer();
  playerEl.style.width = '100%';
  playerEl.style.height = '100%';
  playerWrap.appendChild(playerEl);

  objectUrl = URL.createObjectURL(blob);
  await playerEl.ruffle().load(objectUrl);
  setPlayingUi(name);
  window.heymingAchievements?.unlockForCurrentApp('first-action');

  if (window.trackEvent) {
    window.trackEvent('flash_swf_loaded', 'Flash', name.slice(0, 80), 0);
  }
}

/**
 * @param {File} file
 */
async function loadSwfFile(file) {
  if (!file) return;
  const name = file.name || 'movie.swf';
  const lower = name.toLowerCase();
  if (!lower.endsWith('.swf') && file.type !== 'application/x-shockwave-flash') {
    window.alert('Please choose a .swf Flash file.');
    return;
  }
  await loadSwfBlob(file, name);
}

function unload() {
  if (fileInput) fileInput.value = '';
  setIdleUi();
}

function openPicker() {
  fileInput.click();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fuzzyScore(text, query) {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 1;
  if (t.includes(q)) return 1000 + (1000 - t.indexOf(q));

  let ti = 0;
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      consecutive += 1;
      score += 10 + consecutive;
      qi += 1;
    } else {
      consecutive = 0;
    }
    ti += 1;
  }
  return qi === q.length ? score : 0;
}

function handleSearch(query) {
  const q = String(query || '').trim();
  if (!q) {
    filteredSwfs = allSwfs.slice();
  } else {
    filteredSwfs = allSwfs
      .map((swf) => ({ swf, score: fuzzyScore(swf.title || swf.name, q) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.swf.name.localeCompare(b.swf.name))
      .map((row) => row.swf);
  }
  renderSwfs(filteredSwfs);
}

function renderSwfs(swfs) {
  if (!contentArea) return;
  if (!swfs.length) {
    contentArea.innerHTML = '<div class="empty">No Flash games match that search.</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'swf-grid';

  for (const swf of swfs) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'swf-card';
    card.innerHTML = `
      <p class="swf-title">${escapeHtml(swf.title || swf.name)}</p>
      <p class="swf-meta">${escapeHtml(swf.size && swf.size !== 'Unknown' ? swf.size : '.swf')}</p>
    `;
    card.addEventListener('click', () => loadFromArchive(swf));
    grid.appendChild(card);
  }

  contentArea.replaceChildren(grid);
}

async function loadCollectionList() {
  if (!contentArea) return;
  contentArea.innerHTML = '<div class="loading">Loading collection…</div>';

  try {
    if (!iaClient) iaClient = createIaClient();
    if (!iaClient) throw new Error('Internet Archive client unavailable.');
    if (!window.proxyService) throw new Error('Proxy service not available.');

    allSwfs = await iaClient.fetchRomList();
    filteredSwfs = allSwfs.slice();
    renderSwfs(filteredSwfs);
  } catch (error) {
    console.error('Failed to list Flash collection:', error);
    const detail =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
    contentArea.innerHTML =
      '<div class="error">Failed to load Flash games from Internet Archive.' +
      `<div class="error-detail">${escapeHtml(
        detail
      )} Proxies can be flaky — retry often works.</div>` +
      '<div class="error-actions"><button type="button" class="btn btn-primary" data-action="retry-list">Retry</button></div></div>';
    contentArea.querySelector('[data-action="retry-list"]')?.addEventListener('click', () => {
      if (iaClient) iaClient.clearListCache();
      allSwfs = [];
      loadCollectionList();
    });
  }
}

/**
 * @param {{ name: string, title: string, downloadUrl: string, fileExtension?: string }} swf
 */
async function loadFromArchive(swf) {
  const title = swf.title || swf.name;
  const restoreList = () => renderSwfs(filteredSwfs.length ? filteredSwfs : allSwfs);

  try {
    if (contentArea) {
      contentArea.innerHTML =
        `<div class="loading">Loading ${escapeHtml(title)}…` +
        '<div class="error-detail">Large SWFs can take a minute while proxies rotate.</div></div>';
    }

    if (!iaClient) iaClient = createIaClient();
    if (!iaClient) throw new Error('Internet Archive client unavailable.');

    const bytes = await iaClient.loadRom(swf);
    const filename = `${title}${swf.fileExtension || '.swf'}`;
    const file = new File([bytes], filename, { type: 'application/x-shockwave-flash' });

    closeBrowser(false);
    await loadSwfBlob(file, filename);

    if (window.trackEvent) {
      window.trackEvent('flash_ia_loaded', 'Flash', title.slice(0, 80), 0);
    }
  } catch (error) {
    console.error('Failed to load SWF from Archive:', error);
    const detail =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
    if (contentArea) {
      contentArea.innerHTML =
        `<div class="error">Failed to load ${escapeHtml(title)}.` +
        `<div class="error-detail">${escapeHtml(detail)}</div>` +
        '<div class="error-actions">' +
        '<button type="button" class="btn btn-primary" data-action="retry-swf">Retry download</button>' +
        '<button type="button" class="btn" data-action="back-list">Back to list</button>' +
        '</div></div>';
      contentArea.querySelector('[data-action="retry-swf"]')?.addEventListener('click', () => {
        loadFromArchive(swf);
      });
      contentArea
        .querySelector('[data-action="back-list"]')
        ?.addEventListener('click', restoreList);
    } else {
      window.alert(`Could not load SWF.\n${detail}`);
    }
  }
}

function openBrowser() {
  if (!browserModal) return;
  closeLoadModal();
  browserModal.hidden = false;
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  if (!allSwfs.length) {
    loadCollectionList();
  } else {
    filteredSwfs = allSwfs.slice();
    renderSwfs(filteredSwfs);
  }
}

/**
 * @param {boolean} [restoreLoad=true] reopen load dialog when idle
 */
function closeBrowser(restoreLoad = true) {
  if (!browserModal) return;
  browserModal.hidden = true;
  if (restoreLoad && !isPlaying) openLoadModal();
}

/**
 * @param {unknown} err
 */
function showLoadError(err) {
  console.error(err);
  setIdleUi();
  const msg =
    err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
  window.alert(`Could not load SWF.\n${msg}`);
}

async function maybeDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const wanted = (params.get('swf') || '').trim();
  if (!wanted) return;

  try {
    if (!iaClient) iaClient = createIaClient();
    if (!iaClient) return;
    allSwfs = await iaClient.fetchRomList();
    const lower = wanted.toLowerCase();
    const match =
      allSwfs.find((s) => s.name.toLowerCase() === lower) ||
      allSwfs.find((s) => s.name.toLowerCase().includes(lower));
    if (match) {
      openBrowser();
      await loadFromArchive(match);
    }
  } catch (err) {
    console.warn('Flash deep-link failed:', err);
  }
}

loadBtn.addEventListener('click', openPicker);
loadBootBtn.addEventListener('click', openPicker);
browseBtn.addEventListener('click', openBrowser);
browseBootBtn.addEventListener('click', openBrowser);
closeBrowserBtn.addEventListener('click', () => closeBrowser());

browserModal.addEventListener('click', (e) => {
  if (e.target === browserModal) closeBrowser();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (browserModal && !browserModal.hidden) {
    closeBrowser();
  }
});

// Collection browser sits above the load dialog.
if (browserModal) browserModal.style.zIndex = '90';

searchInput.addEventListener('input', () => handleSearch(searchInput.value));

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) loadSwfFile(file).catch(showLoadError);
});

unloadBtn.addEventListener('click', unload);

fullscreenBtn.addEventListener('click', async () => {
  const target = playerWrap;
  if (!document.fullscreenElement) {
    try {
      await target.requestFullscreen();
    } catch (err) {
      console.warn('Fullscreen failed:', err);
    }
  } else {
    await document.exitFullscreen();
  }
});

// Silent drag-and-drop for power users; not advertised in the load dialog.
stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadSwfFile(file).catch(showLoadError);
});

setIdleUi();
maybeDeepLink();
