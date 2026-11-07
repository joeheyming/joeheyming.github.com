// Flavor controller. URL modes:
//   ?manual=1        → bail; full uzdoom-loader picker UI takes over.
//   ?flavor=classic  → auto-prime original DOOM (doom.wad fetched
//                      from CDN); hero button launches.
//   ?flavor=freedoom → auto-prime bundled Freedoom; hero button
//                      launches.
//   ?flavor=legend   → auto-prime Freedoom + LoD pk3; hero button
//                      launches.
//   (default)        → flavor picker is the user gesture; click a
//                      card to prime + launch the chosen flavor.
//
// The picker click is itself the user gesture for the chosen flavor,
// which means AudioContext / fullscreen unlock the same way they
// would on a single hero-button click. The hero is unused in picker
// mode and stays hidden via body.picker-mode CSS.

(function () {
  if (window.heymingAnalytics) window.heymingAnalytics.enable('play-counts');
  var params = new URLSearchParams(window.location.search);
  if (window.DoomFlavors) window.DoomFlavors.mount(document);
  var FLAVORS = {};
  var flavorList = window.DOOM_FLAVORS || [];
  for (var fi = 0; fi < flavorList.length; fi++) FLAVORS[flavorList[fi].id] = flavorList[fi];
  if (params.get('manual') === '1') {
    document.addEventListener('DOMContentLoaded', function () {
      var freedoom = document.getElementById('useFreedoomBtn');
      if (!freedoom || document.activeElement !== document.body) return;
      try {
        freedoom.focus({ preventScroll: true, focusVisible: true });
      } catch (err) {
        freedoom.focus();
      }
    });
    return;
  }

  // GA helper for the DOOM flavor funnel. We want to know how often
  // the engine actually boots vs bails during the multi-MB load, and
  // which flavor + which entry path (picker click vs ?flavor=NAME
  // auto-launch). analytics.js exposes window.trackEvent globally;
  // it no-ops on localhost.
  function trackDoomEvent(name, label, value) {
    if (typeof window.trackEvent !== 'function') return;
    window.trackEvent(name, 'DoomFlavor', label, value);
  }

  // Move focus onto a control that just became usable, unless the
  // visitor is already on another control.
  function focusIdle(el, force) {
    if (!el || el.disabled) return;
    var remote = window.heymingRemote;
    if (remote && typeof remote.focusIfIdle === 'function') {
      remote.focusIfIdle(el, !!force, true);
      return;
    }
    var active = document.activeElement;
    if (!force && active && active !== document.body && active !== document.documentElement) {
      return;
    }
    try {
      el.focus({ preventScroll: true });
    } catch (err) {
      try {
        el.focus();
      } catch (err2) {
        /* control cannot take focus */
      }
    }
  }

  // Flavor cards are <button>s, so the offer lives in #doomFailNext (or in
  // the auto-launch instructions, which is a div). hidden is cleared here
  // because the slot starts hidden and an author display:flex would otherwise
  // lose to nothing once the class is added.
  function offerDoomNext(parent) {
    if (!parent || !window.DoomNextApps) return;
    parent.hidden = false;
    window.DoomNextApps.mount(parent, 'doom_fail');
  }

  // A launch request is not a successful engine launch. Wait for the shared
  // lifecycle to confirm the first playable frame, then detach so one run
  // produces exactly one outcome event.
  function trackLaunchWhenPlaying(flavor, entryPath, startedAt) {
    var lifecycle = window.UZDoomLifecycle;
    if (!lifecycle || typeof lifecycle.subscribe !== 'function') return;
    var unsubscribe = function () {};
    unsubscribe = lifecycle.subscribe(function (state) {
      if (state.phase === 'playing') {
        unsubscribe();
        trackDoomEvent(
          'doom_engine_launched',
          flavor + ':' + entryPath,
          Math.round((Date.now() - startedAt) / 1000)
        );
        var countsReady =
          window.heymingAnalytics && typeof window.heymingAnalytics.enable === 'function'
            ? window.heymingAnalytics.enable('play-counts')
            : null;
        Promise.resolve(countsReady).then(function () {
          if (window.heymingCounts && typeof window.heymingCounts.recordDoomPlay === 'function') {
            window.heymingCounts.recordDoomPlay(flavor);
          }
        });
      } else if (state.phase === 'error' || state.phase === 'exited') {
        unsubscribe();
      }
    });
  }

  // Wait for window.UZDoomLoader to publish (loader IIFE runs
  // after engine scripts inject post-COI). Bounded poll, ~50ms.
  async function waitForLoader() {
    var deadline = Date.now() + 30000;
    while (!window.UZDoomLoader) {
      if (Date.now() > deadline) throw new Error('UZDoomLoader never appeared');
      await new Promise(function (r) {
        setTimeout(r, 50);
      });
    }
    return window.UZDoomLoader;
  }

  // Streaming fetch with byte-level progress callbacks. Used by
  // both the IWAD and mod fetches so the user gets a real
  // progress bar during the 73 MB Castlevania download (and
  // every other multi-MB flavor). Falls back to non-streaming
  // arrayBuffer() if the body isn't readable, which is unusual
  // on modern browsers but worth handling so the page doesn't
  // hard-fail on some exotic transport.
  //
  // Wrapper applies one retry with a short backoff for transient
  // network errors (CDN cache miss on first byte, 5xx, AbortError).
  // The picker-side `Failed to fetch` TypeError is the dominant
  // first-load failure mode we see, and most of those are first-byte
  // CDN misses that recover on retry — cheap fix, 750ms cost on the
  // unlucky path.
  function isFailedToFetch(err) {
    return /failed to fetch/i.test(String((err && err.message) || err));
  }

  // Direct CDN misses are the common first-load failure. One proxy pass
  // after the direct retry, then the caller records doom_flavor_failed.
  async function fetchViaProxy(url, onProgress) {
    var proxy = window.proxyService;
    if (!proxy || typeof proxy.fetchBinary !== 'function') {
      throw new TypeError('Failed to fetch');
    }
    if (onProgress) onProgress({ loaded: 0, total: 0 });
    var data = await proxy.fetchBinary(url, {
      skipDirect: true,
      maxRetries: 0,
      timeout: 120000
    });
    var bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (onProgress) onProgress({ loaded: bytes.byteLength, total: bytes.byteLength });
    return bytes;
  }

  async function fetchWithProgress(url, onProgress) {
    try {
      return await fetchWithProgressOnce(url, onProgress);
    } catch (err) {
      if (!isRetryableFetchError(err)) throw err;
      await new Promise(function (r) {
        setTimeout(r, 750);
      });
      try {
        return await fetchWithProgressOnce(url, onProgress);
      } catch (retryErr) {
        if (!isFailedToFetch(retryErr)) throw retryErr;
        return await fetchViaProxy(url, onProgress);
      }
    }
  }

  // 4xx (other than 408/429) are definitive — the file is missing
  // or the request is malformed. Don't waste time retrying those.
  // 5xx, 408, 429, and network/abort errors are transient.
  function isRetryableFetchError(err) {
    var msg = String((err && err.message) || err);
    var m = msg.match(/^HTTP (\d+)/);
    if (m) {
      var code = parseInt(m[1], 10);
      return code === 408 || code === 429 || (code >= 500 && code <= 599);
    }
    return true;
  }

  async function fetchWithProgressOnce(url, onProgress) {
    var res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    var total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
    if (!res.body || typeof res.body.getReader !== 'function') {
      if (onProgress) onProgress({ loaded: 0, total: total });
      var buf = await res.arrayBuffer();
      if (onProgress) onProgress({ loaded: buf.byteLength, total: buf.byteLength });
      return new Uint8Array(buf);
    }
    var reader = res.body.getReader();
    var chunks = [];
    var loaded = 0;
    var r = await reader.read();
    while (!r.done) {
      chunks.push(r.value);
      loaded += r.value.byteLength;
      if (onProgress) onProgress({ loaded: loaded, total: total });
      r = await reader.read();
    }
    var merged = new Uint8Array(loaded);
    var off = 0;
    for (var i = 0; i < chunks.length; i++) {
      merged.set(chunks[i], off);
      off += chunks[i].byteLength;
    }
    return merged;
  }

  function fmtMb(bytes) {
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  // Attach an inline progress block (status line + bar) to any
  // host element and return an updater. Used by the flavor
  // picker (host = clicked .flavor-card) and the autolaunch
  // hero (host = #cleanHero). One helper so the two modes show
  // identical loading UX.
  //
  // The returned `set(text, pct)`:
  //   - text: human-readable status. If null, leaves text alone.
  //   - pct : 0–100 numeric for a determinate bar, or null/NaN
  //           for the slide animation (engine-boot phase has no
  //           byte total, just textual status).
  function attachLoadInfo(host) {
    if (!host) return null;
    var info = host.querySelector(':scope > .load-info');
    if (!info) {
      info = document.createElement('span');
      info.className = 'load-info';
      info.innerHTML =
        '<span class="load-text">Starting…</span>' +
        '<span class="load-bar indeterminate"><span class="load-bar-fill"></span></span>';
      host.appendChild(info);
    }
    host.classList.add('has-load-info');
    var textEl = info.querySelector('.load-text');
    var barEl = info.querySelector('.load-bar');
    var fillEl = info.querySelector('.load-bar-fill');

    // Coalesce updates onto the next animation frame. A 73 MB
    // streamed download can fire 1000+ progress callbacks per
    // second; without rAF batching each one triggers a layout
    // flush on .textContent / .style.width writes. With it,
    // we do at most one DOM update per frame.
    var pendingText = null;
    var pendingPct;
    var hasPendingPct = false;
    var frameId = null;
    function flush() {
      frameId = null;
      if (pendingText != null && textEl) textEl.textContent = pendingText;
      if (hasPendingPct && barEl && fillEl) {
        if (pendingPct == null || !isFinite(pendingPct)) {
          barEl.classList.add('indeterminate');
        } else {
          barEl.classList.remove('indeterminate');
          var clamped = Math.max(0, Math.min(100, pendingPct));
          fillEl.style.width = clamped.toFixed(1) + '%';
        }
      }
      pendingText = null;
      pendingPct = undefined;
      hasPendingPct = false;
    }

    return {
      set: function (text, pct) {
        if (text != null) pendingText = text;
        if (arguments.length >= 2) {
          pendingPct = pct;
          hasPendingPct = true;
        }
        if (frameId == null) {
          frameId =
            typeof requestAnimationFrame === 'function'
              ? requestAnimationFrame(flush)
              : setTimeout(flush, 16);
        }
      }
    };
  }

  // Mirror engine-boot status into a load-info UI. Once the
  // fetch phase is done the loader takes over and pushes textual
  // status into #status / #statusRight ("Fetching brightmaps…",
  // "Syncing saves from IndexedDB…", "Booting engine…"). Without
  // mirroring, those updates would happen way down in the boot
  // panel — out of view on mobile — and the loading card would
  // sit on the last fetch message until the engine takes over
  // the canvas. Returns a stop() so callers can detach early.
  function mirrorEngineStatus(ui) {
    if (!ui) return function () {};
    var statusEl = document.getElementById('status');
    var statusRightEl = document.getElementById('statusRight');
    if (!statusEl) return function () {};
    function refresh() {
      var l = (statusEl.textContent || '').trim();
      var r = (statusRightEl && statusRightEl.textContent) || '';
      r = r.trim();
      if (!l && !r) return;
      ui.set(l + (r ? ' — ' + r : ''), null);
    }
    var mo = new MutationObserver(refresh);
    mo.observe(statusEl, { childList: true, characterData: true, subtree: true });
    if (statusRightEl) {
      mo.observe(statusRightEl, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
    refresh();
    var unsub = function () {};
    if (window.UZDoomLifecycle) {
      unsub = window.UZDoomLifecycle.subscribe(function (state) {
        if (state.phase === 'playing' || state.phase === 'error' || state.phase === 'exited') {
          mo.disconnect();
          if (unsub) unsub();
        }
      });
    }
    return function stop() {
      mo.disconnect();
      if (unsub) unsub();
    };
  }

  // Resolve the IWAD descriptor for primeWith. Either fetch a
  // remote .wad (Classic DOOM) and hand the loader the bytes, or
  // hand it one of the bundled Freedoom references (no fetch
  // needed). Both freedoom1.wad (Doom 1 IWAD) and freedoom2.wad
  // (Doom 2 IWAD) are preloaded into the WASM virtual filesystem
  // — see uzdoom-loader.js BUNDLED_IWADS. Doom 2-family mods
  // (e.g. Spram's Metroid Doom, Plutonia mapsets) require the
  // Doom 2 IWAD; Doom 1-family (e.g. Legend of Doom) need
  // freedoom1.
  async function resolveIwad(cfg, onProgress) {
    if (cfg.iwadUrl) {
      var data = await fetchWithProgress(cfg.iwadUrl, onProgress);
      return { name: cfg.iwadName, data: data };
    }
    var bundled = cfg.bundledIwad || 'freedoom1.wad';
    return { name: bundled + ' (bundled)', data: null, bundled: bundled };
  }

  // Pull named WADs out of a downloaded zip, in zipWads order.
  // UZDoomModdbArchive is published by moddb-archive.js, which is a
  // deferred module and has run before a flavor can launch.
  async function unpackZipWads(bytes, names) {
    var archive = window.UZDoomModdbArchive;
    if (!archive || typeof archive.extractZip !== 'function') {
      throw new Error('archive helper missing');
    }
    var wanted = {};
    for (var n = 0; n < names.length; n++) {
      wanted[String(names[n]).split(/[/\\]/).pop().toLowerCase()] = true;
    }
    var entries = await archive.extractZip(bytes, {
      filter: function (name) {
        var base = String(name).split(/[/\\]/).pop().toLowerCase();
        return !!wanted[base];
      }
    });
    var byName = {};
    for (var i = 0; i < entries.length; i++) {
      byName[String(entries[i].name).toLowerCase()] = entries[i];
    }
    return names.map(function (name) {
      var hit = byName[name.toLowerCase()];
      if (!hit || !hit.data) throw new Error('missing ' + name + ' in map pack');
      return { name: name, data: hit.data };
    });
  }

  // primeFlavor's `onProgress` is the single channel the picker
  // and autolaunch UIs subscribe to during the fetch phase.
  // Receives { stage, loaded, total, label } where stage is
  // 'iwad' | 'mod' | 'done' and loaded/total are combined bytes
  // across both files (so a single bar tracks the whole prime).
  async function primeFlavor(flavor, onProgress) {
    var cfg = FLAVORS[flavor];
    if (!cfg) throw new Error('unknown flavor: ' + flavor);
    var loader = await waitForLoader();

    // Combined-bytes progress across the IWAD and every mod.
    // Fetches still run in parallel — the previous parallel
    // structure was a real cold-start win and we keep it — but
    // every callback accumulates into a single reported total so
    // the UI shows one steady bar. mods[] order is load order.
    var modList = Array.isArray(cfg.mods)
      ? cfg.mods
      : cfg.modUrl
      ? [{ url: cfg.modUrl, name: cfg.modName }]
      : [];
    var zips = Array.isArray(cfg.zips)
      ? cfg.zips
      : cfg.zipUrl
      ? [{ url: cfg.zipUrl, label: cfg.zipLabel, files: cfg.zipWads }]
      : [];
    var slotCount = modList.length + zips.length;
    var prog = {
      iwad: { loaded: 0, total: 0 },
      mods: [],
      label: cfg.iwadName || cfg.bundledIwad || 'engine'
    };
    for (var slot = 0; slot < slotCount; slot++) {
      prog.mods.push({ loaded: 0, total: 0 });
    }
    function sumBytes() {
      var loaded = prog.iwad.loaded;
      var total = prog.iwad.total;
      for (var i = 0; i < prog.mods.length; i++) {
        loaded += prog.mods[i].loaded;
        total += prog.mods[i].total;
      }
      return { loaded: loaded, total: total };
    }
    function report(stage) {
      if (!onProgress) return;
      var bytes = sumBytes();
      onProgress({
        stage: stage,
        loaded: bytes.loaded,
        total: bytes.total,
        label: stage === 'mod' ? prog.label : cfg.iwadName || cfg.bundledIwad || 'engine'
      });
    }

    var iwadPromise = resolveIwad(cfg, function (p) {
      prog.iwad = p;
      report('iwad');
    });
    var modPromises = modList.map(function (mod, i) {
      return fetchWithProgress(mod.url, function (p) {
        prog.mods[i] = p;
        prog.label = mod.name || 'mod';
        report('mod');
      }).then(function (data) {
        return { name: mod.name, data: data };
      });
    });

    var zipPromises = zips.map(function (zip, i) {
      return fetchWithProgress(zip.url, function (p) {
        prog.mods[modList.length + i] = p;
        prog.label = zip.label || 'map pack';
        report('mod');
      }).then(function (bytes) {
        return unpackZipWads(bytes, zip.files || []);
      });
    });

    var iwad = await iwadPromise;
    var fileMods = await Promise.all(modPromises);
    var zipGroups = await Promise.all(zipPromises);
    var zipMods = [];
    for (var g = 0; g < zipGroups.length; g++) zipMods = zipMods.concat(zipGroups[g]);
    var mods = fileMods.concat(zipMods);

    if (onProgress) {
      var doneBytes = sumBytes();
      onProgress({
        stage: 'done',
        loaded: doneBytes.loaded,
        total: doneBytes.total,
        label: 'Handoff to engine…'
      });
    }

    await loader.primeWith({ iwad: iwad, mods: mods });
    console.log('[flavor] primed ' + flavor);
  }

  // Translate a primeFlavor progress event into a status line
  // string for the inline load-info UI. Single helper so picker
  // and autolaunch read the same way.
  function formatPrimeProgress(p) {
    var prefix =
      p.stage === 'mod'
        ? 'Downloading ' + p.label
        : p.stage === 'done'
        ? 'Handoff to engine…'
        : 'Downloading ' + p.label;
    if (!p.total) {
      return prefix + ' — ' + fmtMb(p.loaded);
    }
    var pct = Math.round((p.loaded / p.total) * 100);
    return prefix + ' — ' + fmtMb(p.loaded) + ' / ' + fmtMb(p.total) + ' (' + pct + '%)';
  }

  function applyFlavorBranding(flavor) {
    var cfg = FLAVORS[flavor];
    if (!cfg) return;
    if (window.prependBaseTitle) window.prependBaseTitle(cfg.title);
    var emoji = document.getElementById('brandEmoji');
    var title = document.getElementById('brandTitle');
    var tagline = document.getElementById('heroTagline');
    if (emoji) emoji.textContent = cfg.emoji || '';
    if (title && title.firstChild) title.firstChild.textContent = cfg.brand || cfg.title;
    if (tagline) tagline.textContent = cfg.tagline;
  }

  // Hero button (clean / ?flavor=... mode): subscribe to lifecycle,
  // click forwards to UZDoomLoader.launch().
  function wireHeroButton(flavor) {
    var btn = document.getElementById('cleanLaunchBtn');
    if (!btn) return;
    var cfg = FLAVORS[flavor];
    var hero = document.getElementById('cleanHero');
    var ui = attachLoadInfo(hero);
    var mirrorStarted = false;
    if (window.UZDoomLifecycle) {
      window.UZDoomLifecycle.subscribe(function (state) {
        if (state.phase === 'primed') {
          btn.textContent = (cfg && cfg.launchLabel) || 'Launch';
          btn.disabled = false;
          focusIdle(btn);
        } else if (state.phase === 'launching') {
          btn.textContent = 'Loading…';
          btn.disabled = true;
          // Engine boot has started — start mirroring #status
          // into the hero UI so the user keeps seeing live
          // progress all the way to first frame.
          if (ui && !mirrorStarted) {
            mirrorStarted = true;
            mirrorEngineStatus(ui);
          }
        } else if (state.phase === 'error') {
          var reason = (state.detail && state.detail.reason) || 'unknown';
          btn.textContent =
            reason === 'coi' ? 'Cross-origin isolation failed' : 'Failed: ' + reason;
          btn.disabled = true;
        }
      });
    }
    btn.addEventListener('click', async function () {
      if (window.UZDoomLifecycle && window.UZDoomLifecycle.get() !== 'primed') return;
      var tStart = Date.now();
      trackLaunchWhenPlaying(flavor, 'autolaunch', tStart);
      btn.textContent = 'Loading…';
      btn.disabled = true;
      // Yield so the Loading label paints before WASM boot work.
      if (typeof window.yieldToMain === 'function') {
        await window.yieldToMain();
      } else {
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
      }
      if (window.UZDoomLoader) window.UZDoomLoader.launch();
    });
    return ui;
  }

  // Picker mode: each flavor card is the user gesture. Click ⇒
  // disable both cards, prime that flavor, then launch.
  function wireFlavorPicker() {
    var picker = document.getElementById('flavorPicker');
    if (!picker) return;

    var cards = picker.querySelectorAll('.flavor-card');

    function setEnabled(enabled, message) {
      cards.forEach(function (c) {
        c.disabled = !enabled;
        var cta = c.querySelector('.cta');
        if (cta) cta.textContent = message || cta.dataset.defaultCta || '';
      });
    }
    // Surface terminal lifecycle errors (COI failure, wasm-abort)
    // on the cards themselves so the user isn't left clicking a
    // dead UI.
    if (window.UZDoomLifecycle) {
      window.UZDoomLifecycle.subscribe(function (state) {
        if (state.phase === 'error') {
          var reason = (state.detail && state.detail.reason) || 'unknown';
          setEnabled(false, reason === 'coi' ? 'COI failed' : 'Engine error: ' + reason);
        }
      });
    }

    // The engine script stays unloaded until launch. Cards are usable
    // immediately so a click can paint Loading before that parse.
    focusIdle(cards[0]);

    // Back from a pushed ?flavor= entry returns to the picker URL in
    // this same document. Reload so the running launch does not stay
    // on screen after the address bar has gone home.
    window.addEventListener('popstate', function () {
      var flavor = new URL(window.location.href).searchParams.get('flavor');
      if (flavor && FLAVORS[flavor]) return;
      window.location.reload();
    });

    cards.forEach(function (card) {
      card.addEventListener('click', async function () {
        if (card.disabled) return;
        var flavor = card.dataset.flavor;
        // Push a history entry so Back returns to the picker, and so a
        // COI reload resumes this game instead of forgetting the click.
        if (FLAVORS[flavor]) {
          var picked = new URL(window.location.href);
          if (picked.searchParams.get('flavor') !== flavor) {
            picked.search = 'flavor=' + encodeURIComponent(flavor);
            // Prototype call: gtag's history wrapper would count this as a page view.
            if (window.pushHistorySilent) window.pushHistorySilent({ flavor: flavor }, picked);
            else History.prototype.pushState.call(history, { flavor: flavor }, '', String(picked));
          }
        }
        var tStart = Date.now();
        cards.forEach(function (c) {
          c.disabled = true;
        });
        card.classList.add('loading');
        var cta = card.querySelector('.cta');
        if (cta) cta.textContent = 'Loading';

        // Flip the boot overlay into loading-focus mode: hides
        // the other (now-disabled) cards, the manual-mode
        // instructions, and the warning banner so the clicked
        // card becomes the visual focus and its inline progress
        // is unmistakable.
        document.body.classList.add('flavor-loading');

        // Attach the inline progress UI to this card. The UI
        // gets driven first by primeFlavor's byte-level fetch
        // callbacks (real determinate bar across the ~73 MB
        // Castlevania download), then by mirrorEngineStatus
        // (indeterminate bar with live engine-boot text).
        var ui = attachLoadInfo(card);
        if (ui) ui.set('Preparing…', null);
        var stopMirror = null;

        // Paint Loading before multi-MB prime + WASM launch so the
        // click's INP closes on the visual feedback frame (Search
        // Console flagged /doom/ just over the 200ms good threshold).
        if (typeof window.yieldToMain === 'function') {
          await window.yieldToMain();
        } else {
          await new Promise(function (r) {
            setTimeout(r, 0);
          });
        }

        try {
          applyFlavorBranding(flavor);
          document.body.classList.add('flavor-' + flavor);
          await primeFlavor(flavor, function (p) {
            if (!ui) return;
            var pct = p.total ? (p.loaded / p.total) * 100 : null;
            ui.set(formatPrimeProgress(p), pct);
          });
          // Switch to engine-boot mirroring. The detach happens
          // automatically when lifecycle reaches playing/error/
          // exited, so we don't need to track this except to
          // bail in the catch below.
          if (ui) stopMirror = mirrorEngineStatus(ui);
          trackLaunchWhenPlaying(flavor, 'picker', tStart);
          if (window.UZDoomLoader) window.UZDoomLoader.launch();
        } catch (e) {
          console.warn('[flavor picker] failed:', e);
          trackDoomEvent(
            'doom_flavor_failed',
            flavor + ':picker: ' + String(e.message || e).slice(0, 80)
          );
          if (window.UZDoomLifecycle && !window.UZDoomLifecycle.isTerminal()) {
            window.UZDoomLifecycle.markError('flavor-prime', {
              message: String(e.message || e)
            });
          }
          if (stopMirror) stopMirror();
          if (ui) ui.set('Failed: ' + String(e.message || e), 0);
          card.classList.remove('loading');
          document.body.classList.remove('flavor-loading');
          if (cta) cta.textContent = 'Failed — reload to retry';
          offerDoomNext(document.getElementById('doomFailNext'));
        }
      });
    });
  }

  // Auto-launch path (?flavor=NAME): prime in the background, hero
  // button enables on `primed`, user clicks it to launch.
  async function autoLaunch(flavor) {
    applyFlavorBranding(flavor);
    var ui = wireHeroButton(flavor);
    if (ui) ui.set('Preparing…', null);
    try {
      await primeFlavor(flavor, function (p) {
        if (!ui) return;
        var pct = p.total ? (p.loaded / p.total) * 100 : null;
        ui.set(formatPrimeProgress(p), pct);
      });
      if (ui) ui.set('Ready — click Launch.', 100);
    } catch (e) {
      console.warn('[flavor auto-launch] priming failed:', e);
      if (ui) ui.set('Failed: ' + String(e.message || e), 0);
      trackDoomEvent(
        'doom_flavor_failed',
        flavor + ':autolaunch: ' + String(e.message || e).slice(0, 80)
      );
      var alreadyTerminal = window.UZDoomLifecycle && window.UZDoomLifecycle.isTerminal();
      if (!alreadyTerminal && window.UZDoomLifecycle) {
        window.UZDoomLifecycle.markError('autoprime', { message: String(e.message || e) });
      }
      var inst = document.getElementById('autoInstructions');
      if (!alreadyTerminal && inst) {
        inst.classList.remove('manual-only');
        inst.innerHTML =
          '<b>⚠ Auto-setup failed.</b>' +
          '<p style="margin:6px 0 0 0">' +
          'Could not prepare ' +
          FLAVORS[flavor].title +
          ' automatically (' +
          String(e.message || e) +
          '). Reload with <code>?manual=1</code> to pick files by hand.</p>';
        inst.style.display = 'block';
        offerDoomNext(inst);
      } else {
        offerDoomNext(document.getElementById('doomFailNext'));
      }
    }
  }

  // Flavor switcher — generic. Wires any root element that follows
  // the (.flavor-switcher > [data-role=toggle], [data-role=menu])
  // shape. Used twice on the page:
  //
  //   1. The inline #flavorPickerSwitcher dropdown on the picker
  //      page, replacing the old "Use custom IWAD / mods…" link.
  //      Always visible while the user is on the picker.
  //
  //   2. The floating #flavorSwitcher in the top-right corner
  //      while the engine is running. Hidden until lifecycle hits
  //      `playing`; opts.revealOnPlaying = true.
  //
  // Both menus carry identical items: 3 flavors + a "Manual mode"
  // option that navigates to ?manual=1. We don't try to hot-swap
  // inside the running engine — uz-doom doesn't expose a clean
  // "swap IWAD/PK3" call and the wasm runtime would have to be
  // torn down anyway. Saves persist via IDBFS, so a full reload
  // is non-destructive.
  function wireFlavorSwitcher(rootOrId, opts) {
    opts = opts || {};
    var root = typeof rootOrId === 'string' ? document.getElementById(rootOrId) : rootOrId;
    if (!root) return;
    var btn = root.querySelector('[data-role="toggle"]');
    var menu = root.querySelector('[data-role="menu"]');
    if (!btn || !menu) return;

    // Identify the currently active flavor from the body class
    // (set by the early mode-switch script for ?flavor=... URLs;
    // set by wireFlavorPicker on card click).
    function activeFlavor() {
      var cls = document.body.className.match(/\bflavor-(\w+)\b/);
      return cls ? cls[1] : null;
    }
    function isManualMode() {
      return params.get('manual') === '1';
    }
    function isModdbMode() {
      return params.get('manual') === 'browse';
    }

    function paintActive() {
      var active = activeFlavor();
      var manual = isManualMode();
      var moddb = isModdbMode();
      menu.querySelectorAll('button[data-switch]').forEach(function (b) {
        var s = b.dataset.switch;
        var match;
        if (s === 'manual') match = manual;
        else if (s === 'moddb') match = moddb;
        else match = s === active;
        if (match) {
          b.dataset.active = 'true';
          b.disabled = true;
        } else {
          delete b.dataset.active;
          b.disabled = false;
        }
      });
    }

    function openMenu() {
      paintActive();
      menu.classList.remove('hidden');
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-modal', 'true');
      if (!menu.getAttribute('aria-label')) menu.setAttribute('aria-label', 'More ways to play');
      root.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      var first = menu.querySelector('button:not([disabled])');
      if (first) {
        try {
          first.focus({ preventScroll: true, focusVisible: true });
        } catch (err) {
          first.focus();
        }
      }
    }
    function closeMenu() {
      var wasOpen = !menu.classList.contains('hidden');
      menu.classList.add('hidden');
      menu.setAttribute('role', 'menu');
      menu.removeAttribute('aria-modal');
      root.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      if (wasOpen) {
        try {
          btn.focus({ preventScroll: true, focusVisible: true });
        } catch (err) {
          btn.focus();
        }
      }
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.classList.contains('hidden')) openMenu();
      else closeMenu();
    });

    menu.addEventListener('click', function (e) {
      var t = e.target.closest('button[data-switch]');
      if (!t || t.disabled) return;
      var f = t.dataset.switch;
      // Reload the page with the chosen mode. Pure URL change +
      // reload is the simplest way to reuse the auto-launch /
      // manual paths without stitching together a partial engine
      // teardown.
      if (f === 'manual') {
        window.location.search = 'manual=1';
        return;
      }
      if (f === 'moddb') {
        window.location.search = 'manual=browse';
        return;
      }
      if (!FLAVORS[f]) return;
      window.location.search = 'flavor=' + encodeURIComponent(f);
    });

    // Click-outside to dismiss. Capture phase so engine canvas
    // clicks (which may swallow propagation) still close the menu.
    document.addEventListener(
      'click',
      function (e) {
        if (menu.classList.contains('hidden')) return;
        if (root.contains(e.target)) return;
        closeMenu();
      },
      true
    );
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.classList.contains('hidden')) closeMenu();
    });

    // Reveal on `playing`. Used by the floating in-game variant;
    // the inline picker variant is always visible (no `.hidden`
    // class on it to begin with).
    if (opts.revealOnPlaying && window.UZDoomLifecycle) {
      window.UZDoomLifecycle.subscribe(function (state) {
        if (state.phase === 'playing') {
          root.classList.remove('hidden');
        } else if (state.phase === 'exited' || state.phase === 'error') {
          root.classList.add('hidden');
          closeMenu();
        }
      });
    }
  }

  function start() {
    // Floating in-game switcher: hidden until lifecycle = playing.
    wireFlavorSwitcher('flavorSwitcher', { revealOnPlaying: true });
    // Inline switcher on the picker page (replaces the old
    // "Use custom IWAD / mods…" link). Hidden in non-picker modes
    // via body.clean / body:not(.picker-mode) CSS.
    wireFlavorSwitcher('flavorPickerSwitcher');
    var flavor = params.get('flavor');
    if (flavor && FLAVORS[flavor]) {
      autoLaunch(flavor);
    } else {
      wireFlavorPicker();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
