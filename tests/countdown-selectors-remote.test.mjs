import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { componentSource, sharedHelpersSource } from './countdown-helpers.mjs';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setup(file, className, tag) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only',
    url: 'https://joeheyming.github.io/countdown/'
  });
  const { window } = dom;
  const listeners = [];
  window.localeService = {
    locale: 'en',
    str: (key) => (key === 'ui.display' ? 'Display:' : key),
    ready: async () => {},
    subscribe(callback) {
      listeners.push(callback);
      return () => listeners.splice(listeners.indexOf(callback), 1);
    }
  };
  window.SUPPORTED_LOCALES = [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'es', name: 'Spanish', nativeName: 'Español' },
    { code: 'fr', name: 'French', nativeName: 'Français' }
  ];
  window.YouTubePlayer = {
    VIDEOS: { CELEBRATION: 'aaaaaaaaaaa', PARTY: 'bbbbbbbbbbb' },
    VIDEO_METADATA: {
      CELEBRATION: { label: 'Celebration', artist: 'Kool', emoji: '🎉' },
      PARTY: { label: 'Party', artist: 'Band', emoji: '🥳' }
    },
    EVENT_DEFAULTS: {}
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.eval(sharedHelpersSource());
  window.eval(componentSource(file, className));
  const host = window.document.createElement(tag);
  host.tabIndex = 0;
  window.document.body.append(host);
  const changeLocale = (code) => {
    window.localeService.locale = code;
    listeners.slice().forEach((callback) => callback(code));
  };
  window.localeService = new Proxy(window.localeService, {
    set(target, key, value) {
      target[key] = value;
      if (key === 'locale') listeners.slice().forEach((callback) => callback(value));
      return true;
    }
  });
  return { dom, window, host, changeLocale };
}

function key(window, target, name, extra = {}) {
  const event = new window.KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...extra
  });
  target.dispatchEvent(event);
  return event;
}

function ok(window, host) {
  host.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
}

function parts(host) {
  const root = host.shadowRoot;
  const button = root.getElementById('selectorBtn');
  const listbox = root.getElementById(button.getAttribute('aria-controls'));
  const active = () => root.getElementById(button.getAttribute('aria-activedescendant') || '');
  return { root, button, listbox, active };
}

function assertCombobox(host) {
  const { root, button, listbox } = parts(host);
  assert.equal(button.getAttribute('role'), 'combobox');
  assert.equal(button.getAttribute('aria-haspopup'), 'listbox');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  const name = button
    .getAttribute('aria-labelledby')
    .split(/\s+/)
    .map((id) => root.getElementById(id)?.textContent.trim())
    .join(' ');
  assert.ok(name.length > 3, `combobox has an accessible name, got "${name}"`);
  assert.equal(listbox.getAttribute('role'), 'listbox');
  const options = [...listbox.querySelectorAll('[role="option"]')];
  assert.ok(options.length > 1);
  assert.ok(options.every((option) => option.id), 'every option has an id');
  assert.equal(new Set(options.map((option) => option.id)).size, options.length);
}

// Arrows from the host and from the button inside it, Escape, Left/Right, Enter.
async function exerciseKeys({ window, host }, onChoose) {
  const { button, active } = parts(host);
  let reachedDocument = 0;
  window.document.addEventListener('keydown', () => reachedDocument++, true);

  ok(window, host);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  const first = active();
  assert.ok(first, 'an option is active once open');
  assert.equal(first.getAttribute('aria-selected'), 'true');

  const fromButton = key(window, button, 'ArrowDown');
  assert.equal(fromButton.heymingHandled, true, 'the open list claims Down from the inner button');
  assert.equal(reachedDocument, 0, 'remote.js never sees the claimed arrow');
  assert.notEqual(active(), first);

  key(window, host, 'ArrowUp');
  assert.equal(active(), first, 'Up from the focused host moves back');

  key(window, button, 'End');
  const options = [...parts(host).listbox.querySelectorAll('[role="option"]')];
  assert.equal(active(), options[options.length - 1]);
  key(window, button, 'Home');
  assert.equal(active(), options[0]);
  assert.equal(
    parts(host).listbox.querySelectorAll('[aria-selected="true"]').length,
    1,
    'only the active option is selected'
  );

  const escape = key(window, button, 'Escape');
  assert.equal(escape.defaultPrevented, true, 'Escape closes instead of navigating back');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.hasAttribute('aria-activedescendant'), false);

  ok(window, host);
  const right = key(window, button, 'ArrowRight');
  assert.equal(right.defaultPrevented, false, 'Right is left for remote.js to move focus');
  assert.equal(button.getAttribute('aria-expanded'), 'false');

  key(window, button, 'ArrowDown', { altKey: true });
  assert.equal(button.getAttribute('aria-expanded'), 'true', 'Alt+Down opens');
  key(window, button, 'ArrowDown');
  const enter = key(window, button, 'Enter');
  assert.equal(enter.defaultPrevented, true, 'Enter does not also click the button');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  onChoose();
}

