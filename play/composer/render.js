/**
 * SVG score renderer — grand staff, notes, rests, beams, ties, dynamics.
 */
import {
  LAYOUT,
  bassStaffTop,
  keySigCount,
  keySigPositions,
  ledgerMidis,
  noteX,
  playheadX,
  scoreHeight,
  scoreWidth,
  startToX,
  stepToY,
  trebleStaffTop
} from './layout.js';
import {
  chainNotes,
  isTieContinue,
  letterIndexFromMidi,
  naturalsForStaff,
  sortedNotes
} from './model.js';
import {
  baseDurationId,
  beamGroupIndex,
  flagCount,
  isBeamableDuration,
  isFilledHead,
  keyAccidentalForLetter,
  keySignatureLetters,
  measureIndex,
  measureSixteenths,
  totalSixteenths
} from './notation.js';

const NOTE_HIT_R = 11;

export function renderScore(svg, score, ui) {
  const ks = keySigCount(score.keySig);
  const w = scoreWidth(score.measures, score.timeSig, ks);
  const h = scoreHeight();
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.style.width = `${w}px`;

  const parts = [];
  parts.push(drawStaffSystem(score, ks, w));
  const beamed = collectBeamedIds(score);
  parts.push(drawNotesAndRests(score, ks, ui, beamed));
  parts.push(drawBeams(score, ks));
  parts.push(drawTies(score, ks));
  parts.push(drawShadow(score, ks, ui));
  parts.push(drawPlayhead(score, ks, ui.playheadStart));
  parts.push(drawMeasureChrome(score, ks));
  svg.innerHTML = parts.join('');
}

function drawStaffSystem(score, ks, w) {
  const parts = [];
  const endX = w - LAYOUT.rightPad;
  const mLen = measureSixteenths(score.timeSig);
  const total = totalSixteenths(score.measures, score.timeSig);
  const y1 = trebleStaffTop();
  const y2 = bassStaffTop() + 4 * LAYOUT.lineGap;

  for (const staff of ['treble', 'bass']) {
    const top = staff === 'treble' ? trebleStaffTop() : bassStaffTop();
    for (let i = 0; i < 5; i++) {
      const y = top + i * LAYOUT.lineGap;
      parts.push(
        `<line class="staff-line" x1="${LAYOUT.leftPad - 40}" y1="${y}" x2="${endX}" y2="${y}" />`
      );
    }
    const clef = staff === 'treble' ? '𝄞' : '𝄢';
    const clefY = top + (staff === 'treble' ? 2.15 : 1.1) * LAYOUT.lineGap;
    const clefSize = staff === 'treble' ? 72 : 56;
    parts.push(
      `<text class="clef" x="${
        LAYOUT.leftPad - 78
      }" y="${clefY}" font-size="${clefSize}">${clef}</text>`
    );

    const letters = keySignatureLetters(score.keySig);
    letters.forEach((entry, i) => {
      const posMap = keySigPositions(staff, entry.accidental);
      const midi = posMap[entry.letter];
      if (midi == null) return;
      const naturals = naturalsForStaff(staff);
      const step = naturals.indexOf(midi);
      const y = step >= 0 ? stepToY(staff, step) : top + 2 * LAYOUT.lineGap;
      const glyph = entry.accidental === 'sharp' ? '♯' : '♭';
      const x = LAYOUT.leftPad - 28 + i * 10;
      parts.push(`<text class="accidental-sig" x="${x}" y="${y + 5}">${glyph}</text>`);
    });

    const tx = LAYOUT.leftPad - 8 + ks * 10;
    parts.push(
      `<text class="time-sig" x="${tx}" y="${top + 1.35 * LAYOUT.lineGap}">${
        score.timeSig.beats
      }</text>`
    );
    parts.push(
      `<text class="time-sig" x="${tx}" y="${top + 3.15 * LAYOUT.lineGap}">${
        score.timeSig.unit
      }</text>`
    );
  }

  parts.push(
    `<path class="brace" d="M ${LAYOUT.leftPad - 92} ${y1} C ${LAYOUT.leftPad - 108} ${
      (y1 + y2) / 2
    }, ${LAYOUT.leftPad - 108} ${(y1 + y2) / 2}, ${
      LAYOUT.leftPad - 92
    } ${y2}" fill="none" stroke-width="2.5" />`
  );

  for (let m = 0; m <= score.measures; m++) {
    const x = startToX(m * mLen, ks);
    const heavy = m === 0 || m === score.measures;
    parts.push(
      `<line class="bar-line" x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke-width="${
        heavy ? 2.4 : 1.5
      }" />`
    );
  }

  const step = Math.max(2, Math.floor(mLen / score.timeSig.beats));
  for (let s = 0; s < total; s += step) {
    if (s % mLen === 0) continue;
    const x = startToX(s, ks);
    parts.push(`<line class="beat-guide" x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" />`);
  }

  return parts.join('');
}

