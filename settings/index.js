import { WALLPAPER_PRESETS, loadPrefs } from '../os/prefs.js';
import { getSavedUsername, getSavedHostname } from '../os/config.js';

const MSG = {
  IFRAME_MESSAGE: 'iframe-message',
  OS_PREFS: 'osPrefs',
  OPEN_FILE: 'openFile',
  OPEN_FILE_DIALOG: 'openFileDialog'
};

const ACTION = {
  SET_OS_PREFS: 'setOsPrefs',
  GET_OS_PREFS: 'getOsPrefs',
  OPEN_ABOUT: 'openAbout',
  RESET_OS: 'resetOs'
};

function isEmbedded() {
  try {
    return window.self !== window.top && Boolean(window.parent?.HeymingOS);
  } catch {
    return false;
  }
}

function post(type, extra = {}) {
  if (!isEmbedded()) return;
  window.parent.postMessage({ type: MSG.IFRAME_MESSAGE, message: { type, ...extra } }, '*');
}

/** @type {Record<string, unknown>} */
let state = {
  prefs: loadPrefs(),
  username: getSavedUsername() || 'user',
  hostname: getSavedHostname() || 'heyming-os',
  osName: 'Heyming OS',
  version: '1.0',
  tagline: 'A desktop that fits in a tab.'
};

function sendPatch(patch) {
  if (isEmbedded()) {
    post(ACTION.SET_OS_PREFS, { patch });
    return;
  }
  void standalonePatch(patch);
}

async function standalonePatch(patch) {
  const { patchPrefs, loadPrefs: reload } = await import('../os/prefs.js');
  const cfg = await import('../os/config.js');
  const next = { ...patch };
  if (typeof next.hostname === 'string') {
    cfg.saveHostname(next.hostname);
    state.hostname = next.hostname;
    delete next.hostname;
  }
  if (Object.keys(next).length) {
    state.prefs = patchPrefs(next);
  } else {
    state.prefs = reload();
  }
  render();
}

