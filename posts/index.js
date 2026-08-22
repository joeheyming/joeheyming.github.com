import { CONFIG, isConfigured } from './config.js';
import { assertImagesSafe, assertTextSafe, isImageAttachment } from './moderate.js';
import { encodeAttachments, formBodyByteLength } from './upload.js';
import { loadDraft } from './share-client.js';
import {
  fetchTab,
  parseBoardPosts,
  mergeLocalWithRemote,
  hashStr,
  clampCoordinate,
  positionFor,
  formatWhen
} from './feed.js';
import { createBoardCamera } from './camera.js';
import { createTidy } from './tidy.js';
import { createArchive } from './archive.js';

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
 *   pending?: boolean,
 *   pinning?: boolean
 * }} Post
 */

/** @type {Post[]} */
let posts = [];
/** @type {string|null} */
let activeDraftId = null;
/** @type {ReturnType<typeof setTimeout>|null} */
let statusTimer = null;
/** @type {ReturnType<typeof setTimeout>|null} */
let flashTimer = null;
/** @type {string|null} */
let pendingFocusPostId = null;

/** @type {{ x: number, y: number, zoom: number }} */
const camera = { x: 0, y: 0, zoom: 1 };

const els = {
  setupBanner: document.getElementById('setup-banner'),
  board: document.getElementById('board'),
  empty: document.getElementById('board-empty'),
  add: document.getElementById('add-note'),
  refresh: document.getElementById('refresh-btn'),
  resetView: document.getElementById('reset-view-btn'),
  archiveBtn: document.getElementById('archive-btn'),
  archiveClose: document.getElementById('archive-close'),
  archivePanel: document.getElementById('archive-panel'),
  archiveBackdrop: document.getElementById('archive-backdrop'),
  archiveList: document.getElementById('archive-list'),
  archiveSearch: document.getElementById('archive-search'),
  jumpNewest: document.getElementById('jump-newest-btn'),
  tidyBtn: document.getElementById('tidy-btn'),
  status: document.getElementById('board-status'),
  file: document.getElementById('note-file'),
  honeypot: document.getElementById('note-honeypot'),
  lightbox: document.getElementById('lightbox'),
  lightboxImg: document.getElementById('lightbox-img')
};

const configured = isConfigured();

/** @type {ReturnType<typeof createArchive>} */
let archiveApi;

const tidy = createTidy({
  getBoard: () => els.board,
  getBoardSurface: () => getBoardSurface(),
  resetCamera: (...args) => boardCamera.resetCamera(...args),
  renderBoard: () => renderBoard(),
  applyNotePosition: (el, post) => applyNotePosition(el, post),
  positionFor,
  CONFIG,
  setStatus
});

const boardCamera = createBoardCamera({
  getBoard: () => els.board,
  camera,
  getBoardSurface: () => getBoardSurface(),
  getLayoutMode: () => tidy.getLayoutMode(),
  getArchiveOpen: () => archiveApi.isOpen(),
  sizeBoardSurface: () => tidy.sizeBoardSurface(),
  clampCoordinate,
  CONFIG,
  setStatus
});

archiveApi = createArchive({
  els: {
    board: els.board,
    archiveBtn: els.archiveBtn,
    archiveClose: els.archiveClose,
    archivePanel: els.archivePanel,
    archiveBackdrop: els.archiveBackdrop,
    archiveList: els.archiveList,
    archiveSearch: /** @type {HTMLInputElement|null} */ (els.archiveSearch),
    jumpNewest: els.jumpNewest,
    tidyBtn: els.tidyBtn,
    lightbox: els.lightbox,
    lightboxImg: /** @type {HTMLImageElement|null} */ (els.lightboxImg)
  },
  partitionPosts: () => partitionPosts(),
  livePost: (id) => livePost(id),
  displayPosition: (post) => tidy.displayPosition(post),
  panCameraToNormalized: (x, y) => boardCamera.panCameraToNormalized(x, y),
  openLightbox: (src) => openLightbox(src),
  setStatus,
  flashElement: (el) => flashElement(el),
  getLayoutMode: () => tidy.getLayoutMode(),
  getPendingFocusPostId: () => pendingFocusPostId,
  setPendingFocusPostId: (id) => {
    pendingFocusPostId = id;
  }
});

const { setupBoardCamera, applyCamera, resetCamera, pointInView, boardPointFromClient } =
  boardCamera;

const { setLayoutMode, sizeBoardSurface, packTidyGrid, displayPosition, clearTidySlots } = tidy;

const {
  setupArchiveUi,
  renderArchiveList,
  updateChromeActions,
  jumpToNewest,
  maybeFocusPendingPost
} = archiveApi;

init();

