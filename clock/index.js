'use strict';

/* ── Constants ── */
const CITIES = [
  { name: 'New York', tz: 'America/New_York' },
  { name: 'Los Angeles', tz: 'America/Los_Angeles' },
  { name: 'Chicago', tz: 'America/Chicago' },
  { name: 'Denver', tz: 'America/Denver' },
  { name: 'Toronto', tz: 'America/Toronto' },
  { name: 'São Paulo', tz: 'America/Sao_Paulo' },
  { name: 'London', tz: 'Europe/London' },
  { name: 'Paris', tz: 'Europe/Paris' },
  { name: 'Berlin', tz: 'Europe/Berlin' },
  { name: 'Moscow', tz: 'Europe/Moscow' },
  { name: 'Dubai', tz: 'Asia/Dubai' },
  { name: 'Mumbai', tz: 'Asia/Kolkata' },
  { name: 'Kolkata', tz: 'Asia/Kolkata' },
  { name: 'Bangkok', tz: 'Asia/Bangkok' },
  { name: 'Singapore', tz: 'Asia/Singapore' },
  { name: 'Hong Kong', tz: 'Asia/Hong_Kong' },
  { name: 'Shanghai', tz: 'Asia/Shanghai' },
  { name: 'Tokyo', tz: 'Asia/Tokyo' },
  { name: 'Seoul', tz: 'Asia/Seoul' },
  { name: 'Sydney', tz: 'Australia/Sydney' },
  { name: 'Auckland', tz: 'Pacific/Auckland' },
  { name: 'Honolulu', tz: 'Pacific/Honolulu' }
];

const LS_AMPM = 'clock_use12hr';
const LS_CITIES = 'clock_cities';
const RING_R = 52;
const RING_CIRC = 2 * Math.PI * RING_R;

/* ── Utilities ── */
const pad2 = (n) => String(n).padStart(2, '0');

function tzOffset(tz) {
  const now = new Date();
  const local = new Date(
    now.toLocaleString('en-US', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
  );
  const city = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const diffMs = city - local;
  const diffH = diffMs / 3600000;
  if (diffH === 0) return 'Local';
  const sign = diffH > 0 ? '+' : '−';
  const abs = Math.abs(diffH);
  return Number.isInteger(abs)
    ? `${sign}${abs}h`
    : `${sign}${abs.toFixed(1).replace('.', 'h')}m`.replace('hm', 'h30m');
}

function formatTZ(tz, use12) {
  const now = new Date();
  const opts = {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: use12
  };
  const str = now.toLocaleString('en-US', opts);
  if (use12) {
    const [time, period] = str.split(' ');
    return { time, period };
  }
  return { time: str, period: '' };
}

function fmtDuration(ms) {
  const totalCs = Math.floor(ms / 10);
  const cs = totalCs % 100;
  const secs = Math.floor(totalCs / 100) % 60;
  const mins = Math.floor(totalCs / 6000);
  return { mins: pad2(mins), secs: pad2(secs), cs: pad2(cs) };
}

function fmtTimerDisplay(totalSecs) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
  return `${m}:${pad2(s)}`;
}

/* ── Tab switching ── */
const tabs = [
  { btn: document.getElementById('tab-clock'), panel: document.getElementById('clock-panel') },
  { btn: document.getElementById('tab-sw'), panel: document.getElementById('sw-panel') },
  { btn: document.getElementById('tab-timer'), panel: document.getElementById('timer-panel') }
];

tabs.forEach(({ btn, panel }, idx) => {
  btn.addEventListener('click', () => activateTab(idx));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      activateTab((idx + 1) % tabs.length);
      tabs[(idx + 1) % tabs.length].btn.focus();
    }
    if (e.key === 'ArrowLeft') {
      activateTab((idx + 2) % tabs.length);
      tabs[(idx + 2) % tabs.length].btn.focus();
    }
  });
});

function activateTab(idx) {
  tabs.forEach(({ btn, panel: p }, i) => {
    const active = i === idx;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
    btn.setAttribute('tabindex', active ? '0' : '-1');
    p.classList.toggle('active', active);
    p.hidden = !active;
  });
}

