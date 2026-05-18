// UZDoom web loader: IWAD/mod/soundfont management, launch, clean exit.
//
// This file started as a port of abootnet/uzdoom-wasm's upstream loader
// and has since grown site-specific logic. Everything is marked below
// with either:
//
//   [UPSTREAM] — functionally identical (or near-identical) to the
//                public upstream loader. Patches here are candidates
//                for upstream PRs.
//   [SITE]     — joeheyming.github.com fork patches (flavor picker,
//                lifecycle wiring, IDBFS auto-save sync, touch overlay,
//                etc.). Changes here never go upstream.
//
// When rebasing on a new upstream snapshot, search for the [SITE]
// markers; everything in between is ours to preserve.
//
// The Emscripten module (uzdoom.js + uzdoom.wasm) is the native game engine
// compiled to WebAssembly. This script handles everything around it:
// picking files, plumbing them into IDBFS, driving the launch, surfacing
// progress, and catching the engine's exit so the UI can show a proper
// "session ended" panel instead of leaving a frozen canvas.
//
// [SITE] Lifecycle integration: every transition between phases is
// reported to `window.UZDoomLifecycle` (see lifecycle.js). The closure
// `state` below no longer carries `launched` / `exited` flags — those
// live on the lifecycle. This removes the "four flags agreeing on one
// concept" problem that previously required reading three files to
// answer "is the engine playing right now?"
//
// IndexedDB layout (via Emscripten's IDBFS):
//   /wads                         — user IWADs and PK3s (selected at boot)
//   /home/web_user/.config        — engine config INI, save games, cache
//   /soundfonts                   — user-uploaded SF2 (in-memory only;
//                                    not mounted to IDBFS because the bundle
//                                    ships a server-hosted default)

import { UZDoomLifecycle as LC } from './lifecycle.js';
import { syncSavesToIDB } from './uzdoom-loader-idbfs.js';
import { installUzdomLoaderEngine } from './uzdoom-loader-engine.js';

(function guardAudioParam() {
  if (typeof AudioParam === 'undefined') return;
  const proto = AudioParam.prototype;

  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) {
    const origSet = desc.set;
    Object.defineProperty(proto, 'value', {
      get: desc.get,
      set(v) {
        origSet.call(this, Number.isFinite(v) ? v : 0);
      },
      configurable: true,
      enumerable: desc.enumerable
    });
  }

  const methods = ['setValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime'];
  for (const m of methods) {
    if (typeof proto[m] !== 'function') continue;
    const orig = proto[m];
    proto[m] = function (value, ...rest) {
      return orig.call(this, Number.isFinite(value) ? value : 0, ...rest);
    };
  }
})();

// Sibling guard for scheduled-source start()/stop(). The OpenAL fallback
// path inside uzdoom.js (scheduleSourceAudio → scheduleContextAudio,
// also driven by the setInterval pump set up in _alcCreateContext, plus
// _alSourcePlay) occasionally calls `bufferSource.start(when, offset,
// duration)` with a non-finite arg — observed on Legend of DOOM map
// transitions and on the F32→S16 fallback music stream when the
// AL_EXT_FLOAT32 extension is missing. Without this shim the throw
// escapes back into the engine's main loop and the OpenAL source state
// machine retries forever, which both spams the console with a
// thousand-deep rAF stack and stalls the main thread for ~1s per frame.
//
// Note: it's *not* enough to patch AudioScheduledSourceNode.prototype
// (the WebAudio base class). Per spec, AudioBufferSourceNode defines its
// own start(when, offset, duration) directly on its own prototype — a
// 3-arg overload that shadows the 1-arg base. So `bufferSrc.start(...)`
// resolves to AudioBufferSourceNode.prototype.start, never the base.
// We patch every concrete scheduled-source prototype the engine uses.
(function guardScheduledSource() {
  const sanitize = (a) => (a === undefined || Number.isFinite(a) ? a : 0);
  const protos = [
    typeof AudioScheduledSourceNode !== 'undefined' && AudioScheduledSourceNode.prototype,
    typeof AudioBufferSourceNode !== 'undefined' && AudioBufferSourceNode.prototype,
    typeof OscillatorNode !== 'undefined' && OscillatorNode.prototype,
    typeof ConstantSourceNode !== 'undefined' && ConstantSourceNode.prototype
  ].filter(Boolean);

  for (const proto of protos) {
    for (const m of ['start', 'stop']) {
      if (!Object.prototype.hasOwnProperty.call(proto, m)) continue;
      if (typeof proto[m] !== 'function') continue;
      const orig = proto[m];
      proto[m] = function (...args) {
        return orig.apply(this, args.map(sanitize));
      };
    }
  }
})();

