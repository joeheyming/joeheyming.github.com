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

function createAutocomplete() {
  const dom = new JSDOM('<!doctype html>', {
    runScripts: 'outside-only',
    url: 'https://joeheyming.github.io/countdown/'
  });
  const source = readFileSync(path.join(ROOT, 'countdown/event-autocomplete.js'), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(
      'export default EventAutocomplete;',
      'window.EventAutocompleteForTest = EventAutocomplete;'
    );

  dom.window.dayjs = (value = Date.now()) => ({
    diff(other) {
      const otherValue = other && typeof other.valueOf === 'function' ? other.valueOf() : other;
      return new Date(value).getTime() - new Date(otherValue).getTime();
    },
    isValid() {
      return Number.isFinite(new Date(value).getTime());
    },
    valueOf() {
      return new Date(value).getTime();
    }
  });
  dom.window.getLocalizedEventLabel = (id) => id;
  dom.window.CATEGORY_EMOJIS = {};
  dom.window.localeService = {
    locale: 'en',
    str: (key) => key,
    ready: async () => {},
    subscribe: () => () => {}
  };
  dom.window.onClickOutside = () => () => {};
  dom.window.dropdownStyles = '';
  dom.window.chevronStyles = '';
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.eval(source);

  const autocomplete = new dom.window.EventAutocompleteForTest();
  autocomplete.render();
  autocomplete.setupEventListeners();
  autocomplete.setEvents([
    {
      id: 'alpha',
      name: 'Alpha',
      label: 'Alpha',
      emoji: '🅰️',
      category: 'other',
      date: '2026-08-01'
    },
    {
      id: 'beta',
      name: 'Beta',
      label: 'Beta',
      emoji: '🅱️',
      category: 'other',
      date: '2026-09-01'
    }
  ]);

  return { autocomplete, dom };
}

function dispatchInput(autocomplete, query) {
  autocomplete.input.value = query;
  autocomplete.input.dispatchEvent(new autocomplete.ownerDocument.defaultView.Event('input'));
}

function dispatchKey(autocomplete, key) {
  autocomplete.input.dispatchEvent(
    new autocomplete.ownerDocument.defaultView.KeyboardEvent('keydown', { key })
  );
}

test('input filtering waits until typing pauses', async () => {
  const { autocomplete, dom } = createAutocomplete();
  let filterCalls = 0;
  const filterEvents = autocomplete.filterEvents.bind(autocomplete);
  autocomplete.filterEvents = (query) => {
    filterCalls++;
    filterEvents(query);
  };

  dispatchInput(autocomplete, 'a');
  await delay(70);
  dispatchInput(autocomplete, 'beta');

  assert.equal(filterCalls, 0);
  await delay(70);
  assert.equal(filterCalls, 0);
  await delay(70);
  assert.equal(filterCalls, 1);
  assert.equal(autocomplete.filteredEvents.map((event) => event.id).join(','), 'beta');
  dom.window.close();
});

test('arrow and enter keys synchronously flush pending filtering', async () => {
  const { autocomplete, dom } = createAutocomplete();
  let filterCalls = 0;
  const filterEvents = autocomplete.filterEvents.bind(autocomplete);
  autocomplete.filterEvents = (query) => {
    filterCalls++;
    filterEvents(query);
  };

  dispatchInput(autocomplete, 'beta');
  dispatchKey(autocomplete, 'ArrowDown');
  assert.equal(filterCalls, 1);
  assert.equal(autocomplete.filteredEvents[autocomplete.highlightedIndex].id, 'beta');

  dispatchInput(autocomplete, 'alpha');
  dispatchKey(autocomplete, 'ArrowUp');
  assert.equal(filterCalls, 2);
  assert.equal(autocomplete.filteredEvents[autocomplete.highlightedIndex].id, 'alpha');

  let selectedId = null;
  autocomplete.addEventListener('event-selected', (event) => {
    selectedId = event.detail.id;
  });
  dispatchInput(autocomplete, 'beta');
  dispatchKey(autocomplete, 'Enter');
  assert.equal(filterCalls, 3);
  assert.equal(selectedId, 'beta');

  await delay(150);
  assert.equal(filterCalls, 3);
  dom.window.close();
});

test('closing cancels pending filtering', async () => {
  const { autocomplete, dom } = createAutocomplete();
  let filterCalls = 0;
  const filterEvents = autocomplete.filterEvents.bind(autocomplete);
  autocomplete.filterEvents = (query) => {
    filterCalls++;
    filterEvents(query);
  };

  dispatchInput(autocomplete, 'beta');
  autocomplete.close();
  await delay(150);

  assert.equal(filterCalls, 0);
  assert.equal(autocomplete.filteredEvents.length, 2);
  dom.window.close();
});
