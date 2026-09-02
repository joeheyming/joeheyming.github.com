/**
 * Answers / Tallies / Quarantine retention for trivia.
 * Apps Script (`apps-script.local.gs`) mirrors these rules.
 */

/** Current round plus this many closed RoundHistory rows (~36h at 30m). */
export const ANSWERS_KEEP_ROUNDS = 72;

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
