/**
 * Tidy / scatter layout for the Posts board.
 * Factory takes injected deps so index stays the orchestrator.
 */

export const LAYOUT_KEY = 'posts-layout-v1';

// Tidy view geometry, in surface pixels.
export const TIDY_GAP = 28;
export const TIDY_NOTE_MAX_W = 270;
// Only used when a card somehow reports no height (display:none, detached).
export const TIDY_FALLBACK_H = 210;

/** @returns {'scatter'|'tidy'} */
export function loadLayoutMode() {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'tidy' ? 'tidy' : 'scatter';
  } catch {
    return 'scatter';
  }
}

/**
 * @typedef {{
 *   getBoard: () => HTMLElement|null,
 *   getBoardSurface: () => HTMLElement|null,
 *   resetCamera: () => void,
 *   renderBoard: () => void,
 *   applyNotePosition: (el: HTMLElement, post: { id: string }) => void,
 *   positionFor: (id: string, metadata: { x?: unknown, y?: unknown }|null|undefined) => { x: number, y: number },
 *   CONFIG: { worldScale?: number },
 *   setStatus: (msg: string, isError?: boolean) => void
 * }} TidyDeps
 */

/**
 * @param {TidyDeps} deps
 */
export function createTidy(deps) {
  /** @type {'scatter'|'tidy'} */
  let layoutMode = loadLayoutMode();
  /** Grid slots keyed by post id, only populated in tidy mode. @type {Map<string, {x: number, y: number}>} */
  let tidySlots = new Map();

  function getLayoutMode() {
    return layoutMode;
  }

  function getTidySlots() {
    return tidySlots;
  }

  function clearTidySlots() {
    tidySlots = new Map();
  }

  /** @param {'scatter'|'tidy'} mode */
  function setLayoutMode(mode) {
    layoutMode = mode === 'tidy' ? 'tidy' : 'scatter';
    try {
      localStorage.setItem(LAYOUT_KEY, layoutMode);
    } catch {
      /* private mode — the toggle just won't stick */
    }
    deps.getBoard()?.classList.toggle('is-tidy', layoutMode === 'tidy');
    deps.renderBoard();
    deps.resetCamera();
    deps.setStatus(layoutMode === 'tidy' ? 'Tidied — newest note first' : 'Back to the cork board');
  }

  /** Card width and column count for the tidy grid, derived from the viewport. */
  function tidyMetrics() {
    const view = Math.max(deps.getBoard()?.clientWidth || 0, 240);
    const noteW = Math.max(180, Math.min(TIDY_NOTE_MAX_W, view - TIDY_GAP * 2));
    const cols = Math.max(1, Math.floor((view - TIDY_GAP) / (noteW + TIDY_GAP)));
    return { noteW, cols };
  }

  function sizeBoardSurface() {
    const surface = deps.getBoardSurface();
    const board = deps.getBoard();
    if (!board || !surface) return;

    let width;
    let height;
    if (layoutMode === 'tidy') {
      // Provisional only — packTidyGrid grows the surface once cards are measured.
      board.style.setProperty('--tidy-note-w', `${tidyMetrics().noteW}px`);
      width = board.clientWidth;
      height = board.clientHeight;
    } else {
      const scale = deps.CONFIG.worldScale || 1.85;
      width = Math.max(board.clientWidth * scale, board.clientWidth);
      height = Math.max(board.clientHeight * scale, board.clientHeight);
    }

    surface.style.width = `${Math.round(width)}px`;
    surface.style.height = `${Math.round(height)}px`;
    surface.style.minHeight = `${Math.round(height)}px`;
  }

  /**
   * Pack the rendered notes into newest-first columns, each card keeping its own
   * height so nothing is clipped, then grow the surface to fit. Must run after the
   * cards are in the DOM — it measures them.
   * @param {Array<{ id: string }>} list
   * @param {HTMLElement} surface
   */
  function packTidyGrid(list, surface) {
    const { noteW, cols } = tidyMetrics();
    const width = surface.offsetWidth || 1;
    const cellW = noteW + TIDY_GAP;
    const startX = Math.max(TIDY_GAP, (width - (cols * cellW - TIDY_GAP)) / 2);
    const columnBottoms = new Array(cols).fill(TIDY_GAP);

    /** @type {Array<{post: { id: string }, el: HTMLElement, centerX: number, centerY: number}>} */
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

    const height = Math.max(deps.getBoard()?.clientHeight || 0, ...columnBottoms);
    surface.style.height = `${Math.round(height)}px`;
    surface.style.minHeight = `${Math.round(height)}px`;

    tidySlots = new Map(
      placements.map(({ post, centerX, centerY }) => [
        post.id,
        { x: centerX / width, y: centerY / height }
      ])
    );
    for (const { el, post } of placements) deps.applyNotePosition(el, post);
  }

  /**
   * Where a note is drawn right now — its grid slot in tidy mode, otherwise the
   * coordinates everyone else sees.
   * @param {{ id: string, x?: number, y?: number }} post
   */
  function displayPosition(post) {
    return tidySlots.get(post.id) || deps.positionFor(post.id, post);
  }

  return {
    getLayoutMode,
    setLayoutMode,
    getTidySlots,
    clearTidySlots,
    tidyMetrics,
    sizeBoardSurface,
    packTidyGrid,
    displayPosition
  };
}
