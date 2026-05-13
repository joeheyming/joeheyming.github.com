// Engine script injection. Gated on cross-origin isolation via
// UZDoomCOI.whenReady(). If COI never arrives, the promise rejects
// and we bail; coi.js has already put up the error card and
// flipped the lifecycle to error{coi}.

(function () {
  function loadEngineInOrder() {
    var melt = document.createElement('script');
    melt.src = 'uzdoom-melt.js';
    melt.async = false;
    var t0Melt = performance.now();
    melt.onload = function () {
      console.log(
        '[uzdoom scripts] uzdoom-melt.js loaded in ' +
          (performance.now() - t0Melt).toFixed(0) +
          'ms'
      );
      var t0Loader = performance.now();
      var loader = document.createElement('script');
      loader.type = 'module';
      loader.src = 'uzdoom-loader.js';
      loader.async = false;
      loader.onload = function () {
        console.log(
          '[uzdoom scripts] uzdoom-loader.js loaded in ' +
            (performance.now() - t0Loader).toFixed(0) +
            'ms'
        );
        var t0Engine = performance.now();
        var engine = document.createElement('script');
        engine.src = 'uzdoom.js';
        engine.async = false;
        engine.onload = function () {
          console.log(
            '[uzdoom scripts] uzdoom.js loaded in ' +
              (performance.now() - t0Engine).toFixed(0) +
              'ms'
          );
        };
        engine.onerror = function (e) {
          console.warn('[uzdoom scripts] uzdoom.js failed:', (e && e.message) || '(no msg)');
        };
        document.body.appendChild(engine);
      };
      loader.onerror = function (e) {
        console.warn(
          '[uzdoom scripts] uzdoom-loader.js failed:',
          (e && e.message) || '(no msg)'
        );
      };
      document.body.appendChild(loader);
    };
    melt.onerror = function (e) {
      console.warn('[uzdoom scripts] uzdoom-melt.js failed:', (e && e.message) || '(no msg)');
    };
    document.body.appendChild(melt);
  }
  function gate() {
    if (window.UZDoomCOI) {
      window.UZDoomCOI.whenReady().then(loadEngineInOrder, function () {
        console.warn('[uzdoom scripts] COI never arrived; engine not loaded');
      });
    } else if (window.crossOriginIsolated) {
      loadEngineInOrder();
    } else {
      console.warn('[uzdoom scripts] UZDoomCOI missing and not isolated; engine not loaded');
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', gate, { once: true });
  } else {
    gate();
  }
})();
