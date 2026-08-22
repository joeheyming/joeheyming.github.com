import { CONFIG, isConfigured } from './config.js';
import { assertImagesSafe, assertTextSafe, isImageAttachment } from './moderate.js';
import { encodeAttachments, formBodyByteLength } from './upload.js';
import { loadDraft } from './share-client.js';

const DEMO_KEY = 'posts-demo-v1';
const LAYOUT_KEY = 'posts-layout-v1';
const ATTACHMENT_CHUNK_PREFIX = 'posts-attachment-chunk-v1';
const NOTE_COLORS = ['#fff3a6', '#ffd6e7', '#cceeff', '#d9f7be', '#ffe0b5', '#e4d7ff'];

// Tidy view geometry, in surface pixels.
const TIDY_GAP = 28;
const TIDY_NOTE_MAX_W = 270;
// Only used when a card somehow reports no height (display:none, detached).
const TIDY_FALLBACK_H = 210;
// Below this zoom a note is too small to read, so it collapses to a headline.
const FAR_ZOOM = 0.7;

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
let archiveOpen = false;
let archiveQuery = '';

/** @type {'scatter'|'tidy'} */
let layoutMode = loadLayoutMode();
/** Grid slots keyed by post id, only populated in tidy mode. @type {Map<string, {x: number, y: number}>} */
let tidySlots = new Map();

/** @type {{ x: number, y: number, zoom: number }} */
const camera = { x: 0, y: 0, zoom: 1 };
let cameraReady = false;

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

init();

async function init() {
  els.add?.addEventListener('click', () => {
    const point = pointInView();
    void createDraftNote(
      point ? { x: point.x, y: point.y, avoidOverlap: true } : { avoidOverlap: true }
    );
  });
  els.board?.classList.toggle('is-tidy', layoutMode === 'tidy');
  setupBoardCamera();
  setupArchiveUi();
  els.tidyBtn?.addEventListener('click', () => {
    setLayoutMode(layoutMode === 'tidy' ? 'scatter' : 'tidy');
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
    if (layoutMode === 'tidy') renderBoard();
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

/**
 * @type {{
 *   pointerId: number,
 *   startX: number,
 *   startY: number,
 *   originPanX: number,
 *   originPanY: number
 * }|null}
 */
let boardGesture = null;
/** @type {Map<number, { x: number, y: number }>} */
const activePointers = new Map();
/**
 * @type {{
 *   distance: number,
 *   zoom: number,
 *   worldX: number,
 *   worldY: number
 * }|null}
 */
let pinchState = null;

function setupBoardCamera() {
  if (!els.board) return;

  els.board.addEventListener(
    'wheel',
    (event) => {
      if (archiveOpen) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomAtClient(event.clientX, event.clientY, camera.zoom * factor);
    },
    { passive: false }
  );

  els.board.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Element)) return;
    // Tidy cards can't be dragged, so they pan the board like bare cork does.
    const controls = 'button, a, input, textarea, audio, video, dialog';
    if (event.target.closest(layoutMode === 'tidy' ? controls : `.post, ${controls}`)) return;
    if (event.button !== 0 && event.button !== 1) return;

    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size >= 2) {
      boardGesture = null;
      pinchState = capturePinchState();
      els.board.classList.add('is-panning');
      return;
    }

    boardGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originPanX: camera.x,
      originPanY: camera.y
    };
    pinchState = null;
    els.board.classList.add('is-panning');
    try {
      els.board.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  });

  els.board.addEventListener('pointermove', (event) => {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (activePointers.size >= 2) {
      if (!pinchState) pinchState = capturePinchState();
      const next = capturePinchLive();
      if (!pinchState || !next || !els.board) return;
      event.preventDefault();
      const ratio = next.distance / Math.max(1, pinchState.distance);
      const zoom = clampZoom(pinchState.zoom * ratio);
      const boardRect = els.board.getBoundingClientRect();
      camera.zoom = zoom;
      camera.x = next.midX - boardRect.left - pinchState.worldX * zoom;
      camera.y = next.midY - boardRect.top - pinchState.worldY * zoom;
      applyCamera();
      return;
    }

    if (!boardGesture || event.pointerId !== boardGesture.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - boardGesture.startX;
    const dy = event.clientY - boardGesture.startY;
    camera.x = boardGesture.originPanX + dx;
    camera.y = boardGesture.originPanY + dy;
    applyCamera();
  });

  const endPointer = (event) => {
    activePointers.delete(event.pointerId);

    if (activePointers.size >= 2) {
      pinchState = capturePinchState();
      return;
    }

    if (activePointers.size === 1) {
      // Drop from pinch to one-finger pan from the remaining contact.
      pinchState = null;
      const [pointerId, point] = [...activePointers.entries()][0];
      boardGesture = {
        pointerId,
        startX: point.x,
        startY: point.y,
        originPanX: camera.x,
        originPanY: camera.y
      };
      return;
    }

    pinchState = null;
    if (boardGesture && event.pointerId === boardGesture.pointerId) {
      boardGesture = null;
      if (els.board?.hasPointerCapture(event.pointerId)) {
        els.board.releasePointerCapture(event.pointerId);
      }
    }
    if (activePointers.size === 0) {
      boardGesture = null;
      els.board?.classList.remove('is-panning');
    }
  };

  els.board.addEventListener('pointerup', endPointer);
  els.board.addEventListener('pointercancel', endPointer);
  els.board.addEventListener('lostpointercapture', () => {
    if (activePointers.size === 0) {
      boardGesture = null;
      pinchState = null;
      els.board?.classList.remove('is-panning');
    }
  });

  sizeBoardSurface();
  resetCamera();
}

