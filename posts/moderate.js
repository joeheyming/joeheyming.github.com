// Soft client-side NSFW gate for Posts image attachments (nsfwjs).
// Lazy-loads TensorFlow.js + nsfwjs on first image pin. https:// URLs and
// audio are skipped here — Apps Script covers public image URLs when configured.

const NSFW_THRESHOLD = 0.6;
const BLOCK_CLASSES = new Set(['Porn', 'Hentai']);
const TFJS_URL = 'https://esm.sh/@tensorflow/tfjs@4.22.0';
const NSFWJS_URL = 'https://esm.sh/nsfwjs@4.2.1?deps=@tensorflow/tfjs@4.22.0';

/** @type {Promise<{ classify: (img: HTMLImageElement) => Promise<Array<{ className: string, probability: number }>> }>|null} */
let modelPromise = null;

/**
 * True for in-browser image blobs / data URLs. False for audio and https://
 * (CORS — moderated server-side when Sightengine is configured).
 * @param {unknown} input
 * @returns {boolean}
 */
export function isImageAttachment(input) {
  if (input instanceof Blob) {
    return Boolean(input.type && input.type.startsWith('image/'));
  }
  if (typeof input !== 'string') return false;
  return input.trim().startsWith('data:image/');
}

/**
 * @returns {Promise<{ classify: (img: HTMLImageElement) => Promise<Array<{ className: string, probability: number }>> }>}
 */
function getModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      await import(/* @vite-ignore */ TFJS_URL);
      const nsfwjs = await import(/* @vite-ignore */ NSFWJS_URL);
      return nsfwjs.load();
    })().catch((err) => {
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}

/**
 * @param {Blob|string} input
 * @returns {Promise<HTMLImageElement>}
 */
async function toImageElement(input) {
  const src = typeof input === 'string' ? input.trim() : await blobToDataUrl(input);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image for moderation'));
    img.src = src;
  });
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image for moderation'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Classify one image attachment. No-op for non-images.
 * Throws when NSFW; fails open (warn + return) if the model cannot load.
 * @param {unknown} input
 * @returns {Promise<void>}
 */
export async function assertImageSafe(input) {
  if (!isImageAttachment(input)) return;

  let model;
  try {
    model = await getModel();
  } catch (err) {
    console.warn('Posts image moderation skipped — model load failed', err);
    return;
  }

  const img = await toImageElement(/** @type {Blob|string} */ (input));
  const predictions = await model.classify(img);
  for (const prediction of predictions) {
    if (BLOCK_CLASSES.has(prediction.className) && prediction.probability >= NSFW_THRESHOLD) {
      throw new Error('Attachment blocked — image not allowed');
    }
  }
}

/**
 * @param {unknown[]} inputs
 * @returns {Promise<void>}
 */
export async function assertImagesSafe(inputs) {
  for (const input of inputs) {
    await assertImageSafe(input);
  }
}