/** Hover chrome above each measure: − remove, + insert after. */
function drawMeasureChrome(score, ks) {
  const parts = [];
  const mLen = measureSixteenths(score.timeSig);
  const canAdd = score.measures < 16;
  const canRemove = score.measures > 1;
  const btnR = 9;
  const y = 14;

  for (let m = 0; m < score.measures; m++) {
    const x0 = startToX(m * mLen, ks);
    const x1 = startToX((m + 1) * mLen, ks);
    const mid = (x0 + x1) / 2;
    const hitW = x1 - x0;
    parts.push(`<g class="measure-chrome" data-measure="${m}">`);
    parts.push(`<rect class="measure-chrome-hit" x="${x0}" y="0" width="${hitW}" height="36" />`);
    parts.push(`<g class="measure-chrome-btns">`);
    if (canRemove) {
      parts.push(measureBtn(mid - 12, y, btnR, 'remove', m, '−', 'Remove bar'));
    }
    if (canAdd) {
      parts.push(measureBtn(mid + 12, y, btnR, 'insert-after', m, '+', 'Add bar after'));
    }
    parts.push(`</g></g>`);
  }

  // Append affordance just past the final barline
  if (canAdd) {
    const xEnd = startToX(score.measures * mLen, ks);
    parts.push(`<g class="measure-chrome measure-chrome-end">`);
    parts.push(`<rect class="measure-chrome-hit" x="${xEnd - 6}" y="0" width="36" height="36" />`);
    parts.push(`<g class="measure-chrome-btns">`);
    parts.push(measureBtn(xEnd + 12, y, btnR, 'insert-after', score.measures - 1, '+', 'Add bar'));
    parts.push(`</g></g>`);
  }

  return parts.join('');
}

function measureBtn(cx, cy, r, action, measureIndex, label, title) {
  return (
    `<g class="measure-btn" data-measure-action="${action}" data-measure-index="${measureIndex}" role="button" tabindex="-1">` +
    `<title>${title}</title>` +
    `<circle class="measure-btn-bg" cx="${cx}" cy="${cy}" r="${r}" />` +
    `<text class="measure-btn-label" x="${cx}" y="${
      cy + 1
    }" text-anchor="middle" dominant-baseline="middle">${label}</text>` +
    `</g>`
  );
}

function drawNotesAndRests(score, ks, ui, beamed) {
  const parts = [];
  const selectedIds = selectedChainIds(score, ui.selectedId);
  const courtesyShown = new Set(); // `${staff}|${measure}|${letter}`

  for (const n of sortedNotes(score)) {
    const selected = selectedIds.has(n.id);
    if (n.rest) {
      parts.push(drawRest(n, ks, selected));
    } else {
      parts.push(drawNote(n, score, ks, selected, beamed.has(n.id), courtesyShown));
      if (n.dynamic) {
        const x = noteX(n.start, n.duration, ks);
        const y =
          (n.staff === 'bass' ? bassStaffTop() : trebleStaffTop()) + 4 * LAYOUT.lineGap + 18;
        parts.push(`<text class="dynamic" x="${x}" y="${y}">${n.dynamic}</text>`);
      }
    }
  }
  return parts.join('');
}

