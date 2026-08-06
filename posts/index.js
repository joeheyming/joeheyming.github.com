import { CONFIG, isConfigured } from './config.js';
import { assertImagesSafe, isImageAttachment } from './moderate.js';
import { encodeAttachments, formBodyByteLength } from './upload.js';
import { loadDraft } from './share-client.js';

const DEMO_KEY = 'posts-demo-v1';
const ATTACHMENT_CHUNK_PREFIX = 'posts-attachment-chunk-v1';
const NOTE_COLORS = ['#fff3a6', '#ffd6e7', '#cceeff', '#d9f7be', '#ffe0b5', '#e4d7ff'];

/**
 * @typedef {{
 *   id: string,
 *   ts: number,
 *   text: string,
 *   attachments: Array<string|{blob?: Blob, url: string, revoke?: boolean}>,
 *   email: string,
 *   x?: number,
 *   y?: number,
 *   draft?: boolean,
 *   pending?: boolean
 * }} Post
 */

/** @type {Post[]} */
let posts = [];
/** @type {string|null} */
let activeDraftId = null;
/** @type {ReturnType<typeof setTimeout>|null} */
let statusTimer = null;

const els = {
  setupBanner: document.getElementById('setup-banner'),
  board: document.getElementById('board'),
  empty: document.getElementById('board-empty'),
  add: document.getElementById('add-note'),
  refresh: document.getElementById('refresh-btn'),
  status: document.getElementById('board-status'),
  file: document.getElementById('note-file'),
  honeypot: document.getElementById('note-honeypot'),
  lightbox: document.getElementById('lightbox'),
  lightboxImg: document.getElementById('lightbox-img')
};

const configured = isConfigured();

init();

async function init() {
  els.add?.addEventListener('click', () => createDraftNote());
  setupBoardPlacement();
  els.refresh?.addEventListener('click', () => {
    if (configured) pollFeed();
    else {
      const drafts = posts.filter((p) => p.draft);
      posts = [...drafts, ...loadDemoPosts()];
      renderBoard();
      setStatus('Board refreshed');
    }
  });
  els.file?.addEventListener('change', onFilesPicked);
  document.addEventListener('paste', onPaste);
  setupDropTargets();
  setupLightbox();

  const params = new URLSearchParams(window.location.search);
  const wantsCompose = params.get('compose') === '1';
  if (wantsCompose) history.replaceState({}, '', '/posts/');

  const draft = await loadDraft();
  if (draft) {
    await createDraftNote({
      text: draft.text || '',
      email: draft.email || '',
      attachments: draft.attachments || draft.images || []
    });
  } else if (wantsCompose) {
    createDraftNote();
  }

  if (!configured) {
    if (els.setupBanner) els.setupBanner.hidden = false;
    const drafts = posts.filter((p) => p.draft);
    posts = [...drafts, ...loadDemoPosts()];
    renderBoard();
    return;
  }

  await pollFeed();
  setInterval(() => {
    pollFeed().catch(() => {});
  }, CONFIG.pollIntervalMs);
}

/**
 * @param {{ text?: string, email?: string, attachments?: Array<string|Blob>, x?: number, y?: number }} [seed]
 */
async function createDraftNote(seed = {}) {
  const metadata = createPostMetadata(seed.x, seed.y);
  /** @type {Post} */
  const note = {
    id: metadata.id,
    ts: Date.now(),
    text: typeof seed.text === 'string' ? seed.text : '',
    email: typeof seed.email === 'string' ? seed.email : '',
    attachments: [],
    x: metadata.x,
    y: metadata.y,
    draft: true
  };

  const sources = Array.isArray(seed.attachments) ? seed.attachments : [];
  for (const src of sources.slice(0, CONFIG.maxAttachmentsPerPost)) {
    await addAttachmentToNote(note, src);
  }

  posts = [note, ...posts.filter((p) => p.id !== note.id)];
  activeDraftId = note.id;
  renderBoard();
  focusDraft(note.id);
  setStatus('Edit the note, then pin it');
}

/** @type {{ pointerId: number, x: number, y: number, moved: boolean }|null} */
let boardPlaceGesture = null;

