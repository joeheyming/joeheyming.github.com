/**
 * Live-board retention rules for Posts.
 * Apps Script (`apps-script.local.gs`) mirrors this picker — keep them aligned.
 */

export const MAX_LIVE_POSTS = 150;
export const MAX_RESPONSE_ROWS = 500;
export const MAX_ATTACHMENT_CHUNKS = 20;
export const INCOMPLETE_MIN_AGE_MS = 15 * 60 * 1000;

/**
 * @typedef {{ id: string, ts: number, rows: number }} LivePost
 * @typedef {{ id: string, ts: number, rows: number, ageMs: number }} IncompleteGroup
 *
 * @param {{
 *   posts: LivePost[],
 *   incomplete?: IncompleteGroup[],
 *   maxLivePosts?: number,
 *   maxRows?: number,
 *   incompleteMinAgeMs?: number
 * }} opts
 * @returns {{ archivePostIds: string[], dropIncompleteIds: string[] }}
 */
export function pickArchiveTargets(opts) {
  const maxLivePosts = opts.maxLivePosts ?? MAX_LIVE_POSTS;
  const maxRows = opts.maxRows ?? MAX_RESPONSE_ROWS;
  const incompleteMinAgeMs = opts.incompleteMinAgeMs ?? INCOMPLETE_MIN_AGE_MS;
  const posts = [...(opts.posts || [])].sort(compareByTsThenId);
  const incomplete = [...(opts.incomplete || [])].sort(compareByTsThenId);
  const archive = new Set();
  const dropInc = new Set();

  const live = () => posts.filter((p) => !archive.has(p.id));
  const rowTotal = () =>
    live().reduce((sum, p) => sum + p.rows, 0) +
    incomplete.filter((g) => !dropInc.has(g.id)).reduce((sum, g) => sum + g.rows, 0);

  while (live().length > maxLivePosts && live().length > 1) {
    archive.add(live()[0].id);
  }

  const staleIncomplete = incomplete.filter((g) => g.ageMs >= incompleteMinAgeMs);

  while (rowTotal() > maxRows) {
    const remaining = live();
    if (remaining.length > 1) {
      archive.add(remaining[0].id);
      continue;
    }
    const nextInc = staleIncomplete.find((g) => !dropInc.has(g.id));
    if (nextInc) {
      dropInc.add(nextInc.id);
      continue;
    }
    break;
  }

  return {
    archivePostIds: [...archive],
    dropIncompleteIds: [...dropInc]
  };
}

/**
 * @param {string} serialized
 * @param {number} maxChunkChars
 * @returns {number}
 */
export function attachmentChunkCount(serialized, maxChunkChars) {
  if (!serialized || !serialized.startsWith('data:') || serialized.length <= maxChunkChars) {
    return 1;
  }
  return Math.ceil(serialized.length / maxChunkChars);
}

/**
 * @param {{ id: string, ts: number }} a
 * @param {{ id: string, ts: number }} b
 */
function compareByTsThenId(a, b) {
  return a.ts - b.ts || String(a.id).localeCompare(String(b.id));
}
