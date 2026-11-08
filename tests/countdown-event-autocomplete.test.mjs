import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { sharedHelpersSource } from './countdown-helpers.mjs';

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
    .replace(/^import [\s\S]*?;\n/gm, '')
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
  dom.window.eval(sharedHelpersSource());
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

test('focus and arrows do not open the list; space and ok do', () => {
  const { autocomplete, dom } = createAutocomplete();
  autocomplete.setSelectedEvent(autocomplete.events[0]);
  autocomplete.input.dispatchEvent(new dom.window.FocusEvent('focus'));
  assert.equal(autocomplete.isOpen, false);

  const down = new dom.window.KeyboardEvent('keydown', {
    key: 'ArrowDown',
    bubbles: true,
    cancelable: true
  });
  autocomplete.input.dispatchEvent(down);
  assert.equal(down.defaultPrevented, false);
  assert.equal(autocomplete.isOpen, false);
  assert.equal(autocomplete.getSelectedEvent().id, 'alpha');

  const space = new dom.window.KeyboardEvent('keydown', {
    key: ' ',
    bubbles: true,
    cancelable: true
  });
  autocomplete.input.dispatchEvent(space);
  assert.equal(space.defaultPrevented, true);
  assert.equal(autocomplete.isOpen, true);
  assert.equal(autocomplete.getSelectedEvent().id, 'alpha');
  dom.window.close();
});

test('ok selects the highlighted row, not the event at that date index', () => {
  const { autocomplete, dom } = createAutocomplete();
  autocomplete.setEvents([
    {
      id: 'soon',
      name: 'Soon',
      label: 'Soon',
      emoji: '1',
      category: 'national',
      date: '2026-08-01'
    },
    {
      id: 'later',
      name: 'Later',
      label: 'Later',
      emoji: '2',
      category: 'fun',
      date: '2026-12-01'
    },
    {
      id: 'season',
      name: 'Season',
      label: 'Season',
      emoji: '3',
      category: 'seasonal',
      date: '2027-01-01'
    }
  ]);
  autocomplete.setSelectedEvent(autocomplete.events.find((event) => event.id === 'soon'));
  autocomplete.open();

  const rowIds = () =>
    [...autocomplete.dropdown.querySelectorAll('.item')].map((row) => row.dataset.id);
  const highlightedId = () => autocomplete.dropdown.querySelector('.item.highlighted').dataset.id;

  // Seasonal, then national, then fun. Date order is soon, later, season.
  assert.deepEqual(rowIds(), ['season', 'soon', 'later']);
  assert.equal(highlightedId(), 'soon');

  dispatchKey(autocomplete, 'ArrowDown');
  assert.equal(highlightedId(), 'later');

  let selectedId = null;
  autocomplete.addEventListener('event-selected', (event) => {
    selectedId = event.detail.id;
  });
  dispatchKey(autocomplete, 'Enter');
  assert.equal(selectedId, 'later');

  autocomplete.open();
  dispatchKey(autocomplete, 'ArrowUp');
  assert.equal(highlightedId(), 'soon');
  autocomplete.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(selectedId, 'soon');
  dom.window.close();
});

test('ok opens the list and left and right do not change the event', () => {
  const { autocomplete, dom } = createAutocomplete();
  autocomplete.setSelectedEvent(autocomplete.events[0]);
  autocomplete.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(autocomplete.isOpen, true);
  assert.equal(autocomplete.getSelectedEvent().id, 'alpha');

  const right = new dom.window.KeyboardEvent('keydown', {
    key: 'ArrowRight',
    bubbles: true,
    cancelable: true
  });
  autocomplete.dispatchEvent(right);
  assert.equal(right.defaultPrevented, false);
  assert.equal(autocomplete.getSelectedEvent().id, 'alpha');
  assert.equal(autocomplete.isOpen, false);
  dom.window.close();
});

test('the page lands on the event field so a remote has a starting control', async () => {
  const html = readFileSync(path.join(ROOT, 'countdown/index.html'), 'utf8');
  assert.match(
    html,
    /<event-autocomplete\b[^>]*\bid="eventAutocomplete"[^>]*\bdata-initial-focus\b/
  );

  const dom = new JSDOM(
    `<!doctype html><body>
      <button class="heyming-nav-toggle">Menu</button>
      <event-autocomplete id="eventAutocomplete" tabindex="0" data-initial-focus></event-autocomplete>
      <button id="custom">Custom</button>
    </body>`,
    { url: 'https://joeheyming.github.io/countdown/', runScripts: 'outside-only' }
  );
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  try {
    await import(pathToFileURL(path.join(ROOT, 'remote.js')).href + '?countdown-initial=1');
    assert.equal(dom.window.document.activeElement.id, 'eventAutocomplete');
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.getComputedStyle = previous.getComputedStyle;
    dom.window.close();
  }
});