function setupBoardPlacement() {
  if (!els.board) return;

  els.board.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('.post, button, a, input, textarea, audio, video, dialog')) return;
    boardPlaceGesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false
    };
  });

  els.board.addEventListener('pointermove', (event) => {
    if (!boardPlaceGesture || event.pointerId !== boardPlaceGesture.pointerId) return;
    if (Math.hypot(event.clientX - boardPlaceGesture.x, event.clientY - boardPlaceGesture.y) > 8) {
      boardPlaceGesture.moved = true;
    }
  });

  const finishPlace = (event) => {
    if (!boardPlaceGesture || event.pointerId !== boardPlaceGesture.pointerId) return;
    const gesture = boardPlaceGesture;
    boardPlaceGesture = null;
    if (gesture.moved) return;
    if (event.target instanceof Element && event.target.closest('.post')) return;
    const point = boardPointFromClient(gesture.x, gesture.y);
    if (!point) return;
    void createDraftNote({ x: point.x, y: point.y });
  };

  els.board.addEventListener('pointerup', finishPlace);
  els.board.addEventListener('pointercancel', () => {
    boardPlaceGesture = null;
  });
}

function boardPointFromClient(clientX, clientY) {
  const surface =
    els.board?.querySelector('.board-surface') || /** @type {HTMLElement|null} */ (els.board);
  if (!surface) return null;
  const rect = surface.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    x: clampCoordinate((clientX - rect.left) / rect.width, 0.5),
    y: clampCoordinate((clientY - rect.top) / rect.height, 0.5)
  };
}

function focusDraft(id) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = els.board?.querySelector(`[data-post-id="${CSS.escape(id)}"] textarea`);
      if (el instanceof HTMLTextAreaElement) {
        el.focus({ preventScroll: true });
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  });
}

async function addAttachmentToNote(note, src) {
  if (note.attachments.length >= CONFIG.maxAttachmentsPerPost) {
    setStatus(`Max ${CONFIG.maxAttachmentsPerPost} attachment per note`, true);
    return;
  }
  if (typeof src === 'string' && /^https?:\/\//i.test(src)) {
    note.attachments.push({ url: src.trim() });
    return;
  }
  if (typeof src === 'string' && src.startsWith('data:')) {
    const blob = await (await fetch(src)).blob();
    const url = URL.createObjectURL(blob);
    note.attachments.push({ blob, url, revoke: true });
    return;
  }
  if (src instanceof Blob) {
    const url = URL.createObjectURL(src);
    note.attachments.push({ blob: src, url, revoke: true });
  }
}

function onFilesPicked() {
  const note = posts.find((p) => p.id === activeDraftId && p.draft);
  const files = [...(els.file?.files || [])];
  if (els.file) els.file.value = '';
  if (!note) return;
  void addFilesToDraft(note, files);
}

async function addFilesToDraft(note, files) {
  let added = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/') && !file.type.startsWith('audio/')) continue;
    const before = note.attachments.length;
    await addAttachmentToNote(note, file);
    if (note.attachments.length > before) added += 1;
  }
  renderBoard();
  focusDraft(note.id);
  if (added) setStatus(added === 1 ? 'Attachment added' : `${added} attachments added`);
  else if (files.length) setStatus('Drop image or audio attachments only', true);
}

/**
 * @param {DataTransfer|null|undefined} dataTransfer
 * @returns {File[]}
 */
function filesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return [];
  const listed = [...(dataTransfer.files || [])];
  if (listed.length) return listed;
  return [...(dataTransfer.items || [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function isAttachmentDrop(dataTransfer) {
  if (!dataTransfer) return false;
  if ([...(dataTransfer.files || [])].length > 0) return true;
  return [...(dataTransfer.types || [])].some(
    (type) => type === 'Files' || type.startsWith('image/') || type.startsWith('audio/')
  );
}

function clearDropHighlights() {
  els.board?.classList.remove('drop-target');
  els.board?.querySelectorAll('.post.drop-target').forEach((el) => {
    el.classList.remove('drop-target');
  });
}

function setupDropTargets() {
  if (!els.board) return;

  els.board.addEventListener('dragenter', (event) => {
    if (!isAttachmentDrop(event.dataTransfer)) return;
    event.preventDefault();
    highlightDropTarget(event);
  });

  els.board.addEventListener('dragover', (event) => {
    if (!isAttachmentDrop(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    highlightDropTarget(event);
  });

  els.board.addEventListener('dragleave', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target === els.board || event.target.classList.contains('board-surface')) {
      clearDropHighlights();
    }
    const draft = event.target.closest?.('.post.draft');
    if (draft && !draft.contains(/** @type {Node} */ (event.relatedTarget))) {
      draft.classList.remove('drop-target');
    }
  });

  els.board.addEventListener('drop', (event) => {
    if (!isAttachmentDrop(event.dataTransfer)) return;
    event.preventDefault();
    clearDropHighlights();
    const files = filesFromDataTransfer(event.dataTransfer);
    if (!files.length) {
      setStatus('Drop image or audio attachments only', true);
      return;
    }
    void handleAttachmentDrop(event, files);
  });

  window.addEventListener('dragend', clearDropHighlights);
}

/**
 * @param {DragEvent} event
 */
function highlightDropTarget(event) {
  clearDropHighlights();
  const draft = event.target instanceof Element ? event.target.closest('.post.draft') : null;
  if (draft) {
    draft.classList.add('drop-target');
    return;
  }
  els.board?.classList.add('drop-target');
}

/**
 * @param {DragEvent} event
 * @param {File[]} files
 */
async function handleAttachmentDrop(event, files) {
  const draftEl = event.target instanceof Element ? event.target.closest('.post.draft') : null;
  if (draftEl) {
    const note = posts.find((p) => p.id === draftEl.dataset.postId && p.draft);
    if (note) {
      activeDraftId = note.id;
      await addFilesToDraft(note, files);
      return;
    }
  }

  const point = boardPointFromClient(event.clientX, event.clientY) || undefined;
  await createDraftNote({
    x: point?.x,
    y: point?.y,
    attachments: files.slice(0, CONFIG.maxAttachmentsPerPost)
  });
  setStatus('Dropped onto a new note');
}

/**
 * True when paste belongs to some other page control (nav search, etc.).
 * Draft note fields are ours to handle for attachments.
 * @param {EventTarget|null} target
 */
function isForeignEditable(target) {
  if (!(target instanceof Element)) return false;
  const editable = target.closest(
    'textarea, input:not([type="file"]):not([type="hidden"]), [contenteditable="true"]'
  );
  if (!editable) return false;
  if (editable.closest('.post.draft')) return false;
  if (editable.id === 'note-honeypot') return false;
  return true;
}

async function onPaste(e) {
  if (!e.clipboardData) return;
  if (isForeignEditable(e.target)) return;

  const files = filesFromDataTransfer(e.clipboardData).filter(
    (file) => file.type.startsWith('image/') || file.type.startsWith('audio/')
  );

  if (files.length) {
    e.preventDefault();
    const note = posts.find((p) => p.id === activeDraftId && p.draft);
    if (!note) {
      await createDraftNote({
        attachments: files.slice(0, CONFIG.maxAttachmentsPerPost)
      });
      setStatus('Pasted onto a new note');
      return;
    }
    await addFilesToDraft(note, files);
    return;
  }

  // Native paste into the draft textarea/name field.
  if (e.target instanceof Element && e.target.closest('.post.draft textarea, .post.draft input')) {
    return;
  }

  const text = e.clipboardData.getData('text/plain');
  if (!text) return;

  e.preventDefault();
  const note = posts.find((p) => p.id === activeDraftId && p.draft);
  if (!note) {
    await createDraftNote({ text });
    setStatus('Pasted onto a new note');
    return;
  }
  note.text = note.text ? `${note.text}${text}` : text;
  renderBoard();
  focusDraft(note.id);
  setStatus('Text pasted');
}

function discardDraft(note) {
  for (const item of note.attachments) {
    if (item && typeof item === 'object' && item.revoke) URL.revokeObjectURL(item.url);
  }
  posts = posts.filter((p) => p.id !== note.id);
  if (activeDraftId === note.id) activeDraftId = null;
  renderBoard();
  setStatus('Draft discarded');
}

async function pinDraft(note) {
  if (els.honeypot?.value.trim()) {
    setStatus('Thanks!');
    return;
  }
  const text = note.text.trim();
  if (!text && note.attachments.length === 0) {
    setStatus('Write something or add an attachment', true);
    return;
  }

  setStatus(note.attachments.length ? 'Encoding attachments…' : 'Pinning…');
  try {
    const rawInputs = note.attachments.map((item) =>
      typeof item === 'string' ? item : item.blob || item.url
    );
    const hasAudio = rawInputs.some(
      (item) =>
        (item instanceof Blob && item.type.startsWith('audio/')) ||
        (typeof item === 'string' && item.startsWith('data:audio/'))
    );
    const attachmentUrls = await encodeAttachments(rawInputs, {
      maxEdge: CONFIG.maxAttachmentEdge,
      quality: CONFIG.jpegQuality,
      max: CONFIG.maxAttachmentsPerPost,
      maxTotalChars: hasAudio ? CONFIG.maxAudioAttachmentFieldChars : CONFIG.maxAttachmentFieldChars
    });

    const imageUrls = attachmentUrls.filter(isImageAttachment);
    if (imageUrls.length) {
      setStatus('Checking image…');
      await assertImagesSafe(imageUrls);
    }

    const metadata = {
      id: note.id,
      action: 'post',
      x: note.x,
      y: note.y
    };
    const formBodies = buildFormBodies(text, attachmentUrls, note.email.trim(), metadata);
    for (const body of formBodies) assertFormBodyFits(body);

    const published = {
      id: note.id,
      ts: Date.now(),
      text,
      attachments: attachmentUrls,
      email: note.email.trim(),
      x: note.x,
      y: note.y,
      pending: true
    };

    if (configured) {
      for (let i = 0; i < formBodies.length; i++) {
        if (formBodies.length > 1) {
          setStatus(`Pinning attachment chunk ${i + 1} of ${formBodies.length}…`);
        }
        await submitToForm(formBodies[i]);
      }
    } else {
      const demo = loadDemoPosts();
      demo.unshift({ ...published, pending: false });
      saveDemoPosts(demo);
    }

    for (const item of note.attachments) {
      if (item && typeof item === 'object' && item.revoke) URL.revokeObjectURL(item.url);
    }

    posts = [
      published,
      ...posts.filter((p) => p.id !== note.id && !(p.draft === false && p.id === note.id))
    ];
    activeDraftId = null;
    if (!configured) {
      const drafts = posts.filter((p) => p.draft);
      posts = [...drafts, ...loadDemoPosts()];
    }
    renderBoard();
    setStatus(
      configured ? 'Pinned — may take a few seconds for everyone' : 'Pinned (demo — local only)'
    );
    window.trackEvent?.('posts_submit', 'Engagement', String(attachmentUrls.length));
  } catch (err) {
    console.error(err);
    setStatus(err instanceof Error ? err.message : 'Pin failed', true);
  }
}

function buildFormBody(text, attachmentUrls, email, metadata = null) {
  const body = new URLSearchParams();
  body.set(CONFIG.entryIds.text, text);
  body.set(CONFIG.entryIds.attachment, serializeAttachments(attachmentUrls));
  body.set(CONFIG.entryIds.email, email || '');
  body.set(CONFIG.entryIds.metadata, metadata ? JSON.stringify(metadata) : '');
  body.set(CONFIG.entryIds.honeypot, '');
  return body;
}

function buildFormBodies(text, attachmentUrls, email, metadata) {
  const serialized = serializeAttachments(attachmentUrls);
  if (!serialized.startsWith('data:') || serialized.length <= CONFIG.maxAttachmentChunkChars) {
    return [buildFormBody(text, attachmentUrls, email, metadata)];
  }

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const chunks = [];
  for (let offset = 0; offset < serialized.length; offset += CONFIG.maxAttachmentChunkChars) {
    chunks.push(serialized.slice(offset, offset + CONFIG.maxAttachmentChunkChars));
  }

  return chunks.map((chunk, index) => {
    const envelope = `${ATTACHMENT_CHUNK_PREFIX}|${id}|${index}|${chunks.length}|${chunk}`;
    return buildFormBody(
      index === 0 ? text : '',
      [envelope],
      index === 0 ? email : '',
      index === 0 ? metadata : null
    );
  });
}

function createPostMetadata(x, y) {
  return {
    id: `post-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    action: 'post',
    x: Number.isFinite(Number(x))
      ? clampCoordinate(x, 0.5)
      : Number((0.18 + Math.random() * 0.64).toFixed(4)),
    y: Number.isFinite(Number(y))
      ? clampCoordinate(y, 0.5)
      : Number((0.18 + Math.random() * 0.64).toFixed(4))
  };
}

function assertFormBodyFits(body) {
  const bodyBytes = formBodyByteLength(body);
  if (bodyBytes <= CONFIG.maxFormBodyBytes) return;
  throw new Error(`Post chunk too large for Google Forms (${Math.round(bodyBytes / 1024)} KB).`);
}

async function submitToForm(body) {
  await fetch(CONFIG.formActionUrl, {
    method: 'POST',
    mode: 'no-cors',
    body
  });
}

function serializeAttachments(urls) {
  return urls.join('\n');
}

function parseAttachments(raw) {
  if (raw == null || raw === '') return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        return arr
          .map(String)
          .map((u) => u.trim())
          .filter((u) => /^https?:\/\//i.test(u) || u.startsWith('data:'));
      }
    } catch {
      /* fall through */
    }
  }
  return s
    .split(/\n+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u) || u.startsWith('data:'));
}

function parseAttachmentChunk(raw) {
  if (raw == null) return null;
  const match = String(raw).match(/^posts-attachment-chunk-v1\|([^|]+)\|(\d+)\|(\d+)\|([\s\S]*)$/);
  if (!match) return null;
  const index = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index >= total) {
    return null;
  }
  return { id: match[1], index, total, data: match[4] };
}

function parseMetadata(raw) {
  if (raw == null || raw === '') return null;
  try {
    const value = JSON.parse(String(raw));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function positionFor(id, metadata) {
  const fallbackX = (parseInt(hashStr(`${id}:x`), 36) % 6400) / 10000 + 0.18;
  const fallbackY = (parseInt(hashStr(`${id}:y`), 36) % 6400) / 10000 + 0.18;
  return {
    x: clampCoordinate(metadata?.x, fallbackX),
    y: clampCoordinate(metadata?.y, fallbackY)
  };
}

function clampCoordinate(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(0.94, Math.max(0.06, n)) : fallback;
}

function gvizUrl(tab) {
  return `https://docs.google.com/spreadsheets/d/${
    CONFIG.sheetId
  }/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
}

async function fetchTab(tab) {
  const text = await fetch(gvizUrl(tab), { cache: 'no-store' }).then((r) => r.text());
  const m = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!m) throw new Error('gviz parse failed');
  const json = JSON.parse(m[1]);
  if (!json.table || !json.table.rows) return { cols: [], rows: [] };
  const cols = (json.table.cols || []).map((c) => (c && c.label) || '');
  const rows = json.table.rows.map((r) => (r.c || []).map((c) => (c == null ? null : c.v)));
  return { cols, rows };
}

function parseTs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const m = v.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
    if (m) {
      return new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

function colIndex(cols, names) {
  const lower = cols.map((c) => String(c).toLowerCase());
  for (const name of names) {
    const i = lower.findIndex((c) => c.includes(name));
    if (i >= 0) return i;
  }
  return -1;
}

async function pollFeed() {
  const { cols, rows } = await fetchTab(CONFIG.responsesTab);
  const iTs = colIndex(cols, ['timestamp', 'time']);
  const iText = colIndex(cols, ['text', 'post', 'body', 'message']);
  const iAttach = colIndex(cols, [
    'attachment',
    'attachments',
    'images',
    'image',
    'media',
    'photos'
  ]);
  const iEmail = colIndex(cols, ['email', 'e-mail']);
  const iName = colIndex(cols, ['name', 'author']);
  const iMetadata = colIndex(cols, ['metadata']);
  const iHoney = colIndex(cols, ['honeypot', 'comments', 'website', 'spam']);

  const tIdx = iTs >= 0 ? iTs : 0;
  const textIdx = iText >= 0 ? iText : 1;
  const attachIdx = iAttach >= 0 ? iAttach : 2;
  const emailIdx = iName >= 0 ? iName : iEmail >= 0 ? iEmail : 3;
  const metadataIdx = iMetadata >= 0 ? iMetadata : -1;
  const honeyIdx = iHoney >= 0 ? iHoney : 5;

  const remote = [];
  const chunkGroups = new Map();
  const removedIds = new Set();
  const movedPositions = new Map();
  for (const row of rows) {
    const honey = honeyIdx < row.length ? row[honeyIdx] : '';
    if (honey != null && String(honey).trim() !== '') continue;

    const text = textIdx < row.length && row[textIdx] != null ? String(row[textIdx]) : '';
    const rawAttachment = attachIdx < row.length ? row[attachIdx] : '';
    const email = emailIdx < row.length && row[emailIdx] != null ? String(row[emailIdx]) : '';
    const ts = parseTs(tIdx < row.length ? row[tIdx] : null);
    const metadata = parseMetadata(
      metadataIdx >= 0 && metadataIdx < row.length ? row[metadataIdx] : ''
    );
    if (metadata?.action === 'remove' && typeof metadata.targetId === 'string') {
      removedIds.add(metadata.targetId);
      continue;
    }
    if (metadata?.action === 'move' && typeof metadata.targetId === 'string') {
      movedPositions.set(metadata.targetId, positionFor(metadata.targetId, metadata));
      continue;
    }
    const chunk = parseAttachmentChunk(rawAttachment);
    if (chunk) {
      let group = chunkGroups.get(chunk.id);
      if (!group) {
        group = {
          id: chunk.id,
          total: chunk.total,
          chunks: new Array(chunk.total),
          text: '',
          email: '',
          metadata: null,
          ts: ts || Date.now()
        };
        chunkGroups.set(chunk.id, group);
      }
      if (group.total === chunk.total) group.chunks[chunk.index] = chunk.data;
      if (text) group.text = text;
      if (email) group.email = email;
      if (metadata) group.metadata = metadata;
      if (ts && (!group.ts || ts < group.ts)) group.ts = ts;
      continue;
    }

    const attachments = parseAttachments(rawAttachment);
    if (!text && attachments.length === 0) continue;

    const fallbackId = `sheet-${ts}-${hashStr(text + '\n' + attachments.join(','))}`;
    const id = typeof metadata?.id === 'string' && metadata.id ? metadata.id : fallbackId;
    const position = positionFor(id, metadata);
    remote.push({
      id,
      ts: ts || Date.now(),
      text,
      attachments,
      email,
      ...position,
      pending: false
    });
  }

  for (const group of chunkGroups.values()) {
    if (group.chunks.filter((chunk) => typeof chunk === 'string').length !== group.total) continue;
    const attachments = parseAttachments(group.chunks.join(''));
    if (!group.text && attachments.length === 0) continue;
    const fallbackId = `sheet-chunk-${group.id}`;
    const id =
      typeof group.metadata?.id === 'string' && group.metadata.id ? group.metadata.id : fallbackId;
    const position = positionFor(id, group.metadata);
    remote.push({
      id,
      ts: group.ts || Date.now(),
      text: group.text,
      attachments,
      email: group.email,
      ...position,
      pending: false
    });
  }

  for (const post of remote) {
    const moved = movedPositions.get(post.id);
    if (moved) {
      post.x = moved.x;
      post.y = moved.y;
    }
  }

  const visibleRemote = remote.filter((post) => !removedIds.has(post.id));
  visibleRemote.sort((a, b) => b.ts - a.ts);

  const drafts = posts.filter((p) => p.draft);
  const pending = posts.filter((p) => p.pending && !p.draft && !remoteSomeMatch(visibleRemote, p));
  posts = [...drafts, ...pending, ...visibleRemote];
  renderBoard();
  if (activeDraftId) focusDraft(activeDraftId);
}

function remoteSomeMatch(remote, local) {
  return remote.some(
    (r) =>
      r.id === local.id ||
      (r.text === local.text &&
        r.attachments.join('\n') === local.attachments.join('\n') &&
        Math.abs(r.ts - local.ts) < 10 * 60 * 1000)
  );
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function renderBoard() {
  if (!els.board) return;
  const surface = document.createElement('div');
  surface.className = 'board-surface';
  surface.style.minHeight = `${Math.max(
    window.innerHeight,
    720 + Math.ceil(posts.length / 10) * 120
  )}px`;

  if (els.empty) {
    els.empty.hidden = posts.length > 0;
    surface.append(els.empty);
  }

  for (const post of posts) {
    surface.append(post.draft ? renderDraftNote(post) : renderPublishedNote(post));
  }

  els.board.replaceChildren(surface);
}

function styleNote(article, post) {
  const position = positionFor(post.id, post);
  const angle = (parseInt(hashStr(`${post.id}:angle`), 36) % 7) - 3;
  const colorIndex = parseInt(hashStr(`${post.id}:color`), 36) % NOTE_COLORS.length;
  article.dataset.postId = post.id;
  article.tabIndex = 0;
  article.setAttribute(
    'aria-label',
    post.draft
      ? 'Draft note. Use the arrow keys to move it.'
      : 'Pinned note. Use the arrow keys to move it.'
  );
  article.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
  article.style.left = `${position.x * 100}%`;
  article.style.top = `${position.y * 100}%`;
  article.style.setProperty('--tx', `${position.x * -100}%`);
  article.style.setProperty('--ty', `${position.y * -100}%`);
  article.style.setProperty('--rotation', `${angle}deg`);
  article.style.setProperty('--note-color', NOTE_COLORS[colorIndex]);
  attachNoteDragging(article, post);
  attachNoteKeyboardMovement(article, post);
}

function applyNotePosition(article, post) {
  const position = positionFor(post.id, post);
  article.style.left = `${position.x * 100}%`;
  article.style.top = `${position.y * 100}%`;
  article.style.setProperty('--tx', `${position.x * -100}%`);
  article.style.setProperty('--ty', `${position.y * -100}%`);
}

function attachNoteDragging(article, post) {
  let drag = null;

  article.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isInteractiveDragTarget(event.target)) return;
    const surface = article.parentElement;
    if (!surface) return;

    const position = positionFor(post.id, post);
    const surfaceRect = surface.getBoundingClientRect();
    const noteRect = article.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: position.x,
      startY: position.y,
      availableX: Math.max(1, surfaceRect.width - noteRect.width),
      availableY: Math.max(1, surfaceRect.height - noteRect.height),
      moved: false
    };
    article.setPointerCapture(event.pointerId);
  });

  article.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;

    drag.moved = true;
    event.preventDefault();
    article.classList.add('dragging');
    post.x = clampCoordinate(drag.startX + dx / drag.availableX, drag.startX);
    post.y = clampCoordinate(drag.startY + dy / drag.availableY, drag.startY);
    applyNotePosition(article, post);
  });

  const finishDrag = (event, cancelled = false) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const completed = drag;
    drag = null;
    article.classList.remove('dragging');
    if (article.hasPointerCapture(event.pointerId)) article.releasePointerCapture(event.pointerId);
    if (!completed.moved) return;

    if (cancelled) {
      post.x = completed.startX;
      post.y = completed.startY;
      applyNotePosition(article, post);
      return;
    }

    if (post.draft) {
      setStatus('Draft moved');
    } else {
      void persistMove(post, { x: completed.startX, y: completed.startY });
    }
  };

  article.addEventListener('pointerup', (event) => finishDrag(event));
  article.addEventListener('pointercancel', (event) => finishDrag(event, true));
}

