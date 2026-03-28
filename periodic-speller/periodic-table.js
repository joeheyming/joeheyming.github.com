'use strict';

import { ELEMENTS } from './elements.js';

// Standard periodic table grid positions: [atomicNumber] = [row, col] (1-indexed)
var GRID_POS = {
  1: [1, 1],
  2: [1, 18],
  3: [2, 1],
  4: [2, 2],
  5: [2, 13],
  6: [2, 14],
  7: [2, 15],
  8: [2, 16],
  9: [2, 17],
  10: [2, 18],
  11: [3, 1],
  12: [3, 2],
  13: [3, 13],
  14: [3, 14],
  15: [3, 15],
  16: [3, 16],
  17: [3, 17],
  18: [3, 18],
  19: [4, 1],
  20: [4, 2],
  21: [4, 3],
  22: [4, 4],
  23: [4, 5],
  24: [4, 6],
  25: [4, 7],
  26: [4, 8],
  27: [4, 9],
  28: [4, 10],
  29: [4, 11],
  30: [4, 12],
  31: [4, 13],
  32: [4, 14],
  33: [4, 15],
  34: [4, 16],
  35: [4, 17],
  36: [4, 18],
  37: [5, 1],
  38: [5, 2],
  39: [5, 3],
  40: [5, 4],
  41: [5, 5],
  42: [5, 6],
  43: [5, 7],
  44: [5, 8],
  45: [5, 9],
  46: [5, 10],
  47: [5, 11],
  48: [5, 12],
  49: [5, 13],
  50: [5, 14],
  51: [5, 15],
  52: [5, 16],
  53: [5, 17],
  54: [5, 18],
  55: [6, 1],
  56: [6, 2],
  72: [6, 4],
  73: [6, 5],
  74: [6, 6],
  75: [6, 7],
  76: [6, 8],
  77: [6, 9],
  78: [6, 10],
  79: [6, 11],
  80: [6, 12],
  81: [6, 13],
  82: [6, 14],
  83: [6, 15],
  84: [6, 16],
  85: [6, 17],
  86: [6, 18],
  87: [7, 1],
  88: [7, 2],
  104: [7, 4],
  105: [7, 5],
  106: [7, 6],
  107: [7, 7],
  108: [7, 8],
  109: [7, 9],
  110: [7, 10],
  111: [7, 11],
  112: [7, 12],
  113: [7, 13],
  114: [7, 14],
  115: [7, 15],
  116: [7, 16],
  117: [7, 17],
  118: [7, 18],
  // Lanthanides (row 9)
  57: [9, 4],
  58: [9, 5],
  59: [9, 6],
  60: [9, 7],
  61: [9, 8],
  62: [9, 9],
  63: [9, 10],
  64: [9, 11],
  65: [9, 12],
  66: [9, 13],
  67: [9, 14],
  68: [9, 15],
  69: [9, 16],
  70: [9, 17],
  71: [9, 18],
  // Actinides (row 10)
  89: [10, 4],
  90: [10, 5],
  91: [10, 6],
  92: [10, 7],
  93: [10, 8],
  94: [10, 9],
  95: [10, 10],
  96: [10, 11],
  97: [10, 12],
  98: [10, 13],
  99: [10, 14],
  100: [10, 15],
  101: [10, 16],
  102: [10, 17],
  103: [10, 18]
};

var CATEGORY_COLORS = {
  nonmetal: '#22d3ee',
  'noble gas': '#a78bfa',
  'alkali metal': '#f87171',
  'alkaline earth metal': '#fb923c',
  metalloid: '#34d399',
  halogen: '#facc15',
  'transition metal': '#60a5fa',
  'post-transition metal': '#4ade80',
  lanthanide: '#f472b6',
  actinide: '#e879f9',
  custom: '#f59e0b'
};

export function buildPeriodicGrid() {
  var grid = document.getElementById('periodicGrid');
  var legend = document.getElementById('modalLegend');
  if (grid.children.length > 0) return;

  Object.keys(CATEGORY_COLORS).forEach(function (cat) {
    var item = document.createElement('span');
    item.className = 'legend-item';
    var swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = CATEGORY_COLORS[cat];
    var label = document.createElement('span');
    label.textContent = cat;
    item.appendChild(swatch);
    item.appendChild(label);
    legend.appendChild(item);
  });

  var markers = [
    { row: 6, col: 3, text: '57-71' },
    { row: 7, col: 3, text: '89-103' },
    { row: 9, col: 3, text: 'Ln' },
    { row: 10, col: 3, text: 'Ac' }
  ];

  markers.forEach(function (m) {
    var label = document.createElement('div');
    label.className = 'pgrid-label';
    label.textContent = m.text;
    label.style.gridRow = m.row;
    label.style.gridColumn = m.col;
    grid.appendChild(label);
  });

  ELEMENTS.forEach(function (el) {
    var num = el[0];
    var sym = el[1];
    var name = el[2];
    var cat = el[4];
    var pos = GRID_POS[num];
    if (!pos) return;

    var cell = document.createElement('div');
    cell.className = 'pgrid-cell';
    cell.style.gridRow = pos[0];
    cell.style.gridColumn = pos[1];
    cell.style.background = CATEGORY_COLORS[cat] || '#475569';
    cell.title = num + ' - ' + name + ' (' + sym + ') - ' + cat;

    var numEl = document.createElement('span');
    numEl.className = 'pgrid-num';
    numEl.textContent = num;

    var symEl = document.createElement('span');
    symEl.className = 'pgrid-sym';
    symEl.textContent = sym;

    var nameEl = document.createElement('span');
    nameEl.className = 'pgrid-name';
    nameEl.textContent = name;

    cell.appendChild(numEl);
    cell.appendChild(symEl);
    cell.appendChild(nameEl);
    grid.appendChild(cell);
  });
}

export function initPeriodicTableModal() {
  var modal = document.getElementById('tableModal');
  var tableBtn = document.getElementById('tableBtn');
  var closeBtn = document.getElementById('closeModal');

  tableBtn.addEventListener('click', function () {
    buildPeriodicGrid();
    modal.hidden = false;
  });

  closeBtn.addEventListener('click', function () {
    modal.hidden = true;
  });

  modal.addEventListener('click', function (e) {
    if (e.target === modal) modal.hidden = true;
  });
}