/** Ghost note/rest under cursor before place. */
function drawShadow(score, ks, ui) {
  const sh = ui.shadow;
  if (!sh) return '';
  const n = {
    id: '__shadow',
    staff: sh.staff,
    voice: sh.voice ?? 0,
    start: sh.start,
    duration: sh.duration,
    step: sh.step,
    accidental: null,
    tieTo: null,
    dynamic: null,
    rest: !!sh.rest
  };
  const body = n.rest ? drawRest(n, ks, false) : drawNote(n, score, ks, false, false, new Set());
  const cls = sh.blocked ? 'is-shadow is-blocked' : 'is-shadow';
  return body.replace(/class="(note|rest)/, `class="$1 ${cls}`);
}

function selectedChainIds(score, selectedId) {
  const ids = new Set();
  if (!selectedId) return ids;
  const n = score.notes.find((x) => x.id === selectedId);
  if (!n) return ids;
  for (const seg of chainNotes(score, n)) ids.add(seg.id);
  return ids;
}

/** Shared stem direction: voice 1 always down; else by staff position. */
export function stemUp(note) {
  if (note.voice === 1) return false;
  const naturals = naturalsForStaff(note.staff);
  return note.step < naturals.length / 2;
}

/** Flagged rests (8th / 16th): stem + one oval hook per flag. */
function flagRestBody(x, midY, flags) {
  const stem =
    `<path class="rest-path" d="M${x + 2.5} ${midY + 7} L${x + 7} ${midY - 9}" ` +
    `fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />`;
  const hooks = [];
  for (let i = 0; i < flags; i++) {
    const cy = midY - 6 + i * 5.5;
    hooks.push(
      `<ellipse class="rest-block" cx="${x - 0.5}" cy="${cy}" rx="3.2" ry="2.5" />` +
        `<path class="rest-path" d="M${x + 2.2} ${cy + 0.4} L${x + 6.2} ${cy - 3.8}" ` +
        `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />`
    );
  }
  return `<g>${hooks.join('')}${stem}</g>`;
}

function drawRest(n, ks, selected) {
  const x = noteX(n.start, n.duration, ks);
  const top = n.staff === 'bass' ? bassStaffTop() : trebleStaffTop();
  const g = LAYOUT.lineGap;
  const midY = top + 2 * g;
  const cls = selected ? 'rest is-selected' : 'rest';
  const { id, dotted } = baseDurationId(n.duration);
  const parts = [];

  // Engraving: whole hangs below line 2; half sits on line 3; shorter rests center on staff
  let barY = midY;
  let body;
  if (id === 'whole') {
    // Thick horizontal bar hanging from the 2nd staff line (not a square)
    const lineY = top + g;
    const h = Math.max(4, g * 0.42);
    const w = g * 1.35;
    barY = lineY + h / 2;
    body = `<rect class="rest-block" x="${
      x - w / 2
    }" y="${lineY}" width="${w}" height="${h}" rx="0.6" />`;
  } else if (id === 'half') {
    const lineY = top + 2 * g;
    const h = Math.max(4, g * 0.42);
    const w = g * 1.35;
    barY = lineY - h / 2;
    body = `<rect class="rest-block" x="${x - w / 2}" y="${
      lineY - h
    }" width="${w}" height="${h}" rx="0.6" />`;
  } else if (id === 'quarter') {
    // Drawn path — Musical Symbols Unicode often falls back to garbage glyphs
    const ox = x - 4;
    const oy = midY - 10;
    body = `<path class="rest-block" transform="translate(${ox},${oy})" d="M9.2 1.2c.3 1.4-.4 2.6-1.6 3.8L4.2 8.4c1.8.9 3.2 2 3.2 3.8 0 1.7-1.2 2.9-3 4.2 1.7 1.5 2.9 3.2 3.1 5.4H5.2c-.3-1.6-1.3-3-3-4.5C.8 15.8-.2 14.2-.2 12.4c0-2.5 2-3.9 4.2-5.1L7.8 3.6c.9-.9 1.2-1.6 1.4-2.4z" />`;
  } else if (id === 'eighth') {
    body = flagRestBody(x, midY, 1);
  } else {
    // sixteenth (and shorter fallbacks)
    body = flagRestBody(x, midY, 2);
  }
  parts.push(body);

  if (dotted) {
    const dotY = id === 'whole' || id === 'half' ? barY : midY - 2;
    parts.push(`<circle class="rest-dot" cx="${x + 12}" cy="${dotY}" r="2" />`);
  }

  return (
    `<g class="${cls}" data-id="${n.id}">` +
    parts.join('') +
    `<circle class="hit-proxy" cx="${x}" cy="${midY}" r="${NOTE_HIT_R}" />` +
    `</g>`
  );
}