function attachNoteKeyboardMovement(article, post) {
  let startingPosition = null;
  let persistTimer = 0;
  const deltas = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }
  };

  article.addEventListener('keydown', (event) => {
    if (event.target !== article || !(event.key in deltas)) return;
    event.preventDefault();

    const delta = deltas[event.key];
    const step = event.shiftKey ? 0.05 : 0.015;
    if (!startingPosition) {
      const position = positionFor(post.id, post);
      startingPosition = { x: position.x, y: position.y };
    }

    const current = positionFor(post.id, post);
    post.x = clampCoordinate(current.x + delta.x * step, current.x);
    post.y = clampCoordinate(current.y + delta.y * step, current.y);
    applyNotePosition(article, post);

    if (post.draft) {
      setStatus('Draft moved');
      startingPosition = null;
      return;
    }

    setStatus('Moving note…');
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      const previousPosition = startingPosition;
      startingPosition = null;
      if (previousPosition) void persistMove(post, previousPosition);
    }, 300);
  });
}

function isInteractiveDragTarget(target) {
  return (
    target instanceof Element &&
    Boolean(target.closest('button, a, input, textarea, audio, video, [contenteditable="true"]'))
  );
}

async function persistMove(post, previousPosition) {
  setStatus('Moving note…');
  try {
    if (configured) {
      const body = buildFormBody('', [], '', {
        action: 'move',
        targetId: post.id,
        x: post.x,
        y: post.y
      });
      assertFormBodyFits(body);
      await submitToForm(body);
    } else {
      const demo = loadDemoPosts().map((item) =>
        item.id === post.id ? { ...item, x: post.x, y: post.y } : item
      );
      saveDemoPosts(demo);
    }
    setStatus('Note moved');
    window.trackEvent?.('posts_move', 'Engagement', post.id);
  } catch (err) {
    console.error(err);
    post.x = previousPosition.x;
    post.y = previousPosition.y;
    renderBoard();
    setStatus('Could not move the note', true);
  }
}

