(function () {
  'use strict';

  // All 118 elements: [atomic number, symbol, name, atomic mass, category]
  var ELEMENTS = [
    [1, 'H', 'Hydrogen', 1.008, 'nonmetal'],
    [2, 'He', 'Helium', 4.003, 'noble gas'],
    [3, 'Li', 'Lithium', 6.941, 'alkali metal'],
    [4, 'Be', 'Beryllium', 9.012, 'alkaline earth metal'],
    [5, 'B', 'Boron', 10.81, 'metalloid'],
    [6, 'C', 'Carbon', 12.011, 'nonmetal'],
    [7, 'N', 'Nitrogen', 14.007, 'nonmetal'],
    [8, 'O', 'Oxygen', 15.999, 'nonmetal'],
    [9, 'F', 'Fluorine', 18.998, 'halogen'],
    [10, 'Ne', 'Neon', 20.18, 'noble gas'],
    [11, 'Na', 'Sodium', 22.99, 'alkali metal'],
    [12, 'Mg', 'Magnesium', 24.305, 'alkaline earth metal'],
    [13, 'Al', 'Aluminum', 26.982, 'post-transition metal'],
    [14, 'Si', 'Silicon', 28.086, 'metalloid'],
    [15, 'P', 'Phosphorus', 30.974, 'nonmetal'],
    [16, 'S', 'Sulfur', 32.06, 'nonmetal'],
    [17, 'Cl', 'Chlorine', 35.45, 'halogen'],
    [18, 'Ar', 'Argon', 39.948, 'noble gas'],
    [19, 'K', 'Potassium', 39.098, 'alkali metal'],
    [20, 'Ca', 'Calcium', 40.078, 'alkaline earth metal'],
    [21, 'Sc', 'Scandium', 44.956, 'transition metal'],
    [22, 'Ti', 'Titanium', 47.867, 'transition metal'],
    [23, 'V', 'Vanadium', 50.942, 'transition metal'],
    [24, 'Cr', 'Chromium', 51.996, 'transition metal'],
    [25, 'Mn', 'Manganese', 54.938, 'transition metal'],
    [26, 'Fe', 'Iron', 26.982, 'transition metal'],
    [27, 'Co', 'Cobalt', 58.933, 'transition metal'],
    [28, 'Ni', 'Nickel', 58.693, 'transition metal'],
    [29, 'Cu', 'Copper', 63.546, 'transition metal'],
    [30, 'Zn', 'Zinc', 65.38, 'transition metal'],
    [31, 'Ga', 'Gallium', 69.723, 'post-transition metal'],
    [32, 'Ge', 'Germanium', 72.63, 'metalloid'],
    [33, 'As', 'Arsenic', 74.922, 'metalloid'],
    [34, 'Se', 'Selenium', 78.971, 'nonmetal'],
    [35, 'Br', 'Bromine', 79.904, 'halogen'],
    [36, 'Kr', 'Krypton', 83.798, 'noble gas'],
    [37, 'Rb', 'Rubidium', 85.468, 'alkali metal'],
    [38, 'Sr', 'Strontium', 87.62, 'alkaline earth metal'],
    [39, 'Y', 'Yttrium', 88.906, 'transition metal'],
    [40, 'Zr', 'Zirconium', 91.224, 'transition metal'],
    [41, 'Nb', 'Niobium', 92.906, 'transition metal'],
    [42, 'Mo', 'Molybdenum', 95.95, 'transition metal'],
    [43, 'Tc', 'Technetium', 98, 'transition metal'],
    [44, 'Ru', 'Ruthenium', 101.07, 'transition metal'],
    [45, 'Rh', 'Rhodium', 102.906, 'transition metal'],
    [46, 'Pd', 'Palladium', 106.42, 'transition metal'],
    [47, 'Ag', 'Silver', 107.868, 'transition metal'],
    [48, 'Cd', 'Cadmium', 112.414, 'transition metal'],
    [49, 'In', 'Indium', 114.818, 'post-transition metal'],
    [50, 'Sn', 'Tin', 118.711, 'post-transition metal'],
    [51, 'Sb', 'Antimony', 121.76, 'metalloid'],
    [52, 'Te', 'Tellurium', 127.6, 'metalloid'],
    [53, 'I', 'Iodine', 126.904, 'halogen'],
    [54, 'Xe', 'Xenon', 131.294, 'noble gas'],
    [55, 'Cs', 'Cesium', 132.905, 'alkali metal'],
    [56, 'Ba', 'Barium', 137.327, 'alkaline earth metal'],
    [57, 'La', 'Lanthanum', 138.905, 'lanthanide'],
    [58, 'Ce', 'Cerium', 140.116, 'lanthanide'],
    [59, 'Pr', 'Praseodymium', 140.908, 'lanthanide'],
    [60, 'Nd', 'Neodymium', 144.242, 'lanthanide'],
    [61, 'Pm', 'Promethium', 145, 'lanthanide'],
    [62, 'Sm', 'Samarium', 150.36, 'lanthanide'],
    [63, 'Eu', 'Europium', 151.964, 'lanthanide'],
    [64, 'Gd', 'Gadolinium', 157.25, 'lanthanide'],
    [65, 'Tb', 'Terbium', 158.925, 'lanthanide'],
    [66, 'Dy', 'Dysprosium', 162.5, 'lanthanide'],
    [67, 'Ho', 'Holmium', 164.93, 'lanthanide'],
    [68, 'Er', 'Erbium', 167.259, 'lanthanide'],
    [69, 'Tm', 'Thulium', 168.934, 'lanthanide'],
    [70, 'Yb', 'Ytterbium', 173.045, 'lanthanide'],
    [71, 'Lu', 'Lutetium', 174.967, 'lanthanide'],
    [72, 'Hf', 'Hafnium', 178.49, 'transition metal'],
    [73, 'Ta', 'Tantalum', 180.948, 'transition metal'],
    [74, 'W', 'Tungsten', 183.84, 'transition metal'],
    [75, 'Re', 'Rhenium', 186.207, 'transition metal'],
    [76, 'Os', 'Osmium', 190.23, 'transition metal'],
    [77, 'Ir', 'Iridium', 192.217, 'transition metal'],
    [78, 'Pt', 'Platinum', 195.084, 'transition metal'],
    [79, 'Au', 'Gold', 196.967, 'transition metal'],
    [80, 'Hg', 'Mercury', 200.592, 'transition metal'],
    [81, 'Tl', 'Thallium', 204.38, 'post-transition metal'],
    [82, 'Pb', 'Lead', 207.2, 'post-transition metal'],
    [83, 'Bi', 'Bismuth', 208.98, 'post-transition metal'],
    [84, 'Po', 'Polonium', 209, 'post-transition metal'],
    [85, 'At', 'Astatine', 210, 'halogen'],
    [86, 'Rn', 'Radon', 222, 'noble gas'],
    [87, 'Fr', 'Francium', 223, 'alkali metal'],
    [88, 'Ra', 'Radium', 226, 'alkaline earth metal'],
    [89, 'Ac', 'Actinium', 227, 'actinide'],
    [90, 'Th', 'Thorium', 232.038, 'actinide'],
    [91, 'Pa', 'Protactinium', 231.036, 'actinide'],
    [92, 'U', 'Uranium', 238.029, 'actinide'],
    [93, 'Np', 'Neptunium', 237, 'actinide'],
    [94, 'Pu', 'Plutonium', 244, 'actinide'],
    [95, 'Am', 'Americium', 243, 'actinide'],
    [96, 'Cm', 'Curium', 247, 'actinide'],
    [97, 'Bk', 'Berkelium', 247, 'actinide'],
    [98, 'Cf', 'Californium', 251, 'actinide'],
    [99, 'Es', 'Einsteinium', 252, 'actinide'],
    [100, 'Fm', 'Fermium', 257, 'actinide'],
    [101, 'Md', 'Mendelevium', 258, 'actinide'],
    [102, 'No', 'Nobelium', 259, 'actinide'],
    [103, 'Lr', 'Lawrencium', 266, 'actinide'],
    [104, 'Rf', 'Rutherfordium', 267, 'transition metal'],
    [105, 'Db', 'Dubnium', 268, 'transition metal'],
    [106, 'Sg', 'Seaborgium', 269, 'transition metal'],
    [107, 'Bh', 'Bohrium', 270, 'transition metal'],
    [108, 'Hs', 'Hassium', 277, 'transition metal'],
    [109, 'Mt', 'Meitnerium', 278, 'transition metal'],
    [110, 'Ds', 'Darmstadtium', 281, 'transition metal'],
    [111, 'Rg', 'Roentgenium', 282, 'transition metal'],
    [112, 'Cn', 'Copernicium', 285, 'transition metal'],
    [113, 'Nh', 'Nihonium', 286, 'post-transition metal'],
    [114, 'Fl', 'Flerovium', 289, 'post-transition metal'],
    [115, 'Mc', 'Moscovium', 290, 'post-transition metal'],
    [116, 'Lv', 'Livermorium', 293, 'post-transition metal'],
    [117, 'Ts', 'Tennessine', 294, 'halogen'],
    [118, 'Og', 'Oganesson', 294, 'noble gas']
  ];

  // Build lookup maps keyed by lowercase symbol
  var bySymbol = {};
  ELEMENTS.forEach(function (el) {
    bySymbol[el[1].toLowerCase()] = {
      number: el[0],
      symbol: el[1],
      name: el[2],
      mass: el[3],
      category: el[4]
    };
  });

  /**
   * Try to decompose `word` into a sequence of element symbols using backtracking.
   * Prefers two-letter matches to produce fewer, more interesting tiles.
   * Returns an array of element objects, or null if no full decomposition exists.
   */
  function decompose(word) {
    var lower = word.toLowerCase();
    var memo = {};

    function solve(i) {
      if (i === lower.length) return [];
      if (i in memo) return memo[i];

      // Try two-letter symbol first
      if (i + 1 < lower.length) {
        var two = lower.slice(i, i + 2);
        if (bySymbol[two]) {
          var rest2 = solve(i + 2);
          if (rest2 !== null) {
            memo[i] = [bySymbol[two]].concat(rest2);
            return memo[i];
          }
        }
      }

      // Try single-letter symbol
      var one = lower[i];
      if (bySymbol[one]) {
        var rest1 = solve(i + 1);
        if (rest1 !== null) {
          memo[i] = [bySymbol[one]].concat(rest1);
          return memo[i];
        }
      }

      memo[i] = null;
      return null;
    }

    return solve(0);
  }

  /**
   * Best-effort breakdown: greedily match what we can, mark unmatched letters.
   * Returns an array of objects: either element objects or { unmatched: 'x' }.
   */
  function bestEffort(word) {
    var lower = word.toLowerCase();
    var result = [];
    var i = 0;

    while (i < lower.length) {
      // Try two-letter
      if (i + 1 < lower.length) {
        var two = lower.slice(i, i + 2);
        if (bySymbol[two]) {
          result.push(bySymbol[two]);
          i += 2;
          continue;
        }
      }
      // Try single-letter
      var one = lower[i];
      if (bySymbol[one]) {
        result.push(bySymbol[one]);
      } else {
        result.push({ unmatched: lower[i] });
      }
      i++;
    }

    return result;
  }

  function createTileEl(el, delay) {
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

  function createUnmatchedTileEl(letter, delay) {
    var tile = document.createElement('div');
    tile.className = 'tile-unmatched';
    tile.style.animationDelay = delay + 'ms';

    var sym = document.createElement('span');
    sym.className = 'tile-symbol';
    sym.textContent = letter.toUpperCase();

    var label = document.createElement('span');
    label.className = 'tile-name';
    label.textContent = 'no match';

    tile.appendChild(sym);
    tile.appendChild(label);
    return tile;
  }

  /**
   * Decompose a single word, returning an array of element/unmatched items.
   * Uses full backtracking first; falls back to best-effort greedy.
   */
  function decomposeWord(word) {
    var cleaned = word.replace(/[^a-zA-Z]/g, '');
    if (!cleaned) return [];
    var result = decompose(cleaned);
    if (result) return result;
    return bestEffort(cleaned);
  }

  /**
   * Parse input into an array of words, each word is an array of element/unmatched items.
   * Spaces and newlines are treated as word separators.
   */
  function parseInput(text) {
    var words = text.split(/\s+/).filter(function (w) {
      return w.length > 0;
    });
    return words
      .map(function (w) {
        return decomposeWord(w);
      })
      .filter(function (items) {
        return items.length > 0;
      });
  }

  function render(text) {
    var tilesContainer = document.getElementById('tiles');
    var noMatchEl = document.getElementById('noMatch');
    var expRow = document.getElementById('exportRow');
    tilesContainer.innerHTML = '';
    lastDecomposition = null;

    if (!text || !/[a-zA-Z]/.test(text)) {
      noMatchEl.hidden = true;
      expRow.hidden = true;
      return;
    }

    var wordRows = parseInput(text);
    lastDecomposition = wordRows;

    var hasUnmatched = false;
    var tileIdx = 0;

    wordRows.forEach(function (items) {
      var wordEl = document.createElement('div');
      wordEl.className = 'tile-word';
      items.forEach(function (item) {
        if (item.unmatched) {
          hasUnmatched = true;
          wordEl.appendChild(createUnmatchedTileEl(item.unmatched, tileIdx * 60));
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

  // --- PNG export via Canvas API ---

  var EXPORT_TILE_W = 120;
  var EXPORT_TILE_H = 144;
  var EXPORT_GAP = 10;
  var EXPORT_LINE_GAP = 16;
  var EXPORT_PAD = 20;
  var EXPORT_BG = '#0f172a';

  var lastDecomposition = null;

  function getCategoryColor(category) {
    var map = {
      nonmetal: '#22d3ee',
      'noble gas': '#a78bfa',
      'alkali metal': '#f87171',
      'alkaline earth metal': '#fb923c',
      metalloid: '#34d399',
      halogen: '#facc15',
      'transition metal': '#60a5fa',
      'post-transition metal': '#4ade80',
      lanthanide: '#f472b6',
      actinide: '#e879f9'
    };
    return map[category] || '#38bdf8';
  }

  function drawTileOnCanvas(ctx, el, x, y) {
    var w = EXPORT_TILE_W;
    var h = EXPORT_TILE_H;
    var r = 12;
    var borderColor = el.unmatched ? '#64748b' : getCategoryColor(el.category);
    var fillColor = el.unmatched ? '#334155' : '#1e293b';

    // Rounded rect fill
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = el.unmatched ? 2 : 2.5;
    if (el.unmatched) ctx.setLineDash([6, 4]);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (el.unmatched) {
      // Unmatched letter
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 42px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(el.unmatched.toUpperCase(), x + w / 2, y + h / 2 - 6);

      ctx.fillStyle = '#64748b';
      ctx.font = '600 9px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText('NO MATCH', x + w / 2, y + h / 2 + 24);
    } else {
      // Atomic number
      ctx.fillStyle = borderColor;
      ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(el.number), x + 10, y + 8);

      // Symbol
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 42px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(el.symbol, x + w / 2, y + h / 2 - 4);

      // Name
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 9px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(el.name.toUpperCase(), x + w / 2, y + h / 2 + 24);

      // Mass
      ctx.fillStyle = '#64748b';
      ctx.font = '500 8px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(String(el.mass), x + w / 2, y + h / 2 + 38);
    }
  }

  function measureWordWidth(items) {
    return items.length * EXPORT_TILE_W + (items.length - 1) * EXPORT_GAP;
  }

  function exportPNG() {
    if (!lastDecomposition || lastDecomposition.length === 0) return;

    var wordRows = lastDecomposition;
    var maxRowW = 0;
    wordRows.forEach(function (items) {
      var rw = measureWordWidth(items);
      if (rw > maxRowW) maxRowW = rw;
    });

    var numRows = wordRows.length;
    var canvasW = EXPORT_PAD * 2 + maxRowW;
    var canvasH = EXPORT_PAD * 2 + numRows * EXPORT_TILE_H + (numRows - 1) * EXPORT_LINE_GAP;

    var canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    var ctx = canvas.getContext('2d');

    var transparent = document.getElementById('transparentBg').checked;
    if (!transparent) {
      ctx.fillStyle = EXPORT_BG;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    wordRows.forEach(function (items, rowIdx) {
      var rowW = measureWordWidth(items);
      var x = EXPORT_PAD + Math.floor((maxRowW - rowW) / 2);
      var y = EXPORT_PAD + rowIdx * (EXPORT_TILE_H + EXPORT_LINE_GAP);

      items.forEach(function (item, i) {
        if (i > 0) x += EXPORT_GAP;
        drawTileOnCanvas(ctx, item, x, y);
        x += EXPORT_TILE_W;
      });
    });

    var link = document.createElement('a');
    var rawText = document
      .getElementById('wordInput')
      .value.replace(/[^a-zA-Z\s]/g, '')
      .trim();
    var filename = rawText.replace(/\s+/g, '-').toLowerCase() || 'elements';
    link.download = 'periodic-' + filename + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  var input = document.getElementById('wordInput');
  var clearBtn = document.getElementById('clearBtn');
  var exportRow = document.getElementById('exportRow');
  var exportBtn = document.getElementById('exportBtn');

  exportBtn.addEventListener('click', exportPNG);

  input.addEventListener('input', function () {
    clearBtn.style.display = input.value ? 'block' : 'none';
    render(input.value);
  });

  clearBtn.addEventListener('click', function () {
    input.value = '';
    clearBtn.style.display = 'none';
    render('');
    input.focus();
  });

  // --- Periodic table reference modal ---

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
    actinide: '#e879f9'
  };

  function buildPeriodicGrid() {
    var grid = document.getElementById('periodicGrid');
    var legend = document.getElementById('modalLegend');
    if (grid.children.length > 0) return;

    // Build legend
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

    // Lanthanide/actinide indicator arrows in rows 6-7 col 3
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

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) modal.hidden = true;
  });

  // Show a fun default on load
  render('genius');
  input.value = 'genius';
  clearBtn.style.display = 'block';
})();
