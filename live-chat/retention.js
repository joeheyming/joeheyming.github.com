/**
 * Retention helpers for live chat RateLimits / Quarantine.
 * Apps Script (`apps-script.local.gs`) mirrors these constants and rules.
 */

export const RATE_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_QUARANTINE_ROWS = 500;

/**
 * @param {Record<string, { lastMsgAt?: number, lastNickAt?: number, windowStart?: number }>} map
 * @param {number} now
 * @param {number} [idleMs]
 * @returns {typeof map}
 */
export function pruneIdleRates(map, now, idleMs = RATE_IDLE_MS) {
  /** @type {typeof map} */
  const out = {};
  for (const [uuid, row] of Object.entries(map)) {
    const last = Math.max(row.lastMsgAt || 0, row.lastNickAt || 0, row.windowStart || 0);
    if (now - last <= idleMs) out[uuid] = row;
  }
  return out;
}

/**
 * How many oldest append-only rows to drop so `total` fits `maxKeep`.
 * @param {number} total
 * @param {number} maxKeep
 */
export function oldestCountToDrop(total, maxKeep) {
  if (!Number.isFinite(total) || !Number.isFinite(maxKeep) || total <= maxKeep) return 0;
  return total - maxKeep;
}
