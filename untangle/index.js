/**
 * Untangle — Planarity-style graph puzzle.
 * Graphs are generated as line arrangements (Tantalo / Planarity),
 * scrambled onto a circle, then solved by dragging vertices until
 * no straight-line edges cross.
 */

const STORAGE_KEY = 'untangle-best-level';
const NODE_HIT_PAD = 8;

/** @typedef {{ x: number, y: number, vx: number, vy: number }} Node */
/** @typedef {{ a: number, b: number }} Edge */

const FLOAT_DAMP = 0.9;
const FLOAT_STOP = 0.08;
const FLOAT_MAX_SPEED = 42;

/**
 * @param {number} level 1-based level
 * @returns {number} number of lines L = level + 3
 */
function linesForLevel(level) {
  return Math.max(4, level + 3);
}

/**
 * Random lines y = m*x + b in general position (distinct slopes).
 * @param {number} L
 * @returns {{ m: number, b: number }[]}
 */
function generateLines(L) {
  const slopes = [];
  let guard = 0;
  while (slopes.length < L && guard++ < 5000) {
    const m = (Math.random() - 0.5) * 12;
    if (slopes.every((s) => Math.abs(s - m) > 0.2)) slopes.push(m);
  }
  while (slopes.length < L) {
    slopes.push(slopes.length * 1.37 + 0.11);
  }
  return slopes.map((m) => ({
    m,
    b: (Math.random() - 0.5) * 24
  }));
}

/**
 * Pair index for lines i < j → vertex index in [0, L(L-1)/2).
 * @param {number} i
 * @param {number} j
 * @param {number} L
 */
function pairIndex(i, j, L) {
  const a = Math.min(i, j);
  const b = Math.max(i, j);
  // Count pairs (x,y) with x < y and (x < a or (x === a and y < b))
  let idx = 0;
  for (let x = 0; x < a; x++) idx += L - 1 - x;
  idx += b - a - 1;
  return idx;
}

/**
 * Build planar graph from L-line arrangement.
 * @param {number} L
 * @returns {{ nodes: Node[], edges: Edge[], lines: { m: number, b: number }[] }}
 */
function generateArrangement(L) {
  const lines = generateLines(L);
  const n = (L * (L - 1)) / 2;
  /** @type {Node[]} */
  const nodes = new Array(n);

  for (let i = 0; i < L; i++) {
    for (let j = i + 1; j < L; j++) {
      const li = lines[i];
      const lj = lines[j];
      const x = (lj.b - li.b) / (li.m - lj.m);
      const y = li.m * x + li.b;
      nodes[pairIndex(i, j, L)] = { x, y };
    }
  }

  /** @type {Edge[]} */
  const edges = [];
  const seen = new Set();

  for (let i = 0; i < L; i++) {
    /** @type {{ idx: number, t: number }[]} */
    const along = [];
    for (let j = 0; j < L; j++) {
      if (j === i) continue;
      const vi = pairIndex(i, j, L);
      // Project along the line using x (or y if nearly vertical — slopes are bounded)
      along.push({ idx: vi, t: nodes[vi].x });
    }
    along.sort((p, q) => p.t - q.t);
    for (let k = 0; k < along.length - 1; k++) {
      const a = along[k].idx;
      const b = along[k + 1].idx;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }
  }

  return { nodes, edges, lines };
}

/**
 * Place vertices evenly on a circle in random order (the tangle).
 * @param {Node[]} nodes
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 */
function scrambleOnCircle(nodes, cx, cy, radius) {
  const order = nodes.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  const n = nodes.length;
  for (let k = 0; k < n; k++) {
    const angle = (Math.PI * 2 * k) / n - Math.PI / 2;
    const idx = order[k];
    nodes[idx].x = cx + Math.cos(angle) * radius;
    nodes[idx].y = cy + Math.sin(angle) * radius;
  }
}

/**
 * Orientation of ordered triple (a,b,c): +1 / -1 / 0
 * @param {Node} a
 * @param {Node} b
 * @param {Node} c
 */
function orient(a, b, c) {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (v > 1e-9) return 1;
  if (v < -1e-9) return -1;
  return 0;
}

/**
 * Proper segment intersection (shared endpoints do not count).
 * @param {Node} a
 * @param {Node} b
 * @param {Node} c
 * @param {Node} d
 */