/* ══════════════════════════════════════════
   CLOCK
══════════════════════════════════════════ */
let use12 = localStorage.getItem(LS_AMPM) !== 'false';

const clockTimeEl = document.getElementById('clock-time');
const clockAmpmEl = document.getElementById('clock-ampm');
const clockDateEl = document.getElementById('clock-date');
const btn12 = document.getElementById('btn-12hr');
const btn24 = document.getElementById('btn-24hr');

function setFormat(to12) {
  use12 = to12;
  localStorage.setItem(LS_AMPM, to12);
  btn12.classList.toggle('active', to12);
  btn24.classList.toggle('active', !to12);
  btn12.setAttribute('aria-pressed', to12);
  btn24.setAttribute('aria-pressed', !to12);
  renderCityList();
}

btn12.addEventListener('click', () => setFormat(true));
btn24.addEventListener('click', () => setFormat(false));

/* ── Clock face modes ── */
const LS_FACE = 'clock.face';
let clockFace = localStorage.getItem(LS_FACE) || 'digital';

const digitalFaceEl = document.getElementById('digital-face');
const analogFaceEl = document.getElementById('analog-face');
const flipFaceEl = document.getElementById('flip-face');
const romanFaceEl = document.getElementById('roman-face');
const binaryFaceEl = document.getElementById('binary-face');
const ledFaceEl = document.getElementById('led-face');
const wordsFaceEl = document.getElementById('words-face');
const faceBtns = document.querySelectorAll('.face-btn');

const faceMap = {
  digital: { el: digitalFaceEl, display: '' },
  analog: { el: analogFaceEl, display: 'block' },
  flip: { el: flipFaceEl, display: 'flex' },
  roman: { el: romanFaceEl, display: 'block' },
  binary: { el: binaryFaceEl, display: 'block' },
  led: { el: ledFaceEl, display: 'block' },
  words: { el: wordsFaceEl, display: 'block' }
};

function applyFace(face) {
  clockFace = face;
  localStorage.setItem(LS_FACE, face);
  for (const [key, { el, display }] of Object.entries(faceMap)) {
    el.style.display = key === face ? display : 'none';
  }
  clockAmpmEl.hidden = face !== 'digital' || !use12;
  faceBtns.forEach((b) => {
    const active = b.dataset.face === face;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active);
  });
}

/* ── Roman numerals helpers ── */
const ROMAN_MAP = [
  ['M', 1000],
  ['CM', 900],
  ['D', 500],
  ['CD', 400],
  ['C', 100],
  ['XC', 90],
  ['L', 50],
  ['XL', 40],
  ['X', 10],
  ['IX', 9],
  ['V', 5],
  ['IV', 4],
  ['I', 1]
];
function toRoman(n) {
  if (n === 0) return '–';
  let r = '';
  for (const [sym, val] of ROMAN_MAP) {
    while (n >= val) {
      r += sym;
      n -= val;
    }
  }
  return r;
}
const romanH = document.getElementById('roman-h');
const romanM = document.getElementById('roman-m');
const romanS = document.getElementById('roman-s');
const romanAmpm = document.getElementById('roman-ampm');

function updateRoman(hrs, mins, secs, ampm) {
  romanH.textContent = toRoman(hrs);
  romanM.textContent = toRoman(mins);
  romanS.textContent = toRoman(secs);
  romanAmpm.textContent = ampm;
}

/* ── Binary clock helpers ── */
function buildBinaryDots(containerId, bits, colorClass) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  for (let i = bits - 1; i >= 0; i--) {
    const d = document.createElement('div');
    d.className = 'bin-dot';
    d.dataset.bit = i;
    d.dataset.color = colorClass;
    el.appendChild(d);
  }
}
buildBinaryDots('bin-h', 5, 'on-h'); /* 0-23 needs 5 bits */
buildBinaryDots('bin-m', 6, 'on-m'); /* 0-59 needs 6 bits */
buildBinaryDots('bin-s', 6, 'on-s');

