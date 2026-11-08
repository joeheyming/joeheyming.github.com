// Turns a Zenius simfile id ("zenius 26360", "zenius-26360", "zenius_26360")
// into the song title from that simfile's page. Titles are remembered in
// localStorage so the analytics list does not refetch them.

const PAGE = 'https://zenius-i-vanisher.com/v5.2/viewsimfile.php?simfileid=';
const STORE_KEY = 'heyming-zenius-titles-v1';
const sharedMemory = new Map();
/** @type {Map<string, Promise<string>>} */
const inflight = new Map();

/**
 * @param {string} value
 * @returns {string}
 */
export function zeniusSimfileId(value) {
  const match = String(value || '').match(/zenius[_ -]?(\d+)/i);
  return match ? match[1] : '';
}

/**
 * A count row still labeled with the bare simfile id, not a song title.
 * @param {string} name
 * @param {string} [id]
 * @returns {string}
 */
export function isZeniusPlaceholder(name, id) {
  const simfileId = zeniusSimfileId(id) || zeniusSimfileId(name);
  if (!simfileId) return '';
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed === String(id || '')) return simfileId;
  if (new RegExp(`^zenius[_ -]?${simfileId}$`, 'i').test(trimmed)) return simfileId;
  return '';
}

/**
 * @param {string} html
 * @returns {string}
 */
export function zeniusTitleFromHtml(html) {
  const match = String(html || '').match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (!match) return '';
  return decodeHtml(match[1]).replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * @param {string} simfileId
 * @returns {string}
 */
export function zeniusSimfilePageUrl(simfileId) {
  return PAGE + encodeURIComponent(String(simfileId || '').replace(/\D/g, ''));
}

/**
 * @param {string} simfileId
 * @param {{ memory?: Map<string, string>, storage?: Storage | null }} [deps]
 * @returns {string}
 */
export function cachedZeniusTitle(simfileId, deps) {
  const id = String(simfileId || '').replace(/\D/g, '');
  if (!id) return '';
  const memory = (deps && deps.memory) || sharedMemory;
  if (memory.has(id)) return memory.get(id) || '';
  const stored = readStore(resolveStorage(deps))[id] || '';
  if (stored) memory.set(id, stored);
  return stored;
}

/**
 * The song name for one Zenius id or play label. Empty when the page has no title.
 * @param {string} value
 * @param {{ fetchText?: (url: string) => Promise<string>, memory?: Map<string, string>, storage?: Storage | null }} [deps]
 * @returns {Promise<string>}
 */
export async function zeniusSongName(value, deps) {
  const id = zeniusSimfileId(value) || String(value || '').replace(/\D/g, '');
  if (!id) return '';
  const titles = await lookupZeniusTitles([id], deps);
  return titles.get(id) || '';
}

/**
 * @param {string[]} ids
 * @param {{ fetchText?: (url: string) => Promise<string>, memory?: Map<string, string>, storage?: Storage | null }} [deps]
 * @returns {Promise<Map<string, string>>}
 */
export async function lookupZeniusTitles(ids, deps) {
  const options = deps || {};
  const memory = options.memory || sharedMemory;
  const storage = resolveStorage(options);
  const fetchText = options.fetchText || defaultFetchText;
  const share = memory === sharedMemory;
  /** @type {Map<string, string>} */
  const out = new Map();
  /** @type {string[]} */
  const pending = [];
  for (const raw of ids || []) {
    const id = String(raw || '').replace(/\D/g, '');
    if (!id || out.has(id)) continue;
    const cached = cachedZeniusTitle(id, { memory, storage });
    if (cached) {
      out.set(id, cached);
      continue;
    }
    pending.push(id);
  }
  await mapPool(pending, 4, async (id) => {
    let job = share ? inflight.get(id) : undefined;
    if (!job) {
      job = fetchTitle(id, fetchText).then((title) => {
        if (title) {
          memory.set(id, title);
          writeStored(storage, id, title);
        }
        return title;
      });
      if (share) {
        inflight.set(id, job);
        job.finally(() => {
          if (inflight.get(id) === job) inflight.delete(id);
        });
      }
    }
    const title = await job;
    if (title) out.set(id, title);
  });
  return out;
}

/**
 * @param {string} id
 * @param {(url: string) => Promise<string>} fetchText
 * @returns {Promise<string>}
 */
async function fetchTitle(id, fetchText) {
  try {
    const html = await fetchText(zeniusSimfilePageUrl(id));
    return zeniusTitleFromHtml(html);
  } catch {
    return '';
  }
}

/**
 * @param {string[]} items
 * @param {number} limit
 * @param {(item: string) => Promise<void>} fn
 */
async function mapPool(items, limit, fn) {
  if (!items.length) return;
  let cursor = 0;
  const workers = Math.min(limit, items.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await fn(items[index]);
      }
    })
  );
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
async function defaultFetchText(url) {
  const proxy = typeof window !== 'undefined' ? window.proxyService : null;
  if (proxy && typeof proxy.fetchWithProxy === 'function') {
    const text = await proxy.fetchWithProxy(url, { skipDirect: true });
    return String(text || '');
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(String(response.status));
  return response.text();
}

/**
 * @param {{ storage?: Storage | null }} [deps]
 * @returns {Storage | null}
 */
function resolveStorage(deps) {
  if (deps && Object.prototype.hasOwnProperty.call(deps, 'storage')) return deps.storage || null;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* private mode */
  }
  return null;
}

/**
 * @param {Storage | null} storage
 * @returns {Record<string, string>}
 */
function readStore(storage) {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(STORE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return /** @type {Record<string, string>} */ (parsed);
  } catch {
    return {};
  }
}

/**
 * @param {Storage | null} storage
 * @param {string} id
 * @param {string} title
 */
function writeStored(storage, id, title) {
  if (!storage) return;
  const all = readStore(storage);
  if (all[id] === title) return;
  all[id] = title;
  try {
    storage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* quota */
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function decodeHtml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, digits) => {
      const code = Number(digits);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}
