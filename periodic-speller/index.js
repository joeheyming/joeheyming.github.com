'use strict';

import {
  loadCustomElements,
  registerCustomElement,
  removeCustomElement,
  clearAllCustomElements,
  formatCustomSymbol,
  isRealElementSymbol,
  CUSTOM_SYMBOL_MAX
} from './elements.js';
import { render } from './tiles.js';
import { buildThemePopover } from './themes.js';
import { exportPNG, renderToCanvas } from './export.js';
import { initPeriodicTableModal } from './periodic-table.js';
import { decodeShareState, applyShareState, initShareLink } from './share-link.js';

// --- Custom element UI ---

function renderCustomList() {
  var customs = loadCustomElements();
  var keys = Object.keys(customs);
  var listEl = document.getElementById('customElList');
  var itemsEl = document.getElementById('customElItems');
  if (keys.length === 0) {
    listEl.hidden = true;
    return;
  }
  listEl.hidden = false;
  itemsEl.innerHTML = '';
  keys.forEach(function (key) {
    var el = customs[key];
    var chip = document.createElement('span');
    chip.className = 'custom-el-chip';

    var sym = document.createElement('span');
    sym.className = 'custom-el-chip-sym';
    sym.textContent = el.symbol;

    var name = document.createElement('span');
    name.className = 'custom-el-chip-name';
    name.textContent = el.name;

    var removeBtn = document.createElement('button');
    removeBtn.className = 'custom-el-chip-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove ' + el.symbol;
    removeBtn.addEventListener('click', function () {
      removeCustomElement(key, function () {
        renderCustomList();
        reRender();
      });
    });

    chip.appendChild(sym);
    chip.appendChild(name);
    chip.appendChild(removeBtn);
    itemsEl.appendChild(chip);
  });
}

function showSymbolError(message) {
  var errorEl = document.getElementById('customElError');
  errorEl.textContent = message || '';
  errorEl.hidden = !message;
}

function syncSymbolPreview() {
  var symInput = document.getElementById('customElSymbol');
  var preview = document.getElementById('customElSymbolPreview');
  var formatted = formatCustomSymbol(symInput.value);
  preview.textContent = formatted || '…';
  if (formatted && isRealElementSymbol(formatted)) {
    showSymbolError(formatted + ' is already a real element.');
  } else {
    showSymbolError('');
  }
}

function openCustomElementDialog(letter) {
  var modal = document.getElementById('customElementModal');
  var symInput = document.getElementById('customElSymbol');
  var nameInput = document.getElementById('customElName');
  var numInput = document.getElementById('customElNumber');

  symInput.value = letter.toUpperCase();
  nameInput.value = '';
  showSymbolError('');
  syncSymbolPreview();

  var customs = loadCustomElements();
  var nextNum = 119 + Object.keys(customs).length;
  numInput.value = nextNum;

  modal.hidden = false;
  symInput.focus();
  var end = symInput.value.length;
  symInput.setSelectionRange(end, end);
}

var symbolInput = document.getElementById('customElSymbol');
symbolInput.maxLength = CUSTOM_SYMBOL_MAX;
symbolInput.addEventListener('input', function () {
  var cleaned = this.value.replace(/[^a-zA-Z]/g, '').slice(0, CUSTOM_SYMBOL_MAX);
  if (cleaned !== this.value) {
    var pos = this.selectionStart;
    this.value = cleaned;
    var next = Math.min(pos == null ? cleaned.length : pos, cleaned.length);
    this.setSelectionRange(next, next);
  }
  syncSymbolPreview();
});

document.getElementById('customElForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var sym = document.getElementById('customElSymbol').value.trim();
  var name = document.getElementById('customElName').value.trim();
  var num = parseInt(document.getElementById('customElNumber').value, 10);
  if (!name || isNaN(num)) return;
  var err = registerCustomElement(sym, name, num, function () {
    renderCustomList();
    reRender();
  });
  if (err) {
    showSymbolError(err);
    return;
  }
  document.getElementById('customElementModal').hidden = true;
});

document.getElementById('clearAllCustom').addEventListener('click', function () {
  clearAllCustomElements(function () {
    renderCustomList();
    reRender();
  });
});

document.getElementById('customElementModal').addEventListener('click', function (e) {
  if (e.target === this) this.hidden = true;
});

// --- Core input wiring ---

var input = document.getElementById('wordInput');
var clearBtn = document.getElementById('clearBtn');

function reRender() {
  render(input.value, openCustomElementDialog);
}

// Debounced "user committed to a word" tracker. We don't want to fire a
// GA event for every keystroke (would torch the daily event quota and
// the data would be noise), so wait 1500ms of input-quiet before logging
// the current input value. Skip the seed value "genius" so we don't
// flood the report with the default; skip empties.
var _spellerLastFired = '';
var _spellerTimer = null;
function _spellerScheduleEvent() {
  if (_spellerTimer) clearTimeout(_spellerTimer);
  _spellerTimer = setTimeout(function () {
    var word = input.value.trim();
    if (!word || word.toLowerCase() === 'genius') return;
    if (word === _spellerLastFired) return;
    _spellerLastFired = word;
    if (window.trackEvent) {
      window.trackEvent('speller_word_rendered', 'Speller', word.slice(0, 40), word.length);
    }
  }, 1500);
}

input.addEventListener('input', function () {
  clearBtn.style.display = input.value ? 'block' : 'none';
  reRender();
  if (input.value.trim()) {
    window.heymingAchievements?.unlockForCurrentApp('first-action');
  }
  _spellerScheduleEvent();
});

clearBtn.addEventListener('click', function () {
  input.value = '';
  clearBtn.style.display = 'none';
  render('', openCustomElementDialog);
  input.focus();
});

// --- Export ---

document.getElementById('exportBtn').addEventListener('click', exportPNG);

// --- Theme popover ---

var themeBtn = document.getElementById('themeBtn');
var themePopover = document.getElementById('themePopover');

themeBtn.addEventListener('click', function (e) {
  e.stopPropagation();
  buildThemePopover();
  themePopover.hidden = !themePopover.hidden;
});

themePopover.addEventListener('click', function (e) {
  e.stopPropagation();
});

document.addEventListener('click', function () {
  themePopover.hidden = true;
});

// --- Periodic table modal ---

initPeriodicTableModal();

// --- Global Escape handler ---

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    var tableModal = document.getElementById('tableModal');
    if (!tableModal.hidden) tableModal.hidden = true;
    var customModal = document.getElementById('customElementModal');
    if (!customModal.hidden) customModal.hidden = true;
  }
});

// --- Share link ---

initShareLink(function () {
  return input.value;
});

// --- Init ---

renderCustomList();

var hashStr = window.location.hash.replace(/^#/, '');
var sharePrefix = 's=';
if (hashStr.indexOf(sharePrefix) === 0) {
  var decoded = decodeShareState(hashStr.slice(sharePrefix.length));
  if (decoded) {
    applyShareState(decoded, openCustomElementDialog, renderCustomList);
  } else {
    input.value = 'genius';
    clearBtn.style.display = 'block';
    render('genius', openCustomElementDialog);
  }
} else {
  input.value = 'genius';
  clearBtn.style.display = 'block';
  render('genius', openCustomElementDialog);
}
