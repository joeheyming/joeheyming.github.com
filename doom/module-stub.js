// Emscripten Module stub. uzdoom.js attaches to window.Module; the
// stub here has to be in place BEFORE uzdoom.js runs, so the loader
// can override Module.onRuntimeInitialized, Module.setStatus, etc.
// from its own IIFE.

(function () {
  function log(tag, msg) {
    console.log('[uzdoom ' + tag + ']', msg);
  }
  var Module = {
    canvas: document.getElementById('canvas'),
    arguments: [],
    print: function (t) {
      console.log('[uzdoom]', t);
    },
    printErr: function (t) {
      console.warn('[uzdoom]', t);
    },
    setStatus: function (t) {
      var el = document.getElementById('status');
      if (el) el.textContent = t || '';
    },
    monitorRunDependencies: function (n) {
      Module.setStatus(n ? 'Loading engine… (' + n + ' deps)' : 'Engine ready.');
    },
    locateFile: function (path, prefix) {
      return prefix + path;
    },
    onAbort: function (reason) {
      console.warn('[uzdoom onAbort]', reason);
      if (window.UZDoomLifecycle) {
        window.UZDoomLifecycle.markError('wasm-abort', { reason: String(reason) });
      }
    }
  };
  window.Module = Module;
  log('module', 'stub installed, COI=' + !!window.crossOriginIsolated);

  // Alt+D: dump lifecycle phase history to alert (mobile diagnostic).
  document.addEventListener('keydown', function (e) {
    if (!e.altKey || e.key !== 'd') return;
    var h = (window.UZDoomLifecycle && window.UZDoomLifecycle.history()) || [];
    var fmt = h
      .map(function (e) {
        var d = '';
        if (e.detail) {
          try {
            d = ' ' + JSON.stringify(e.detail);
          } catch (_e) {}
        }
        return '+' + e.t.toFixed(0) + 'ms  ' + (e.from || '<init>') + ' → ' + e.phase + d;
      })
      .join('\n');
    alert('Lifecycle history:\n\n' + (fmt || '(empty)'));
  });
})();