const BUNDLED_IWADS = new Set(['freedoom1.wad', 'freedoom2.wad']);

const SAFE_CHEATS = new Set([
  'god',
  'iddqd',
  'buddha',
  'noclip',
  'idclip',
  'notarget',
  'fly',
  'idfa',
  'idkfa',
  'resurrect',
  'kill'
]);

const RE_FILENAME_WAD = /^[a-z0-9_.-]+\.(wad|ipk3)$/i;
const RE_FILENAME_MOD = /^[a-z0-9_.-]+\.(pk3|ipk3|pk7|wad|zip|deh|bex)$/i;
const RE_WARP = /^\d{1,2}(?:,\d{1,2})?$/;
const RE_SKILL = /^[1-5]$/;
const RE_MAP = /^[A-Za-z0-9_]{2,8}$/;
const RE_CHEAT_LIST = /^[a-z0-9_,]{1,80}$/i;

function parseLauncherArgs() {
  const params = new URLSearchParams(window.location.search);
  const out = { iwad: null, files: [], argv: [], nomelt: false };

  if (params.get('nomelt') === '1') out.nomelt = true;

  const iwad = params.get('iwad');
  if (iwad && RE_FILENAME_WAD.test(iwad)) out.iwad = iwad;

  const fileStr = params.get('file');
  if (fileStr) {
    for (const f of fileStr.split(',').slice(0, 10)) {
      if (RE_FILENAME_MOD.test(f)) out.files.push(f);
    }
  }

  const warp = params.get('warp');
  if (warp && RE_WARP.test(warp)) out.argv.push('-warp', ...warp.split(','));

  const skill = params.get('skill');
  if (skill && RE_SKILL.test(skill)) out.argv.push('-skill', skill);

  const map = params.get('map');
  if (map && RE_MAP.test(map)) out.argv.push('+map', map);

  if (params.get('nomonsters') === '1') out.argv.push('-nomonsters');
  if (params.get('fast') === '1') out.argv.push('-fast');
  if (params.get('respawn') === '1') out.argv.push('-respawn');

  const cheat = params.get('cheat');
  if (cheat && RE_CHEAT_LIST.test(cheat)) {
    for (const c of cheat.toLowerCase().split(',')) {
      if (SAFE_CHEATS.has(c)) out.argv.push('+' + c);
    }
  }
  return out;
}

const launcherArgs = parseLauncherArgs();

const SIDELOADED_IWADS = {
  'doom.wad': '/private/doom.wad',
  'doom2.wad': '/private/doom2.wad'
};

const state = {
  iwad: null,
  mods: [],
  soundfont: null
};

function $(id) {
  return document.getElementById(id);
}
function setStatus(msg) {
  Module.setStatus(msg);
}
function setStatusRight(msg) {
  $('statusRight').textContent = msg || '';
}
function formatBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, data: new Uint8Array(r.result) });
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

function wirePicker(pickerId, onFiles) {
  const picker = $(pickerId);
  const input = picker.querySelector('input[type=file]');

  input.addEventListener('change', (e) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    input.value = '';
    if (files.length) onFiles(files);
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    picker.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      picker.classList.add('drag');
    });
  });
  ['dragleave', 'dragend', 'drop'].forEach((evt) => {
    picker.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      picker.classList.remove('drag');
    });
  });
  picker.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      onFiles(e.dataTransfer.files);
    }
  });
}

['dragover', 'drop'].forEach((evt) => {
  window.addEventListener(
    evt,
    (e) => {
      e.preventDefault();
    },
    false
  );
});

