// UZDoom loader: engine exit handling, core asset fetch, bootEngine + melt handoff.

import {
  IDB_WAD_MOUNT,
  syncSavesToIDB,
  mountFilesystems,
  fsExists,
  writeUserFiles
} from './uzdoom-loader-idbfs.js';
import { runMeltRevealAfterMain } from './uzdoom-loader-melt.js';

const CORE_ASSETS = [
  { url: 'uzdoom.pk3', fs: '/uzdoom.pk3' },
  { url: 'game_support.pk3', fs: '/game_support.pk3' },
  { url: 'brightmaps.pk3', fs: '/brightmaps.pk3' },
  { url: 'lights.pk3', fs: '/lights.pk3' },
  { url: 'game_widescreen_gfx.pk3', fs: '/game_widescreen_gfx.pk3' },
  { url: 'soundfonts/uzdoom.sf2', fs: '/soundfonts/uzdoom.sf2' },
  { url: 'fm_banks/GENMIDI.GS.wopl', fs: '/fm_banks/GENMIDI.GS.wopl' },
  {
    url: 'fm_banks/gs-by-papiezak-and-sneakernets.wopn',
    fs: '/fm_banks/gs-by-papiezak-and-sneakernets.wopn'
  }
];

/**
 * @param {{
 *   $: (id: string) => HTMLElement | null,
 *   LC: import('./lifecycle.js').UZDoomLifecycle,
 *   state: { iwad: unknown, mods: unknown[], soundfont: unknown },
 *   launcherArgs: { argv: string[], nomelt?: boolean },
 *   SIDELOADED_IWADS: Record<string, string>,
 *   formatBytes: (n: number) => string,
 *   setStatus: (msg: string) => void,
 *   setStatusRight: (msg: string) => void
 * }} ctx
 */