function updateBinaryRow(containerId, valElId, value, colorClass) {
  const dots = document.querySelectorAll(`#${containerId} .bin-dot`);
  const bits = dots.length;
  dots.forEach((d, i) => {
    const bitPos = bits - 1 - i;
    const on = (value >> bitPos) & 1;
    d.classList.toggle(colorClass, !!on);
  });
  document.getElementById(valElId).textContent = pad2(value);
}
const binaryAmpm = document.getElementById('binary-ampm');

function updateBinary(hrs, mins, secs, ampm) {
  updateBinaryRow('bin-h', 'bin-h-val', hrs, 'on-h');
  updateBinaryRow('bin-m', 'bin-m-val', mins, 'on-m');
  updateBinaryRow('bin-s', 'bin-s-val', secs, 'on-s');
  binaryAmpm.textContent = ampm;
}

/* ── LED dot-matrix helpers ── */
const LED_PATTERNS = {
  0: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['01110', '10001', '00001', '00110', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
};
function makeLedDigit(d, colorClass) {
  const pat = LED_PATTERNS[d] || LED_PATTERNS[0];
  const matrix = document.createElement('div');
  matrix.className = 'led-digit-matrix';
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 5; c++) {
      const dot = document.createElement('div');
      dot.className = 'ldot' + (pat[r][c] === '1' ? ' ' + colorClass : '');
      matrix.appendChild(dot);
    }
  }
  return matrix;
}
function makeLedSep() {
  const sep = document.createElement('div');
  sep.className = 'led-sep-col';
  sep.innerHTML = '<div class="led-sep-dot"></div><div class="led-sep-dot"></div>';
  return sep;
}
function makeLedGroup(value, label, colorClass) {
  const grp = document.createElement('div');
  grp.className = 'led-unit-group';
  const digits = document.createElement('div');
  digits.className = 'led-unit-digits';
  String(pad2(value))
    .split('')
    .forEach((ch) => digits.appendChild(makeLedDigit(+ch, colorClass)));
  const lbl = document.createElement('span');
  lbl.className = 'led-unit-label';
  lbl.textContent = label;
  grp.appendChild(digits);
  grp.appendChild(lbl);
  return grp;
}
const ledGrid = document.getElementById('led-grid');
const ledAmpm = document.getElementById('led-ampm');

function updateLed(hrs, mins, secs, ampm) {
  ledGrid.innerHTML = '';
  ledGrid.appendChild(makeLedGroup(hrs, 'hr', 'on-amb'));
  ledGrid.appendChild(makeLedSep());
  ledGrid.appendChild(makeLedGroup(mins, 'min', 'on-grn'));
  ledGrid.appendChild(makeLedSep());
  ledGrid.appendChild(makeLedGroup(secs, 'sec', 'on-red'));
  ledAmpm.textContent = ampm;
}

/* ── Words face helpers ── */
const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen'
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
function numWords(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
}
function w(text) {
  return `<span class="w-num">${text}</span>`;
}
function u(text) {
  return `<span class="w-unit">${text}</span>`;
}
function buildWordsPhrase(hrs, mins, secs, ampm) {
  let phrase;
  if (mins === 0 && secs === 0) {
    phrase = `${w(numWords(hrs))} ${u("o'clock")}`;
  } else if (secs === 0) {
    if (mins === 15) phrase = `${u('quarter past')} ${w(numWords(hrs))}`;
    else if (mins === 30) phrase = `${w('half')} ${u('past')} ${w(numWords(hrs))}`;
    else if (mins === 45) phrase = `${u('quarter to')} ${w(numWords(hrs + 1 > 12 ? 1 : hrs + 1))}`;
    else
      phrase = `${w(numWords(mins))} ${u(mins === 1 ? 'minute past' : 'minutes past')} ${w(
        numWords(hrs)
      )}`;
  } else {
    phrase = `${w(numWords(hrs))} ${u('h')} ${w(numWords(mins))} ${u('m')} ${w(numWords(secs))} ${u(
      's'
    )}`;
  }
  return phrase + (ampm ? ` <span class="w-sep">${ampm}</span>` : '');
}
const wordsPhrase = document.getElementById('words-phrase');