function capturePinchLive() {
  if (activePointers.size < 2) return null;
  const points = [...activePointers.values()];
  const [a, b] = points;
  return {
    distance: Math.hypot(a.x - b.x, a.y - b.y),
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2
  };
}

function capturePinchState() {
  if (!els.board || activePointers.size < 2) return null;
  const live = capturePinchLive();
  if (!live) return null;
  const boardRect = els.board.getBoundingClientRect();
  return {
    distance: live.distance,
    zoom: camera.zoom,
    worldX: (live.midX - boardRect.left - camera.x) / camera.zoom,
    worldY: (live.midY - boardRect.top - camera.y) / camera.zoom
  };
}

function boardPointFromClient(clientX, clientY) {
  const surface = getBoardSurface();
  if (!surface) return null;
  const rect = surface.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    x: clampCoordinate((clientX - rect.left) / rect.width, 0.5),
    y: clampCoordinate((clientY - rect.top) / rect.height, 0.5)
  };
}

/** Center of the current viewport, in board coordinates. */
function pointInView() {
  if (!els.board) return null;
  const rect = els.board.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return boardPointFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function clampZoom(value) {
  const min = CONFIG.minZoom || 0.4;
  const max = CONFIG.maxZoom || 2.75;
  return Math.min(max, Math.max(min, value));
}

function zoomAtClient(clientX, clientY, nextZoom) {
  if (!els.board) return;
  const zoom = clampZoom(nextZoom);
  const boardRect = els.board.getBoundingClientRect();
  const vx = clientX - boardRect.left;
  const vy = clientY - boardRect.top;
  const wx = (vx - camera.x) / camera.zoom;
  const wy = (vy - camera.y) / camera.zoom;
  camera.zoom = zoom;
  camera.x = vx - wx * camera.zoom;
  camera.y = vy - wy * camera.zoom;
  applyCamera();
}

function applyCamera() {
  const surface = getBoardSurface();
  if (!surface) return;
  surface.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
  els.board?.classList.toggle('is-far', camera.zoom < FAR_ZOOM);
}

/** @returns {'scatter'|'tidy'} */
function loadLayoutMode() {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'tidy' ? 'tidy' : 'scatter';
  } catch {
    return 'scatter';
  }
}

/** @param {'scatter'|'tidy'} mode */
function setLayoutMode(mode) {
  layoutMode = mode === 'tidy' ? 'tidy' : 'scatter';
  try {
    localStorage.setItem(LAYOUT_KEY, layoutMode);
  } catch {
    /* private mode — the toggle just won't stick */
  }
  els.board?.classList.toggle('is-tidy', layoutMode === 'tidy');
  renderBoard();
  resetCamera();
  setStatus(layoutMode === 'tidy' ? 'Tidied — newest note first' : 'Back to the cork board');
  window.trackEvent?.('posts_layout', 'Engagement', layoutMode);
}