function renderDraftNote(post) {
  const article = document.createElement('article');
  article.className = 'post draft';
  styleNote(article, post);

  const discard = document.createElement('button');
  discard.type = 'button';
  discard.className = 'post-discard';
  discard.textContent = '×';
  discard.title = 'Discard draft';
  discard.setAttribute('aria-label', 'Discard draft');
  discard.addEventListener('click', () => discardDraft(post));

  const editor = document.createElement('div');
  editor.className = 'note-editor';

  const text = document.createElement('textarea');
  text.placeholder = 'Write on this note… (markdown ok)';
  text.maxLength = 8000;
  text.value = post.text;
  text.addEventListener('input', () => {
    post.text = text.value;
  });
  text.addEventListener('focus', () => {
    activeDraftId = post.id;
  });
  article.addEventListener('pointerdown', () => {
    activeDraftId = post.id;
  });

  const thumbs = document.createElement('div');
  thumbs.className = 'note-thumbs';
  renderDraftThumbs(post, thumbs);

  const name = document.createElement('input');
  name.type = 'text';
  name.placeholder = 'Name or email (optional)';
  name.autocomplete = 'name';
  name.value = post.email;
  name.addEventListener('input', () => {
    post.email = name.value;
  });
  name.addEventListener('focus', () => {
    activeDraftId = post.id;
  });

  const actions = document.createElement('div');
  actions.className = 'note-actions';

  const fileBtn = document.createElement('button');
  fileBtn.type = 'button';
  fileBtn.className = 'file-btn';
  fileBtn.textContent = 'Attach';
  fileBtn.title = 'Attach an image or audio file, or drop one on this note';
  fileBtn.addEventListener('click', () => {
    activeDraftId = post.id;
    els.file?.click();
  });

  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'btn primary sm';
  pin.textContent = 'Pin';
  pin.addEventListener('click', () => {
    activeDraftId = post.id;
    void pinDraft(post);
  });

  actions.append(fileBtn, pin);
  editor.append(text, thumbs, name, actions);
  article.append(discard, editor);
  return article;
}

