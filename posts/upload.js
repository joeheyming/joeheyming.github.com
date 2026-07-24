// Compress attachments to data URLs for the Form → Sheet write path.
//
// Binding limit is Google Forms POST size (413 Content Too Large), which
// is much tighter than Sheets' 50k cell cap. URLSearchParams also
// percent-encodes +, /, = in base64 and expands the body further.

/**
 * @param {Blob|File|string} input
 * @param {{ maxEdge?: number, quality?: number, mime?: string }} [opts]
 * @returns {Promise<Blob>}
 */
export async function compressAttachment(input, opts = {}) {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.9;
  const mime = opts.mime ?? (supportsWebp() ? 'image/webp' : 'image/jpeg');
  const blob = await toBlob(input);
  const bitmap = await createImageBitmap(blob);
  try {
    let { width, height } = bitmap;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    const out = await canvasToBlob(canvas, mime, quality);
    // If webp somehow failed empty, fall back to jpeg.
    if (out.size === 0 && mime !== 'image/jpeg') {
      return canvasToBlob(canvas, 'image/jpeg', quality);
    }
    return out;
  } finally {
    bitmap.close?.();
  }
}

/** @deprecated Use compressAttachment */
export const compressImage = compressAttachment;

/**
 * @param {Blob|File|string} input
 * @param {{ maxEdge?: number, quality?: number, mime?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function encodeAttachment(input, opts = {}) {
  if (typeof input === 'string' && /^https?:\/\//i.test(input.trim())) {
    return input.trim();
  }
  if (typeof input === 'string' && input.startsWith('data:audio/')) {
    return input;
  }
  if (input instanceof Blob && input.type.startsWith('audio/')) {
    return blobToDataUrl(input);
  }
  const compressed = await compressAttachment(input, opts);
  return blobToDataUrl(compressed);
}

/**
 * Encode attachments so the Form POST stays under Google's size limit.
 * @param {Array<Blob|File|string>} inputs
 * @param {{
 *   maxEdge?: number,
 *   quality?: number,
 *   max?: number,
 *   maxTotalChars?: number
 * }} [opts]
 * @returns {Promise<string[]>}
 */
export async function encodeAttachments(inputs, opts = {}) {
  const max = opts.max ?? 1;
  const maxTotalChars = opts.maxTotalChars ?? 350000;
  const list = inputs.slice(0, max);
  if (!list.length) return [];

  // Keep screenshots and other already-small images byte-for-byte. Lossy
  // WebP conversion makes text and UI captures noticeably soft.
  if (list.length === 1) {
    const item = list[0];
    if (typeof item === 'string' && item.startsWith('data:image/')) {
      if (item.length <= maxTotalChars) return [item];
    } else if (item instanceof Blob && item.type.startsWith('image/')) {
      const original = await blobToDataUrl(item);
      if (original.length <= maxTotalChars) return [original];
    }
  }

  // Non-image attachments cannot be recompressed here. Pass them
  // through when they fit; otherwise fail with a useful message.
  const direct = [];
  let allDirect = true;
  for (const item of list) {
    if (typeof item === 'string' && /^https?:\/\//i.test(item.trim())) {
      direct.push(item.trim());
    } else if (typeof item === 'string' && item.startsWith('data:audio/')) {
      direct.push(item);
    } else if (item instanceof Blob && item.type.startsWith('audio/')) {
      direct.push(await blobToDataUrl(item));
    } else {
      allDirect = false;
      break;
    }
  }
  if (allDirect) {
    if (direct.join('\n').length <= maxTotalChars) return direct;
    throw new Error('Audio attachment is too large for Google Forms. Record a shorter clip.');
  }

  let maxEdge = opts.maxEdge ?? 1600;
  let quality = opts.quality ?? 0.9;
  let mime = supportsWebp() ? 'image/webp' : 'image/jpeg';

  for (let attempt = 0; attempt < 10; attempt++) {
    const encoded = [];
    for (const item of list) {
      encoded.push(await encodeAttachment(item, { maxEdge, quality, mime }));
    }
    const packed = encoded.join('\n');
    if (packed.length <= maxTotalChars) return encoded;

    maxEdge = Math.max(120, Math.floor(maxEdge * 0.7));
    quality = Math.max(0.28, quality - 0.06);
    if (attempt === 4 && mime === 'image/webp') {
      // Last resorts often compress better as jpeg at tiny sizes.
      mime = 'image/jpeg';
    }
  }

  throw new Error(
    'Image could not fit within the attachment budget. Try a smaller image or paste an https URL instead.'
  );
}

/**
 * Rough size of a URL-encoded Form body. Used to refuse submits that
 * would get 413 from Google Forms (no-cors can't surface that status).
 * @param {URLSearchParams} body
 * @returns {number}
 */
export function formBodyByteLength(body) {
  return new TextEncoder().encode(body.toString()).length;
}

let _supportsWebp = /** @type {boolean|null} */ (null);
function supportsWebp() {
  if (_supportsWebp != null) return _supportsWebp;
  try {
    _supportsWebp = document
      .createElement('canvas')
      .toDataURL('image/webp')
      .startsWith('data:image/webp');
  } catch {
    _supportsWebp = false;
  }
  return _supportsWebp;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} mime
 * @param {number} quality
 * @returns {Promise<Blob>}
 */
function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), mime, quality);
  });
}

/**
 * @param {Blob|File|string} input
 * @returns {Promise<Blob>}
 */
async function toBlob(input) {
  if (input instanceof Blob) return input;
  if (typeof input === 'string') {
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Failed to load attachment (${res.status})`);
    return res.blob();
  }
  throw new Error('Unsupported attachment input');
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}
