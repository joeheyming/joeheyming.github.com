import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadAppFilter() {
  const dom = new JSDOM(
    `<!doctype html>
      <input id="filter">
      <div id="apps">
        <a data-filterable="true">Doom</a>
        <a data-filterable="true">Calculator</a>
      </div>`,
    { runScripts: 'outside-only', url: 'https://joeheyming.github.io/' }
  );

  class FakeXMLHttpRequest {
    open() {}

    send() {
      this.status = 200;
      this.responseText = '[]';
    }
  }

  dom.window.XMLHttpRequest = FakeXMLHttpRequest;
  dom.window.eval(readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
  return dom;
}

test('AppFilter defers per-keystroke DOM filtering', async () => {
  const dom = loadAppFilter();
  const { document, Event } = dom.window;
  const input = document.getElementById('filter');
  const items = document.querySelectorAll('[data-filterable="true"]');
  const controller = dom.window.AppFilter.create({
    container: document.getElementById('apps'),
    filterInput: input
  });
  controller.bindKeyboardShortcuts();

  input.value = 'doom';
  input.dispatchEvent(new Event('input', { bubbles: true }));

  assert.equal(items[1].style.display, '');
  await delay(150);
  assert.equal(items[0].style.display, '');
  assert.equal(items[1].style.display, 'none');
  dom.window.close();
});

test('AppFilter reset cancels a pending stale query', async () => {
  const dom = loadAppFilter();
  const { document, Event } = dom.window;
  const input = document.getElementById('filter');
  const items = document.querySelectorAll('[data-filterable="true"]');
  const controller = dom.window.AppFilter.create({
    container: document.getElementById('apps'),
    filterInput: input
  });
  controller.bindKeyboardShortcuts();

  input.value = 'doom';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  controller.reset();

  await delay(150);
  assert.equal(input.value, '');
  assert.equal(items[0].style.display, '');
  assert.equal(items[1].style.display, '');
  dom.window.close();
});

test('Notepad autosave waits for idle typing and flushes on pagehide', async () => {
  const dom = new JSDOM('<!doctype html>', {
    runScripts: 'outside-only',
    url: 'https://joeheyming.github.io/notepad/'
  });
  const source = readFileSync(path.join(ROOT, 'notepad/notepad.js'), 'utf8');
  const classSource = source.split('// Initialize the rich notepad')[0];
  dom.window.eval(`${classSource}\nwindow.RichNotepadForTest = RichNotepad;`);

  const writes = [];
  Object.defineProperty(dom.window, 'localStorage', {
    value: {
      setItem(key, value) {
        writes.push([key, value]);
      }
    }
  });

  let onTextChange;
  const notepad = Object.create(dom.window.RichNotepadForTest.prototype);
  notepad.autoSaveTimer = null;
  notepad.autoSaveDirty = false;
  notepad.quill = {
    getContents: () => ({ ops: [{ insert: 'hello\n' }] }),
    on(type, listener) {
      if (type === 'text-change') onTextChange = listener;
    }
  };

  notepad.setupAutoSave();
  onTextChange();
  assert.equal(writes.length, 0);

  await delay(780);
  assert.equal(writes.length, 1);

  onTextChange();
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  assert.equal(writes.length, 2);
  dom.window.close();
});

function loadInpPage(url) {
  const dom = new JSDOM('<!doctype html><button id="submit">Submit</button>', {
    runScripts: 'outside-only',
    url
  });
  const observers = [];

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback;
      this.records = [];
      observers.push(this);
    }

    observe() {}

    takeRecords() {
      const records = this.records;
      this.records = [];
      return records;
    }
  }

  dom.window.PerformanceObserver = FakePerformanceObserver;
  dom.window.eval(readFileSync(path.join(ROOT, 'analytics.js'), 'utf8'));
  return { dom, observers };
}

function deliverInp(observer, entry) {
  observer.records.push(entry);
  observer.callback({ getEntries: () => observer.records.splice(0) });
}

function reportedInp(dom) {
  return dom.window.dataLayer
    .map((args) => Array.from(args))
    .filter((args) => args[0] === 'event' && args[1] === 'web_vital_inp');
}

test('analytics reports the slowest buffered interaction on pagehide', () => {
  const { dom, observers } = loadInpPage('https://joeheyming.github.io/wordle-finder/');

  assert.equal(observers.length, 1);
  const submit = dom.window.document.getElementById('submit');
  deliverInp(observers[0], {
    interactionId: 1,
    duration: 287,
    name: 'click',
    target: submit
  });
  submit.remove();
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));

  const [inpEvent] = reportedInp(dom);
  assert.ok(inpEvent);
  assert.equal(inpEvent[2].event_category, 'Web Vitals');
  assert.equal(inpEvent[2].event_label, 'click button#submit');
  assert.equal(inpEvent[2].value, 287);
  assert.equal(inpEvent[2].page_path, '/wordle-finder/');
  dom.window.close();
});

test('analytics names a click whose target was removed before Event Timing', () => {
  const { dom, observers } = loadInpPage('https://joeheyming.github.io/wordle-finder/');
  const submit = dom.window.document.getElementById('submit');
  const event = new dom.window.MouseEvent('click', { bubbles: true, composed: true });
  submit.dispatchEvent(event);
  deliverInp(observers[0], {
    interactionId: 1,
    duration: 640,
    name: 'click',
    startTime: event.timeStamp,
    target: null
  });
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));

  const [inpEvent] = reportedInp(dom);
  assert.equal(inpEvent[2].event_label, 'click button#submit');
  assert.equal(inpEvent[2].value, 640);
  dom.window.close();
});