async function init() {
  els.add?.addEventListener('click', () => {
    const point = pointInView();
    void createDraftNote(
      point ? { x: point.x, y: point.y, avoidOverlap: true } : { avoidOverlap: true }
    );
  });
  els.board?.classList.toggle('is-tidy', tidy.getLayoutMode() === 'tidy');
  setupBoardCamera();
  setupArchiveUi();
  els.tidyBtn?.addEventListener('click', () => {
    setLayoutMode(tidy.getLayoutMode() === 'tidy' ? 'scatter' : 'tidy');
  });
  els.jumpNewest?.addEventListener('click', () => jumpToNewest());
  els.resetView?.addEventListener('click', () => {
    resetCamera({ announce: true });
  });
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
  window.addEventListener('resize', () => {
    // Tidy columns depend on viewport width, so the grid has to be recomputed.
    if (tidy.getLayoutMode() === 'tidy') renderBoard();
    else sizeBoardSurface();
    applyCamera();
  });

  const params = new URLSearchParams(window.location.search);
  const wantsCompose = params.get('compose') === '1';
  const focusPostId = params.get('post');
  if (focusPostId) pendingFocusPostId = focusPostId;
  if (wantsCompose || focusPostId) {
    const next = new URL(window.location.href);
    next.searchParams.delete('compose');
    next.searchParams.delete('post');
    history.replaceState({}, '', `${next.pathname}${next.search}${next.hash}` || '/posts/');
  }

  const draft = await loadDraft();
  if (draft) {
    const point = pointInView();
    await createDraftNote({
      text: draft.text || '',
      email: draft.email || '',
      attachments: draft.attachments || draft.images || [],
      ...(point || {}),
      avoidOverlap: true
    });
  } else if (wantsCompose) {
    const point = pointInView();
    void createDraftNote(point ? { ...point, avoidOverlap: true } : { avoidOverlap: true });
  }

  if (!configured) {
    if (els.setupBanner) els.setupBanner.hidden = false;
    const drafts = posts.filter((p) => p.draft);
    posts = [...drafts, ...loadDemoPosts()];
    renderBoard();
    maybeFocusPendingPost();
    return;
  }

  await pollFeed();
  maybeFocusPendingPost();
  setInterval(() => {
    pollFeed().catch(() => {});
  }, CONFIG.pollIntervalMs);
}

/**
 * @param {{ text?: string, email?: string, attachments?: Array<string|Blob>, x?: number, y?: number, avoidOverlap?: boolean }} [seed]
 */
