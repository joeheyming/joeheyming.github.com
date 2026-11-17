/**
 * Fold one server row into a cell.
 *
 * `lastTs` is the newest server timestamp already applied to this cell.
 * It must be a sheet timestamp, never the browser's `Date.now()` at
 * click time. Google Forms stamps whole seconds, so a click at
 * 12:00:00.400 and its confirming row at 12:00:00.000 disagree by a
 * few hundred milliseconds. Treating the click clock as newer makes
 * the next snapshot drop the check: the bitmap reload clears the bit,
 * then the confirming row is discarded as stale.
 *
 * Pending local intent wins over the row. A matching row clears
 * pending and adopts the server time when it is newer. The bit stays
 * at the local value until a non-pending row is actually applied.
 *
 * @param {{ bit: number, lastTs: number, pending: { value: boolean } | null }} cell
 * @param {{ ts: number, bit: number }} row
 * @param {number} snapshotMaxTs
 * @returns {{ bit: number, lastTs: number, pending: { value: boolean } | null }}
 */
export function applyServerRow(cell, row, snapshotMaxTs) {
  if (!(row.ts > snapshotMaxTs)) return cell;
  if (cell.pending) {
    const confirmed = cell.pending.value === !!row.bit;
    return {
      bit: cell.bit,
      lastTs: row.ts >= cell.lastTs ? row.ts : cell.lastTs,
      pending: confirmed ? null : cell.pending
    };
  }
  if (row.ts < cell.lastTs) return cell;
  return { bit: row.bit, lastTs: row.ts, pending: null };
}

/**
 * A bit flip moves the other-people ring unless this tab made the
 * click. Two tabs in one browser share a client id, so the id cannot
 * tell them apart. `ownClick` is the pending confirm or a cell this
 * tab toggled.
 *
 * @param {{ before: number, after: number, ownClick: boolean }} row
 * @returns {boolean}
 */
export function isRemoteFlip(row) {
  if (row.before === row.after) return false;
  if (row.ownClick) return false;
  return true;
}

// Distinct from the gold keyboard cursor and the blue checked fill.
export const CLIENT_COLORS = [
  '#e11d48',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#db2777',
  '#4f46e5',
  '#65a30d',
  '#0d9488',
  '#c026d3',
  '#0284c7',
  '#d97706'
];

/**
 * A checker still counts as here this long after their last flip.
 * The sheet is polled every few seconds, so the window has to cover
 * one quiet gap between clicks without keeping someone who left.
 */
export const ACTIVE_WINDOW_MS = 30000;

/**
 * How many of `lastSeen` (client id → last flip, ms) are still inside
 * the window. Timestamps are caller clocks; this only compares them.
 *
 * @param {Iterable<[string, number]>} lastSeen
 * @param {number} now
 * @param {number} [windowMs]
 * @returns {number}
 */
export function activeCheckerCount(lastSeen, now, windowMs = ACTIVE_WINDOW_MS) {
  const cutoff = now - windowMs;
  let count = 0;
  for (const [, ts] of lastSeen) {
    if (typeof ts === 'number' && ts >= cutoff) count++;
  }
  return count;
}

/**
 * The header sentence for `activeCheckerCount`. Zero means other
 * people: this tab's own clicks are not in the map.
 *
 * @param {number} count
 * @returns {string}
 */
export function activeCheckersLabel(count) {
  if (count <= 0) return 'No one else is checking boxes right now';
  if (count === 1) return '1 person checking boxes right now';
  const n = count.toLocaleString();
  return `${n} people checking boxes right now`;
}

/** Stable color for one writer. The same id always maps to the same slot. */
export function colorForClient(clientId) {
  const key = String(clientId || '');
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return CLIENT_COLORS[(hash >>> 0) % CLIENT_COLORS.length];
}
