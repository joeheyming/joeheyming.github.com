/**
 * Board camera — pan, zoom, and pinch.
 * Factory takes injected deps so index stays the orchestrator.
 */

/** Below this zoom a note is too small to read, so it collapses to a headline. */
export const FAR_ZOOM = 0.7;

/**
 * @typedef {{
 *   getBoard: () => HTMLElement|null,
 *   camera: { x: number, y: number, zoom: number },
 *   getBoardSurface: () => HTMLElement|null,
 *   getLayoutMode: () => 'scatter'|'tidy',
 *   getArchiveOpen: () => boolean,
 *   sizeBoardSurface: () => void,
 *   clampCoordinate: (value: unknown, fallback: number) => number,
 *   CONFIG: { minZoom?: number, maxZoom?: number },
 *   setStatus: (msg: string, isError?: boolean) => void
 * }} BoardCameraDeps
 */

/**
 * @param {BoardCameraDeps} deps
 */
export function createBoardCamera(deps) {
  let cameraReady = false;

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

  function isCameraReady() {
    return cameraReady;
  }

  function clampZoom(value) {
    const min = deps.CONFIG.minZoom || 0.4;
    const max = deps.CONFIG.maxZoom || 2.75;
    return Math.min(max, Math.max(min, value));
  }

  function applyCamera() {
    const surface = deps.getBoardSurface();
    if (!surface) return;
    const { camera } = deps;
    surface.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
    deps.getBoard()?.classList.toggle('is-far', camera.zoom < FAR_ZOOM);
  }

  function boardPointFromClient(clientX, clientY) {
    const surface = deps.getBoardSurface();
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: deps.clampCoordinate((clientX - rect.left) / rect.width, 0.5),
      y: deps.clampCoordinate((clientY - rect.top) / rect.height, 0.5)
    };
  }

  /** Center of the current viewport, in board coordinates. */
  function pointInView() {
    const board = deps.getBoard();
    if (!board) return null;
    const rect = board.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return boardPointFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function centerCameraOnWorld(wx, wy, { zoom = deps.camera.zoom } = {}) {
    const board = deps.getBoard();
    if (!board) return;
    deps.camera.zoom = clampZoom(zoom);
    deps.camera.x = board.clientWidth / 2 - wx * deps.camera.zoom;
    deps.camera.y = board.clientHeight / 2 - wy * deps.camera.zoom;
    applyCamera();
  }

  function panCameraToNormalized(x, y) {
    const surface = deps.getBoardSurface();
    if (!surface) return;
    centerCameraOnWorld(x * surface.offsetWidth, y * surface.offsetHeight);
  }

  function resetCamera({ announce = false } = {}) {
    // In tidy mode the packed height is authoritative; re-sizing here would squash it.
    if (deps.getLayoutMode() !== 'tidy') deps.sizeBoardSurface();
    const board = deps.getBoard();
    const surface = deps.getBoardSurface();
    if (!board || !surface) return;
    deps.camera.zoom = 1;
    deps.camera.x = (board.clientWidth - surface.offsetWidth) / 2;
    // Tidy mode reads top-down, so start at the newest row instead of the middle.
    deps.camera.y =
      deps.getLayoutMode() === 'tidy' ? 0 : (board.clientHeight - surface.offsetHeight) / 2;
    applyCamera();
    cameraReady = true;
    if (announce) deps.setStatus('View reset');
  }

  function zoomAtClient(clientX, clientY, nextZoom) {
    const board = deps.getBoard();
    if (!board) return;
    const zoom = clampZoom(nextZoom);
    const boardRect = board.getBoundingClientRect();
    const vx = clientX - boardRect.left;
    const vy = clientY - boardRect.top;
    const wx = (vx - deps.camera.x) / deps.camera.zoom;
    const wy = (vy - deps.camera.y) / deps.camera.zoom;
    deps.camera.zoom = zoom;
    deps.camera.x = vx - wx * deps.camera.zoom;
    deps.camera.y = vy - wy * deps.camera.zoom;
    applyCamera();
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
    const board = deps.getBoard();
    if (!board || activePointers.size < 2) return null;
    const live = capturePinchLive();
    if (!live) return null;
    const boardRect = board.getBoundingClientRect();
    return {
      distance: live.distance,
      zoom: deps.camera.zoom,
      worldX: (live.midX - boardRect.left - deps.camera.x) / deps.camera.zoom,
      worldY: (live.midY - boardRect.top - deps.camera.y) / deps.camera.zoom
    };
  }

  function setupBoardCamera() {
    const board = deps.getBoard();
    if (!board) return;

    board.addEventListener(
      'wheel',
      (event) => {
        if (deps.getArchiveOpen()) return;
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * 0.0015);
        zoomAtClient(event.clientX, event.clientY, deps.camera.zoom * factor);
      },
      { passive: false }
    );

    board.addEventListener('pointerdown', (event) => {
      if (!(event.target instanceof Element)) return;
      // Tidy cards can't be dragged, so they pan the board like bare cork does.
      const controls = 'button, a, input, textarea, audio, video, dialog';
      if (event.target.closest(deps.getLayoutMode() === 'tidy' ? controls : `.post, ${controls}`)) {
        return;
      }
      if (event.button !== 0 && event.button !== 1) return;

      event.preventDefault();
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (activePointers.size >= 2) {
        boardGesture = null;
        pinchState = capturePinchState();
        board.classList.add('is-panning');
        return;
      }

      boardGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originPanX: deps.camera.x,
        originPanY: deps.camera.y
      };
      pinchState = null;
      board.classList.add('is-panning');
      try {
        board.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    });

    board.addEventListener('pointermove', (event) => {
      if (activePointers.has(event.pointerId)) {
        activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (activePointers.size >= 2) {
        if (!pinchState) pinchState = capturePinchState();
        const next = capturePinchLive();
        if (!pinchState || !next || !deps.getBoard()) return;
        event.preventDefault();
        const ratio = next.distance / Math.max(1, pinchState.distance);
        const zoom = clampZoom(pinchState.zoom * ratio);
        const boardRect = board.getBoundingClientRect();
        deps.camera.zoom = zoom;
        deps.camera.x = next.midX - boardRect.left - pinchState.worldX * zoom;
        deps.camera.y = next.midY - boardRect.top - pinchState.worldY * zoom;
        applyCamera();
        return;
      }

      if (!boardGesture || event.pointerId !== boardGesture.pointerId) return;
      event.preventDefault();
      const dx = event.clientX - boardGesture.startX;
      const dy = event.clientY - boardGesture.startY;
      deps.camera.x = boardGesture.originPanX + dx;
      deps.camera.y = boardGesture.originPanY + dy;
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
          originPanX: deps.camera.x,
          originPanY: deps.camera.y
        };
        return;
      }

      pinchState = null;
      if (boardGesture && event.pointerId === boardGesture.pointerId) {
        boardGesture = null;
        if (board.hasPointerCapture(event.pointerId)) {
          board.releasePointerCapture(event.pointerId);
        }
      }
      if (activePointers.size === 0) {
        boardGesture = null;
        board.classList.remove('is-panning');
      }
    };

    board.addEventListener('pointerup', endPointer);
    board.addEventListener('pointercancel', endPointer);
    board.addEventListener('lostpointercapture', () => {
      if (activePointers.size === 0) {
        boardGesture = null;
        pinchState = null;
        board.classList.remove('is-panning');
      }
    });

    deps.sizeBoardSurface();
    resetCamera();
  }

  return {
    setupBoardCamera,
    applyCamera,
    resetCamera,
    panCameraToNormalized,
    centerCameraOnWorld,
    pointInView,
    boardPointFromClient,
    clampZoom,
    isCameraReady
  };
}
