import { Chess } from 'chess.js';
import { CONFIG, isConfigured } from './config.js';
import { fetchGame, postRow } from './sheet.js';
import { canMove, makeGameId, replayGame, seatFor } from './sync.js';

const NICK_KEY = 'heyming-chess-nick';
const GLYPH = {
  wk: '♔',
  wq: '♕',
  wr: '♖',
  wb: '♗',
  wn: '♘',
  wp: '♙',
  bk: '♚',
  bq: '♛',
  br: '♜',
  bb: '♝',
  bn: '♞',
  bp: '♟'
};

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const noteEl = document.getElementById('share-note');
const codeEl = document.getElementById('code');
const nickEl = /** @type {HTMLInputElement | null} */ (document.getElementById('nick'));
const joinEl = /** @type {HTMLInputElement | null} */ (document.getElementById('join-code'));
const sharedTools = document.getElementById('shared-tools');
const promoEl = document.getElementById('promo');
const bootEl = document.getElementById('boot-msg');

/** @type {import('chess.js').Chess} */
let chess = new Chess();
/** @type {'local' | 'shared'} */
let mode = 'local';
/** @type {'w' | 'b' | ''} */
let seat = '';
let gameId = '';
let flipped = false;
/** @type {string | null} */
let selected = null;
/** @type {Array<{ from: string, to: string, promotion?: string, san: string }>} */
let pendingPromo = [];
let pollGen = 0;
/** @type {ReturnType<typeof setTimeout> | 0} */
let pollTimer = 0;

if (bootEl) bootEl.hidden = true;

function nick() {
  const value = (nickEl && nickEl.value.trim()) || 'Player';
  return value.slice(0, 20);
}

function rememberNick() {
  try {
    localStorage.setItem(NICK_KEY, nick());
  } catch {
    /* private mode */
  }
}

function stopPoll() {
  pollGen += 1;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = 0;
}

function files() {
  return flipped
    ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']
    : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
}

function ranks() {
  return flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
}

/**
 * @param {string} square
 */
function glyphFor(square) {
  const piece = chess.get(square);
  if (!piece) return '';
  const key = `${piece.color}${piece.type}`;
  return GLYPH[key] || '';
}

function interactive() {
  return canMove(mode, mode === 'local' ? null : seat, chess.turn(), chess.isGameOver());
}

function statusText() {
  const turn = chess.turn();
  const who = turn === 'w' ? 'White' : 'Black';
  if (chess.isCheckmate()) return `Checkmate. ${turn === 'w' ? 'Black' : 'White'} wins.`;
  if (chess.isStalemate()) return 'Stalemate.';
  if (chess.isDraw()) return 'Draw.';
  const check = chess.isCheck() ? ' Check.' : '';
  if (mode === 'shared' && seat && seat !== turn) return `Waiting for ${who}.${check}`;
  if (mode === 'shared' && !seat) return `Watching. ${who} to move.${check}`;
  return `${who} to move.${check}`;
}

function render() {
  if (!boardEl || !statusEl) return;
  statusEl.textContent = statusText();
  if (codeEl) {
    if (mode === 'shared' && gameId) {
      codeEl.hidden = false;
      codeEl.textContent = `Game code ${gameId}`;
    } else {
      codeEl.hidden = true;
      codeEl.textContent = '';
    }
  }
  const legal = selected ? chess.moves({ square: selected, verbose: true }) : [];
  const targets = new Set(legal.map((move) => move.to));
  boardEl.replaceChildren();
  for (const rank of ranks()) {
    for (const file of files()) {
      const square = `${file}${rank}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'square';
      const dark = (file.charCodeAt(0) - 97 + Number(rank)) % 2 === 1;
      if (dark) button.classList.add('square-dark');
      if (square === selected) button.classList.add('square-selected');
      if (targets.has(square)) button.classList.add('square-target');
      const piece = chess.get(square);
      const glyph = glyphFor(square);
      button.textContent = glyph;
      const who = piece ? `${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : 'empty';
      button.setAttribute('aria-label', `${square}, ${who}`);
      button.addEventListener('click', () => onSquare(square));
      boardEl.appendChild(button);
    }
  }
}

/**
 * @param {{ from: string, to: string, promotion?: string }} move
 */
function playMove(move) {
  let played = null;
  try {
    played = chess.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion
    });
  } catch {
    played = null;
  }
  selected = null;
  pendingPromo = [];
  if (promoEl) promoEl.hidden = true;
  if (!played) {
    render();
    return;
  }
  if (mode === 'shared' && isConfigured() && gameId) {
    const ply = chess.history().length;
    postRow(CONFIG, {
      gameId,
      ply,
      name: nick(),
      san: played.san,
      color: played.color
    });
  }
  render();
}

/**
 * @param {string} square
 */