/** Card width and column count for the tidy grid, derived from the viewport. */
function tidyMetrics() {
  const view = Math.max(els.board?.clientWidth || 0, 240);
  const noteW = Math.max(180, Math.min(TIDY_NOTE_MAX_W, view - TIDY_GAP * 2));
  const cols = Math.max(1, Math.floor((view - TIDY_GAP) / (noteW + TIDY_GAP)));
  return { noteW, cols };
}

function sizeBoardSurface() {
  const surface = getBoardSurface();
  if (!els.board || !surface) return;

  let width;
  let height;
  if (layoutMode === 'tidy') {
    // Provisional only — packTidyGrid grows the surface once cards are measured.
    els.board.style.setProperty('--tidy-note-w', `${tidyMetrics().noteW}px`);
    width = els.board.clientWidth;
    height = els.board.clientHeight;
  } else {
    const scale = CONFIG.worldScale || 1.85;
    width = Math.max(els.board.clientWidth * scale, els.board.clientWidth);
    height = Math.max(els.board.clientHeight * scale, els.board.clientHeight);
  }

  surface.style.width = `${Math.round(width)}px`;
  surface.style.height = `${Math.round(height)}px`;
  surface.style.minHeight = `${Math.round(height)}px`;
}

/**
 * Pack the rendered notes into newest-first columns, each card keeping its own
 * height so nothing is clipped, then grow the surface to fit. Must run after the
 * cards are in the DOM — it measures them.
 * @param {Post[]} list
 * @param {HTMLElement} surface
 */
function packTidyGrid(list, surface) {
  const { noteW, cols } = tidyMetrics();
  const width = surface.offsetWidth || 1;
  const cellW = noteW + TIDY_GAP;
  const startX = Math.max(TIDY_GAP, (width - (cols * cellW - TIDY_GAP)) / 2);
  const columnBottoms = new Array(cols).fill(TIDY_GAP);

  /** @type {Array<{post: Post, el: HTMLElement, centerX: number, centerY: number}>} */
  const placements = [];
  for (const post of list) {
    const el = surface.querySelector(`[data-post-id="${CSS.escape(post.id)}"]`);
    if (!(el instanceof HTMLElement)) continue;

    let col = 0;
    for (let i = 1; i < cols; i++) {
      if (columnBottoms[i] < columnBottoms[col]) col = i;
    }

    const noteH = el.offsetHeight || TIDY_FALLBACK_H;
    const top = columnBottoms[col];
    columnBottoms[col] = top + noteH + TIDY_GAP;
    placements.push({
      post,
      el,
      centerX: startX + col * cellW + noteW / 2,
      centerY: top + noteH / 2
    });
  }

  const height = Math.max(els.board?.clientHeight || 0, ...columnBottoms);
  surface.style.height = `${Math.round(height)}px`;
  surface.style.minHeight = `${Math.round(height)}px`;

  tidySlots = new Map(
    placements.map(({ post, centerX, centerY }) => [
      post.id,
      { x: centerX / width, y: centerY / height }
    ])
  );
  for (const { el, post } of placements) applyNotePosition(el, post);
}

/**
 * Where a note is drawn right now — its grid slot in tidy mode, otherwise the
 * coordinates everyone else sees.
 * @param {Post} post
 */
function displayPosition(post) {
  return tidySlots.get(post.id) || positionFor(post.id, post);
}

function centerCameraOnWorld(wx, wy, { zoom = camera.zoom } = {}) {
  if (!els.board) return;
  camera.zoom = clampZoom(zoom);
  camera.x = els.board.clientWidth / 2 - wx * camera.zoom;
  camera.y = els.board.clientHeight / 2 - wy * camera.zoom;
  applyCamera();
}

function resetCamera({ announce = false } = {}) {
  // In tidy mode the packed height is authoritative; re-sizing here would squash it.
  if (layoutMode !== 'tidy') sizeBoardSurface();
  const surface = getBoardSurface();
  if (!els.board || !surface) return;
  camera.zoom = 1;
  camera.x = (els.board.clientWidth - surface.offsetWidth) / 2;
  // Tidy mode reads top-down, so start at the newest row instead of the middle.
  camera.y = layoutMode === 'tidy' ? 0 : (els.board.clientHeight - surface.offsetHeight) / 2;
  applyCamera();
  cameraReady = true;
  if (announce) setStatus('View reset');
}