function renderDraftThumbs(post, thumbs) {
  thumbs.replaceChildren();
  post.attachments.forEach((item, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'note-thumb';
    const url = typeof item === 'string' ? item : item.url;
    const isAudio =
      (typeof item !== 'string' && item.blob?.type.startsWith('audio/')) ||
      url.startsWith('data:audio/');
    const preview = document.createElement(isAudio ? 'audio' : 'img');
    preview.src = url;
    if (isAudio) preview.controls = true;
    else preview.alt = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Remove attachment');
    btn.textContent = '×';
    btn.addEventListener('click', () => {
      const removed = post.attachments.splice(i, 1)[0];
      if (removed && typeof removed === 'object' && removed.revoke) {
        URL.revokeObjectURL(removed.url);
      }
      renderBoard();
    });
    wrap.classList.toggle('audio', isAudio);
    wrap.append(preview, btn);
    thumbs.append(wrap);
  });
}

function renderPublishedNote(post) {
  const article = document.createElement('article');
  article.className = 'post' + (post.pending ? ' pending' : '');
  styleNote(article, post);

  const meta = document.createElement('div');
  meta.className = 'post-meta';
  const when = document.createElement('time');
  when.dateTime = new Date(post.ts).toISOString();
  when.textContent = formatWhen(post.ts);
  meta.append(when);
  if (post.email) {
    const em = document.createElement('span');
    em.textContent = post.email;
    meta.append(em);
  }
  if (post.pending) {
    const pend = document.createElement('span');
    pend.textContent = 'sending…';
    meta.append(pend);
  }
  if (!post.pending) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'post-remove';
    remove.textContent = '×';
    remove.title = 'Take this note down';
    remove.setAttribute('aria-label', 'Take this note down');
    remove.addEventListener('click', () => onRemovePost(post, remove));
    meta.append(remove);
  }

  const body = document.createElement('div');
  body.className = 'post-body';
  body.innerHTML = renderMarkdown(post.text || '');

  article.append(meta, body);

  const urls = post.attachments.filter((item) => typeof item === 'string');
  if (urls.length) {
    const gallery = document.createElement('div');
    gallery.className = 'post-attachments';
    for (const src of urls) {
      if (src.startsWith('data:audio/')) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'metadata';
        audio.src = src;
        gallery.append(audio);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'post-attachment-btn';
      btn.setAttribute('aria-label', 'View larger attachment');
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.loading = 'lazy';
      btn.append(img);
      btn.addEventListener('click', () => openLightbox(src));
      gallery.append(btn);
    }
    article.append(gallery);
  }

  return article;
}