function updateWords(hrs, mins, secs, ampm) {
  wordsPhrase.innerHTML = buildWordsPhrase(hrs, mins, secs, ampm);
}

faceBtns.forEach((b) => b.addEventListener('click', () => applyFace(b.dataset.face)));
applyFace(clockFace);

/* ── Build analog tick marks ── */
(function buildTicks() {
  const g = document.getElementById('analog-ticks');
  for (let i = 0; i < 60; i++) {
    const isMajor = i % 5 === 0;
    const angle = (i / 60) * 360;
    const r1 = isMajor ? 82 : 88;
    const r2 = 93;
    const rad = ((angle - 90) * Math.PI) / 180;
    const x1 = 100 + r1 * Math.cos(rad);
    const y1 = 100 + r1 * Math.sin(rad);
    const x2 = 100 + r2 * Math.cos(rad);
    const y2 = 100 + r2 * Math.sin(rad);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', isMajor ? 'tick-major' : 'tick-minor');
    g.appendChild(line);
  }
})();

const handHour = document.getElementById('hand-hour');
const handMin = document.getElementById('hand-min');
const handSec = document.getElementById('hand-sec');
const handSecTail = document.getElementById('hand-sec-tail');

function updateAnalog(hrs24, mins, secs) {
  const hDeg = ((hrs24 % 12) / 12) * 360 + (mins / 60) * 30;
  const mDeg = (mins / 60) * 360 + (secs / 60) * 6;
  const sDeg = (secs / 60) * 360;
  const rot = (deg) => `rotate(${deg}, 100, 100)`;
  handHour.setAttribute('transform', rot(hDeg));
  handMin.setAttribute('transform', rot(mDeg));
  handSec.setAttribute('transform', rot(sDeg));
  handSecTail.setAttribute('transform', rot(sDeg));
}

/* ── Flip clock ── */
const flipDigitPrev = { h0: '', h1: '', m0: '', m1: '', s0: '', s1: '' };

function setFlipDigit(id, newVal) {
  const key = id.replace('fd-', '');
  if (flipDigitPrev[key] === newVal) return;
  const oldVal = flipDigitPrev[key];
  flipDigitPrev[key] = newVal;
  const el = document.getElementById(id);
  if (!el) return;

  /* Update static top/bottom to new value */
  el.querySelector('.flip-top span').textContent = newVal;
  el.querySelector('.flip-bottom span').textContent = newVal;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced || oldVal === '') return;

  /* Animate: clone old value into fold panels */
  const topFold = document.createElement('div');
  topFold.className = 'flip-top-fold';
  topFold.innerHTML = `<span>${oldVal}</span>`;

  const botFold = document.createElement('div');
  botFold.className = 'flip-bottom-fold';
  botFold.innerHTML = `<span>${newVal}</span>`;

  el.classList.add('flipping');
  el.appendChild(topFold);
  el.appendChild(botFold);

  topFold.addEventListener(
    'animationend',
    () => {
      topFold.remove();
      if (!el.querySelector('.flip-bottom-fold')) el.classList.remove('flipping');
    },
    { once: true }
  );
  botFold.addEventListener(
    'animationend',
    () => {
      botFold.remove();
      el.classList.remove('flipping');
    },
    { once: true }
  );
}