wirePicker('iwadPicker', async (files) => {
  state.iwad = await readFile(files[0]);
  $('iwadDesc').textContent = `${state.iwad.name} — ${formatBytes(state.iwad.data.length)}`;
  $('iwadPicker').classList.add('filled');
  $('launchBtn').disabled = false;
  LC.markPrimed({ iwad: state.iwad.name });
});

wirePicker('modPicker', async (files) => {
  for (const f of files) state.mods.push(await readFile(f));
  renderModChips();
});

wirePicker('sfPicker', async (files) => {
  state.soundfont = await readFile(files[0]);
  $('sfDesc').textContent = `${state.soundfont.name} — ${formatBytes(state.soundfont.data.length)}`;
  $('sfPicker').classList.add('filled');
});

function renderModChips() {
  const chips = $('modChips');
  const desc = $('modDesc');
  chips.innerHTML = '';
  if (state.mods.length === 0) {
    desc.textContent = 'No mods selected. Multi-select supported.';
    $('modPicker').classList.remove('filled');
    return;
  }
  desc.textContent = `${state.mods.length} file(s) — load order = selection order`;
  $('modPicker').classList.add('filled');
  state.mods.forEach((m, idx) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = m.name;
    name.title = m.name;
    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = formatBytes(m.data.length);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '×';
    btn.title = 'Remove';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.mods.splice(idx, 1);
      renderModChips();
    });
    chip.appendChild(name);
    chip.appendChild(size);
    chip.appendChild(btn);
    chips.appendChild(chip);
  });
}

$('useFreedoomBtn').addEventListener('click', () => {
  state.iwad = { name: 'freedoom1.wad (bundled)', data: null, bundled: 'freedoom1.wad' };
  $('iwadDesc').textContent = 'freedoom1.wad (bundled — 12 MB)';
  $('iwadPicker').classList.add('filled');
  $('launchBtn').disabled = false;
  setStatus('Ready to launch with Freedoom.');
  LC.markPrimed({ iwad: 'freedoom1.wad' });
});

const { bootEngine } = installUzdomLoaderEngine({
  $,
  LC,
  state,
  launcherArgs,
  SIDELOADED_IWADS,
  formatBytes,
  setStatus,
  setStatusRight
});

$('launchBtn').addEventListener('click', async () => {
  if (LC.get() !== 'primed') return;
  LC.markLaunching();
  $('launchBtn').disabled = true;
  setStatus('Launching engine…');

  if (Module && Module.calledRun) {
    bootEngine();
  } else {
    Module.onRuntimeInitialized = bootEngine;
  }
});

setInterval(() => {
  if (!LC.isRunning()) return;
  syncSavesToIDB();
}, 30000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  if (!LC.isRunning()) return;
  syncSavesToIDB();
});

window.addEventListener('beforeunload', () => {
  if (!LC.isRunning()) return;
  syncSavesToIDB();
});

function toggleFullscreen() {
  const c = $('canvas');
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (c.requestFullscreen) {
    c.requestFullscreen({ navigationUI: 'hide' }).catch((e) => {
      console.warn('fullscreen request failed', e);
    });
  }
}
$('fsBtn').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  $('fsBtn').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
});

$('resetBtn').addEventListener('click', () => {
  $('resetModal').classList.remove('hidden');
});
$('resetCancelBtn').addEventListener('click', () => {
  $('resetModal').classList.add('hidden');
});
$('resetConfirmBtn').addEventListener('click', async () => {
  $('resetConfirmBtn').disabled = true;
  $('resetConfirmBtn').textContent = 'Wiping…';
  try {
    const dbs = ['/wads', '/home/web_user/.config'];
    for (const name of dbs) {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    }
    try {
      const all = (await indexedDB.databases) ? indexedDB.databases() : [];
      for (const d of all) {
        if (d.name && (d.name.startsWith('/wads') || d.name.startsWith('/home'))) {
          await new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(d.name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          });
        }
      }
    } catch (e) {
      /* indexedDB.databases() not supported in all browsers */
    }

    $('resetModal').classList.add('hidden');
    setStatus('Data wiped. Reloading…');
    setTimeout(() => location.reload(), 400);
  } catch (e) {
    console.error('reset failed', e);
    $('resetConfirmBtn').textContent = 'Failed — check console';
  }
});