test('locale selector is an APG combobox a remote and keyboard can drive', async () => {
  const ctx = setup('countdown/components/locale-selector.js', 'LocaleSelector', 'locale-selector');
  await delay(0);
  assertCombobox(ctx.host);
  await exerciseKeys(ctx, () => {
    assert.equal(ctx.window.localeService.locale, 'es');
  });
  ctx.dom.window.close();
});

test('display mode selector survives a locale change without doubled listeners', async () => {
  const ctx = setup(
    'countdown/components/display-mode-selector.js',
    'DisplayModeSelector',
    'display-mode-selector'
  );
  await delay(0);
  assertCombobox(ctx.host);
  const modes = [];
  ctx.host.addEventListener('mode-change', (event) => modes.push(event.detail.mode));
  await exerciseKeys(ctx, () => assert.equal(modes.length, 1));

  ctx.changeLocale('fr');
  ctx.changeLocale('en');
  const { button } = parts(ctx.host);
  button.click();
  assert.equal(button.getAttribute('aria-expanded'), 'true', 'one click opens, not open+close');
  key(ctx.window, button, 'ArrowDown');
  key(ctx.window, button, 'Enter');
  assert.equal(modes.length, 2, 'one change event per choice after re-render');
  ctx.dom.window.close();
});

test('celebration video custom link is reachable from the list and returns focus', async () => {
  const ctx = setup(
    'countdown/components/celebration-video-selector.js',
    'CelebrationVideoSelector',
    'celebration-video-selector'
  );
  await delay(0);
  assertCombobox(ctx.host);
  const changes = [];
  ctx.host.addEventListener('video-change', (event) => changes.push(event.detail));
  await exerciseKeys(ctx, () => assert.equal(changes.length, 1));

  ctx.changeLocale('fr');
  const { root, button, active } = parts(ctx.host);
  ok(ctx.window, ctx.host);
  key(ctx.window, button, 'End');
  assert.equal(active().dataset.key, 'CUSTOM');
  key(ctx.window, button, 'Enter');

  const input = root.getElementById('customInput');
  assert.equal(root.activeElement, input, 'choosing Custom moves focus to the link field');
  assert.equal(root.getElementById('customBtn').getAttribute('aria-expanded'), 'true');
  assert.equal(root.querySelector(`label[for="customInput"]`).textContent.trim().length > 0, true);

  input.value = 'not a video';
  key(ctx.window, input, 'Enter');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.match(root.getElementById('customError').textContent, /YouTube/);
  assert.equal(root.getElementById('customError').getAttribute('role'), 'alert');

  input.value = 'https://youtu.be/dQw4w9WgXcQ';
  key(ctx.window, input, 'Enter');
  assert.equal(changes.length, 2, 'one change after a locale re-render');
  assert.equal(changes[1].videoId, 'dQw4w9WgXcQ');
  assert.equal(changes[1].isCustom, true);
  assert.equal(root.activeElement, root.getElementById('selectorBtn'), 'focus returns to the field');

  ok(ctx.window, ctx.host);
  key(ctx.window, button, 'End');
  key(ctx.window, button, 'Enter');
  const escape = key(ctx.window, root.getElementById('customInput'), 'Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(root.getElementById('customBtn').getAttribute('aria-expanded'), 'false');
  assert.equal(root.activeElement, root.getElementById('selectorBtn'));
  ctx.dom.window.close();
});
