/**
 * Document loader — turns a File (dropped or selected) into an
 * attachment object the chat can pass to the LLM.
 *
 * Supported:
 *   - Anything with a `text/*` MIME type (UTF-8 read directly).
 *   - JSON, XML, common code/config file extensions.
 *   - PDF — extracted with pdf.js, loaded lazily from a CDN the first
 *     time someone drops a PDF. The worker uses the bundled .mjs from
 *     the same version so document parsing stays fast.
 *
 * Hermes-3 8B has plenty of context (Llama-3.1 base = 128k tokens) but
 * WebLLM's q4f16_1 build is configured for a much smaller window. We
 * cap extracted content at MAX_TEXT_CHARS so a 500-page PDF doesn't
 * OOM the model. Anything past the cap is marked `truncated: true`
 * and we surface that to the user in the chip + to the model in the
 * attachment header.
 */

/**
 * Lazy import URL — pinned so the worker matches.
 *
 * 4.10.38 is the last 4.x release; pdf.js v5 drops a few legacy
 * features (DOM Matrix worker constructor, options shape changes) and
 * I'd rather upgrade deliberately than chase its breakage on a Friday.
 * `esm.run` resolves the version and serves the ESM build directly.
 */
const PDFJS_VERSION = '4.10.38';
const PDFJS_MODULE_URL = `https://esm.run/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`;
const PDFJS_WORKER_URL = `https://esm.run/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;

/**
 * Conservative limits so a single document never blows past the model's
 * context window.
 *
 * The Hermes-3-Llama-3.1-8B q4f16_1 WebLLM build ships with a 4096-token
 * `context_window_size`. The base model supports 128k, but the prebuilt
 * MLC artifact bakes the smaller window for GPU-memory reasons. After
 * the system prompt (~600 tokens incl. the apps catalog), a couple of
 * prior turns, and ~500 tokens reserved for the assistant's reply, we
 * have roughly ~2500 tokens of headroom for the user's message —
 * about 8–9 KB of English text.
 *
 * 6000 chars (≈1500 tokens) keeps room for the user's typed question
 * plus a few earlier turns of history without overflowing.
 */
const MAX_TEXT_CHARS = 6000;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB filesystem-side cap; PDFs are often big.

/**
 * Extensions we'll treat as text-with-no-MIME-type. Browsers don't
 * always set a useful mime for code files dropped from Finder/Explorer.
 */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.rst', '.log', '.csv', '.tsv', '.json',
  '.xml', '.html', '.htm', '.svg', '.yml', '.yaml', '.toml', '.ini',
  '.cfg', '.conf', '.env',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss', '.less',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cc',
  '.cpp', '.cxx', '.h', '.hpp', '.cs', '.php', '.lua', '.r', '.scala',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.gql', '.graphql', '.proto'
]);

/**
 * @typedef {Object} Attachment
 * @property {string} name
 * @property {'text'|'pdf'} kind
 * @property {number} size                Original file size in bytes.
 * @property {number} [pages]             PDF page count, when applicable.
 * @property {boolean} truncated          True when content was clipped at MAX_TEXT_CHARS.
 * @property {number} [originalLength]    Total extracted-text length before truncation.
 * @property {string} [content]           Extracted text. Stripped before persistence.
 */

/**
 * Load a single dropped/selected File into an Attachment. Throws with
 * a user-friendly message when the file is unsupported or too large.
 *
 * @param {File} file
 * @returns {Promise<Attachment>}
 */
export async function loadDocument(file) {
  if (!file) throw new Error('No file provided.');
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`File too large (${mb} MB). Cap is ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }

  const name = file.name || 'untitled';
  const ext = fileExtension(name);
  const mime = (file.type || '').toLowerCase();

  if (mime === 'application/pdf' || ext === '.pdf') {
    return loadPdf(file);
  }

  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    TEXT_EXTENSIONS.has(ext) ||
    // Empty MIME + small file = try-as-text. Most code files Finder
    // hands us have no MIME and a recognizable extension; some have
    // no extension at all (Dockerfile, Makefile, README) — also fine.
    (!mime && file.size < 2 * 1024 * 1024)
  ) {
    return loadText(file);
  }

  throw new Error(
    `Unsupported file type${mime ? ` (${mime})` : ''}. Try .txt, .md, .json, .csv, code files, or a PDF.`
  );
}

/**
 * @param {File} file
 * @returns {Promise<Attachment>}
 */
async function loadText(file) {
  const raw = await file.text();
  // Strip null bytes — if they're in there, this is probably a
  // binary file pretending to be text. We trim instead of refusing
  // because some text files have stray NULs and they break the LLM
  // tokenizer if left in.
  const text = raw.replace(/\0/g, '');
  const originalLength = text.length;
  const truncated = originalLength > MAX_TEXT_CHARS;
  return {
    name: file.name,
    kind: 'text',
    size: file.size,
    truncated,
    originalLength,
    content: truncated ? text.slice(0, MAX_TEXT_CHARS) : text
  };
}

/** @type {Promise<any> | null} */
let pdfjsModulePromise = null;
async function loadPdfJs() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = (async () => {
      try {
        const mod = await import(/* @vite-ignore */ PDFJS_MODULE_URL);
        mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return mod;
      } catch (err) {
        pdfjsModulePromise = null;
        const msg = err && /** @type {Error} */ (err).message;
        throw new Error(`PDF support unavailable: ${msg || err}`);
      }
    })();
  }
  return pdfjsModulePromise;
}

/**
 * @param {File} file
 * @returns {Promise<Attachment>}
 */
async function loadPdf(file) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  /** @type {any} */
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = doc.numPages;

  /** @type {string[]} */
  const chunks = [];
  let totalChars = 0;
  let truncated = false;
  for (let i = 1; i <= pages; i += 1) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items
      .map((/** @type {any} */ it) => (typeof it.str === 'string' ? it.str : ''))
      .join(' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
    chunks.push(`--- Page ${i} ---\n${text}`);
    totalChars += text.length;
    if (totalChars >= MAX_TEXT_CHARS) {
      truncated = true;
      break;
    }
  }

  return {
    name: file.name,
    kind: 'pdf',
    size: file.size,
    pages,
    truncated,
    originalLength: totalChars,
    content: chunks.join('\n\n')
  };
}

function fileExtension(name) {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx).toLowerCase();
}

/**
 * Build the text the LLM should see for one attachment. Includes a
 * header with filename + truncation note so the model knows what it's
 * looking at and whether content is incomplete.
 *
 * @param {Attachment} a
 * @returns {string}
 */
export function formatAttachmentForModel(a) {
  if (!a || !a.content) return '';
  const header = [
    `filename: ${a.name}`,
    `type: ${a.kind === 'pdf' ? `PDF, ${a.pages || '?'} page(s)` : 'text'}`,
    a.truncated
      ? `note: truncated — only the first ${a.content.length} characters of ${a.originalLength || '?'} are shown`
      : null
  ]
    .filter(Boolean)
    .join('\n');
  return [
    '--- Attached document ---',
    header,
    '',
    a.content,
    '--- End of document ---'
  ].join('\n');
}

/**
 * Strip the heavy `content` field so an attachment can be persisted
 * to localStorage without taking ~30 KB per message.
 *
 * @param {Attachment} a
 * @returns {Attachment}
 */
export function stripContentForPersistence(a) {
  const { content, ...rest } = a;
  return rest;
}

/** Human-readable size for the chip UI. @param {number} bytes */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
