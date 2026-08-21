/**
 * Capability probe for browsers with no developer tools — console web views
 * above all (the PS5 system browser has no console, no reload button, and no
 * remote inspector).
 *
 * Deliberate constraints, since this page is the thing you reach for when the
 * normal machinery is what's suspect:
 *   - classic script, no ES modules (module support is itself a probe)
 *   - no imports, no CDN, no shared site scripts
 *   - no optional chaining or nullish coalescing, so old engines can parse it
 */
(function () {
  'use strict';

  var MAX_LOG = 16;
  var PAD_RENDER_MS = 100;

  function el(id) {
    return document.getElementById(id);
  }

  function verdict(ok) {
    return ok ? 'pass' : 'fail';
  }

  /** Render an array of [label, value, className] into a `.rows` grid. */
  function renderRows(target, rows) {
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i][0];
      var v = rows[i][1];
      var cls = rows[i][2] ? ' ' + rows[i][2] : '';
      html +=
        '<span class="k">' +
        escapeHtml(k) +
        '</span>' +
        '<span class="v' +
        cls +
        '">' +
        escapeHtml(String(v)) +
        '</span>';
    }
    target.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Engine ──────────────────────────────────────────────────────── */

  /**
   * The only conclusive WebAssembly test is compiling a module: an engine can
   * expose the namespace and still refuse to build one. This is the 8-byte
   * empty module (magic number + version).
   */
  function wasmStatus() {
    if (typeof WebAssembly !== 'object' || WebAssembly === null) {
      return 'missing (typeof WebAssembly === "' + typeof WebAssembly + '")';
    }
    if (typeof WebAssembly.Module !== 'function') return 'namespace present, no Module constructor';
    try {
      new WebAssembly.Module(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    } catch (err) {
      return 'namespace present, compile failed: ' + err;
    }
    return 'yes, compiles';
  }

  function contextFlag(name) {
    var canvas = document.createElement('canvas');
    try {
      return !!canvas.getContext(name);
    } catch (err) {
      return false;
    }
  }

  function audioCtor() {
    return window.AudioContext || window.webkitAudioContext || null;
  }

  /** gamepad-keys.js synthesizes events with this constructor, so probe it. */
  function keyboardEventConstructible() {
    try {
      var ev = new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp' });
      return ev.code === 'ArrowUp';
    } catch (err) {
      return false;
    }
  }

  function renderEngine() {
    var Ctor = audioCtor();
    var wasm = wasmStatus();
    var webgl2 = contextFlag('webgl2');
    var webgl1 = contextFlag('webgl') || contextFlag('experimental-webgl');
    var pointer = typeof window.PointerEvent === 'function' && 'onpointerdown' in window;
    var pads = typeof navigator.getGamepads === 'function';
    var modules = window.__esModules === true;
    var kbd = keyboardEventConstructible();
    var worklet = !!(Ctor && Ctor.prototype && 'audioWorklet' in Ctor.prototype);

    renderRows(el('engine'), [
      ['User agent', navigator.userAgent],
      ['WebAssembly', wasm, wasm.indexOf('yes') === 0 ? 'pass' : 'fail'],
      [
        'SharedArrayBuffer',
        typeof SharedArrayBuffer !== 'undefined',
        verdict(typeof SharedArrayBuffer !== 'undefined')
      ],
      [
        'crossOriginIsolated',
        String(window.crossOriginIsolated),
        window.crossOriginIsolated ? 'pass' : 'warn'
      ],
      ['ES modules', modules, verdict(modules)],
      ['WebGL 1', webgl1, verdict(webgl1)],
      ['WebGL 2', webgl2, verdict(webgl2)],
      [
        'AudioContext',
        Ctor ? (window.AudioContext ? 'AudioContext' : 'webkitAudioContext only') : 'missing',
        verdict(!!Ctor)
      ],
      ['AudioWorklet', worklet, worklet ? 'pass' : 'warn'],
      ['Pointer Events', pointer, verdict(pointer)],
      ['Touch Events', 'ontouchstart' in window],
      ['navigator.getGamepads', pads, verdict(pads)],
      ['new KeyboardEvent()', kbd, verdict(kbd)],
      ['Device pixel ratio', window.devicePixelRatio],
      ['Viewport', window.innerWidth + ' × ' + window.innerHeight]
    ]);
  }

  /* ── Audio ───────────────────────────────────────────────────────── */

  var ctx = null;

  function playTone() {
    var Ctor = audioCtor();
    if (!Ctor) {
      renderRows(el('audio'), [['Result', 'No AudioContext constructor on this engine.', 'fail']]);
      return;
    }

    var createdState;
    if (!ctx) {
      ctx = new Ctor();
      createdState = ctx.state;
    } else {
      createdState = '(existing context) ' + ctx.state;
    }

    var stateBefore = ctx.state;
    if (ctx.state !== 'running' && typeof ctx.resume === 'function') {
      ctx.resume().catch(function () {});
    }

    // The silent one-frame buffer is the WebKit output unlock that
    // play/shared/audio.js performs; replicate it so this page tests the same
    // path the instruments take.
    var unlocked = true;
    try {
      var silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      silent.connect(ctx.destination);
      silent.start(0);
    } catch (err) {
      unlocked = false;
    }

    var clockStart = ctx.currentTime;
    var analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.frequency.value = 440;
    gain.gain.value = 0.25;
    osc.connect(gain);
    gain.connect(analyser);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1);

    renderRows(el('audio'), [['Result', 'Playing… metering in progress.', 'warn']]);

    window.setTimeout(function () {
      var data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      // Time-domain samples center on 128; peak deviation is the signal level.
      var peak = 0;
      for (var i = 0; i < data.length; i++) {
        var dev = Math.abs(data[i] - 128);
        if (dev > peak) peak = dev;
      }
      var clockMoved = ctx.currentTime - clockStart;
      var running = ctx.state === 'running';
      var signal = peak > 2;

      var summary;
      var summaryClass;
      if (!running || clockMoved <= 0) {
        summary =
          'Context never started (state "' +
          ctx.state +
          '", clock did not advance). Nothing could be audible.';
        summaryClass = 'fail';
      } else if (!signal) {
        summary = 'Context runs but the graph produced no signal — node scheduling is broken.';
        summaryClass = 'fail';
      } else {
        summary =
          'Graph is running and producing signal. If you heard nothing, this browser does not route Web Audio to the speakers.';
        summaryClass = 'pass';
      }

      renderRows(el('audio'), [
        ['State on create', createdState],
        ['State before tone', stateBefore],
        ['State after tone', ctx.state, running ? 'pass' : 'fail'],
        ['Silent-buffer unlock', unlocked ? 'accepted' : 'threw', verdict(unlocked)],
        ['Clock advanced', clockMoved.toFixed(3) + ' s', clockMoved > 0 ? 'pass' : 'fail'],
        ['Sample rate', ctx.sampleRate + ' Hz'],
        ['In-graph peak', peak + ' / 127', signal ? 'pass' : 'fail'],
        ['Verdict', summary, summaryClass]
      ]);
    }, 400);
  }

  /* ── Input log ───────────────────────────────────────────────────── */

  var log = [];

  function describe(ev) {
    if (ev.type.indexOf('key') === 0) {
      return (
        'key=' + ev.key + ' code=' + ev.code + ' keyCode=' + ev.keyCode + ' trusted=' + ev.isTrusted
      );
    }
    if (ev.type.indexOf('pointer') === 0) {
      return 'pointerType=' + ev.pointerType + ' button=' + ev.button + ' id=' + ev.pointerId;
    }
    if (ev.type.indexOf('mouse') === 0 || ev.type === 'click') {
      return 'button=' + ev.button + ' x=' + ev.clientX + ' y=' + ev.clientY;
    }
    if (ev.type.indexOf('touch') === 0) {
      return 'touches=' + (ev.touches ? ev.touches.length : '?');
    }
    if (ev.gamepad) {
      return 'index=' + ev.gamepad.index + ' id=' + ev.gamepad.id;
    }
    return '';
  }

  function record(ev) {
    var stamp = new Date().toLocaleTimeString();
    log.unshift(stamp + '  ' + ev.type + '  ' + describe(ev));
    if (log.length > MAX_LOG) log.length = MAX_LOG;
    el('events').textContent = log.join('\n');
  }

  function watchInput() {
    var types = [
      'pointerdown',
      'pointerup',
      'mousedown',
      'mouseup',
      'click',
      'keydown',
      'keyup',
      'touchstart',
      'touchend',
      'gamepadconnected',
      'gamepaddisconnected'
    ];
    for (var i = 0; i < types.length; i++) {
      window.addEventListener(types[i], record, true);
    }
  }

  /* ── Gamepads ────────────────────────────────────────────────────── */

  var lastPadRender = 0;

  function pollPads(now) {
    window.requestAnimationFrame(pollPads);
    // A console browser has little CPU to spare; 10 Hz is plenty to read.
    if (now - lastPadRender < PAD_RENDER_MS) return;
    lastPadRender = now;

    var target = el('pads');
    if (typeof navigator.getGamepads !== 'function') {
      renderRows(target, [['Gamepad API', 'navigator.getGamepads is not a function', 'fail']]);
      return;
    }

    var list;
    try {
      list = navigator.getGamepads();
    } catch (err) {
      renderRows(target, [['Gamepad API', 'getGamepads() threw: ' + err, 'fail']]);
      return;
    }

    var rows = [];
    var found = 0;
    for (var i = 0; i < list.length; i++) {
      var pad = list[i];
      if (!pad) continue;
      found++;

      var pressed = [];
      var buttons = pad.buttons || [];
      for (var b = 0; b < buttons.length; b++) {
        var button = buttons[b];
        var down = button && (typeof button === 'object' ? button.pressed : button > 0.5);
        if (down) pressed.push(b);
      }

      var axes = [];
      for (var a = 0; a < (pad.axes || []).length; a++) {
        axes.push(pad.axes[a].toFixed(2));
      }

      rows.push(['Pad ' + pad.index, pad.id]);
      rows.push([
        '  mapping',
        pad.mapping || '(none)',
        pad.mapping === 'standard' ? 'pass' : 'warn'
      ]);
      rows.push(['  connected', String(pad.connected), pad.connected ? 'pass' : 'fail']);
      rows.push([
        '  buttons down',
        pressed.length ? pressed.join(', ') : '—',
        pressed.length ? 'pass' : ''
      ]);
      rows.push(['  axes', axes.length ? axes.join('  ') : '—']);
    }

    if (!found) {
      rows.push([
        'Pads detected',
        'none — press a button; if this stays empty the browser exposes no pad',
        'fail'
      ]);
    }
    renderRows(target, rows);
  }

  /* ── Init ────────────────────────────────────────────────────────── */

  function init() {
    renderEngine();
    watchInput();
    el('tone').addEventListener('click', playTone);
    el('clear').addEventListener('click', function () {
      log = [];
      el('events').textContent = 'Waiting for input…';
    });
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(pollPads);
    } else {
      renderRows(el('pads'), [['requestAnimationFrame', 'missing — cannot poll', 'fail']]);
    }
  }

  // Module scripts and other deferred work run before DOMContentLoaded, so
  // waiting for it is what makes the ES-modules probe meaningful.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