function drawNote(n, score, ks, selected, isBeamed, courtesyShown) {
  const naturals = naturalsForStaff(n.staff);
  const midi = naturals[n.step] ?? naturals[0];
  const x = noteX(n.start, n.duration, ks);
  const y = stepToY(n.staff, n.step);
  const rx = 6.5;
  const ry = 5;
  const parts = [];

  for (const lm of ledgerMidis(n.staff, midi)) {
    const st = naturals.indexOf(lm);
    if (st < 0) continue;
    const ly = stepToY(n.staff, st);
    parts.push(`<line class="ledger-line" x1="${x - 11}" y1="${ly}" x2="${x + 11}" y2="${ly}" />`);
  }

  const letter = letterIndexFromMidi(midi);
  const keyAcc = keyAccidentalForLetter(score.keySig, letter);
  let showAcc = n.accidental;
  if (!showAcc && keyAcc && !isTieContinue(score, n)) {
    const key = `${n.staff}|${measureIndex(n.start, score.timeSig)}|${letter}`;
    if (!courtesyShown.has(key)) {
      courtesyShown.add(key);
      showAcc = keyAcc;
    }
  }
  if (showAcc) {
    const g = showAcc === 'sharp' ? '♯' : showAcc === 'flat' ? '♭' : '♮';
    parts.push(`<text class="accidental" x="${x - 16}" y="${y + 5}">${g}</text>`);
  }

  const filled = isFilledHead(n.duration);
  const up = stemUp(n);
  const stemX = up ? x + rx - 1 : x - rx + 1;
  const stemLen = LAYOUT.lineGap * 2.4;
  const stemY2 = up ? y - stemLen : y + stemLen;

  parts.push(
    `<ellipse class="note-head${
      filled ? '' : ' open'
    }" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(-18 ${x} ${y})" />`
  );

  if (n.duration < 16) {
    const stemColor = selected ? '#2f6fed' : '#1a1f2c';
    parts.push(
      `<line class="note-stem" x1="${stemX}" y1="${y}" x2="${stemX}" y2="${stemY2}" stroke="${stemColor}" stroke-width="1.6" />`
    );
    if (!isBeamed) {
      const flags = flagCount(n.duration);
      for (let f = 0; f < flags; f++) {
        const fy = up ? stemY2 + f * 6 : stemY2 - f * 6;
        parts.push(
          `<path class="note-flag" d="M${stemX} ${fy} c 8 ${up ? 4 : -4}, 10 ${up ? 12 : -12}, 2 ${
            up ? 16 : -16
          }" fill="none" stroke="${stemColor}" stroke-width="1.6" />`
        );
      }
    }
  }

  if (baseDurationId(n.duration).dotted) {
    parts.push(`<circle class="note-dot" cx="${x + rx + 6}" cy="${y - 2}" r="2" />`);
  }

  const cls = selected ? 'note is-selected' : 'note';
  return (
    `<g class="${cls}" data-id="${n.id}" data-staff="${n.staff}">` +
    parts.join('') +
    `<circle class="hit-proxy" cx="${x}" cy="${y}" r="${NOTE_HIT_R}" />` +
    `</g>`
  );
}

function collectBeamedIds(score) {
  const beamed = new Set();
  for (const group of computeBeamGroups(score)) {
    if (group.length >= 2) for (const id of group) beamed.add(id);
  }
  return beamed;
}