function onSquare(square) {
  if (!interactive()) return;
  if (pendingPromo.length) return;
  const piece = chess.get(square);
  const legals = selected
    ? chess.moves({ square: selected, verbose: true }).filter((move) => move.to === square)
    : [];
  if (legals.length === 1) {
    playMove(legals[0]);
    return;
  }
  if (legals.length > 1) {
    pendingPromo = legals;
    showPromo(legals);
    return;
  }
  const ownTurn = piece && piece.color === chess.turn();
  if (ownTurn && (mode === 'local' || piece.color === seat)) {
    selected = square;
    render();
    return;
  }
  selected = null;
  render();
}

/**
 * @param {Array<{ promotion?: string }>} legals
 */
function showPromo(legals) {
  if (!promoEl) return;
  promoEl.hidden = false;
  promoEl.replaceChildren();
  const label = document.createElement('span');
  label.textContent = 'Promote to';
  promoEl.appendChild(label);
  const names = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
  for (const move of legals) {
    const key = move.promotion || 'q';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = names[key] || key;
    button.addEventListener('click', () => playMove(move));
    promoEl.appendChild(button);
  }
}

function resetLocal() {
  stopPoll();
  mode = 'local';
  seat = '';
  gameId = '';
  flipped = false;
  selected = null;
  pendingPromo = [];
  if (promoEl) promoEl.hidden = true;
  chess = new Chess();
  render();
}

function startPoll() {
  stopPoll();
  const gen = pollGen;
  const tick = async () => {
    if (gen !== pollGen || !gameId) return;
    try {
      const rows = await fetchGame(CONFIG, gameId);
      if (gen !== pollGen) return;
      absorb(rows);
    } catch (err) {
      console.warn('Chess sheet did not load', err);
    }
    if (gen === pollGen) pollTimer = setTimeout(tick, CONFIG.pollMs);
  };
  pollTimer = setTimeout(tick, 400);
}

function absorb(rows) {
  const next = new Chess();
  const replay = replayGame(rows, next, gameId);
  if (replay.applied.length < chess.history().length) return;
  chess = next;
  if (!seat) {
    const claimed = seatFor(replay, nick());
    if (claimed) seat = claimed;
    if (seat === 'b') flipped = true;
  }
  selected = null;
  render();
}

async function createShared() {
  if (!isConfigured()) return;
  rememberNick();
  stopPoll();
  gameId = makeGameId(crypto.getRandomValues(new Uint8Array(5)));
  mode = 'shared';
  seat = 'w';
  flipped = false;
  selected = null;
  chess = new Chess();
  postRow(CONFIG, { gameId, ply: 0, name: nick(), san: '', color: 'w' });
  render();
  startPoll();
}

async function joinShared(code) {
  if (!isConfigured()) return;
  const id = String(code || '')
    .trim()
    .toUpperCase();
  if (!id) return;
  rememberNick();
  let rows;
  try {
    rows = await fetchGame(CONFIG, id);
  } catch (err) {
    console.warn(err);
    if (statusEl) statusEl.textContent = 'The game list did not load. Try again.';
    return;
  }
  const probe = new Chess();
  const replay = replayGame(rows, probe, id);
  if (!replay.white) {
    if (statusEl) statusEl.textContent = 'No game with that code yet.';
    return;
  }
  stopPoll();
  gameId = id;
  mode = 'shared';
  chess = probe;
  const claimed = seatFor(replay, nick());
  seat = claimed;
  if (claimed === 'b' && !replay.black) {
    postRow(CONFIG, { gameId, ply: 0, name: nick(), san: '', color: 'b' });
  }
  flipped = seat === 'b';
  selected = null;
  render();
  startPoll();
}

function bind() {
  const saved = (() => {
    try {
      return localStorage.getItem(NICK_KEY) || '';
    } catch {
      return '';
    }
  })();
  if (nickEl && saved) nickEl.value = saved;
  const configured = isConfigured();
  if (noteEl) {
    noteEl.hidden = configured;
    noteEl.textContent = configured
      ? ''
      : 'Shared games post each move to a Google Form. This page is pass-and-play until that form is connected.';
  }
  if (sharedTools) sharedTools.hidden = !configured;

  document.getElementById('local-btn')?.addEventListener('click', () => {
    rememberNick();
    resetLocal();
  });
  document.getElementById('create-btn')?.addEventListener('click', () => {
    void createShared();
  });
  document.getElementById('join-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void joinShared(joinEl ? joinEl.value : '');
  });
  document.getElementById('flip')?.addEventListener('click', () => {
    flipped = !flipped;
    render();
  });
  nickEl?.addEventListener('change', rememberNick);

  const params = new URLSearchParams(window.location.search);
  const code = params.get('game');
  if (joinEl && code) joinEl.value = code.toUpperCase();
  resetLocal();
}

bind();
