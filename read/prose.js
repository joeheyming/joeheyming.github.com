const MAX_BYTES = 20 * 1024 * 1024;

export const TOO_BIG = 'That file is too large to open here.';
export const UNSUPPORTED = 'Save it as text or PDF first.';
export const EMPTY = 'No words to read in that file.';
export const SCAN = 'This PDF has no text to read. It may be a scan.';
export const PDF_FAIL = 'This PDF could not be opened.';
export const NO_SPEECH = 'This browser has no speaking voice.';
export const NOTHING_ALOUD = 'Nothing on this page to read aloud.';

const UNSUPPORTED_EXT = new Set(['.doc', '.docx', '.epub', '.rtf', '.odt', '.pages', '.mobi']);
const TEXT_EXT = new Set([
  '.txt',
  '.text',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.rst',
  '.log',
  '.csv'
]);

export class DocumentError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'DocumentError';
  }
}

/**
 * @param {string} name
 */
export function titleFromName(name) {
  const base = String(name || 'Document').replace(/^.*[/\\]/, '');
  const stripped = base.replace(/\.[^.]+$/, '');
  const title = stripped.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return title || 'Document';
}

/**
 * @param {string} name
 */
export function extensionOf(name) {
  const base = String(name || '').toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot);
}

/**
 * Words a voice should say. Addresses are left out.
 * @param {string} text
 */
export function spokenText(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text
 */
function hasWords(text) {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * @param {string} text
 */
function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/**
 * @param {{ type: string, level?: number, text: string }[]} blocks
 * @param {string} text
 */
function pushParagraph(blocks, text) {
  const clean = spokenText(decodeEntities(text));
  if (!hasWords(clean)) return;
  blocks.push({ type: 'paragraph', text: clean });
}

/**
 * @param {{ type: string, level?: number, text: string }[]} blocks
 * @param {string} text
 * @param {number} level
 */
function pushHeading(blocks, text, level) {
  const clean = spokenText(decodeEntities(text));
  if (!hasWords(clean)) return;
  blocks.push({ type: 'heading', level, text: clean });
}

/**
 * @param {string} text
 */
function inlineMarkdown(text) {
  let s = text;
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  s = s.replace(/<(https?:\/\/[^>\s]+)>/gi, '');
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1$2');
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, '$1$2');
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  s = s.replace(/\\([\\`*_{}[\]()#+.!|-])/g, '$1');
  return s;
}

/**
 * Headings and paragraphs. Fences, markers, and addresses are dropped.
 * @param {string} source
 */
export function blocksFromMarkdown(source) {
  let text = String(source || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  text = text.replace(/^---\n[\s\S]*?\n---\n*/, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/```[^\n]*\n[\s\S]*?```/g, '\n');
  text = text.replace(/~~~[^\n]*\n[\s\S]*?~~~/g, '\n');

  const lines = text.split('\n');
  /** @type {{ type: string, level?: number, text: string }[]} */
  const blocks = [];
  /** @type {string[]} */
  let para = [];

  const flush = () => {
    if (!para.length) return;
    pushParagraph(blocks, inlineMarkdown(para.join(' ')));
    para = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed === '```' || trimmed === '~~~') {
      flush();
      continue;
    }
    if (/^\[[^\]]+\]:\s+\S+/.test(trimmed)) {
      flush();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      pushHeading(blocks, inlineMarkdown(heading[2]), heading[1].length);
      continue;
    }
    const next = (lines[i + 1] || '').trim();
    if (/^=+$/.test(next)) {
      flush();
      pushHeading(blocks, inlineMarkdown(trimmed), 1);
      i += 1;
      continue;
    }
    if (/^-+$/.test(next) && !/^[-*+] /.test(trimmed)) {
      flush();
      pushHeading(blocks, inlineMarkdown(trimmed), 2);
      i += 1;
      continue;
    }
    if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) continue;
    if (trimmed.includes('|') && /^\|?.+\|.+\|?$/.test(trimmed)) {
      flush();
      const cells = trimmed
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => inlineMarkdown(cell))
        .filter((cell) => hasWords(spokenText(cell)));
      if (cells.length) pushParagraph(blocks, cells.join(', '));
      continue;
    }
    const item = /^(?:>\s*)*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(trimmed);
    if (item) {
      flush();
      pushParagraph(blocks, inlineMarkdown(item[1]));
      continue;
    }
    const quote = /^(?:>\s*)+(.*)$/.exec(trimmed);
    para.push(quote ? quote[1] : trimmed);
  }
  flush();
  return blocks;
}

const HTML_SKIP = new Set([
  'script',
  'style',
  'noscript',
  'svg',
  'canvas',
  'iframe',
  'template',
  'head',
  'nav',
  'footer',
  'aside',
  'pre'
]);

const HTML_BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,dd,dt,figcaption,td,th';

/**
 * @param {Element} node
 * @param {{ type: string, level?: number, text: string }[]} blocks
 */
function walkHtml(node, blocks) {
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();
  if (HTML_SKIP.has(tag)) return;
  if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return;
  if (/^h[1-6]$/.test(tag)) {
    pushHeading(blocks, node.textContent || '', Number(tag[1]));
    return;
  }
  const nested = node.querySelector(HTML_BLOCKS);
  const leaf = /^(p|li|blockquote|dd|dt|figcaption|td|th)$/.test(tag);
  if (leaf && !nested) {
    pushParagraph(blocks, node.textContent || '');
    return;
  }
  if (!node.children.length) {
    pushParagraph(blocks, node.textContent || '');
    return;
  }
  for (const child of node.children) walkHtml(child, blocks);
}

