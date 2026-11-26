/**
 * Which chess response rows to delete. A game stays whole: dropping the
 * opening and keeping a later move would make the replay illegal.
 * Keep the numbers in chess/apps-script.local.gs in step with these.
 */

/** No new row for this long and the whole game is removed. */
export const IDLE_MS = 30 * 24 * 60 * 60 * 1000;

/** Data rows kept on the response sheet, header excluded. */
export const MAX_ROWS = 2000;

/** The page reads 300 rows of one game. A longer game cannot be replayed. */
export const MAX_GAME_ROWS = 300;

/**
 * @param {Array<{ gameId?: string, at?: number }>} rows Sheet order.
 * @param {number} now
 * @param {{ idleMs?: number, maxRows?: number, maxGameRows?: number }} [opts]
 * @returns {number[]} Indexes to delete, ascending.
 */
export function rowIndexesToDrop(rows, now, opts = {}) {
  const idleMs = opts.idleMs ?? IDLE_MS;
  const maxRows = opts.maxRows ?? MAX_ROWS;
  const maxGameRows = opts.maxGameRows ?? MAX_GAME_ROWS;

  /** @type {Map<string, number[]>} */
  const groups = new Map();
  rows.forEach((row, index) => {
    const id = String(row && row.gameId ? row.gameId : '').trim();
    const list = groups.get(id);
    if (list) list.push(index);
    else groups.set(id, [index]);
  });

  /** @type {Set<number>} */
  const drop = new Set();
  for (const index of groups.get('') || []) drop.add(index);
  groups.delete('');

  /** @type {Array<{ indexes: number[], latest: number }>} */
  const games = [];
  for (const indexes of groups.values()) {
    let latest = 0;
    for (const index of indexes) {
      const at = rows[index] && rows[index].at;
      if (typeof at === 'number' && Number.isFinite(at) && at > latest) latest = at;
    }
    if (indexes.length > maxGameRows || !latest || now - latest >= idleMs) {
      for (const index of indexes) drop.add(index);
    } else {
      games.push({ indexes, latest });
    }
  }

  games.sort((a, b) => a.latest - b.latest || a.indexes[0] - b.indexes[0]);
  let kept = rows.length - drop.size;
  for (const game of games) {
    if (kept <= maxRows) break;
    for (const index of game.indexes) drop.add(index);
    kept -= game.indexes.length;
  }

  return [...drop].sort((a, b) => a - b);
}
