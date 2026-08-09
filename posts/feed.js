/**
 * Shared Posts feed helpers (gviz read path).
 * Used by the board and the home-page latest-note teaser.
 */

import { CONFIG, isConfigured } from './config.js';

/**
 * @typedef {{
 *   id: string,
 *   ts: number,
 *   text: string,
 *   email: string,
 *   hasAttachment: boolean
 * }} FeedPost
 */

/**
 * @param {string} [tab]
 * @returns {Promise<{ cols: string[], rows: unknown[][] }>}
 */
export async function fetchTab(tab = CONFIG.responsesTab) {
  const url = `https://docs.google.com/spreadsheets/d/${
    CONFIG.sheetId
  }/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
  const text = await fetch(url, { cache: 'no-store' }).then((r) => r.text());
  const m = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!m) throw new Error('gviz parse failed');
  const json = JSON.parse(m[1]);
  if (!json.table || !json.table.rows) return { cols: [], rows: [] };
  const cols = (json.table.cols || []).map((c) => (c && c.label) || '');
  const rows = json.table.rows.map((r) => (r.c || []).map((c) => (c == null ? null : c.v)));
  return { cols, rows };
}

/**
 * @param {unknown} v
 * @returns {number}
 */
export function parseTs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const m = v.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
    if (m) {
      return new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

/**
 * @param {string[]} cols
 * @param {string[]} names
 */
export function colIndex(cols, names) {
  const lower = cols.map((c) => String(c).toLowerCase());
  for (const name of names) {
    const i = lower.findIndex((c) => c.includes(name));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>|null}
 */
function parseMetadata(raw) {
  if (raw == null || raw === '') return null;
  try {
    const value = JSON.parse(String(raw));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} raw
 */
function parseAttachmentChunk(raw) {
  if (raw == null) return null;
  const match = String(raw).match(/^posts-attachment-chunk-v1\|([^|]+)\|(\d+)\|(\d+)\|([\s\S]*)$/);
  if (!match) return null;
  const index = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index >= total) {
    return null;
  }
  return { id: match[1], index, total };
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function parseAttachments(raw) {
  if (raw == null || raw === '') return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        return arr
          .map(String)
          .map((u) => u.trim())
          .filter((u) => /^https?:\/\//i.test(u) || u.startsWith('data:'));
      }
    } catch {
      /* fall through */
    }
  }
  return s
    .split(/\n+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u) || u.startsWith('data:'));
}

/**
 * @param {string} s
 */
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Strip light markdown noise for a one-line teaser.
 * @param {string} text
 */
export function previewText(text) {
  return String(text || '')
    .replace(/[#>*_`~\-[\]]/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {number} ts
 */
export function formatWhen(ts) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

/**
 * Newest visible post from the public Sheet (skips honeypot / remove / move).
 * Chunked uploads contribute text from the first chunk row without reassembling media.
 * @returns {Promise<FeedPost|null>}
 */
export async function fetchLatestPost() {
  if (!isConfigured()) return null;
  const { cols, rows } = await fetchTab(CONFIG.responsesTab);
  const iTs = colIndex(cols, ['timestamp', 'time']);
  const iText = colIndex(cols, ['text', 'post', 'body', 'message']);
  const iAttach = colIndex(cols, [
    'attachment',
    'attachments',
    'images',
    'image',
    'media',
    'photos'
  ]);
  const iEmail = colIndex(cols, ['email', 'e-mail']);
  const iName = colIndex(cols, ['name', 'author']);
  const iMetadata = colIndex(cols, ['metadata']);
  const iHoney = colIndex(cols, ['honeypot', 'comments', 'website', 'spam']);

  const tIdx = iTs >= 0 ? iTs : 0;
  const textIdx = iText >= 0 ? iText : 1;
  const attachIdx = iAttach >= 0 ? iAttach : 2;
  const emailIdx = iName >= 0 ? iName : iEmail >= 0 ? iEmail : 3;
  const metadataIdx = iMetadata >= 0 ? iMetadata : -1;
  const honeyIdx = iHoney >= 0 ? iHoney : 5;

  /** @type {FeedPost[]} */
  const remote = [];
  /** @type {Map<string, { id: string, total: number, text: string, email: string, metadata: Record<string, unknown>|null, ts: number, seen: number }>} */
  const chunkGroups = new Map();
  const removedIds = new Set();

  for (const row of rows) {
    const honey = honeyIdx < row.length ? row[honeyIdx] : '';
    if (honey != null && String(honey).trim() !== '') continue;

    const text = textIdx < row.length && row[textIdx] != null ? String(row[textIdx]) : '';
    const rawAttachment = attachIdx < row.length ? row[attachIdx] : '';
    const email = emailIdx < row.length && row[emailIdx] != null ? String(row[emailIdx]) : '';
    const ts = parseTs(tIdx < row.length ? row[tIdx] : null);
    const metadata = parseMetadata(
      metadataIdx >= 0 && metadataIdx < row.length ? row[metadataIdx] : ''
    );
    if (metadata?.action === 'remove' && typeof metadata.targetId === 'string') {
      removedIds.add(metadata.targetId);
      continue;
    }
    if (metadata?.action === 'move') continue;

    const chunk = parseAttachmentChunk(rawAttachment);
    if (chunk) {
      let group = chunkGroups.get(chunk.id);
      if (!group) {
        group = {
          id: chunk.id,
          total: chunk.total,
          text: '',
          email: '',
          metadata: null,
          ts: ts || Date.now(),
          seen: 0
        };
        chunkGroups.set(chunk.id, group);
      }
      group.seen += 1;
      if (text) group.text = text;
      if (email) group.email = email;
      if (metadata) group.metadata = metadata;
      if (ts && (!group.ts || ts < group.ts)) group.ts = ts;
      continue;
    }

    const attachments = parseAttachments(rawAttachment);
    if (!text && attachments.length === 0) continue;

    const fallbackId = `sheet-${ts}-${hashStr(text + '\n' + attachments.join(','))}`;
    const id = typeof metadata?.id === 'string' && metadata.id ? metadata.id : fallbackId;
    remote.push({
      id,
      ts: ts || Date.now(),
      text,
      email,
      hasAttachment: attachments.length > 0
    });
  }

  for (const group of chunkGroups.values()) {
    if (group.seen < group.total && !group.text) continue;
    if (!group.text && group.seen < 1) continue;
    const fallbackId = `sheet-chunk-${group.id}`;
    const id =
      typeof group.metadata?.id === 'string' && group.metadata.id
        ? String(group.metadata.id)
        : fallbackId;
    if (!group.text) {
      remote.push({
        id,
        ts: group.ts || Date.now(),
        text: '',
        email: group.email,
        hasAttachment: true
      });
      continue;
    }
    remote.push({
      id,
      ts: group.ts || Date.now(),
      text: group.text,
      email: group.email,
      hasAttachment: true
    });
  }

  const visible = remote.filter((post) => !removedIds.has(post.id));
  visible.sort((a, b) => b.ts - a.ts);
  return visible[0] || null;
}
