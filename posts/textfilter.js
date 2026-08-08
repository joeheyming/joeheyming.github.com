// Soft client-side text gate via TensorFlow toxicity.
// Lazy-loads on first use. Client-only (bypassable via direct Form POST).
//
// esm.sh must pin tfjs-core + tfjs-converter: toxicity@1.2.2 still depends on
// ^1.3.3, and `?deps=@tensorflow/tfjs@4.22.0` alone does not remap those.

const TOXICITY_THRESHOLD = 0.9;
const TOXICITY_LABELS = [
  'identity_attack',
  'threat',
  'sexual_explicit',
  'severe_toxicity',
  'toxicity',
  'obscene'
];

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

/**
 * @returns {Promise<ToxicityModel>}
 */
export function getTextModel() {
  if (!textModelPromise) {
    textModelPromise = (async () => {
      await import(/* @vite-ignore */ TFJS_URL);
      const toxicity = await import(/* @vite-ignore */ TOXICITY_URL);
      return toxicity.load(TOXICITY_THRESHOLD, TOXICITY_LABELS);
    })().catch((err) => {
      textModelPromise = null;
      throw err;
    });
  }
  return textModelPromise;
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
