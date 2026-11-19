import { DocumentError, PDF_FAIL } from './prose.js';

const PDFJS_VERSION = '4.10.38';
const PDFJS_MODULE_URL = `https://esm.run/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`;
const PDFJS_WORKER_URL = `https://esm.run/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;

/**
 * @typedef {{ str?: string, transform?: number[], width?: number }} PdfItem
 * @typedef {{
 *   GlobalWorkerOptions: { workerSrc: string },
 *   getDocument: (opts: { data: ArrayBuffer }) => {
 *     promise: Promise<{
 *       numPages: number,
 *       destroy?: () => Promise<void>,
 *       getPage: (n: number) => Promise<{
 *         getTextContent: () => Promise<{ items: PdfItem[] }>
 *       }>
 *     }>
 *   }
 * }} PdfJs
 */

/** @type {Promise<PdfJs> | null} */
let loading = null;

async function loadPdfJs() {
  if (!loading) {
    loading = import(/* @vite-ignore */ PDFJS_MODULE_URL)
      .then((mod) => {
        const pdfjs = /** @type {PdfJs} */ (mod);
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return pdfjs;
      })
      .catch(() => {
        loading = null;
        throw new DocumentError(PDF_FAIL);
      });
  }
  return loading;
}

/**
 * @param {string} line
 */
function isPageFurniture(line) {
  return /^\d{1,4}$/.test(line) || /^page\s+\d+$/i.test(line) || /^[-–—]\s*\d+\s*[-–—]$/.test(line);
}

/**
 * @param {PdfItem[]} items
 */
export function textFromPdfItems(items) {
  const positioned = [];
  for (const item of items || []) {
    if (!item || typeof item.str !== 'string' || !item.str) continue;
    positioned.push({
      str: item.str,
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
      width: item.width ?? 0
    });
  }
  positioned.sort((a, b) => b.y - a.y || a.x - b.x);

  /** @type {{ y: number, items: typeof positioned }[]} */
  const lines = [];
  for (const item of positioned) {
    const line = lines[lines.length - 1];
    if (!line || Math.abs(line.y - item.y) > 2) lines.push({ y: item.y, items: [item] });
    else line.items.push(item);
  }

  /** @type {string[]} */
  const parts = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let text = '';
    /** @type {(typeof positioned)[number] | null} */
    let last = null;
    for (const item of line.items) {
      if (last) {
        const gap = item.x - (last.x + last.width);
        const hyphen = /-$/.test(text) && /^[a-z]/.test(item.str);
        if (hyphen) text = text.slice(0, -1);
        else if (gap > 1 || (!last.width && !text.endsWith(' ') && !item.str.startsWith(' '))) {
          text += ' ';
        }
      }
      text += item.str;
      last = item;
    }
    const trimmed = text.replace(/[ \t]+/g, ' ').trim();
    if (trimmed && !isPageFurniture(trimmed)) parts.push(trimmed);
  }

  for (let i = 0; i < parts.length - 1; i += 1) {
    if (/-$/.test(parts[i]) && /^[a-z]/.test(parts[i + 1])) {
      parts[i] = parts[i].slice(0, -1) + parts[i + 1];
      parts.splice(i + 1, 1);
      i -= 1;
    }
  }
  return parts.join('\n');
}

/**
 * @param {File} file
 */
export async function textFromPdfFile(file) {
  const pdfjs = await loadPdfJs();
  const data = await file.arrayBuffer();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data }).promise;
  } catch {
    throw new DocumentError(PDF_FAIL);
  }
  try {
    const pageCount = Math.min(doc.numPages || 0, 2000);
    /** @type {string[]} */
    const pages = [];
    for (let i = 1; i <= pageCount; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = textFromPdfItems(content.items);
      if (text) pages.push(text);
    }
    return pages.join('\n\n');
  } catch {
    throw new DocumentError(PDF_FAIL);
  } finally {
    if (typeof doc.destroy === 'function') {
      try {
        await doc.destroy();
      } catch {
        /* The words are already copied out. */
      }
    }
  }
}
