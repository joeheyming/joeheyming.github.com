/**
 * runner.js — Sandboxed JavaScript runner. Sends source into a sandboxed
 * iframe via postMessage and captures console output.
 *
 * The iframe was injected by index.html with `sandbox="allow-scripts"`,
 * which means it has a null origin and no parent-DOM access. We use a fresh
 * srcdoc on every run so each run starts with a clean state.
 */

const RUNNER_HTML = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><title>runner</title></head>
<body>
<script>
(function(){
  function send(level, args){
    try {
      parent.postMessage({ source: 'code-ide-runner', level: level, args: args.map(format) }, '*');
    } catch (e) {
      parent.postMessage({ source: 'code-ide-runner', level: 'error', args: [String(e)] }, '*');
    }
  }
  function format(v){
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'function') return v.toString().slice(0, 200);
    try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
  }
  ['log','info','warn','error','debug'].forEach(function(level){
    var orig = console[level];
    console[level] = function(){
      send(level, [].slice.call(arguments));
      try { orig.apply(console, arguments); } catch(e){}
    };
  });
  window.onerror = function(msg, src, line, col){
    send('error', ['Uncaught ' + msg + ' (line ' + line + ':' + col + ')']);
    return false;
  };
  window.onunhandledrejection = function(e){
    send('error', ['Unhandled promise rejection: ' + (e.reason && e.reason.message || e.reason)]);
  };
  window.addEventListener('message', function(e){
    var data = e.data || {};
    if (data.source !== 'code-ide-host') return;
    if (data.kind === 'run') {
      send('system', ['▶ running ' + (data.name || 'snippet')]);
      try {
        // eslint-disable-next-line no-new-func
        var fn = new Function(data.code + '\n//# sourceURL=' + (data.name || 'snippet.js'));
        var ret = fn();
        if (ret && typeof ret.then === 'function') {
          ret.then(function(v){ if (v !== undefined) send('log', [v]); send('system', ['✓ done']); })
             .catch(function(err){ send('error', [err && err.stack || String(err)]); });
        } else {
          if (ret !== undefined) send('log', [ret]);
          send('system', ['✓ done']);
        }
      } catch (err) {
        send('error', [err && err.stack || String(err)]);
      }
    }
  });
  send('system', ['runner ready']);
})();
</script>
</body></html>`;

export class Runner {
  constructor(iframeEl, { onMessage } = {}) {
    this.iframe = iframeEl;
    this.onMessage = onMessage || (() => {});
    this.ready = this.boot();
    window.addEventListener('message', (e) => {
      if (e.data?.source === 'code-ide-runner') {
        this.onMessage({ level: e.data.level || 'log', args: e.data.args || [] });
      }
    });
  }

  boot() {
    return new Promise((resolve) => {
      const handler = () => {
        this.iframe.removeEventListener('load', handler);
        resolve();
      };
      this.iframe.addEventListener('load', handler);
      this.iframe.srcdoc = RUNNER_HTML;
    });
  }

  async run(code, name) {
    await this.ready;
    this.iframe.contentWindow.postMessage(
      { source: 'code-ide-host', kind: 'run', code, name },
      '*'
    );
  }

  async reset() {
    this.ready = this.boot();
    await this.ready;
  }
}
