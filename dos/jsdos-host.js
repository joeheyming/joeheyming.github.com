// dos/jsdos-host.js — thin wrapper around js-dos v8.
//
// Responsibilities:
//   • Mount a .jsdos bundle (Uint8Array) into the supplied container.
//   • If a prior save zip is provided, overlay its files onto the
//     bundle before launching so DOSBox sees the saved state.
//   • Return a handle exposing { persist(), stop() } so the caller can
//     snapshot the FS to IndexedDB before tearing the emulator down.
//
// We never embed bytes via base64 or data URIs — everything is a
// `blob:` URL backed by the same Uint8Array, then revoked on stop().
//
// js-dos v8 surface used:
//   • `window.Dos(host, options)` — mounts the player.
//   • `options.onEvent(name, ...args)` — fires `ci-ready` with the
//      command interface (ci) once the WASM has booted.
//   • `ci.persist()` — returns a Promise<Uint8Array> containing a zip
//      of changed files (the FS delta).
//   • `ci.exit()` / props.stop() — tears the emulator down.

/* global Dos, JSZip */

/**
 * @typedef {Object} HostHandle
 * @property {Promise<Uint8Array | null>} persist  Resolves with the FS
 *   delta zip (or null if persist isn't available).
 * @property {() => Promise<void>} stop
 */

/**
 * @param {HTMLElement} host
 * @param {Uint8Array} bundleBytes  .jsdos bundle bytes (output of repack.js).
 * @param {Uint8Array | null} saveBytes  Prior persist() result, or null.
 * @param {(label: string) => void} onStatus  UI status reporter.
 * @returns {Promise<HostHandle>}
 */
export async function launchJsDos(host, bundleBytes, saveBytes, onStatus) {
  if (typeof Dos !== 'function') {
    throw new Error('js-dos failed to load from CDN.');
  }

  // Merge saved-state files on top of the original bundle. js-dos's
  // persist() output is itself a zip of changed files relative to the
  // bundle, so overlay = the live FS at last exit.
  const launchBytes = saveBytes ? await overlaySaveOntoBundle(bundleBytes, saveBytes) : bundleBytes;

  const blob = new Blob([launchBytes], { type: 'application/zip' });
  const blobUrl = URL.createObjectURL(blob);

  /** @type {any} */
  let ci = null;
  const ciReady = new Promise((resolve) => {
    // Some js-dos builds resolve `ci-ready` before the caller awaits
    // it; capture into `ci` synchronously and also resolve the promise.
    const finish = (value) => {
      ci = value;
      resolve(value);
      // js-dos attaches its keydown handler on `document`, so the
      // physical keyboard already works without explicit focus — but
      // moving focus to the canvas means the browser scrolls it into
      // view AND avoids any host page Tab/space/arrow handlers eating
      // keystrokes before they reach the emulator. Defer to a tick so
      // js-dos has finished mounting the canvas.
      setTimeout(() => focusEmulator(host), 0);
    };
    /** @type {any} */
    const opts = {
      url: blobUrl,
      // js-dos resolves `<pathPrefix>emulators.js` (and `wdosbox.js`,
      // `wdosbox.wasm`, `wdosbox-x.js`, `wdosbox-x.wasm`) at boot.
      // Pinned to the same `emulators` version that the loaded
      // `js-dos@8.3.20` was built against — see the CDN <script> in
      // `index.html` and keep these in sync when bumping versions.
      pathPrefix: 'https://cdn.jsdelivr.net/npm/emulators@8.3.8/dist/',
      theme: 'dark',
      // Keep saves local: no dos.zone account, no upstream telemetry.
      noCloud: true,
      noNetworking: true,
      // Don't capture the pointer on click; lets the user reach the
      // toolbar above the canvas without ESC-ing first.
      mouseCapture: false,
      backend: 'dosboxX',
      autoStart: true,
      // Hide js-dos's built-in sidebar (save / F6 / settings / soft
      // keyboard toggle). It's designed for phones; on desktop the
      // soft-keyboard icon is a UX trap — users click it thinking
      // they need to "enable" their physical keyboard, and the
      // on-screen keyboard then steals ~30% of the viewport.
      //
      // We replace its responsibilities cleanly:
      //   • Save → our `stop()` calls `ci.persist()` and writes to
      //     IndexedDB whenever the user exits via "← Back to catalog".
      //   • F6 / DOSBox controls → still bound to the physical key.
      //   • Soft keyboard → not needed on desktop; mobile users can
      //     use Chrome's native software keyboard (Tab to focus).
      kiosk: true,
      onEvent: (name, arg) => {
        if (name === 'ci-ready' && arg) {
          onStatus('');
          finish(arg);
        } else if (name === 'emu-ready') {
          onStatus('Booting DOSBox…');
        } else if (name === 'bnd-load') {
          onStatus('Loading bundle into emulator…');
        }
      }
    };

    onStatus('Starting emulator…');
    try {
      const props = Dos(host, opts);
      // Stash for later teardown — props.stop() works across v8 minor
      // versions even when ci.exit() isn't exposed.
      host.__jsdosProps = props;
      // WebAudio is gated behind a user gesture on the AudioContext
      // *that js-dos creates*, which happens after our async download
      // chain — so the original catalog click no longer counts. Lay
      // down a click-to-start overlay so the user has an explicit,
      // gesture-quality target. Its pointerdown bubbles up to js-dos's
      // own document-level handler, which resumes the AudioContext.
      host.__jsdosOverlay = showClickToStart(host);
    } catch (err) {
      URL.revokeObjectURL(blobUrl);
      throw err;
    }
  });

  // Wait up to 90s for ci-ready. Most boots finish in 3-8s; the long
  // budget is there for slow networks pulling the wdosbox WASM payload.
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Emulator did not signal ready in 90s')), 90_000)
  );
  await Promise.race([ciReady, timeout]);

  const persist = async () => {
    if (!ci || typeof ci.persist !== 'function') return null;
    try {
      const out = await ci.persist();
      if (!out) return null;
      return out instanceof Uint8Array ? out : new Uint8Array(out);
    } catch (err) {
      console.warn('[dos] persist() failed:', err);
      return null;
    }
  };

  const stop = async () => {
    try {
      if (ci && typeof ci.exit === 'function') {
        await ci.exit();
      } else if (host.__jsdosProps && typeof host.__jsdosProps.stop === 'function') {
        await host.__jsdosProps.stop();
      }
    } catch (err) {
      console.warn('[dos] stop() failed:', err);
    } finally {
      URL.revokeObjectURL(blobUrl);
      delete host.__jsdosProps;
      // Drop the overlay if the user exits before clicking it.
      if (host.__jsdosOverlay) {
        host.__jsdosOverlay.remove();
        delete host.__jsdosOverlay;
      }
      // Wipe whatever DOM js-dos appended so the next launch starts clean.
      while (host.firstChild) host.removeChild(host.firstChild);
    }
  };

  return { persist: persist(), stop };
}

