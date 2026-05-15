'use strict';

import { bySymbol, loadCustomElements, saveCustomElements } from './elements.js';
import { THEMES, getCurrentTheme, setTheme } from './themes.js';
import { render } from './tiles.js';
import { createNotifier } from '/notifications.js';

// Singleton notifier — share-link is the only periodic-speller surface
// that uses toasts today. `singletonHack: true` semantics aren't needed;
// `existing.remove()` behaviour is preserved by `clear()` before each show.
const _shareNotifier = createNotifier({
  kindClass: () => 'share-toast',
  defaultDurationMs: 2200,
  fadeOut: { outClass: 'share-toast-out', outMs: 400 }
});

export function encodeShareState(inputValue) {
  var state = { t: inputValue };
  var customs = loadCustomElements();
  if (Object.keys(customs).length > 0) state.c = customs;
  var theme = getCurrentTheme();
  if (theme !== 'default') state.th = theme;
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
}

export function decodeShareState(hash) {
  try {
    var json = decodeURIComponent(escape(atob(hash)));
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

export function applyShareState(decoded, onClickCreate, renderCustomList) {
  var input = document.getElementById('wordInput');
  var clearBtn = document.getElementById('clearBtn');

  if (decoded.c) {
    Object.keys(decoded.c).forEach(function (key) {
      bySymbol[key] = decoded.c[key];
    });
    var merged = loadCustomElements();
    Object.keys(decoded.c).forEach(function (key) {
      merged[key] = decoded.c[key];
    });
    saveCustomElements(merged);
    renderCustomList();
  }
  if (decoded.th && THEMES[decoded.th]) {
    setTheme(decoded.th);
  }
  input.value = decoded.t || '';
  clearBtn.style.display = input.value ? 'block' : 'none';
  render(input.value, onClickCreate);
}

export function showShareToast(msg) {
  // Match the old "only one share-toast on screen at a time" behaviour
  // — the previous implementation always remove()'d the previous one.
  _shareNotifier.clear();
  // The 1800 ms "start fading out" hint matches the old hand-rolled
  // timing: the shared notifier removes after `defaultDurationMs`
  // (2200) and adds the out-class `outMs` (400) before that ⇒ 1800.
  _shareNotifier.notify(msg);
}

export function initShareLink(getInputValue) {
  document.getElementById('shareLinkBtn').addEventListener('click', function () {
    var encoded = encodeShareState(getInputValue());
    var url = window.location.origin + window.location.pathname + '#s=' + encoded;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        showShareToast('Link copied!');
      });
    } else {
      var tmp = document.createElement('textarea');
      tmp.value = url;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      document.body.removeChild(tmp);
      showShareToast('Link copied!');
    }
  });
}
