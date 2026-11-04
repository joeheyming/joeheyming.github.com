// Engine script injection. The 700KB uzdoom.js parse blocks the main
// thread, so it stays unloaded until a launch asks for it. Cross-origin
// isolation is still required before the script runs; if COI never
// arrives the promise rejects and coi.js has already shown the error.

(function () {
  /** @type {Promise<void> | null} */
  var ready = null;

  /**
   * @param {string} src
   * @param {{ type?: string }} [attrs]
   * @returns {Promise<void>}
   */
  function loadScript(src, attrs) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.async = false;
      if (attrs && attrs.type) el.type = attrs.type;
      var t0 = performance.now();
      el.onload = function () {
        console.log(
          '[uzdoom scripts] ' + src + ' loaded in ' + (performance.now() - t0).toFixed(0) + 'ms'
        );
        resolve();
      };
      el.onerror = function () {
        reject(new Error(src + ' failed to load'));
      };
      document.body.appendChild(el);
    });
  }

  function loadEngineInOrder() {
    return loadScript('uzdoom-melt.js')
      .then(function () {
        return loadScript('uzdoom-loader.js', { type: 'module' });
      })
      .then(function () {
        return loadScript('uzdoom.js');
      });
  }

  function fail(err) {
    ready = null;
    console.warn('[uzdoom scripts] engine not loaded:', err);
    throw err;
  }

  /**
   * Load melt, the loader, and uzdoom.js once. Later calls share the promise.
   * @returns {Promise<void>}
   */
  function ensure() {
    if (ready) return ready;
    if (window.UZDoomCOI) {
      ready = window.UZDoomCOI.whenReady().then(loadEngineInOrder).catch(fail);
    } else if (window.crossOriginIsolated) {
      ready = loadEngineInOrder().catch(fail);
    } else {
      return Promise.reject(new Error('UZDoomCOI missing and not isolated'));
    }
    return ready;
  }

  window.UZDoomEngine = { ensure: ensure };
})();