/**
 * @param {string} source
 * @param {typeof DOMParser} [Parser]
 */
export function blocksFromHtml(source, Parser = globalThis.DOMParser) {
  const doc = new Parser().parseFromString(String(source || ''), 'text/html');
  /** @type {{ type: string, level?: number, text: string }[]} */
  const blocks = [];
  if (doc.body) walkHtml(doc.body, blocks);
  return blocks;
}

/**
 * @param {string} source
 */
export function blocksFromPlain(source) {
  const text = String(source || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  /** @type {{ type: string, level?: number, text: string }[]} */
  const blocks = [];
  for (const raw of text.split(/\n{2,}/)) pushParagraph(blocks, raw.replace(/\n/g, ' '));
  return blocks;
}

/**
 * @param {string} name
 * @param {string} mime
 * @param {string} raw
 */
function detectKind(name, mime, raw) {
  const ext = extensionOf(name);
  const type = (mime || '').toLowerCase();
  if (ext === '.md' || ext === '.markdown' || type === 'text/markdown') return 'markdown';
  if (
    ext === '.html' ||
    ext === '.htm' ||
    type === 'text/html' ||
    /^\s*<(!doctype|html|body)\b/i.test(raw)
  ) {
    return 'html';
  }
  return 'plain';
}

/**
 * @param {File} file
 * @param {{ maxBytes?: number, readPdf?: (file: File) => Promise<string> }} [options]
 */
export async function blocksFromFile(file, options = {}) {
  const name = file?.name || 'Document';
  const ext = extensionOf(name);
  const mime = (file?.type || '').toLowerCase();
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  if (!file || file.size > maxBytes) throw new DocumentError(TOO_BIG);
  if (UNSUPPORTED_EXT.has(ext)) throw new DocumentError(UNSUPPORTED);

  const title = titleFromName(name);
  if (ext === '.pdf' || mime === 'application/pdf') {
    const readPdf = options.readPdf || defaultReadPdf;
    const text = await readPdf(file);
    const blocks = blocksFromPlain(text);
    if (!blocks.length) throw new DocumentError(SCAN);
    return { title, blocks };
  }

  const textLike =
    mime.startsWith('text/') ||
    TEXT_EXT.has(ext) ||
    mime === 'application/xhtml+xml' ||
    (!mime && !ext);
  if (!textLike) throw new DocumentError(UNSUPPORTED);

  const raw = await file.text();
  if (raw.includes('\0')) throw new DocumentError(UNSUPPORTED);
  const kind = detectKind(name, mime, raw);
  const blocks =
    kind === 'html'
      ? blocksFromHtml(raw)
      : kind === 'markdown'
      ? blocksFromMarkdown(raw)
      : blocksFromPlain(raw);
  if (!blocks.length) throw new DocumentError(EMPTY);
  return { title, blocks };
}

/**
 * @param {File} file
 */
async function defaultReadPdf(file) {
  const { textFromPdfFile } = await import('./pdf-text.js');
  return textFromPdfFile(file);
}

const ABBREV = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|vs|etc|e\.g|i\.e)\./gi;

/**
 * Short pieces so a browser voice does not cut an utterance off.
 * @param {string} text
 * @param {number} [maxChars]
 */
export function speechChunks(text, maxChars = 160) {
  const clean = spokenText(text);
  if (!clean) return [];
  const masked = clean.replace(ABBREV, (match) => `${match.slice(0, -1)}\uE000`);
  const sentences = masked
    .split(/(?<=[.!?])["'”’)]*\s+(?=[A-Z“"])/u)
    .map((sentence) => sentence.replace(/\uE000/g, '.').trim())
    .filter(Boolean);

  /** @type {string[]} */
  const chunks = [];
  let buf = '';
  const emit = (part) => {
    if (part) chunks.push(part);
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      emit(buf);
      buf = '';
      for (const piece of splitLong(sentence, maxChars)) emit(piece);
      continue;
    }
    if (buf && buf.length + 1 + sentence.length > maxChars) {
      emit(buf);
      buf = sentence;
    } else {
      buf = buf ? `${buf} ${sentence}` : sentence;
    }
  }
  emit(buf);
  return chunks;
}

/**
 * @param {string} sentence
 * @param {number} maxChars
 */
function splitLong(sentence, maxChars) {
  /** @type {string[]} */
  const out = [];
  let buf = '';
  for (const part of sentence.split(/(?<=[,;:—–-])\s+/)) {
    if (part.length > maxChars) {
      if (buf) out.push(buf);
      buf = '';
      for (let i = 0; i < part.length; i += maxChars) {
        const slice = part.slice(i, i + maxChars).trim();
        if (slice) out.push(slice);
      }
      continue;
    }
    if (buf && buf.length + 1 + part.length > maxChars) {
      out.push(buf);
      buf = part;
    } else {
      buf = buf ? `${buf} ${part}` : part;
    }
  }
  if (buf) out.push(buf);
  return out;
}
