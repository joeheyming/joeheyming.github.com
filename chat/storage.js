/**
 * Conversation persistence for the chat app.
 *
 * Stores the running list of OpenAI-shape messages in localStorage so a
 * reload doesn't blow away context. Single rolling conversation only —
 * multi-conversation history is a v2 concern.
 */

const STORAGE_KEY = 'heyming.chat.v1';
// Bumped when the default model changes so anyone with a stale "installed"
// flag from a previous default sees a fresh install card.
const INSTALLED_KEY = 'heyming.chat.modelInstalled.v2.hermes3-8b';
const MAX_MESSAGES = 80; // keep history bounded
const MAX_CHARS = 200000; // hard cap on serialized size

/**
 * @typedef {Object} StoredMessage
 * @property {string} role  'system' | 'user' | 'assistant' | 'tool'
 * @property {string|null} [content]
 * @property {string} [name]
 * @property {string} [tool_call_id]
 * @property {Array<object>} [tool_calls]
 */

/** @returns {StoredMessage[]} */
export function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => m && typeof m === 'object' && typeof m.role === 'string');
  } catch {
    return [];
  }
}

/** @param {StoredMessage[]} messages */
export function saveHistory(messages) {
  try {
    const stripped = messages.map(stripAttachmentContent);
    const trimmed = trimHistory(stripped);
    const serialized = JSON.stringify(trimmed);
    if (serialized.length > MAX_CHARS) {
      // Drop oldest non-system messages until it fits.
      const recent = pruneByChars(trimmed, MAX_CHARS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
      return;
    }
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    /* quota or private mode — graceful loss */
  }
}

/**
 * Drop attachment text before persisting. We keep the metadata (name,
 * size, kind, pages, truncation flag) so reloads can still render the
 * chip on the user bubble, but the model loses access to the content
 * — that's a deliberate privacy trade-off and keeps localStorage from
 * filling up with PDF dumps.
 *
 * @param {StoredMessage} m
 * @returns {StoredMessage}
 */
function stripAttachmentContent(m) {
  /** @type {any} */
  const anyMsg = m;
  if (!Array.isArray(anyMsg.attachments)) return m;
  return {
    ...m,
    attachments: anyMsg.attachments.map((/** @type {any} */ a) => {
      const { content, ...rest } = a;
      return rest;
    })
  };
}

export function clearHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Has the local model been successfully installed in this browser
 * before? Used to decide between silent-init-on-boot (returning
 * visitor) and an "Install" CTA (first-time visitor). The OPFS cache
 * is the source of truth for the actual model bytes; this flag is a
 * cheap pre-check so we don't have to probe OPFS on every page load.
 */
export function hasInstalledModel() {
  try {
    return localStorage.getItem(INSTALLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markModelInstalled() {
  try {
    localStorage.setItem(INSTALLED_KEY, '1');
  } catch {
    /* quota — silent init will re-confirm next visit */
  }
}

export function clearModelInstalledFlag() {
  try {
    localStorage.removeItem(INSTALLED_KEY);
  } catch {
    /* ignore */
  }
}

/** @param {StoredMessage[]} messages */
function trimHistory(messages) {
  if (messages.length <= MAX_MESSAGES) return messages;
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');
  const recent = nonSystem.slice(-(MAX_MESSAGES - systemMessages.length));
  return [...systemMessages, ...recent];
}

/** @param {StoredMessage[]} messages @param {number} maxChars */
function pruneByChars(messages, maxChars) {
  const systemMessages = messages.filter((m) => m.role === 'system');
  let recent = messages.filter((m) => m.role !== 'system');
  while (recent.length && JSON.stringify([...systemMessages, ...recent]).length > maxChars) {
    recent = recent.slice(1);
  }
  return [...systemMessages, ...recent];
}
