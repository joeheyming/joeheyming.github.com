import { CONFIG } from './config.js';
import { assertTextSafe, getTextModel } from '../posts/textfilter.js';

/** Doom/COEP pages cannot load esm.sh TF — skip client toxicity (Script still moderates). */
export function canRunClientToxicity() {
  return !(typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated);
}

/**
 * Warm the shared Posts toxicity model. Uses getTextModel (always exported)
 * so a COI-cached older textfilter.js still loads this module.
 */
export function preloadTextModel() {
  if (!canRunClientToxicity()) return;
  try {
    getTextModel().catch(() => {});
  } catch {
    // Ignore — moderation fails open on send.
  }
}

/**
 * @param {string} message
 * @returns {string|null}
 */
export function validateMessageShape(message) {
  const text = String(message || '').trim();
  if (!text) return 'Say something first';
  if (text.length > CONFIG.maxMessageChars) {
    return `Max ${CONFIG.maxMessageChars} characters`;
  }
  if (/https?:\/\//i.test(text) || /www\./i.test(text)) {
    return 'Links are not allowed';
  }
  return null;
}

/**
 * Client soft gate — same path as Posts (`assertTextSafe`) when TF can load.
 * On COI (Doom), shape-only; Apps Script is the real filter.
 *
 * @param {string} text
 * @param {'nick'|'message'} kind
 */
export async function assertChatTextSafe(text, kind = 'message') {
  if (kind === 'message') {
    const shape = validateMessageShape(text);
    if (shape) throw new Error(shape);
  }

  if (!canRunClientToxicity()) return;

  try {
    await assertTextSafe(text);
  } catch (err) {
    if (err instanceof Error && /blocked|not allowed/i.test(err.message)) {
      throw new Error(kind === 'nick' ? 'Name not allowed' : 'Message not allowed');
    }
    throw err;
  }
}