async function onRemovePost(post, button) {
  if (
    !window.confirm(
      'Take this note down? Anyone can remove a note—the board uses the honor system.'
    )
  ) {
    return;
  }

  button.disabled = true;
  try {
    if (configured) {
      const body = buildFormBody('', [], '', {
        action: 'remove',
        targetId: post.id
      });
      assertFormBodyFits(body);
      await submitToForm(body);
    } else {
      const demo = loadDemoPosts().filter((item) => item.id !== post.id);
      saveDemoPosts(demo);
    }
    posts = posts.filter((item) => item.id !== post.id);
    renderBoard();
    setStatus('Note taken down');
    window.trackEvent?.('posts_remove', 'Engagement', post.id);
  } catch (err) {
    console.error(err);
    button.disabled = false;
    setStatus('Could not remove the note', true);
  }
}

function setupLightbox() {
  const dialog = els.lightbox;
  if (!dialog) return;
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

function openLightbox(src) {
  if (!els.lightbox || !els.lightboxImg) return;
  els.lightboxImg.src = src;
  if (typeof els.lightbox.showModal === 'function') els.lightbox.showModal();
  else els.lightbox.setAttribute('open', '');
}

function renderMarkdown(text) {
  const md = window.marked;
  const purify = window.DOMPurify;
  if (md && purify) {
    try {
      return purify.sanitize(md.parse(text, { breaks: true, gfm: true }));
    } catch {
      /* fall through */
    }
  }
  const el = document.createElement('div');
  el.textContent = text;
  return el.innerHTML.replace(/\n/g, '<br>');
}

function formatWhen(ts) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

function setStatus(msg, isError = false) {
  if (!els.status) return;
  if (statusTimer) clearTimeout(statusTimer);
  els.status.textContent = msg;
  els.status.classList.toggle('error', Boolean(isError));
  els.status.classList.toggle('is-visible', Boolean(msg));
  if (msg) {
    statusTimer = setTimeout(() => {
      els.status.classList.remove('is-visible');
    }, 4200);
  }
}

function loadDemoPosts() {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDemoPosts(list) {
  localStorage.setItem(DEMO_KEY, JSON.stringify(list.slice(0, 100)));
}