async function createDraftNote(seed = {}) {
  const placed = Number.isFinite(Number(seed.x)) || Number.isFinite(Number(seed.y));
  const metadata = createPostMetadata(seed.x, seed.y, {
    avoidOverlap: seed.avoidOverlap ?? !placed
  });
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
      const point = pointInView();
      await createDraftNote({
        attachments: files.slice(0, CONFIG.maxAttachmentsPerPost),
        ...(point || {}),
        avoidOverlap: true
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
    const point = pointInView();
    await createDraftNote({
      text,
      ...(point || {}),
      avoidOverlap: true
    });
    setStatus('Pasted onto a new note');
    return;
  }
  note.text = note.text ? `${note.text}${text}` : text;
  renderBoard();
  focusDraft(note.id);
  setStatus('Text pasted');
}

function discardDraft(note) {
  if (note.pinning) {
    setStatus('Still pinning — wait for moderation to finish', true);
    return;
  }
  for (const item of note.attachments) {
    if (item && typeof item === 'object' && item.revoke) URL.revokeObjectURL(item.url);
  }
  posts = posts.filter((p) => p.id !== note.id);
  if (activeDraftId === note.id) activeDraftId = null;
  renderBoard();
  setStatus('Draft discarded');
}

async function pinDraft(note) {
  if (note.pinning) return;
  if (els.honeypot?.value.trim()) {
    setStatus('Thanks!');
    return;
  }
  const text = note.text.trim();
  if (!text && note.attachments.length === 0) {
    setStatus('Write something or add an attachment', true);
    return;
  }

  note.pinning = true;
  renderBoard();

  try {
    if (text) {
      setStatus('Checking text…');
      await assertTextSafe(text);
    }

    setStatus(note.attachments.length ? 'Encoding attachments…' : 'Pinning…');
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
    window.heymingAchievements?.unlockForCurrentApp('first-action');
  } catch (err) {
    console.error(err);
    setStatus(err instanceof Error ? err.message : 'Pin failed', true);
  } finally {
    note.pinning = false;
    if (posts.some((p) => p.id === note.id && p.draft)) renderBoard();
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

function createPostMetadata(x, y, { avoidOverlap = false } = {}) {
  const hasX = Number.isFinite(Number(x));
  const hasY = Number.isFinite(Number(y));
  let nextX = hasX ? clampCoordinate(x, 0.5) : Number((0.18 + Math.random() * 0.64).toFixed(4));
  let nextY = hasY ? clampCoordinate(y, 0.5) : Number((0.18 + Math.random() * 0.64).toFixed(4));

  if (avoidOverlap) {
    const cleared = findClearPosition(nextX, nextY);
    nextX = cleared.x;
    nextY = cleared.y;
  }

  return {
    id: `post-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    action: 'post',
    x: nextX,
    y: nextY
  };
}

/**
 * Spiral away from neighbors so random pins don't stack.
 * @param {number} x
 * @param {number} y
 * @param {string} [excludeId]
 */
function findClearPosition(x, y, excludeId) {
  const clearance = CONFIG.noteClearance || 0.09;
  const occupied = partitionPosts().board.filter((p) => p.id !== excludeId);
  let px = clampCoordinate(x, 0.5);
  let py = clampCoordinate(y, 0.5);

  for (let attempt = 0; attempt < 14; attempt++) {
    const clash = occupied.some((p) => {
      const pos = positionFor(p.id, p);
      return Math.hypot(pos.x - px, pos.y - py) < clearance;
    });
    if (!clash) return { x: Number(px.toFixed(4)), y: Number(py.toFixed(4)) };
    const angle = attempt * 2.399;
    const radius = clearance + attempt * 0.025;
    px = clampCoordinate(x + Math.cos(angle) * radius, 0.5);
    py = clampCoordinate(y + Math.sin(angle) * radius, 0.5);
  }

  return { x: Number(px.toFixed(4)), y: Number(py.toFixed(4)) };
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

async function pollFeed() {
  const { cols, rows } = await fetchTab(CONFIG.responsesTab);
  const { posts: visibleRemote } = parseBoardPosts(cols, rows);
  posts = mergeLocalWithRemote(posts, visibleRemote);
  renderBoard();
  if (activeDraftId) focusDraft(activeDraftId);
}

/** @param {string} id */
function livePost(id) {
  return posts.find((p) => p.id === id) || null;
}

function partitionPosts() {
  const drafts = [];
  const pending = [];
  const published = [];
  for (const post of posts) {
    if (post.draft) drafts.push(post);
    else if (post.pending) pending.push(post);
    else published.push(post);
  }
  published.sort((a, b) => b.ts - a.ts);
  const max = CONFIG.boardMaxNotes || 24;
  return {
    board: [...drafts, ...pending, ...published.slice(0, max)],
    archive: published.slice(max),
    all: [...pending, ...published],
    newestPublished: published[0] || pending[0] || null
  };
}

/** @param {Post} post */
function attachmentSignature(post) {
  return post.attachments
    .map((item) => {
      if (typeof item === 'string') {
        return `${item.length}:${item.slice(0, 24)}:${item.slice(-16)}`;
      }
      const url = item.url || '';
      return `obj:${url.length}:${url.slice(0, 24)}`;
    })
    .join('|');
}

/** @param {Post} post */
function noteSignature(post) {
  if (post.draft) {
    return `${tidy.getLayoutMode()}|d|${post.pinning ? 1 : 0}|${attachmentSignature(post)}`;
  }
  return `${tidy.getLayoutMode()}|p|${post.pending ? 1 : 0}|${post.email}|${
    post.text
  }|${attachmentSignature(post)}`;
}

function getBoardSurface() {
  if (!els.board) return null;
  let surface = els.board.querySelector('.board-surface');
  if (!(surface instanceof HTMLElement)) {
    surface = document.createElement('div');
    surface.className = 'board-surface';
    els.board.replaceChildren(surface);
  }
  return surface;
}

function renderBoard() {
  if (!els.board) return;
  const surface = getBoardSurface();
  if (!surface) return;

  const { board, all, newestPublished } = partitionPosts();
  if (tidy.getLayoutMode() !== 'tidy') clearTidySlots();
  sizeBoardSurface();
  if (!boardCamera.isCameraReady()) resetCamera();
  else applyCamera();

  if (els.empty) {
    els.empty.hidden = posts.length > 0;
    if (els.empty.parentElement !== surface) surface.prepend(els.empty);
  }

  const keep = new Set(board.map((post) => post.id));
  for (const node of [...surface.querySelectorAll('.post')]) {
    if (!(node instanceof HTMLElement)) continue;
    const id = node.dataset.postId;
    if (!id || !keep.has(id)) node.remove();
  }

  for (const post of board) {
    const existing = surface.querySelector(`[data-post-id="${CSS.escape(post.id)}"]`);
    const sig = noteSignature(post);
    if (existing instanceof HTMLElement && existing.dataset.sig === sig) {
      applyNotePosition(existing, post);
      continue;
    }
    const next = post.draft ? renderDraftNote(post) : renderPublishedNote(post);
    next.dataset.sig = sig;
    if (existing) existing.replaceWith(next);
    else surface.append(next);
  }

  if (tidy.getLayoutMode() === 'tidy') packTidyGrid(board, surface);

  renderArchiveList(all);
  updateChromeActions(all.length, newestPublished);
}

/** @param {HTMLElement} el */
function flashElement(el) {
  el.classList.remove('is-flash');
  // Force restart when the same note is focused twice.
  void el.offsetWidth;
  el.classList.add('is-flash');
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    el.classList.remove('is-flash');
  }, 1500);
}

function styleNote(article, post) {
  const position = displayPosition(post);
  const angle =
    tidy.getLayoutMode() === 'tidy' ? 0 : (parseInt(hashStr(`${post.id}:angle`), 36) % 7) - 3;
  const colorIndex = parseInt(hashStr(`${post.id}:color`), 36) % NOTE_COLORS.length;
  article.dataset.postId = post.id;
  article.tabIndex = 0;
  const kind = post.draft ? 'Draft note' : 'Pinned note';
  article.setAttribute(
    'aria-label',
    tidy.getLayoutMode() === 'tidy' ? `${kind}.` : `${kind}. Use the arrow keys to move it.`
  );
  if (tidy.getLayoutMode() === 'tidy') article.removeAttribute('aria-keyshortcuts');
  else article.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
  article.style.left = `${position.x * 100}%`;
  article.style.top = `${position.y * 100}%`;
  article.style.setProperty('--tx', `${position.x * -100}%`);
  article.style.setProperty('--ty', `${position.y * -100}%`);
  article.style.setProperty('--rotation', `${angle}deg`);
  article.style.setProperty('--note-color', NOTE_COLORS[colorIndex]);
  attachNoteDragging(article);
  attachNoteKeyboardMovement(article);
}

function applyNotePosition(article, post) {
  const position = displayPosition(post);
  article.style.left = `${position.x * 100}%`;
  article.style.top = `${position.y * 100}%`;
  article.style.setProperty('--tx', `${position.x * -100}%`);
  article.style.setProperty('--ty', `${position.y * -100}%`);
}

function attachNoteDragging(article) {
  let drag = null;

  article.addEventListener('pointerdown', (event) => {
    const post = livePost(article.dataset.postId || '');
    if (!post || post.pinning || tidy.getLayoutMode() === 'tidy') return;
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
    const post = livePost(article.dataset.postId || '');
    if (!post) return;
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
    const post = livePost(article.dataset.postId || '');
    const completed = drag;
    drag = null;
    article.classList.remove('dragging');
    if (article.hasPointerCapture(event.pointerId)) article.releasePointerCapture(event.pointerId);
    if (!completed.moved || !post) return;

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

function attachNoteKeyboardMovement(article) {
  let startingPosition = null;
  let persistTimer = 0;
  const deltas = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }
  };

  article.addEventListener('keydown', (event) => {
    const post = livePost(article.dataset.postId || '');
    if (!post || post.pinning) return;
    if (event.target !== article || !(event.key in deltas)) return;
    event.preventDefault();

    if (tidy.getLayoutMode() === 'tidy') {
      setStatus('The grid holds every note in place — switch off Tidy to rearrange');
      return;
    }

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
      const live = livePost(article.dataset.postId || '');
      const previousPosition = startingPosition;
      startingPosition = null;
      if (live && previousPosition) void persistMove(live, previousPosition);
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
  article.className = 'post draft' + (post.pinning ? ' pinning' : '');
  styleNote(article, post);

  const discard = document.createElement('button');
  discard.type = 'button';
  discard.className = 'post-discard';
  discard.textContent = '×';
  discard.title = 'Discard draft';
  discard.setAttribute('aria-label', 'Discard draft');
  discard.disabled = Boolean(post.pinning);
  discard.addEventListener('click', () => discardDraft(post));

  const editor = document.createElement('div');
  editor.className = 'note-editor';

  const text = document.createElement('textarea');
  text.placeholder = 'Write on this note… (markdown ok)';
  text.maxLength = 8000;
  text.value = post.text;
  text.disabled = Boolean(post.pinning);
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
  name.disabled = Boolean(post.pinning);
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
  fileBtn.disabled = Boolean(post.pinning);
  fileBtn.addEventListener('click', () => {
    activeDraftId = post.id;
    els.file?.click();
  });

  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'btn primary sm';
  pin.textContent = post.pinning ? 'Pinning…' : 'Pin';
  pin.disabled = Boolean(post.pinning);
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
    btn.disabled = Boolean(post.pinning);
    btn.addEventListener('click', () => {
      if (post.pinning) return;
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