function panCameraToNormalized(x, y) {
  const surface = getBoardSurface();
  if (!surface) return;
  centerCameraOnWorld(x * surface.offsetWidth, y * surface.offsetHeight);
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
    return `${layoutMode}|d|${post.pinning ? 1 : 0}|${attachmentSignature(post)}`;
  }
  return `${layoutMode}|p|${post.pending ? 1 : 0}|${post.email}|${post.text}|${attachmentSignature(
    post
  )}`;
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
  if (layoutMode !== 'tidy') tidySlots = new Map();
  sizeBoardSurface();
  if (!cameraReady) resetCamera();
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

  if (layoutMode === 'tidy') packTidyGrid(board, surface);

  renderArchiveList(all);
  updateChromeActions(all.length, newestPublished);
}

/**
 * @param {Post[]} all
 */
function renderArchiveList(all) {
  if (!els.archiveList) return;
  if (!archiveOpen) {
    els.archiveList.replaceChildren();
    return;
  }
  els.archiveList.replaceChildren();
  const matches = archiveQuery
    ? all.filter((post) => `${post.text} ${post.email}`.toLowerCase().includes(archiveQuery))
    : all;

  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'archive-empty';
    if (archiveQuery) empty.textContent = `No posts match “${archiveQuery}”.`;
    else empty.textContent = 'No posts yet.';
    els.archiveList.append(empty);
    return;
  }

  for (const post of matches) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'archive-item';
    btn.dataset.archiveId = post.id;
    btn.setAttribute('role', 'listitem');

    const thumb = document.createElement('div');
    const first = post.attachments.find((item) => typeof item === 'string');
    if (typeof first === 'string' && first.startsWith('data:audio/')) {
      thumb.className = 'archive-thumb audio';
      thumb.textContent = 'Audio';
    } else if (typeof first === 'string') {
      thumb.className = 'archive-thumb';
      const img = document.createElement('img');
      img.src = first;
      img.alt = '';
      img.loading = 'lazy';
      thumb.append(img);
    } else {
      thumb.className = 'archive-thumb blank';
      thumb.textContent = 'Note';
    }

    const body = document.createElement('div');
    body.className = 'archive-item-body';
    const when = document.createElement('span');
    when.className = 'archive-item-when';
    when.textContent = formatWhen(post.ts);
    const text = document.createElement('p');
    text.className = 'archive-item-text';
    text.textContent = previewText(post.text) || '(attachment only)';
    body.append(when, text);
    if (post.email) {
      const author = document.createElement('span');
      author.className = 'archive-item-author';
      author.textContent = post.email;
      body.append(author);
    }

    btn.append(thumb, body);
    btn.addEventListener('click', () => {
      const onBoard = els.board?.querySelector(`[data-post-id="${CSS.escape(post.id)}"]`);
      if (onBoard) focusBoardPost(post.id);
      else openArchiveReader(post);
    });
    els.archiveList.append(btn);
  }
}