test("typing new years matches New Year's Day", async () => {
  const { autocomplete, dom } = createAutocomplete();
  autocomplete.setEvents([
    {
      id: 'new-years',
      name: "New Year's Day",
      label: "New Year's Day",
      emoji: '🎆',
      category: 'seasonal',
      date: '2027-01-01'
    },
    {
      id: 'new-years-eve',
      name: "New Year's Eve",
      label: "New Year's Eve",
      emoji: '🥂',
      category: 'seasonal',
      date: '2026-12-31'
    },
    {
      id: 'groundhog',
      name: 'Groundhog Day',
      label: 'Groundhog Day',
      emoji: '🦫',
      category: 'fun',
      date: '2027-02-02'
    }
  ]);

  dispatchInput(autocomplete, 'new years');
  await delay(150);
  assert.equal(
    autocomplete.filteredEvents.map((event) => event.id).join(','),
    'new-years-eve,new-years'
  );

  const typed = new dom.window.KeyboardEvent('keydown', {
    key: 'n',
    bubbles: true,
    cancelable: true
  });
  autocomplete.dispatchEvent(typed);
  assert.equal(typed.defaultPrevented, true);
  assert.equal(autocomplete.input.value, 'n');
  assert.equal(autocomplete.isOpen, true);
  dom.window.close();
});

test('the field is an APG combobox that points at the highlighted option', async () => {
  const { autocomplete, dom } = createAutocomplete();
  dom.window.document.body.append(autocomplete);
  await delay(0);
  const input = autocomplete.input;
  const listbox = autocomplete.shadowRoot.getElementById(input.getAttribute('aria-controls'));
  assert.equal(input.getAttribute('role'), 'combobox');
  assert.equal(input.getAttribute('aria-autocomplete'), 'list');
  assert.ok(input.getAttribute('aria-label'));
  assert.equal(listbox.getAttribute('role'), 'listbox');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(input.hasAttribute('aria-activedescendant'), false);

  autocomplete.open();
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  const options = [...listbox.querySelectorAll('[role="option"]')];
  assert.equal(options.length, 2);
  assert.ok(listbox.querySelector('[role="group"][aria-labelledby]'));
  const active = () =>
    autocomplete.shadowRoot.getElementById(input.getAttribute('aria-activedescendant'));
  assert.equal(active().getAttribute('aria-selected'), 'true');
  assert.equal(active().dataset.id, 'alpha');
  assert.match(autocomplete.status.textContent, /2 events/);

  // remote.js runs on document capture. The widget claims the key on window
  // capture first, so remote.js never moves page focus.
  let reachedDocument = false;
  dom.window.document.addEventListener('keydown', () => (reachedDocument = true), true);
  const down = new dom.window.KeyboardEvent('keydown', {
    key: 'ArrowDown',
    bubbles: true,
    composed: true,
    cancelable: true
  });
  input.dispatchEvent(down);
  assert.equal(down.heymingHandled, true);
  assert.equal(down.defaultPrevented, true);
  assert.equal(reachedDocument, false);
  assert.equal(active().dataset.id, 'beta');
  assert.equal(
    listbox.querySelectorAll('[aria-selected="true"]').length,
    1,
    'only the highlighted option is selected'
  );

  const escape = new dom.window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    composed: true,
    cancelable: true
  });
  input.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true, 'Escape closes the list instead of going back');
  assert.equal(autocomplete.isOpen, false);
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(input.hasAttribute('aria-activedescendant'), false);
  dom.window.close();
});

test('a custom event delete button stays out of the tab order and has a name', () => {
  const { autocomplete, dom } = createAutocomplete();
  autocomplete.setEvents([
    {
      id: 'mine',
      name: 'My "Party"',
      label: 'My "Party"',
      emoji: '🎉',
      category: 'custom',
      date: '2026-10-01'
    }
  ]);
  autocomplete.open();
  const remove = autocomplete.shadowRoot.querySelector('.delete-btn');
  assert.equal(remove.getAttribute('tabindex'), '-1');
  assert.equal(remove.getAttribute('aria-label'), 'Delete My "Party"');
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
