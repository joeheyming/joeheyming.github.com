export const S = {
  worker: null,

  dropZone: null,
  imageUpload: null,
  sampleImage: null,
  loading: null,
  results: null,
  imgPreview: null,
  parsedContent: null,
  playButton: null,
  playIcon: null,
  playText: null,

  canvasModeBtn: null,
  uploadModeBtn: null,
  canvasContainer: null,
  uploadContainer: null,

  drawingCanvas: null,
  canvasCtx: null,
  eraserHoverOverlay: null,
  eraserOverlayCtx: null,
  clearCanvasBtn: null,
  penSizeSlider: null,
  readDrawingBtn: null,
  postDrawingBtn: null,
  canvasStatus: null,
  penToolBtn: null,
  eraserToolBtn: null,
  undoCanvasBtn: null,
  redoCanvasBtn: null,

  isDrawing: false,
  currentPenSize: 15,
  currentTool: 'pen',
  autoSaveTimeout: undefined,

  canvasHistoryStates: [],
  canvasHistoryIndex: 0,

  eraserHoverRaf: 0,
  eraserHoverPendingEvent: null,
  eraserHoverCell: -1,
  eraserOverlayImageData: null,

  sayitAppMessageEl: null,
  sayitAppMessageTimer: null,

  eraserTouchStartX: 0,
  eraserTouchStartY: 0,
  eraserTouchMaxDistSq: 0,
  lastEraserTouchMoveAt: 0
};

export const MAX_CANVAS_HISTORY = 25;
export const INK_LUMA_SUM_MAX = 735;
