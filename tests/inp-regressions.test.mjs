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

test('analytics reports the slowest buffered interaction on pagehide', () => {
  const dom = new JSDOM('<!doctype html><button id="submit">Submit</button>', {
    runScripts: 'outside-only',
    url: 'https://joeheyming.github.io/wordle-finder/'
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

  assert.equal(observers.length, 1);
  observers[0].records.push({
    interactionId: 1,
    duration: 287,
    name: 'click',
    target: dom.window.document.getElementById('submit')
  });
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));

  const inpEvent = dom.window.dataLayer
    .map((args) => Array.from(args))
    .find((args) => args[0] === 'event' && args[1] === 'web_vital_inp');
  assert.ok(inpEvent);
  assert.equal(inpEvent[2].event_category, 'Web Vitals');
  assert.equal(inpEvent[2].event_label, 'click button#submit');
  assert.equal(inpEvent[2].value, 287);
  dom.window.close();
});
