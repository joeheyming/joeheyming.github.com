const fileInput = document.getElementById('fileInput');
const loadBtn = document.getElementById('loadBtn');
const unloadBtn = document.getElementById('unloadBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const dropzone = document.getElementById('dropzone');
const boot = document.getElementById('boot');
const playerWrap = document.getElementById('playerWrap');
const fileLabel = document.getElementById('fileLabel');
const stage = document.getElementById('stage');

/** @type {HTMLElement | null} */
let playerEl = null;
/** @type {string | null} */
let objectUrl = null;
const PAGE_TITLE = 'Flash Player — Play .SWF Files Online ⚡';

function revokeObjectUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function setPlayingUi(name) {
  boot.hidden = true;
  playerWrap.hidden = false;
  unloadBtn.disabled = false;
  fullscreenBtn.disabled = false;
  fileLabel.textContent = name || 'Loaded';
  document.title = name ? `${name} — Flash Player ⚡` : PAGE_TITLE;
}

function setIdleUi() {
  boot.hidden = false;
  playerWrap.hidden = true;
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

  destroyPlayer();

  const ruffle = ensureRuffle();
  playerEl = ruffle.createPlayer();
  playerEl.style.width = '100%';
  playerEl.style.height = '100%';
  playerWrap.appendChild(playerEl);

  objectUrl = URL.createObjectURL(file);
  await playerEl.ruffle().load(objectUrl);
  setPlayingUi(name);

  if (window.trackEvent) {
    window.trackEvent('flash_swf_loaded', 'Flash', name.slice(0, 80), 0);
  }
}

function unload() {
  destroyPlayer();
  setIdleUi();
  if (fileInput) fileInput.value = '';
}

function openPicker() {
  fileInput.click();
}

loadBtn.addEventListener('click', openPicker);
dropzone.addEventListener('click', openPicker);
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openPicker();
  }
});

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

['dragenter', 'dragover'].forEach((type) => {
  stage.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  });
});

['dragleave', 'drop'].forEach((type) => {
  stage.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
  });
});

stage.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadSwfFile(file).catch(showLoadError);
});

/**
 * @param {unknown} err
 */
function showLoadError(err) {
  console.error(err);
  destroyPlayer();
  setIdleUi();
  const msg =
    err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
  window.alert(`Could not load SWF.\n${msg}`);
}

setIdleUi();