function updateFlip(hrs, mins, secs) {
  const hStr = pad2(hrs),
    mStr = pad2(mins),
    sStr = pad2(secs);
  setFlipDigit('fd-h0', hStr[0]);
  setFlipDigit('fd-h1', hStr[1]);
  setFlipDigit('fd-m0', mStr[0]);
  setFlipDigit('fd-m1', mStr[1]);
  setFlipDigit('fd-s0', sStr[0]);
  setFlipDigit('fd-s1', sStr[1]);
  document.getElementById('flip-ampm').textContent = use12 ? (hrs >= 12 ? 'PM' : 'AM') : '';
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

function tickClock() {
  const now = new Date();
  const hrs24 = now.getHours();
  const mins = now.getMinutes();
  const secs = now.getSeconds();
  let dispHrs = hrs24;
  let ampm = '';
  if (use12) {
    ampm = hrs24 >= 12 ? 'PM' : 'AM';
    dispHrs = hrs24 % 12 || 12;
  }

  if (clockFace === 'digital') {
    clockTimeEl.textContent = `${pad2(dispHrs)}:${pad2(mins)}:${pad2(secs)}`;
    clockAmpmEl.textContent = ampm;
    clockAmpmEl.hidden = !use12;
  } else if (clockFace === 'analog') {
    updateAnalog(hrs24, mins, secs);
  } else if (clockFace === 'flip') {
    updateFlip(dispHrs, mins, secs);
  } else if (clockFace === 'roman') {
    updateRoman(dispHrs, mins, secs, ampm);
  } else if (clockFace === 'binary') {
    updateBinary(dispHrs, mins, secs, ampm);
  } else if (clockFace === 'led') {
    updateLed(dispHrs, mins, secs, ampm);
  } else if (clockFace === 'words') {
    updateWords(dispHrs, mins, secs, ampm);
  }

  clockDateEl.textContent = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
}

/* World Clocks */
let savedCities = JSON.parse(localStorage.getItem(LS_CITIES) || '[]');

const cityListEl = document.getElementById('city-list');
const cityEmptyEl = document.getElementById('city-empty');
const openAddBtn = document.getElementById('open-add-city');
const searchCont = document.getElementById('city-search-container');
const searchInput = document.getElementById('city-search');
const cityDropdown = document.getElementById('city-dropdown');

openAddBtn.addEventListener('click', () => {
  const open = searchCont.hidden;
  searchCont.hidden = !open;
  openAddBtn.setAttribute('aria-expanded', open);
  if (open) {
    searchInput.value = '';
    renderDropdown('');
    searchInput.focus();
  }
});

searchInput.addEventListener('input', () => renderDropdown(searchInput.value));
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchCont.hidden = true;
    openAddBtn.setAttribute('aria-expanded', 'false');
    openAddBtn.focus();
  }
});

function renderDropdown(q) {
  const lq = q.toLowerCase();
  const matches = CITIES.filter(
    (c) => c.name.toLowerCase().includes(lq) && !savedCities.find((s) => s.tz === c.tz)
  );
  cityDropdown.innerHTML = '';
  if (!matches.length) {
    const li = document.createElement('div');
    li.className = 'city-option';
    li.textContent = 'No cities found';
    li.setAttribute('aria-disabled', 'true');
    cityDropdown.appendChild(li);
    return;
  }
  matches.forEach((city) => {
    const btn = document.createElement('button');
    btn.className = 'city-option';
    btn.textContent = city.name;
    btn.setAttribute('role', 'option');
    btn.addEventListener('click', () => addCity(city));
    cityDropdown.appendChild(btn);
  });
}

function addCity(city) {
  if (savedCities.find((c) => c.tz === city.tz)) return;
  savedCities.push(city);
  localStorage.setItem(LS_CITIES, JSON.stringify(savedCities));
  renderCityList();
  searchCont.hidden = true;
  openAddBtn.setAttribute('aria-expanded', 'false');
  openAddBtn.focus();
}

function removeCity(tz) {
  savedCities = savedCities.filter((c) => c.tz !== tz);
  localStorage.setItem(LS_CITIES, JSON.stringify(savedCities));
  renderCityList();
}

