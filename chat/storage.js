/**
 * Conversation persistence for the chat app.
 *
 * Stores the running list of OpenAI-shape messages in localStorage so a
 * reload doesn't blow away context. Single rolling conversation only —
 * multi-conversation history is a v2 concern.
 */

const STORAGE_KEY = 'heyming.chat.v1';
/** Prefix for model-specific install flags. Append the WebLLM model id. */
const INSTALLED_KEY_PREFIX = 'heyming.chat.modelInstalled.v3.';
/** Pre-picker install flag — treated as Hermes 3 8B already cached. */
const LEGACY_HERMES_INSTALLED_KEY = 'heyming.chat.modelInstalled.v2.hermes3-8b';
const HERMES_MODEL_ID = 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC';
/** localStorage key for the user's last-selected chat model id. */
const SELECTED_MODEL_KEY = 'heyming.chat.selectedModel.v1';
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
 * Has the given chat model been successfully installed in this browser
 * before? Used to decide between silent-init-on-boot (returning
 * visitor) and an "Install" CTA (first-time visitor). The OPFS cache
 * is the source of truth for the actual model bytes; this flag is a
 * cheap pre-check so we don't have to probe OPFS on every page load.
 *
 * When `modelId` is omitted, reads the legacy Hermes flag so callers
 * predating the picker still compile-time typecheck against a boolean.
 *
 * @param {string} [modelId]
 */
export function hasInstalledModel(modelId) {
  try {
    if (!modelId) {
      return localStorage.getItem(LEGACY_HERMES_INSTALLED_KEY) === '1';
    }
    if (localStorage.getItem(`${INSTALLED_KEY_PREFIX}${modelId}`) === '1') {
      return true;
    }
    if (modelId === HERMES_MODEL_ID && localStorage.getItem(LEGACY_HERMES_INSTALLED_KEY) === '1') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** @param {string} [modelId] */
export function markModelInstalled(modelId) {
  try {
    if (modelId) {
      localStorage.setItem(`${INSTALLED_KEY_PREFIX}${modelId}`, '1');
      return;
    }
    localStorage.setItem(LEGACY_HERMES_INSTALLED_KEY, '1');
  } catch {
    /* quota — silent init will re-confirm next visit */
  }
}

/** @param {string} [modelId] */
export function clearModelInstalledFlag(modelId) {
  try {
    if (modelId) {
      localStorage.removeItem(`${INSTALLED_KEY_PREFIX}${modelId}`);
      if (modelId === HERMES_MODEL_ID) {
        localStorage.removeItem(LEGACY_HERMES_INSTALLED_KEY);
      }
      return;
    }
    localStorage.removeItem(LEGACY_HERMES_INSTALLED_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @returns {string | null}
 */
export function loadSelectedModel() {
  try {
    const raw = localStorage.getItem(SELECTED_MODEL_KEY);
    return raw && typeof raw === 'string' ? raw : null;
  } catch {
    return null;
  }
}

/** @param {string} modelId */
export function saveSelectedModel(modelId) {
  try {
    localStorage.setItem(SELECTED_MODEL_KEY, modelId);
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