export function computeBeamGroups(score) {
  const groups = [];
  const candidates = sortedNotes(score).filter(
    (n) => !n.rest && isBeamableDuration(n.duration) && !isTieContinue(score, n)
  );
  const buckets = new Map();
  for (const n of candidates) {
    const key = `${n.staff}|${n.voice}|${measureIndex(n.start, score.timeSig)}|${beamGroupIndex(
      n.start,
      score.timeSig
    )}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(n);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => a.start - b.start);
    let run = [];
    let prevEnd = -1;
    for (const n of list) {
      if (run.length && n.start !== prevEnd) {
        if (run.length >= 2) groups.push(run.map((x) => x.id));
        run = [];
      }
      run.push(n);
      prevEnd = n.start + n.duration;
    }
    if (run.length >= 2) groups.push(run.map((x) => x.id));
  }
  return groups;
}

function drawBeams(score, ks) {
  const parts = [];
  const byId = new Map(score.notes.map((n) => [n.id, n]));
  for (const ids of computeBeamGroups(score)) {
    const notes = ids.map((id) => byId.get(id)).filter(Boolean);
    if (notes.length < 2) continue;
    const up = stemUp(notes[0]);
    const xs = notes.map((n) => {
      const x = noteX(n.start, n.duration, ks);
      const rx = 6.5;
      return up ? x + rx - 1 : x - rx + 1;
    });
    const ys = notes.map((n) => {
      const y = stepToY(n.staff, n.step);
      const stemLen = LAYOUT.lineGap * 2.4;
      return up ? y - stemLen : y + stemLen;
    });
    const x1 = xs[0];
    const x2 = xs[xs.length - 1];
    const y1 = ys[0];
    const y2 = ys[ys.length - 1];
    const thickness = 4;
    const dy = up ? thickness : -thickness;
    parts.push(
      `<path class="beam" d="M${x1} ${y1} L${x2} ${y2} L${x2} ${y2 + dy} L${x1} ${y1 + dy} Z" />`
    );
    if (notes.every((n) => n.duration <= 1)) {
      const o = up ? 6 : -6;
      parts.push(
        `<path class="beam" d="M${x1} ${y1 + o} L${x2} ${y2 + o} L${x2} ${y2 + o + dy} L${x1} ${
          y1 + o + dy
        } Z" />`
      );
    }
  }
  return parts.join('');
}

function drawTies(score, ks) {
  const parts = [];
  const byId = new Map(score.notes.map((n) => [n.id, n]));
  for (const n of score.notes) {
    if (!n.tieTo || n.rest) continue;
    const other = byId.get(n.tieTo);
    if (
      !other ||
      other.rest ||
      other.staff !== n.staff ||
      other.voice !== n.voice ||
      other.step !== n.step ||
      other.start !== n.start + n.duration
    ) {
      continue;
    }
    const x1 = noteX(n.start, n.duration, ks) + 7;
    const x2 = noteX(other.start, other.duration, ks) - 7;
    const y = stepToY(n.staff, n.step) + 8;
    const mid = (x1 + x2) / 2;
    parts.push(`<path class="tie" d="M${x1} ${y} Q ${mid} ${y + 10}, ${x2} ${y}" fill="none" />`);
  }
  return parts.join('');
}

function drawPlayhead(score, ks, playheadStart) {
  const total = totalSixteenths(score.measures, score.timeSig);
  const start = Math.max(0, Math.min(total, playheadStart || 0));
  const x = playheadX(start, ks);
  const y1 = trebleStaffTop() - 10;
  const y2 = bassStaffTop() + 4 * LAYOUT.lineGap + 10;
  const hit = LAYOUT.playheadHit;
  return (
    `<rect class="playhead-hit" x="${x - hit}" y="${y1 - 8}" width="${hit * 2}" height="${
      y2 - y1 + 16
    }" />` +
    `<line class="playhead" x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" />` +
    `<circle class="playhead-cap" cx="${x}" cy="${y1}" r="5" />`
  );
}

export function hitTestNote(score, svgX, svgY, ks) {
  let best = null;
  let bestDist = NOTE_HIT_R;
  for (const n of score.notes) {
    const x = noteX(n.start, n.duration, ks);
    const y = n.rest
      ? (n.staff === 'bass' ? bassStaffTop() : trebleStaffTop()) + 2 * LAYOUT.lineGap
      : stepToY(n.staff, n.step);
    const d = Math.hypot(x - svgX, y - svgY);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

export function hitTestPlayhead(score, svgX, svgY, playheadStart, ks) {
  const x = playheadX(playheadStart, ks);
  const y1 = trebleStaffTop() - 18;
  const y2 = bassStaffTop() + 4 * LAYOUT.lineGap + 14;
  return Math.abs(svgX - x) <= LAYOUT.playheadHit && svgY >= y1 && svgY <= y2;
}

export { keySigCount };