function segmentsCross(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/**
 * @param {Node[]} nodes
 * @param {Edge[]} edges
 * @returns {number}
 */
function countCrossings(nodes, edges) {
  let count = 0;
  for (let i = 0; i < edges.length; i++) {
    const e1 = edges[i];
    const a = nodes[e1.a];
    const b = nodes[e1.b];
    for (let j = i + 1; j < edges.length; j++) {
      const e2 = edges[j];
      // Share a vertex → cannot properly cross
      if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) continue;
      if (segmentsCross(a, b, nodes[e2.a], nodes[e2.b])) count++;
    }
  }
  return count;
}

// —— Game state ——

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('stage'));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
const elLevel = document.getElementById('level');
const elCrossings = document.getElementById('crossings');
const elMoves = document.getElementById('moves');
const elBest = document.getElementById('best');
const elWin = document.getElementById('win-banner');
const elGradeLetter = document.getElementById('win-grade-letter');
const elGradeDetail = document.getElementById('win-grade-detail');
const btnScramble = /** @type {HTMLButtonElement} */ (document.getElementById('btn-scramble'));
const btnRestart = /** @type {HTMLButtonElement} */ (document.getElementById('btn-restart'));
const btnNext = /** @type {HTMLButtonElement} */ (document.getElementById('btn-next'));

/** @type {{ level: number, nodes: Node[], edges: Edge[], moves: number, crossings: number, won: boolean, dragIndex: number, pointerId: number|null, movedThisDrag: boolean, floating: boolean }} */
const state = {
  level: 1,
  nodes: [],
  edges: [],
  moves: 0,
  crossings: 0,
  won: false,
  dragIndex: -1,
  pointerId: null,
  movedThisDrag: false,
  floating: false
};

let dpr = 1;
let cssW = 0;
let cssH = 0;
let nodeR = 11;
/** @type {number|null} */
let floatRaf = null;
let dragLastX = 0;
let dragLastY = 0;
let dragLastT = 0;
let dragVx = 0;
let dragVy = 0;

function loadBest() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const n = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function saveBest(level) {
  const best = Math.max(loadBest(), level);
  localStorage.setItem(STORAGE_KEY, String(best));
  return best;
}

function circleLayoutRadius() {
  const pad = 36 + nodeR;
  return Math.max(40, Math.min(cssW, cssH) / 2 - pad);
}

function stopFloat() {
  state.floating = false;
  if (floatRaf !== null) {
    cancelAnimationFrame(floatRaf);
    floatRaf = null;
  }
  for (const n of state.nodes) {
    n.vx = 0;
    n.vy = 0;
  }
}

function startLevel(level, { scrambleOnly = false } = {}) {
  stopFloat();
  state.level = Math.max(1, level | 0);
  state.moves = 0;
  state.won = false;
  state.dragIndex = -1;
  state.pointerId = null;
  elWin.hidden = true;
  btnNext.disabled = true;

  if (!scrambleOnly) {
    const L = linesForLevel(state.level);
    const { nodes, edges } = generateArrangement(L);
    state.nodes = nodes.map((n) => ({ ...n, vx: 0, vy: 0 }));
    state.edges = edges;
  } else {
    for (const n of state.nodes) {
      n.vx = 0;
      n.vy = 0;
    }
  }

  const cx = cssW / 2;
  const cy = cssH / 2;
  scrambleOnCircle(state.nodes, cx, cy, circleLayoutRadius());
  refreshCrossings();
  updateHud();
  checkWin();
  draw();
}

function refreshCrossings() {
  state.crossings = countCrossings(state.nodes, state.edges);
}

/**
 * Letter grade from move count vs graph size.
 * Par is roughly one move per node — efficient solvers finish at or under par.
 * @param {number} moves
 * @param {number} nodeCount
 * @returns {'A'|'B'|'C'|'D'|'F'}
 */
function gradeForMoves(moves, nodeCount) {
  const n = Math.max(1, nodeCount);
  const ratio = moves / n;
  if (ratio <= 1) return 'A';
  if (ratio <= 1.75) return 'B';
  if (ratio <= 2.75) return 'C';
  if (ratio <= 4.5) return 'D';
  return 'F';
}

function updateHud() {
  elLevel.textContent = String(state.level);
  elMoves.textContent = String(state.moves);
  elCrossings.textContent = String(state.crossings);
  elCrossings.classList.toggle('clear', state.crossings === 0);
  elBest.textContent = String(loadBest());
}

