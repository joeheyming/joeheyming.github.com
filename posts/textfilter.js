// Soft client-side text gate via TensorFlow toxicity.
// Lazy-loads on first use. Client-only (bypassable via direct Form POST).
//
// esm.sh must pin tfjs-core + tfjs-converter: toxicity@1.2.2 still depends on
// ^1.3.3, and `?deps=@tensorflow/tfjs@4.22.0` alone does not remap those.
//
// Fail open when: model import/load throws, load hangs past LOAD_TIMEOUT_MS,
// or the page is cross-origin isolated (COEP blocks esm.sh — e.g. Doom).

const TOXICITY_THRESHOLD = 0.9;
const TOXICITY_LABELS = [
  'identity_attack',
  'threat',
  'sexual_explicit',
  'severe_toxicity',
  'toxicity',
  'obscene'
];

/** First-time CDN + weight download; hangs must not block the UI forever. */
const LOAD_TIMEOUT_MS = 20000;

export const TFJS_URL = 'https://esm.sh/@tensorflow/tfjs@4.22.0';

/** Must keep core + converter pins — see file header. */
export const TOXICITY_URL =
  'https://esm.sh/@tensorflow-models/toxicity@1.2.2?deps=@tensorflow/tfjs@4.22.0,@tensorflow/tfjs-core@4.22.0,@tensorflow/tfjs-converter@4.22.0';

/**
 * @typedef {{ label: string, results: Array<{ match: boolean|null, probabilities: Float32Array|number[] }> }} ToxicityPrediction
 * @typedef {{ classify: (sentences: string[]) => Promise<ToxicityPrediction[]> }} ToxicityModel
 */

/** @type {Promise<ToxicityModel>|null} */
let textModelPromise = null;

function isCrossOriginIsolated() {
  return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      }
    );
  });
}

/**
 * @returns {Promise<ToxicityModel>}
 */
export function getTextModel() {
  if (isCrossOriginIsolated()) {
    return Promise.reject(new Error('Toxicity model unavailable under crossOriginIsolated'));
  }
  if (!textModelPromise) {
    textModelPromise = withTimeout(
      (async () => {
        await import(/* @vite-ignore */ TFJS_URL);
        const toxicity = await import(/* @vite-ignore */ TOXICITY_URL);
        return toxicity.load(TOXICITY_THRESHOLD, TOXICITY_LABELS);
      })(),
      LOAD_TIMEOUT_MS,
      'Toxicity model load timed out'
    ).catch((err) => {
      textModelPromise = null;
      throw err;
    });
  }
  return textModelPromise;
}

/**
 * Kick off model download in the background (no-op on COI / failure).
 */
export function preloadTextModel() {
  getTextModel().catch(() => {});
}

/**
 * Labels whose match flag is true for the given text (empty if none / blank).
 * @param {unknown} text
 * @returns {Promise<string[]>}
 */
export async function matchingToxicityLabels(text) {
  if (typeof text !== 'string') return [];
  const trimmed = text.trim();
  if (!trimmed) return [];

  const model = await getTextModel();
  const predictions = await model.classify([trimmed]);
  return predictions.filter((p) => p.results[0]?.match === true).map((p) => p.label);
}

/**
 * Classify post body text. No-op for empty/whitespace.
 * Throws when toxic; fails open (warn + return) if the model cannot load.
 * @param {unknown} text
 * @returns {Promise<void>}
 */
export async function assertTextSafe(text) {
  if (typeof text !== 'string') return;
  const trimmed = text.trim();
  if (!trimmed) return;

  let labels;
  try {
    labels = await matchingToxicityLabels(trimmed);
  } catch (err) {
    console.warn('Posts text moderation skipped — model load failed', err);
    return;
  }

  if (labels.length > 0) {
    throw new Error('Post blocked — text not allowed');
  }
}
