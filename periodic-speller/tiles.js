'use strict';

import { parseInput } from './decompose.js';

// Shared mutable reference so export.js can read last decomposition
export var state = {
  lastDecomposition: null
};

export function createTileEl(el, delay) {
  var tile = document.createElement('div');
  tile.className = 'tile';
  tile.setAttribute('data-category', el.category);
  tile.style.animationDelay = delay + 'ms';

  var num = document.createElement('span');
  num.className = 'tile-number';
  num.textContent = el.number;

  var sym = document.createElement('span');
  sym.className = 'tile-symbol';
  sym.textContent = el.symbol;

  var name = document.createElement('span');
  name.className = 'tile-name';
  name.textContent = el.name;

  var mass = document.createElement('span');
  mass.className = 'tile-mass';
  mass.textContent = el.mass;

  tile.appendChild(num);
  tile.appendChild(sym);
  tile.appendChild(name);
  tile.appendChild(mass);
  return tile;
}

export function createUnmatchedTileEl(letter, delay, onClickCreate) {
  var tile = document.createElement('div');
  tile.className = 'tile-unmatched clickable';
  tile.style.animationDelay = delay + 'ms';
  tile.title = 'Click to create a custom element for "' + letter.toUpperCase() + '"';

  var sym = document.createElement('span');
  sym.className = 'tile-symbol';
  sym.textContent = letter.toUpperCase();

  var label = document.createElement('span');
  label.className = 'tile-name';
  label.textContent = '+ create';

  tile.appendChild(sym);
  tile.appendChild(label);

  tile.addEventListener('click', function () {
    if (onClickCreate) onClickCreate(letter);
  });

  return tile;
}

export function render(text, onClickCreate) {
  var tilesContainer = document.getElementById('tiles');
  var noMatchEl = document.getElementById('noMatch');
  var expRow = document.getElementById('exportRow');
  tilesContainer.innerHTML = '';
  state.lastDecomposition = null;

  if (!text || !/[a-zA-Z]/.test(text)) {
    noMatchEl.hidden = true;
    expRow.hidden = true;
    return;
  }

  var wordRows = parseInput(text);
  state.lastDecomposition = wordRows;

  var hasUnmatched = false;
  var tileIdx = 0;

  wordRows.forEach(function (items) {
    var wordEl = document.createElement('div');
    wordEl.className = 'tile-word';
    items.forEach(function (item) {
      if (item.unmatched) {
        hasUnmatched = true;
        wordEl.appendChild(createUnmatchedTileEl(item.unmatched, tileIdx * 60, onClickCreate));
      } else {
        wordEl.appendChild(createTileEl(item, tileIdx * 60));
      }
      tileIdx++;
    });
    tilesContainer.appendChild(wordEl);
  });

  noMatchEl.hidden = !hasUnmatched;
  expRow.hidden = false;
}