/** @param {string} text */
function previewText(text) {
  return String(text || '')
    .replace(/[#>*_`~\-[\]]/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {number} totalCount
 * @param {Post|null} newestPublished
 */
function updateChromeActions(totalCount, newestPublished) {
  if (els.archiveBtn) {
    els.archiveBtn.hidden = totalCount === 0 && !archiveOpen;
    els.archiveBtn.textContent = totalCount ? `Browse (${totalCount})` : 'Browse';
    els.archiveBtn.setAttribute('aria-expanded', archiveOpen ? 'true' : 'false');
  }
  if (els.jumpNewest) {
    els.jumpNewest.hidden = !newestPublished;
  }
  if (els.tidyBtn) {
    const tidy = layoutMode === 'tidy';
    els.tidyBtn.textContent = tidy ? 'Scatter' : 'Tidy';
    els.tidyBtn.setAttribute('aria-pressed', tidy ? 'true' : 'false');
    els.tidyBtn.title = tidy
      ? 'Scatter the notes back across the cork'
      : 'Stack every note in a neat grid, newest first';
  }
}

function setupArchiveUi() {
  els.archiveBtn?.addEventListener('click', () => {
    if (archiveOpen) closeArchive();
    else openArchive();
  });
  els.archiveClose?.addEventListener('click', () => closeArchive());
  els.archiveBackdrop?.addEventListener('click', () => closeArchive());
  els.archiveSearch?.addEventListener('input', () => {
    archiveQuery = (els.archiveSearch?.value || '').trim().toLowerCase();
    renderArchiveList(partitionPosts().all);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && archiveOpen) closeArchive();
  });
}

function openArchive() {
  archiveOpen = true;
  if (els.archivePanel) els.archivePanel.hidden = false;
  if (els.archiveBackdrop) els.archiveBackdrop.hidden = false;
  if (els.archiveBtn) els.archiveBtn.setAttribute('aria-expanded', 'true');
  const all = partitionPosts().all;
  renderArchiveList(all);
  window.trackEvent?.('posts_browse_open', 'Engagement', String(all.length));
}

function closeArchive() {
  archiveOpen = false;
  archiveQuery = '';
  if (els.archivePanel) els.archivePanel.hidden = true;
  if (els.archiveBackdrop) els.archiveBackdrop.hidden = true;
  if (els.archiveBtn) els.archiveBtn.setAttribute('aria-expanded', 'false');
  if (els.archiveSearch) els.archiveSearch.value = '';
  if (els.archiveList) els.archiveList.replaceChildren();
}

/** @param {Post} post */
function openArchiveReader(post) {
  const dialog = els.lightbox;
  if (!dialog || !els.lightboxImg) return;

  const urls = post.attachments.filter((item) => typeof item === 'string');
  const image = urls.find((src) => !src.startsWith('data:audio/'));
  if (image) {
    openLightbox(image);
  }

  const snippet = previewText(post.text);
  setStatus(
    snippet
      ? `${formatWhen(post.ts)} — ${snippet.slice(0, 120)}${snippet.length > 120 ? '…' : ''}`
      : `Archived note from ${formatWhen(post.ts)}`
  );

  const url = new URL(window.location.href);
  url.searchParams.set('post', post.id);
  history.replaceState({}, '', `${url.pathname}?post=${encodeURIComponent(post.id)}`);
  window.trackEvent?.('posts_browse_read', 'Engagement', post.id);
}

function jumpToNewest() {
  const { newestPublished } = partitionPosts();
  if (!newestPublished) {
    setStatus('No pinned notes yet', true);
    return;
  }
  focusBoardPost(newestPublished.id);
}

function maybeFocusPendingPost() {
  if (!pendingFocusPostId) return;
  const id = pendingFocusPostId;
  pendingFocusPostId = null;
  focusBoardPost(id);
}

/** @param {string} id */
function focusBoardPost(id) {
  const onBoard = els.board?.querySelector(`[data-post-id="${CSS.escape(id)}"]`);
  if (onBoard instanceof HTMLElement) {
    closeArchive();
    const post = livePost(id);
    if (post) {
      const position = displayPosition(post);
      panCameraToNormalized(position.x, position.y);
    }
    flashElement(onBoard);
    onBoard.focus({ preventScroll: true });
    setStatus('Found that note');
    return true;
  }

  const archived = partitionPosts().archive.find((post) => post.id === id);
  if (archived) {
    openArchive();
    requestAnimationFrame(() => {
      const row = els.archiveList?.querySelector(`[data-archive-id="${CSS.escape(id)}"]`);
      if (row instanceof HTMLElement) {
        row.scrollIntoView({ block: 'nearest' });
        flashElement(row);
        row.focus();
      }
    });
    setStatus('That note is in Browse');
    return true;
  }

  setStatus('Could not find that note', true);
  return false;
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
  const angle = layoutMode === 'tidy' ? 0 : (parseInt(hashStr(`${post.id}:angle`), 36) % 7) - 3;
  const colorIndex = parseInt(hashStr(`${post.id}:color`), 36) % NOTE_COLORS.length;
  article.dataset.postId = post.id;
  article.tabIndex = 0;
  const kind = post.draft ? 'Draft note' : 'Pinned note';
  article.setAttribute(
    'aria-label',
    layoutMode === 'tidy' ? `${kind}.` : `${kind}. Use the arrow keys to move it.`
  );
  if (layoutMode === 'tidy') article.removeAttribute('aria-keyshortcuts');
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
    if (!post || post.pinning || layoutMode === 'tidy') return;
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

    if (layoutMode === 'tidy') {
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
