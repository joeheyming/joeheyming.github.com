'use strict';

export var CATEGORY_BORDER_COLORS = {
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

function catBorder(cat) {
  return CATEGORY_BORDER_COLORS[cat] || '#38bdf8';
}

export var THEMES = {
  default: {
    label: 'Default',
    swatch: '#1e293b',
    bg: '#0f172a',
    tileBg: '#1e293b',
    border: catBorder,
    symbol: '#f8fafc',
    number: catBorder,
    name: '#94a3b8',
    mass: '#64748b',
    unmatchedBg: '#334155',
    unmatchedBorder: '#64748b',
    unmatchedText: '#64748b'
  },
  pastel: {
    label: 'Pastel',
    swatch: '#f0f4ff',
    bg: '#f8fafc',
    tileBg: '#f0f4ff',
    border: catBorder,
    symbol: '#1e293b',
    number: catBorder,
    name: '#64748b',
    mass: '#94a3b8',
    unmatchedBg: '#f1f5f9',
    unmatchedBorder: '#cbd5e1',
    unmatchedText: '#94a3b8'
  },
  neon: {
    label: 'Neon',
    swatch: '#0a0a0a',
    bg: '#000000',
    tileBg: '#0a0a0a',
    border: catBorder,
    symbol: '#ffffff',
    number: catBorder,
    name: '#a0a0a0',
    mass: '#666666',
    unmatchedBg: '#111111',
    unmatchedBorder: '#444444',
    unmatchedText: '#444444'
  },
  mono: {
    label: 'Mono',
    swatch: '#1e293b',
    bg: '#0f172a',
    tileBg: '#1e293b',
    border: '#e2e8f0',
    symbol: '#f8fafc',
    number: '#e2e8f0',
    name: '#94a3b8',
    mass: '#64748b',
    unmatchedBg: '#334155',
    unmatchedBorder: '#64748b',
    unmatchedText: '#64748b'
  },
  heisenberg: {
    label: 'Heisenberg',
    swatch: '#0c1a0c',
    bg: '#050e05',
    tileBg: '#0c1a0c',
    border: '#22c55e',
    symbol: '#4ade80',
    number: '#22c55e',
    name: '#166534',
    mass: '#14532d',
    unmatchedBg: '#0c1a0c',
    unmatchedBorder: '#166534',
    unmatchedText: '#166534'
  },
  vintage: {
    label: 'Vintage',
    swatch: '#fef3c7',
    bg: '#fffbeb',
    tileBg: '#fef3c7',
    border: '#92400e',
    symbol: '#451a03',
    number: '#92400e',
    name: '#78350f',
    mass: '#92400e',
    unmatchedBg: '#fef9ee',
    unmatchedBorder: '#d6d3d1',
    unmatchedText: '#a8a29e'
  }
};

var currentTheme = 'default';

export function getCurrentTheme() {
  return currentTheme;
}

export function getThemeColors() {
  return THEMES[currentTheme] || THEMES['default'];
}

export function setTheme(themeId) {
  currentTheme = themeId;
  var tilesEl = document.getElementById('tiles');
  tilesEl.setAttribute('data-theme', themeId === 'default' ? '' : themeId);

  var swatches = document.querySelectorAll('.theme-swatch');
  swatches.forEach(function (s) {
    s.classList.toggle('active', s.getAttribute('data-theme-id') === themeId);
  });
}

export function buildThemePopover() {
  var pop = document.getElementById('themePopover');
  if (pop.children.length > 0) return;

  Object.keys(THEMES).forEach(function (key) {
    var t = THEMES[key];
    var btn = document.createElement('button');
    btn.className = 'theme-swatch' + (key === currentTheme ? ' active' : '');
    btn.setAttribute('data-theme-id', key);

    var preview = document.createElement('span');
    preview.className = 'theme-swatch-preview';
    preview.style.background = t.swatch;
    preview.style.borderColor =
      typeof t.border === 'function' ? t.border('transition metal') : t.border;

    var label = document.createElement('span');
    label.textContent = t.label;

    btn.appendChild(preview);
    btn.appendChild(label);
    pop.appendChild(btn);

    btn.addEventListener('click', function () {
      setTheme(key);
      pop.hidden = true;
    });
  });
}