function renderCityList() {
  cityListEl.innerHTML = '';
  cityEmptyEl.hidden = savedCities.length > 0;

  savedCities.forEach((city) => {
    const { time, period } = formatTZ(city.tz, use12);
    const offset = tzOffset(city.tz);

    const row = document.createElement('div');
    row.className = 'city-row';
    row.setAttribute('role', 'listitem');

    const left = document.createElement('div');
    left.className = 'city-row-left';

    const nameEl = document.createElement('div');
    nameEl.className = 'city-name';
    nameEl.textContent = city.name;

    const offEl = document.createElement('div');
    offEl.className = 'city-offset';
    offEl.textContent = offset;

    left.append(nameEl, offEl);

    const timeEl = document.createElement('div');
    timeEl.className = 'city-time';
    timeEl.setAttribute('aria-label', `${city.name}: ${time}${period ? ' ' + period : ''}`);

    const timeSpan = document.createElement('span');
    timeSpan.textContent = time;
    const ampmSpan = document.createElement('span');
    ampmSpan.className = 'city-ampm';
    ampmSpan.textContent = period;
    timeEl.append(timeSpan, ampmSpan);

    const rmBtn = document.createElement('button');
    rmBtn.className = 'remove-city-btn';
    rmBtn.setAttribute('aria-label', `Remove ${city.name}`);
    rmBtn.textContent = '×';
    rmBtn.addEventListener('click', () => removeCity(city.tz));

    row.append(left, timeEl, rmBtn);
    cityListEl.appendChild(row);
  });
}

function tickWorldClocks() {
  const rows = cityListEl.querySelectorAll('.city-row');
  savedCities.forEach((city, i) => {
    const row = rows[i];
    if (!row) return;
    const { time, period } = formatTZ(city.tz, use12);
    const timeEl = row.querySelector('.city-time');
    const timeSpan = timeEl.querySelector('span:first-child');
    const ampmSpan = timeEl.querySelector('.city-ampm');
    timeSpan.textContent = time;
    ampmSpan.textContent = period;
    timeEl.setAttribute('aria-label', `${city.name}: ${time}${period ? ' ' + period : ''}`);
  });
}

/* Clock tick master */
function clockTick() {
  tickClock();
  tickWorldClocks();
}

setFormat(use12);
renderCityList();
renderDropdown('');
clockTick();
setInterval(clockTick, 1000);

/* ══════════════════════════════════════════
   STOPWATCH
══════════════════════════════════════════ */
let swRunning = false;
let swStart = 0;
let swElapsed = 0;
let swLapStart = 0;
let swRaf = null;
let laps = [];

const swMins = document.getElementById('sw-mins');
const swSecs = document.getElementById('sw-secs');
const swCs = document.getElementById('sw-cs');
const swDisplay = document.getElementById('sw-display');
const btnSS = document.getElementById('sw-start-stop');
const btnLR = document.getElementById('sw-lap-reset');
const lapListEl = document.getElementById('lap-list');
const swEmptyEl = document.getElementById('sw-empty');

function swRender(ms) {
  const { mins, secs, cs } = fmtDuration(ms);
  swMins.textContent = mins;
  swSecs.textContent = secs;
  swCs.textContent = cs;
}

function swLoop() {
  const now = performance.now();
  swElapsed = swStart > 0 ? now - swStart + swElapsed : swElapsed;
  swStart = now;
  swRender(swElapsed);
  swRaf = requestAnimationFrame(swLoop);
}

function swStart_() {
  swRunning = true;
  swStart = performance.now();
  if (swLapStart === 0) swLapStart = 0;
  btnSS.textContent = 'Stop';
  btnSS.className = 'circle-btn btn-stop';
  btnSS.setAttribute('aria-label', 'Stop stopwatch');
  btnLR.textContent = 'Lap';
  btnLR.className = 'circle-btn btn-lap';
  btnLR.setAttribute('aria-label', 'Record lap');
  swEmptyEl.hidden = true;
  swRaf = requestAnimationFrame(swLoop);
}

function swStop() {
  swRunning = false;
  const now = performance.now();
  swElapsed += now - swStart;
  swStart = 0;
  cancelAnimationFrame(swRaf);
  btnSS.textContent = 'Start';
  btnSS.className = 'circle-btn btn-start';
  btnSS.setAttribute('aria-label', 'Start stopwatch');
  btnLR.textContent = 'Reset';
  btnLR.className = 'circle-btn btn-reset';
  btnLR.setAttribute('aria-label', 'Reset stopwatch');
}