function checkWin() {
  if (state.won || state.crossings !== 0) return;
  state.won = true;
  const best = saveBest(state.level);
  elBest.textContent = String(best);
  const grade = gradeForMoves(state.moves, state.nodes.length);
  elGradeLetter.textContent = grade;
  elGradeLetter.dataset.grade = grade;
  const moveLabel = state.moves === 1 ? '1 move' : `${state.moves} moves`;
  elGradeDetail.textContent = `${moveLabel} · level ${state.level}`;
  elWin.hidden = false;
  btnNext.disabled = false;
  window.heymingAchievements?.unlockForCurrentApp('first-action');
  if (typeof window.trackEvent === 'function') {
    window.trackEvent(
      'untangle_level_clear',
      'Game',
      `level ${state.level} grade ${grade}`,
      state.moves
    );
  }
}

function resize() {
  const wrap = canvas.parentElement;
  cssW = wrap.clientWidth || window.innerWidth;
  cssH = wrap.clientHeight || window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const raw = getComputedStyle(document.documentElement).getPropertyValue('--node-r').trim();
  nodeR = parseFloat(raw) || 11;

  draw();
}

function draw() {
  ctx.clearRect(0, 0, cssW, cssH);

  const { nodes, edges, dragIndex } = state;

  // Soft vignette playfield
  const g = ctx.createRadialGradient(
    cssW / 2,
    cssH / 2,
    Math.min(cssW, cssH) * 0.15,
    cssW / 2,
    cssH / 2,
    Math.max(cssW, cssH) * 0.65
  );
  g.addColorStop(0, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cssW, cssH);

  // Edges — uniform (no crossing highlights)
  ctx.strokeStyle = '#7a8fa3';
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = 1.75;
  ctx.lineCap = 'round';
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const a = nodes[e.a];
    const b = nodes[e.b];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Nodes
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const active = i === dragIndex;
    const floating = !active && (Math.abs(n.vx) > FLOAT_STOP || Math.abs(n.vy) > FLOAT_STOP);
    ctx.beginPath();
    ctx.arc(n.x, n.y, nodeR, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#0d6e6e' : '#1a2330';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    if (active || floating) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, nodeR + (floating ? 4 : 5), 0, Math.PI * 2);
      ctx.strokeStyle = floating ? 'rgba(26, 35, 48, 0.18)' : 'rgba(13, 110, 110, 0.35)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}

function clampNode(n) {
  const m = nodeR + 2;
  const hitL = n.x < m;
  const hitR = n.x > cssW - m;
  const hitT = n.y < m;
  const hitB = n.y > cssH - m;
  if (hitL) {
    n.x = m;
    n.vx = Math.abs(n.vx) * 0.35;
  } else if (hitR) {
    n.x = cssW - m;
    n.vx = -Math.abs(n.vx) * 0.35;
  }
  if (hitT) {
    n.y = m;
    n.vy = Math.abs(n.vy) * 0.35;
  } else if (hitB) {
    n.y = cssH - m;
    n.vy = -Math.abs(n.vy) * 0.35;
  }
}

/**
 * Soft overlap push so floating nodes don't stack.
 * @param {number} idx
 */
function applySoftFloatForces(idx) {
  const n = state.nodes[idx];
  for (let i = 0; i < state.nodes.length; i++) {
    if (i === idx) continue;
    const o = state.nodes[i];
    const dx = n.x - o.x;
    const dy = n.y - o.y;
    const dist = Math.hypot(dx, dy) || 1;
    const minD = nodeR * 2.8;
    if (dist < minD) {
      const push = ((minD - dist) / minD) * 0.35;
      n.vx += (dx / dist) * push;
      n.vy += (dy / dist) * push;
    }
  }
}

function tickFloat() {
  floatRaf = null;
  let any = false;
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (i === state.dragIndex) continue;
    const speed = Math.hypot(n.vx, n.vy);
    if (speed < FLOAT_STOP) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    any = true;
    applySoftFloatForces(i);
    // Cap after forces
    const s2 = Math.hypot(n.vx, n.vy);
    if (s2 > FLOAT_MAX_SPEED) {
      n.vx = (n.vx / s2) * FLOAT_MAX_SPEED;
      n.vy = (n.vy / s2) * FLOAT_MAX_SPEED;
    }
    n.x += n.vx;
    n.y += n.vy;
    n.vx *= FLOAT_DAMP;
    n.vy *= FLOAT_DAMP;
    clampNode(n);
  }

  refreshCrossings();
  updateHud();
  draw();

  if (any) {
    state.floating = true;
    floatRaf = requestAnimationFrame(tickFloat);
  } else {
    state.floating = false;
    checkWin();
    draw();
  }
}

function startFloat() {
  if (floatRaf !== null) cancelAnimationFrame(floatRaf);
  state.floating = true;
  floatRaf = requestAnimationFrame(tickFloat);
}

/**
 * @param {number} x
 * @param {number} y
 */
function hitTest(x, y) {
  const r2 = (nodeR + NODE_HIT_PAD) ** 2;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    const dx = n.x - x;
    const dy = n.y - y;
    const d = dx * dx + dy * dy;
    if (d <= r2 && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function clientToCanvas(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.pointerId !== null) return;
  const { x, y } = clientToCanvas(e);
  const idx = hitTest(x, y);
  if (idx < 0) return;
  const n = state.nodes[idx];
  n.vx = 0;
  n.vy = 0;
  state.dragIndex = idx;
  state.pointerId = e.pointerId;
  state.movedThisDrag = false;
  dragLastX = x;
  dragLastY = y;
  dragLastT = performance.now();
  dragVx = 0;
  dragVy = 0;
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
  draw();
  e.preventDefault();
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== state.pointerId || state.dragIndex < 0) return;
  const { x, y } = clientToCanvas(e);
  const n = state.nodes[state.dragIndex];
  const now = performance.now();
  const dt = Math.max(1, now - dragLastT);
  if (Math.hypot(n.x - x, n.y - y) > 0.5) state.movedThisDrag = true;
  // Blend recent pointer velocity (px per frame @60Hz scale)
  const rawVx = ((x - dragLastX) / dt) * 16.67;
  const rawVy = ((y - dragLastY) / dt) * 16.67;
  dragVx = dragVx * 0.35 + rawVx * 0.65;
  dragVy = dragVy * 0.35 + rawVy * 0.65;
  dragLastX = x;
  dragLastY = y;
  dragLastT = now;
  n.x = x;
  n.y = y;
  clampNode(n);
  n.vx = 0;
  n.vy = 0;
  refreshCrossings();
  updateHud();
  draw();
  e.preventDefault();
});