/**
 * Drop a click-to-start affordance on top of the freshly-mounted
 * emulator. Returns the overlay element so the caller can store it
 * and remove it on teardown if the user exits before clicking.
 *
 * Why pointerdown, not click: pointerdown is the earliest event that
 * still counts as a user gesture for WebAudio's resume() policy, and
 * also the event js-dos listens for to unlock its own AudioContext.
 * Using pointerdown ensures both audio unlocks fire on the same tap
 * with no perceptible latency.
 *
 * @param {HTMLElement} host
 * @returns {HTMLElement}
 */
function showClickToStart(host) {
  const overlay = document.createElement('button');
  overlay.type = 'button';
  overlay.className = 'jsdos-click-to-start';
  overlay.setAttribute('aria-label', 'Click anywhere to start. Enables sound and keyboard.');
  overlay.innerHTML =
    '<span class="jsdos-click-to-start-inner">' +
    '<span class="jsdos-click-to-start-icon" aria-hidden="true">🔊</span>' +
    '<span class="jsdos-click-to-start-text">' +
    'Click anywhere to start' +
    '<span class="jsdos-click-to-start-sub">enables sound &amp; keyboard</span>' +
    '</span>' +
    '</span>';

  const dismiss = () => {
    overlay.remove();
    focusEmulator(host);
  };
  overlay.addEventListener('pointerdown', dismiss, { once: true });
  // Keyboard fallback for Tab → Enter / Space (a11y).
  overlay.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        dismiss();
      }
    },
    { once: true }
  );

  host.appendChild(overlay);
  return overlay;
}

/**
 * Move keyboard focus into the freshly-mounted emulator. We try a
 * canvas first (the actual rendering surface), fall back to a nested
 * iframe (some js-dos builds wrap the canvas), and finally the host
 * container itself. `tabindex=-1` is set when missing so `focus()`
 * actually takes effect on otherwise-non-focusable elements.
 *
 * @param {HTMLElement} host
 */
function focusEmulator(host) {
  /** @type {HTMLElement | null} */
  const target = host.querySelector('canvas') || host.querySelector('iframe') || host;
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  try {
    target.focus({ preventScroll: false });
  } catch {
    /* Some older browsers reject the options bag; ignore. */
  }
}

/**
 * Merge `saveBytes` (a zip of changed files) on top of `bundleBytes`,
 * preferring save versions for any colliding paths. Returns a new
 * Uint8Array of the merged zip.
 *
 * @param {Uint8Array} bundleBytes
 * @param {Uint8Array} saveBytes
 * @returns {Promise<Uint8Array>}
 */
async function overlaySaveOntoBundle(bundleBytes, saveBytes) {
  if (typeof JSZip === 'undefined') {
    // No JSZip — fall back to ignoring the save rather than refusing
    // to launch the game.
    return bundleBytes;
  }
  const [bundleZip, saveZip] = await Promise.all([
    JSZip.loadAsync(bundleBytes),
    JSZip.loadAsync(saveBytes)
  ]);

  /** @type {Array<Promise<void>>} */
  const ops = [];
  saveZip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    ops.push(
      entry.async('uint8array').then((bytes) => {
        bundleZip.file(relativePath, bytes);
      })
    );
  });
  await Promise.all(ops);

  return bundleZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