test('analytics names the control inside a shadow root', () => {
  const { dom, observers } = loadInpPage('https://joeheyming.github.io/stepmania/');
  const host = dom.window.document.createElement('loading-overlay');
  host.id = 'loading-overlay';
  dom.window.document.body.appendChild(host);
  const button = dom.window.document.createElement('button');
  button.id = 'play-btn';
  host.attachShadow({ mode: 'open' }).appendChild(button);
  const event = new dom.window.MouseEvent('click', { bubbles: true, composed: true });
  button.dispatchEvent(event);
  deliverInp(observers[0], {
    interactionId: 1,
    duration: 420,
    name: 'click',
    startTime: event.timeStamp,
    target: host
  });
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));

  const [inpEvent] = reportedInp(dom);
  assert.equal(inpEvent[2].event_label, 'click loading-overlay#loading-overlay button#play-btn');
  dom.window.close();
});

test('analytics caps a multi-day interaction and records the page path', () => {
  const { dom, observers } = loadInpPage('https://joeheyming.github.io/doom');
  const submit = dom.window.document.getElementById('submit');
  deliverInp(observers[0], {
    interactionId: 1,
    duration: 444570536,
    name: 'pointerup',
    target: submit
  });
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));

  const [inpEvent] = reportedInp(dom);
  assert.equal(inpEvent[2].event_label, 'pointerup button#submit');
  assert.equal(inpEvent[2].value, 10000);
  assert.equal(inpEvent[2].page_path, '/doom/');
  dom.window.close();
});

test('Emulator ROM clicks do not wait on the play counter', () => {
  const roms = readFileSync(path.join(ROOT, 'emulator/rom-browser.js'), 'utf8');
  const loadRomStart = roms.indexOf('async loadRom(rom)');
  const loadRom = roms.slice(loadRomStart, roms.indexOf('contentArea.innerHTML', loadRomStart));
  assert.doesNotMatch(loadRom, /await[^;]*enable\('play-counts'\)/);

  const launch = readFileSync(path.join(ROOT, 'emulator/launch.js'), 'utf8');
  const launchStart = launch.indexOf('window.launchEmulator = async function');
  const tracking = launch.slice(launchStart, launch.indexOf('wasmSupported()', launchStart));
  assert.doesNotMatch(tracking, /await[^;]*enable\('play-counts'\)/);
});

test('Doom caps catch-up work in its browser main loop', () => {
  const source = readFileSync(path.join(ROOT, 'doom/uzdoom-loader-engine.js'), 'utf8');
  assert.match(source, /vid_maxfps 60/);
  assert.match(source, /cl_capfps 1/);
});

test('Doom does not parse the engine while the flavor picker is idle', () => {
  const loader = readFileSync(path.join(ROOT, 'doom/engine.js'), 'utf8');
  assert.match(loader, /export const ensureEngine = once\(/);
  assert.doesNotMatch(loader, /DOMContentLoaded/);

  const flavors = readFileSync(path.join(ROOT, 'doom/flavors.js'), 'utf8');
  assert.doesNotMatch(flavors, /Preparing engine/);
  assert.doesNotMatch(flavors, /btn\.disabled = true/);

  const launch = readFileSync(path.join(ROOT, 'doom/uzdoom-loader.js'), 'utf8');
  const clickStart = launch.indexOf('async function launchEngine()');
  assert.ok(clickStart > 0, 'uzdoom-loader.js defines launchEngine');
  assert.match(launch, /\$\('launchBtn'\)\.addEventListener\('click', launchEngine\)/);
  assert.match(launch, /await launchEngine\(\)/, 'UZDoomLoader.launch calls launchEngine directly');
  assert.doesNotMatch(launch, /\$\('launchBtn'\)\.click\(\)/);
  const click = launch.slice(clickStart, launch.indexOf('setInterval(', clickStart));
  assert.ok(click.indexOf('yieldToMain') < click.indexOf('ensureEngine()'));
  assert.ok(click.indexOf('mountDoomChat()') < click.indexOf('ensureEngine()'));
  assert.ok(click.indexOf('ensureEngine()') < click.indexOf('bootEngine()'));
});

test('StepMania paints interaction feedback before heavy continuations', () => {
  const browserSource = readFileSync(path.join(ROOT, 'stepmania/js/zenius-browser.js'), 'utf8');
  const showBrowserStart = browserSource.indexOf('async showBrowser()');
  const showBrowser = browserSource.slice(
    showBrowserStart,
    browserSource.indexOf('\n  hideBrowser()', showBrowserStart)
  );
  assert.ok(
    showBrowser.indexOf('await window.yieldToMain()') < showBrowser.indexOf('renderRecentChips()')
  );

  const controllerSource = readFileSync(
    path.join(ROOT, 'stepmania/js/mainPageController.js'),
    'utf8'
  );
  const startPlayingStart = controllerSource.indexOf('async startPlaying()');
  const startPlaying = controllerSource.slice(
    startPlayingStart,
    controllerSource.indexOf('\n  getDifficultyShortCode', startPlayingStart)
  );
  assert.ok(
    startPlaying.indexOf('LoadingOverlay.hide()') <
      startPlaying.indexOf('await window.yieldToMain()')
  );
  assert.ok(
    startPlaying.indexOf('await window.yieldToMain()') < startPlaying.indexOf('resetGame()')
  );
});