function swReset() {
  cancelAnimationFrame(swRaf);
  swRunning = false;
  swStart = 0;
  swElapsed = 0;
  swLapStart = 0;
  laps = [];
  swRender(0);
  btnSS.textContent = 'Start';
  btnSS.className = 'circle-btn btn-start';
  btnSS.setAttribute('aria-label', 'Start stopwatch');
  btnLR.textContent = 'Reset';
  btnLR.className = 'circle-btn btn-reset';
  btnLR.setAttribute('aria-label', 'Reset stopwatch');
  lapListEl.innerHTML = '';
  swEmptyEl.hidden = false;
}

function swLap() {
  const lapMs = swElapsed - swLapStart;
  swLapStart = swElapsed;
  laps.push({ lap: lapMs, total: swElapsed });
  renderLaps();
}

function renderLaps() {
  lapListEl.innerHTML = '';
  if (!laps.length) {
    swEmptyEl.hidden = false;
    return;
  }
  swEmptyEl.hidden = true;
  const lapTimes = laps.map((l) => l.lap);
  const minLap = Math.min(...lapTimes);
  const maxLap = Math.max(...lapTimes);

  [...laps].reverse().forEach((entry, ri) => {
    const num = laps.length - ri;
    const row = document.createElement('div');
    row.className = 'lap-row';
    row.setAttribute('role', 'listitem');
    if (laps.length > 1) {
      if (entry.lap === minLap) row.classList.add('best');
      else if (entry.lap === maxLap) row.classList.add('worst');
    }

    const { mins: lm, secs: ls, cs: lc } = fmtDuration(entry.lap);
    const { mins: tm, secs: ts, cs: tc } = fmtDuration(entry.total);

    const numEl = document.createElement('div');
    numEl.className = 'lap-num';
    numEl.textContent = `Lap ${num}`;

    const splitEl = document.createElement('div');
    splitEl.className = 'lap-split';
    splitEl.textContent = `${lm}:${ls}.${lc}`;

    const totalEl = document.createElement('div');
    totalEl.className = 'lap-total';
    totalEl.textContent = `${tm}:${ts}.${tc}`;

    row.setAttribute('aria-label', `Lap ${num}, split ${lm}:${ls}.${lc}, total ${tm}:${ts}.${tc}`);
    row.append(numEl, splitEl, totalEl);
    lapListEl.appendChild(row);
  });
}

btnSS.addEventListener('click', () => {
  swRunning ? swStop() : swStart_();
});
btnLR.addEventListener('click', () => {
  swRunning ? swLap() : swReset();
});

/* ══════════════════════════════════════════
   TIMER
══════════════════════════════════════════ */
let timerTotal = 0;
let timerRemain = 0;
let timerRunning = false;
let timerInterval = null;
let timerFlashing = false;

const tHrs = document.getElementById('t-hrs');
const tMins = document.getElementById('t-mins');
const tSecs = document.getElementById('t-secs');
const timerRingWrap = document.getElementById('timer-ring-wrap');
const ringProg = document.getElementById('ring-prog');
const timerCountdown = document.getElementById('timer-countdown');
const timerStatus = document.getElementById('timer-status');
const timerLive = document.getElementById('timer-live');
const timerStartStop = document.getElementById('timer-start-stop');
const timerCancel = document.getElementById('timer-cancel');
const presetBtns = document.querySelectorAll('.preset-btn');

ringProg.setAttribute('stroke-dasharray', RING_CIRC);
ringProg.setAttribute('stroke-dashoffset', RING_CIRC);

function ringSet(frac) {
  const offset = RING_CIRC * (1 - Math.max(0, Math.min(1, frac)));
  ringProg.setAttribute('stroke-dashoffset', offset);
}

function timerRender() {
  const secs = Math.ceil(timerRemain);
  timerCountdown.textContent = fmtTimerDisplay(secs);
  if (timerTotal > 0) ringSet(timerRemain / timerTotal);
  else ringSet(0);
}

function readInputSecs() {
  const h = parseInt(tHrs.value, 10) || 0;
  const m = parseInt(tMins.value, 10) || 0;
  const s = parseInt(tSecs.value, 10) || 0;
  return h * 3600 + m * 60 + s;
}

function setTimerInputs(totalSecs) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  tHrs.value = h;
  tMins.value = m;
  tSecs.value = s;
}

