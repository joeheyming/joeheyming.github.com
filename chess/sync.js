// Replay a shared game from form rows. The chess object is the rules:
// `move(san)` returns a move or throws / returns null when the SAN is illegal.

const GAME_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function makeGameId(bytes) {
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    const n = bytes && bytes.length > i ? bytes[i] : 0;
    out += GAME_ID_ALPHABET[n % GAME_ID_ALPHABET.length];
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {{ gameId: string, ply: number, name: string, san: string, color: 'w' | 'b' } | null}
 */
export function normalizeRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (raw);
  const gameId = String(record.gameId == null ? '' : record.gameId).trim();
  if (!gameId) return null;
  if (record.ply == null || record.ply === '') return null;
  const ply = typeof record.ply === 'number' ? record.ply : Number(String(record.ply).trim());
  if (!Number.isInteger(ply) || ply < 0) return null;
  const color = String(record.color == null ? '' : record.color)
    .trim()
    .toLowerCase();
  if (color !== 'w' && color !== 'b') return null;
  return {
    gameId,
    ply,
    name: String(record.name == null ? '' : record.name)
      .trim()
      .slice(0, 20),
    san: String(record.san == null ? '' : record.san).trim(),
    color: /** @type {'w' | 'b'} */ (color)
  };
}

/**
 * @param {unknown[]} rawRows
 * @param {{ move: (san: string) => unknown }} chess
 * @param {string} gameId
 */
export function replayGame(rawRows, chess, gameId) {
  /** @type {Array<{ gameId: string, ply: number, name: string, san: string, color: 'w' | 'b', index: number }>} */
  const rows = [];
  /** @type {unknown[]} */
  const dropped = [];
  (rawRows || []).forEach((raw, index) => {
    const row = normalizeRow(raw);
    if (!row || row.gameId !== gameId) {
      if (raw) dropped.push(raw);
      return;
    }
    rows.push({ ...row, index });
  });
  rows.sort((a, b) => a.ply - b.ply || a.index - b.index);

  let white = '';
  let black = '';
  /** @type {typeof rows} */
  const applied = [];
  const seenMovePly = new Set();

  for (const row of rows) {
    if (row.ply === 0) {
      if (row.color === 'w' && row.name && !white) white = row.name;
      else if (row.color === 'b' && row.name && !black) black = row.name;
      else dropped.push(row);
      continue;
    }
    if (seenMovePly.has(row.ply) || row.ply !== applied.length + 1) {
      dropped.push(row);
      continue;
    }
    const expected = row.ply % 2 === 1 ? 'w' : 'b';
    if (row.color !== expected || !row.san) {
      dropped.push(row);
      continue;
    }
    let result = null;
    try {
      result = chess.move(row.san);
    } catch {
      result = null;
    }
    if (!result) {
      dropped.push(row);
      continue;
    }
    seenMovePly.add(row.ply);
    applied.push(row);
  }

  return { white, black, applied, dropped };
}

/**
 * Which seat `nick` plays. An open black seat is offered to anyone who is
 * not already white.
 * @param {{ white: string, black: string }} replay
 * @param {string} nick
 * @returns {'w' | 'b' | ''}
 */
export function seatFor(replay, nick) {
  const name = String(nick || '').trim();
  if (replay.white && name && replay.white === name) return 'w';
  if (replay.black && name && replay.black === name) return 'b';
  if (!replay.black) return 'b';
  return '';
}

/**
 * @param {'local' | 'shared'} mode
 * @param {string | null | undefined} seat
 * @param {string} turn
 * @param {boolean} over
 */
export function canMove(mode, seat, turn, over) {
  if (over) return false;
  if (mode === 'local') return true;
  return (seat === 'w' || seat === 'b') && seat === turn;
}