export function installUzdomLoaderEngine(ctx) {
  const { $, LC, state, launcherArgs, SIDELOADED_IWADS, formatBytes, setStatus, setStatusRight } =
    ctx;

  let exitPanelShown = false;
  function showExitPanel(code, reason) {
    if (exitPanelShown) return;
    exitPanelShown = true;
    if (code !== 0 && reason && reason !== 'quit' && reason !== 'restart') {
      LC.markError('wasm-abort', { code: code, reason: reason });
    } else {
      LC.markExited(code, reason);
    }

    $('canvas').classList.add('hidden');
    $('fsBtn').classList.add('hidden');
    $('boot').classList.add('hidden');
    $('exited').classList.remove('hidden');

    const outcome = $('exitOutcome');
    const reasonEl = $('exitReason');
    if (code === 0 || reason === 'quit' || reason === 'restart') {
      outcome.className = 'outcome ok';
      outcome.textContent = 'Thanks for playing.';
      reasonEl.textContent = '';
    } else if (reason) {
      outcome.className = 'outcome err';
      outcome.textContent = 'Engine exited unexpectedly.';
      reasonEl.textContent = 'Reason: ' + reason + ' (code ' + code + ')';
    } else {
      outcome.className = 'outcome err';
      outcome.textContent = 'Engine exited.';
      reasonEl.textContent = 'Exit code: ' + code;
    }
  }

  Module.onEngineExit = function (code, reason) {
    syncSavesToIDB();
    showExitPanel(code, reason);
  };

  Module.onExit = function (code) {
    showExitPanel(code, null);
  };

  $('relaunchBtn').addEventListener('click', () => {
    syncSavesToIDB().then(
      () => location.reload(),
      () => location.reload()
    );
    setTimeout(() => location.reload(), 500);
  });

  function renderAssetList(assets) {
    const list = $('assetList');
    list.classList.add('show');
    list.innerHTML = '';
    assets.forEach((a) => {
      const el = document.createElement('div');
      el.className = 'pending';
      el.dataset.url = a.url;
      el.textContent = '   ' + a.url;
      list.appendChild(el);
    });
  }

  function markAsset(url, assetState, bytesText) {
    const list = $('assetList');
    const el = list.querySelector(`[data-url="${CSS.escape(url)}"]`);
    if (!el) return;
    el.className = assetState;
    const prefix = assetState === 'done' ? '✓  ' : assetState === 'fail' ? '✗  ' : '·  ';
    el.textContent = prefix + url + (bytesText ? '   ' + bytesText : '');
  }

  async function fetchWithProgress(url, onProgress) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const total = parseInt(resp.headers.get('Content-Length') || '0', 10);
    if (!resp.body || !resp.body.getReader || !total) {
      const buf = new Uint8Array(await resp.arrayBuffer());
      if (onProgress) onProgress(buf.length, buf.length || -1);
      return buf;
    }
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress) onProgress(received, total);
    }
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  async function fetchCoreAssets() {
    $('progress').style.display = 'block';
    renderAssetList(CORE_ASSETS);
    const bar = $('progress').querySelector('.bar');

    let totalBytes = 0;
    for (let i = 0; i < CORE_ASSETS.length; i++) {
      const a = CORE_ASSETS[i];
      setStatus(`Fetching ${a.url}…`);
      setStatusRight(`${i + 1}/${CORE_ASSETS.length}`);
      try {
        const buf = await fetchWithProgress(a.url, (recv, total) => {
          const pct = total > 0 ? (recv / total) * 100 : 0;
          markAsset(
            a.url,
            'pending',
            total > 0
              ? `${formatBytes(recv)} / ${formatBytes(total)} (${pct.toFixed(0)}%)`
              : formatBytes(recv)
          );
          const overall = ((i + (total > 0 ? recv / total : 0)) / CORE_ASSETS.length) * 100;
          bar.style.width = overall.toFixed(1) + '%';
        });
        const dir = a.fs.substring(0, a.fs.lastIndexOf('/'));
        if (dir) {
          try {
            FS.mkdirTree(dir);
          } catch (_e) {
            /* already exists */
          }
        }
        FS.writeFile(a.fs, buf);
        totalBytes += buf.length;
        markAsset(a.url, 'done', formatBytes(buf.length));
      } catch (e) {
        console.warn('asset fetch failed:', a.url, e);
        markAsset(a.url, 'fail', String(e.message || e));
      }
    }
    bar.style.width = '100%';
    setStatusRight(`Loaded ${formatBytes(totalBytes)}`);
  }

  async function resolveSideloadedIwad() {
    if (!state.iwad || !state.iwad.persisted) return;
    const p = IDB_WAD_MOUNT + '/' + state.iwad.name;
    if (fsExists(p)) return;
    const rel = SIDELOADED_IWADS[state.iwad.name.toLowerCase()];
    if (!rel) return;

    setStatus(`Fetching ${state.iwad.name}…`);
    try {
      const buf = await fetchWithProgress(rel, (recv, total) => {
        setStatusRight(
          total > 0
            ? `${state.iwad.name}: ${formatBytes(recv)} / ${formatBytes(total)} (${(
                (recv / total) *
                100
              ).toFixed(0)}%)`
            : `${state.iwad.name}: ${formatBytes(recv)}`
        );
      });
      FS.writeFile(p, buf);
      syncSavesToIDB();
      console.log(`[uzdoom-loader] side-loaded ${state.iwad.name} (${formatBytes(buf.length)})`);
    } catch (e) {
      console.warn(`[uzdoom-loader] side-load failed for ${state.iwad.name}:`, e);
    }
  }

  function bootEngine() {
    mountFilesystems();
    setStatus('Syncing saves…');
    FS.syncfs(true, async (err) => {
      if (err) console.warn('syncfs pull:', err);
      try {
        await fetchCoreAssets();
      } catch (e) {
        console.error('core asset fetch failed', e);
      }

      await resolveSideloadedIwad();

      let userArgs;
      try {
        userArgs = writeUserFiles(state, launcherArgs);
      } catch (e) {
        console.error('[uzdoom-loader] file preparation failed:', e);
        setStatus(String(e.message || e));
        LC.unprime();
        state.iwad = null;
        state.mods = [];
        $('iwadPicker').classList.remove('filled');
        $('launchBtn').disabled = true;
        return;
      }
      userArgs.push('+vid_fullscreen', '0');
      if (window.self !== window.top) {
        userArgs.push('+i_pauseinbackground', '0');
      }
      try {
        var cfg =
          'bind ctrl "+attack"\n' +
          'bind leftarrow "+left"\n' +
          'bind rightarrow "+right"\n' +
          'bind space "+jump"\n' +
          // Mobile-only touch buttons (ALT / WPN) dispatch synthetic
          // KeyboardEvents on these otherwise-unused keys. Bound on
          // desktop too so curious keyboard players get the same
          // shortcuts — `\` throws the Castlevania sub-weapon and `'`
          // cycles weapons, which is more discoverable than mouse2 +
          // wheel for new visitors.
          //
          // CRITICAL: GZDoom names ASCII printable keys by the literal
          // character, not by a descriptive word. The engine's own
          // commonbinds.txt has `\ +showscores` and uses `,`, `.`, `[`,
          // `]`, `;`, `'` directly. So `bind backslash …` and `bind
          // quote …` are silent no-ops — GZDoom doesn't recognize those
          // tokens as key names and nothing gets bound. Use `\` and `'`.
          // This overrides the default `\ +showscores`, which is fine
          // for single-player.
          'bind \\ "+altattack"\n' +
          'bind \' "weapnext"\n';
        if (document.body.classList.contains('mobile')) {
          cfg = 'unbind mouse1\n' + cfg;
        }
        FS.writeFile('/lod-input-binds.cfg', cfg);
        userArgs.push('-exec', '/lod-input-binds.cfg');
      } catch (e) {
        console.warn('[uzdoom-loader] could not write input binds cfg:', e);
      }
      Module.arguments = userArgs;
      console.log('[uzdoom-loader] launching with argv:', userArgs);
      setStatus('Booting engine…');

      try {
        if (window.self !== window.top) {
          window.parent.postMessage({ type: 'uzdoom:launched' }, '*');
        }
      } catch (e) {
        /* not embedded, or security-restricted */
      }

      $('canvas').classList.remove('hidden');
      $('canvas').focus();

      const announceReveal = () => {
        LC.markPlaying();
        try {
          if (window.self !== window.top) {
            window.parent.postMessage({ type: 'uzdoom:revealed' }, '*');
          }
        } catch (e) {
          /* cross-origin restricted or not framed */
        }
      };
      const revealCut = () => {
        $('boot').classList.add('hidden');
        $('fsBtn').classList.remove('hidden');
        announceReveal();
      };

      const wantMelt = !launcherArgs.nomelt && typeof window.UZDoomMelt === 'object';
      let snapshotPromise = null;
      if (wantMelt) {
        snapshotPromise = window.UZDoomMelt.snapshot().catch((e) => {
          console.warn('[uzdoom-loader] melt snapshot failed:', e);
          return null;
        });
      }

      try {
        Module.callMain(userArgs);
      } catch (e) {
        if (e && e.name === 'ExitStatus') return;
        console.error(e);
        showExitPanel(-1, String(e.message || e));
        return;
      }

      if (!wantMelt) {
        revealCut();
        return;
      }

      runMeltRevealAfterMain({
        wantMelt: true,
        snapshotPromise,
        revealCut,
        announceReveal,
        $
      });
    });
  }

  return { bootEngine, showExitPanel };
}
