/**
 * Answers / Tallies / Quarantine retention for trivia.
 * Apps Script (`apps-script.local.gs`) mirrors these rules.
 * Closed-round order comes from Tallies (oldest row first). There is no
 * RoundHistory sheet.
 */

/** Current open round plus this many closed rounds (~36h at 30m). */
export const ANSWERS_KEEP_ROUNDS = 72;

/** Hard cap for Answers, Tallies, and Quarantine data rows. Newest kept. */
export const MAX_SHEET_ROWS = 500;

/**
 * @param {string} currentRoundId
 * @param {string[]} historyRoundIdsOldestFirst
 * @param {number} [keepRounds]
 * @returns {Set<string>}
 */
export function keepRoundIdSet(
  currentRoundId,
  historyRoundIdsOldestFirst,
  keepRounds = ANSWERS_KEEP_ROUNDS
) {
  const ids = new Set();
  if (currentRoundId) ids.add(currentRoundId);
  const slice = historyRoundIdsOldestFirst.slice(-keepRounds);
  for (const id of slice) {
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * @param {string} roundId
 * @param {Set<string>} keep
 */
export function shouldKeepAnswerOrTallyRow(roundId, keep) {
  return keep.has(roundId);
}

/**
 * Quarantine rows with no roundId stay (then a separate max-row trim applies).
 * @param {string} roundId
 * @param {Set<string>} keep
 */
export function shouldKeepQuarantineRow(roundId, keep) {
  if (!roundId) return true;
  return keep.has(roundId);
}

/**
 * How many oldest rows to delete so `roundIdsOldestFirst` fits `maxKeep`.
 * Stops at the first `protectRoundId` so a busy open round is not trimmed
 * out from under the live tallies.
 * @param {string[]} roundIdsOldestFirst
 * @param {number} maxKeep
 * @param {string} [protectRoundId]
 */
export function oldestPrefixToDrop(roundIdsOldestFirst, maxKeep, protectRoundId = '') {
  const total = roundIdsOldestFirst.length;
  if (!Number.isFinite(maxKeep) || total <= maxKeep) return 0;
  let drop = 0;
  const need = total - maxKeep;
  for (let i = 0; i < total && drop < need; i++) {
    if (protectRoundId && roundIdsOldestFirst[i] === protectRoundId) break;
    drop++;
  }
  return drop;
}