$('canvas').addEventListener('click', () => {
  if (!LC.isRunning()) return;
  const c = $('canvas');
  if (document.pointerLockElement === c) return;
  if (!c.requestPointerLock) return;
  // requestPointerLock() returns a Promise in modern browsers. The benign
  // rejections (user hit ESC mid-request, "Pointer lock cannot be acquired
  // immediately after the user gesture" cooldown, "Pointer is already
  // locked" race on a double-click) are not actionable — swallow them so
  // they don't show up in GA as unhandledrejection noise.
  const p = c.requestPointerLock();
  if (p && typeof p.catch === 'function') p.catch(() => {});
});

(function startStallMonitor() {
  let last = performance.now();
  let worstInWindow = 0;
  let windowStart = last;
  let stallCount = 0;
  function tick() {
    const now = performance.now();
    const delta = now - last;
    last = now;
    if (delta > 150) {
      stallCount++;
      worstInWindow = Math.max(worstInWindow, delta);
      if (stallCount <= 20 || stallCount % 20 === 0) {
        console.warn(
          '[stall-mon] main-thread blocked for ' +
            delta.toFixed(0) +
            ' ms (stall #' +
            stallCount +
            ')'
        );
      }
    }
    if (now - windowStart >= 5000) {
      if (worstInWindow > 0) {
        console.log(
          '[stall-mon] last 5s — worst stall ' +
            worstInWindow.toFixed(0) +
            ' ms, total stalls observed: ' +
            stallCount
        );
      }
      worstInWindow = 0;
      windowStart = now;
    }
    setTimeout(tick, 50);
  }
  setTimeout(tick, 50);
})();

export const UZDoomLoader = {
  primeWith: function (descriptor) {
    if (!descriptor || !descriptor.iwad) {
      return Promise.reject(new Error('primeWith requires { iwad }'));
    }
    state.iwad = descriptor.iwad;
    state.mods = Array.isArray(descriptor.mods) ? descriptor.mods.slice() : [];
    state.soundfont = descriptor.soundfont || null;

    if (state.iwad.bundled) {
      $('iwadDesc').textContent = state.iwad.name + ' (bundled)';
    } else if (state.iwad.data) {
      $('iwadDesc').textContent = state.iwad.name + ' — ' + formatBytes(state.iwad.data.length);
    } else if (state.iwad.persisted) {
      $('iwadDesc').textContent = state.iwad.name + ' (persisted)';
    }
    $('iwadPicker').classList.add('filled');

    renderModChips();

    if (state.soundfont && state.soundfont.data) {
      $('sfDesc').textContent =
        state.soundfont.name + ' — ' + formatBytes(state.soundfont.data.length);
      $('sfPicker').classList.add('filled');
    }

    $('launchBtn').disabled = false;
    LC.markPrimed({
      iwad: state.iwad.name,
      mods: state.mods.map(function (m) {
        return m.name;
      })
    });
    return Promise.resolve();
  },
  launch: function () {
    if (LC.get() !== 'primed') return false;
    $('launchBtn').click();
    return true;
  },
  isPrimed: function () {
    return LC.get() === 'primed';
  },
  state: function () {
    return LC.get();
  }
};

window.UZDoomLoader = UZDoomLoader;

if (launcherArgs.iwad) {
  const iwadLower = launcherArgs.iwad.toLowerCase();
  var urlIwad = BUNDLED_IWADS.has(iwadLower)
    ? { name: iwadLower, data: null, bundled: iwadLower }
    : { name: launcherArgs.iwad, persisted: true };
  var urlMods = launcherArgs.files.map(function (f) {
    return { name: f, persisted: true };
  });
  console.log('[launcher] auto-launch from URL:', launcherArgs);
  setStatus('Auto-launching…');
  UZDoomLoader.primeWith({ iwad: urlIwad, mods: urlMods }).then(function () {
    UZDoomLoader.launch();
  });
}