function enableInputs(en) {
  tHrs.disabled = !en;
  tMins.disabled = !en;
  tSecs.disabled = !en;
  presetBtns.forEach((b) => {
    b.disabled = !en;
  });
}

function clearPresetActive() {
  presetBtns.forEach((b) => b.classList.remove('active'));
}

presetBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (timerRunning) return;
    const secs = parseInt(btn.dataset.secs, 10);
    clearPresetActive();
    btn.classList.add('active');
    setTimerInputs(secs);
    timerTotal = secs;
    timerRemain = secs;
    timerRender();
    timerStatus.textContent = 'ready';
    stopFlashing();
  });
});

[tHrs, tMins, tSecs].forEach((inp) => {
  inp.addEventListener('input', () => {
    if (timerRunning) return;
    clearPresetActive();
    const total = readInputSecs();
    timerTotal = total;
    timerRemain = total;
    timerRender();
  });
});

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18, 0.36].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime + delay);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + delay + 0.4);
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.9);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 1);
    });
  } catch (_) {
    /* audio unavailable */
  }
}

function stopFlashing() {
  timerFlashing = false;
  timerRingWrap.classList.remove('flashing');
}

function startTimer() {
  const total = timerRunning ? timerTotal : readInputSecs();
  if (total <= 0) return;
  stopFlashing();
  timerTotal = total;
  if (!timerRunning) timerRemain = total;
  timerRunning = true;

  timerStartStop.textContent = 'Pause';
  timerStartStop.className = 'circle-btn btn-stop';
  timerStartStop.setAttribute('aria-label', 'Pause timer');
  timerStatus.textContent = 'running';
  enableInputs(false);

  const TICK_MS = 100;
  let last = performance.now();

  timerInterval = setInterval(() => {
    const now = performance.now();
    timerRemain -= (now - last) / 1000;
    last = now;
    if (timerRemain <= 0) {
      timerRemain = 0;
      clearInterval(timerInterval);
      timerRunning = false;
      timerRender();
      timerStatus.textContent = 'done';
      timerLive.textContent = 'Timer finished';
      chime();
      timerRingWrap.classList.add('flashing');
      timerFlashing = true;
      timerStartStop.textContent = 'Start';
      timerStartStop.className = 'circle-btn btn-start';
      timerStartStop.setAttribute('aria-label', 'Start timer');
      enableInputs(true);
      return;
    }
    timerRender();
  }, TICK_MS);
}

function pauseTimer() {
  clearInterval(timerInterval);
  timerRunning = false;
  timerStartStop.textContent = 'Resume';
  timerStartStop.className = 'circle-btn btn-start';
  timerStartStop.setAttribute('aria-label', 'Resume timer');
  timerStatus.textContent = 'paused';
}

function cancelTimer() {
  clearInterval(timerInterval);
  timerRunning = false;
  timerRemain = timerTotal;
  timerRender();
  timerStatus.textContent = 'ready';
  timerStartStop.textContent = 'Start';
  timerStartStop.className = 'circle-btn btn-start';
  timerStartStop.setAttribute('aria-label', 'Start timer');
  enableInputs(true);
  stopFlashing();
  timerLive.textContent = '';
}

timerStartStop.addEventListener('click', () => {
  if (timerFlashing) {
    cancelTimer();
    return;
  }
  timerRunning ? pauseTimer() : startTimer();
});
timerCancel.addEventListener('click', cancelTimer);

timerRender();

// Apply a pending timer written by the chat assistant's setTimer tool.
// Both standalone and OS-embedded paths write to the same localStorage key.
(function applyPendingTimer() {
  try {
    const raw = localStorage.getItem('clock.pendingTimer');
    if (!raw) return;
    localStorage.removeItem('clock.pendingTimer');
    const { seconds, label } = JSON.parse(raw);
    if (!seconds || seconds <= 0) return;
    activateTab(2);
    setTimerInputs(seconds);
    timerTotal = seconds;
    timerRemain = seconds;
    timerRender();
    if (label) timerStatus.textContent = label;
  } catch (_) {
    // non-fatal
  }
})();