function endDrag(e) {
  if (e.pointerId !== state.pointerId) return;
  const idx = state.dragIndex;
  if (state.movedThisDrag && idx >= 0) {
    state.moves += 1;
    updateHud();
  }
  if (idx >= 0) {
    let vx = dragVx;
    let vy = dragVy;
    const speed = Math.hypot(vx, vy);
    if (speed > FLOAT_MAX_SPEED) {
      vx = (vx / speed) * FLOAT_MAX_SPEED;
      vy = (vy / speed) * FLOAT_MAX_SPEED;
    }
    state.nodes[idx].vx = vx;
    state.nodes[idx].vy = vy;
  }
  state.dragIndex = -1;
  state.pointerId = null;
  state.movedThisDrag = false;
  dragVx = 0;
  dragVy = 0;
  canvas.classList.remove('dragging');
  refreshCrossings();
  updateHud();
  if (idx >= 0 && Math.hypot(state.nodes[idx].vx, state.nodes[idx].vy) > FLOAT_STOP) {
    startFloat();
  } else {
    checkWin();
    draw();
  }
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

btnScramble.addEventListener('click', () => {
  startLevel(state.level, { scrambleOnly: true });
});

btnRestart.addEventListener('click', () => {
  startLevel(state.level);
});

btnNext.addEventListener('click', () => {
  if (!state.won && state.crossings !== 0) return;
  startLevel(state.level + 1);
});

// Pause float physics while the related-projects panel hides the canvas.
const relatedPanelWatch = new MutationObserver(() => {
  if (document.body.classList.contains('related-panel-open')) stopFloat();
});
relatedPanelWatch.observe(document.body, { attributes: true, attributeFilter: ['class'] });

window.addEventListener('resize', () => {
  const prevW = cssW;
  const prevH = cssH;
  resize();
  if (state.nodes.length && prevW > 0 && prevH > 0) {
    const sx = cssW / prevW;
    const sy = cssH / prevH;
    for (const n of state.nodes) {
      n.x *= sx;
      n.y *= sy;
      clampNode(n);
    }
    refreshCrossings();
    updateHud();
    draw();
  }
});

// Expose for preview seeding / debugging
window.untangleGame = {
  startLevel,
  getState: () => state,
  scramble: () => startLevel(state.level, { scrambleOnly: true })
};

resize();
startLevel(1);