function renderWallpaperTiles() {
  const host = document.getElementById('wallpaper-presets');
  if (!host) return;
  host.replaceChildren();
  const currentId = state.prefs.wallpaper?.source === 'preset' ? state.prefs.wallpaper.id : '';
  for (const [id, meta] of Object.entries(WALLPAPER_PRESETS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wallpaper-tile';
    btn.dataset.preset = id;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', currentId === id ? 'true' : 'false');
    btn.textContent = meta.label;
    btn.addEventListener('click', () => {
      sendPatch({ wallpaper: { source: 'preset', id, fit: state.prefs.wallpaper.fit } });
    });
    host.appendChild(btn);
  }
}

function reflectChoices() {
  const prefs = state.prefs;
  document.querySelectorAll('[data-theme-value]').forEach((btn) => {
    btn.setAttribute('aria-checked', btn.dataset.themeValue === prefs.theme ? 'true' : 'false');
  });
  document.querySelectorAll('[data-icon-size]').forEach((btn) => {
    btn.setAttribute('aria-checked', btn.dataset.iconSize === prefs.iconSize ? 'true' : 'false');
  });
  const fit = document.getElementById('wallpaper-fit');
  if (fit) fit.value = prefs.wallpaper.fit || 'cover';
  const pathEl = document.getElementById('wallpaper-path');
  if (pathEl) {
    pathEl.textContent = prefs.wallpaper.source === 'vfs' ? prefs.wallpaper.path || '' : '';
  }
  const clock = document.getElementById('clock-seconds');
  if (clock) clock.checked = Boolean(prefs.clockShowSeconds);
  const saverOn = document.getElementById('screensaver-enabled');
  if (saverOn) saverOn.checked = Boolean(prefs.screensaver.enabled);
  const timeout = document.getElementById('screensaver-timeout');
  if (timeout) timeout.value = String(prefs.screensaver.timeoutMs);
  const style = document.getElementById('screensaver-style');
  if (style) style.value = prefs.screensaver.style;
  const userEl = document.getElementById('account-username');
  if (userEl) userEl.textContent = String(state.username);
  const hostInput = document.getElementById('account-hostname');
  if (hostInput && document.activeElement !== hostInput) {
    hostInput.value = String(state.hostname);
  }
  const about = document.getElementById('about-copy');
  if (about) {
    about.textContent = `${state.osName} v${state.version} — ${state.tagline}`;
  }
}

function render() {
  renderWallpaperTiles();
  reflectChoices();
}

function bind() {
  document.getElementById('wallpaper-fit')?.addEventListener('change', (e) => {
    const fit = /** @type {HTMLSelectElement} */ (e.target).value;
    sendPatch({ wallpaper: { ...state.prefs.wallpaper, fit } });
  });
  document.getElementById('choose-image')?.addEventListener('click', () => {
    if (!isEmbedded()) {
      window.alert(
        'Choose an image from the Heyming OS desktop (Set as desktop background) or open Settings inside /os/.'
      );
      return;
    }
    post(MSG.OPEN_FILE_DIALOG, {
      fileTypes: ['image/*', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'],
      title: 'Choose wallpaper'
    });
  });
  document.querySelectorAll('[data-theme-value]').forEach((btn) => {
    btn.addEventListener('click', () => sendPatch({ theme: btn.dataset.themeValue }));
  });
  document.querySelectorAll('[data-icon-size]').forEach((btn) => {
    btn.addEventListener('click', () => sendPatch({ iconSize: btn.dataset.iconSize }));
  });
  document.getElementById('clock-seconds')?.addEventListener('change', (e) => {
    sendPatch({ clockShowSeconds: /** @type {HTMLInputElement} */ (e.target).checked });
  });
  document.getElementById('screensaver-enabled')?.addEventListener('change', (e) => {
    sendPatch({
      screensaver: {
        ...state.prefs.screensaver,
        enabled: /** @type {HTMLInputElement} */ (e.target).checked
      }
    });
  });
  document.getElementById('screensaver-timeout')?.addEventListener('change', (e) => {
    sendPatch({
      screensaver: {
        ...state.prefs.screensaver,
        timeoutMs: Number(/** @type {HTMLSelectElement} */ (e.target).value)
      }
    });
  });
  document.getElementById('screensaver-style')?.addEventListener('change', (e) => {
    sendPatch({
      screensaver: {
        ...state.prefs.screensaver,
        style: /** @type {HTMLSelectElement} */ (e.target).value
      }
    });
  });
  document.getElementById('save-hostname')?.addEventListener('click', () => {
    const input = /** @type {HTMLInputElement} */ (document.getElementById('account-hostname'));
    const host = input.value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');
    if (!host) return;
    input.value = host;
    sendPatch({ hostname: host });
  });
  document.getElementById('reset-os')?.addEventListener('click', () => {
    if (isEmbedded()) {
      post(ACTION.RESET_OS);
      return;
    }
    window.alert('Reset is available inside Heyming OS.');
  });
  document.getElementById('open-about')?.addEventListener('click', () => {
    if (isEmbedded()) {
      post(ACTION.OPEN_ABOUT);
      return;
    }
    window.location.href = '/os/';
  });
}

window.addEventListener('message', (e) => {
  const data = e.data;
  if (data?.type === MSG.OS_PREFS) {
    state.prefs = data.prefs || state.prefs;
    if (data.username) state.username = data.username;
    if (data.hostname) state.hostname = data.hostname;
    if (data.osName) state.osName = data.osName;
    if (data.version) state.version = data.version;
    if (data.tagline) state.tagline = data.tagline;
    render();
  }
  if (data?.type === MSG.OPEN_FILE && data.path) {
    sendPatch({
      wallpaper: { source: 'vfs', path: data.path, fit: state.prefs.wallpaper?.fit || 'cover' }
    });
  }
});

bind();
render();
if (isEmbedded()) {
  post(ACTION.GET_OS_PREFS);
}

const hash = location.hash.replace('#', '');
if (hash) {
  document.getElementById(hash)?.scrollIntoView();
}
