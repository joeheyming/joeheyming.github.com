'use strict';

import { bySymbol, loadCustomElements, saveCustomElements } from './elements.js';
import { THEMES, getCurrentTheme, setTheme } from './themes.js';
import { render } from './tiles.js';

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
  var existing = document.querySelector('.share-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.className = 'share-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function () {
    toast.classList.add('share-toast-out');
  }, 1800);
  setTimeout(function () {
    toast.remove();
  }, 2200);
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
