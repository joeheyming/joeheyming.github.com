/**
 * Heyming OS - Constants and Configuration
 * Shared constants used across all OS modules
 */

/**
 * PostMessage API Schema
 * Standardized message types for iframe <-> OS communication
 *
 * All messages follow the format:
 * { type: MessageTypes.*, ...payload }
 *
 * Use origin '*' for local communication (same-origin iframes)
 */
export const MessageTypes = {
  // === App TO OS Messages ===

  // Wrapper for all app-to-OS requests
  IFRAME_MESSAGE: 'iframe-message',

  // App requests any pending file to open (sent on app init)
  REQUEST_PENDING_FILE: 'requestPendingFile',
  // Payload: { app: string }

  // App requests file open dialog
  OPEN_FILE_DIALOG: 'openFileDialog',
  // Payload: { accept?: string, multiple?: boolean }

  // === OS TO App Messages ===

  // OS sends file content to app
  OPEN_FILE: 'openFile',
  // Payload: { fileName: string, content: string|ArrayBuffer, mimeType?: string }

  // OS notifies app that file was saved
  FILE_SAVED: 'fileSaved',
  // Payload: { success: boolean, path?: string, error?: string }

  // OS broadcasts filesystem change to all iframes
  FILESYSTEM_CHANGE: 'filesystem-change'
  // Payload: { path: string, eventType: 'create'|'delete'|'move'|'copy'|'change' }
};

/**
 * IframeMessage Actions (used with MessageTypes.IFRAME_MESSAGE)
 *
 * Format: { type: 'iframe-message', action: IframeActions.*, ...payload }
 */
export const IframeActions = {
  // Open a file with a specific app (e.g. File Manager "Open with …", desktop context menu)
  OPEN_FILE: 'openFile',
  // Payload: { app: string, path: string, content: string|ArrayBuffer, fileName: string }

  // Open a file using OS routing (let OS decide which app)
  OPEN_DESKTOP_FILE: 'openDesktopFile',
  // Payload: { file: { path: string, content?: string|ArrayBuffer, mimeType?: string } }

  // Save file to filesystem
  SAVE: 'save',
  // Payload: { path: string, content: string|ArrayBuffer }

  // Show Save As dialog
  SAVE_AS: 'saveAs',
  // Payload: { currentPath?: string, content: string|ArrayBuffer, suggestedName?: string }

  // Launch an application
  LAUNCH: 'launch',
  // Payload: { appId: string, args?: string[] }

  // Notify OS of filesystem change (from File Manager)
  FILESYSTEM_CHANGED: 'filesystemChanged'
  // Payload: { path: string }
};

// Freeze message constants
Object.freeze(MessageTypes);
Object.freeze(IframeActions);

export const Constants = {
  // Layout dimensions
  TASKBAR_HEIGHT: 48,
  TITLE_BAR_HEIGHT: 40,

  // Window constraints
  MIN_WINDOW_WIDTH: 400,
  MIN_WINDOW_HEIGHT: 300,
  DEFAULT_WINDOW_WIDTH: 900,
  DEFAULT_WINDOW_HEIGHT: 700,

  // Spacing and margins
  WINDOW_MARGIN: 10,
  SIDE_MARGIN: 40,
  TOP_MARGIN: 80,
  CASCADE_STEP: 30,

  // Desktop icon layout
  ICON_SPACING_X: 90,
  ICON_SPACING_Y: 100,
  ICONS_PER_ROW: 6,
  ICON_START_X: 150,
  ICON_START_Y: 30,
  SYSTEM_ICON_X: 30,

  // Mobile icon layout
  MOBILE_ICON_SPACING_X: 80,
  MOBILE_ICON_SPACING_Y: 100,
  MOBILE_ICON_START_X: 20,
  MOBILE_ICON_START_Y: 20,
  MOBILE_MIN_ICONS_PER_ROW: 2,
  MOBILE_ICON_MARGIN: 40,

  // Icon label truncation
  ICON_LABEL_MAX_LENGTH: 12,
  ICON_LABEL_TRUNCATE_AT: 10,

  // Arrow key navigation threshold (pixels)
  ARROW_NAV_THRESHOLD: 20,

  // Mobile breakpoint (pixels)
  MOBILE_BREAKPOINT: 768,

  // Desktop file icon positioning (right side)
  FILE_ICON_RIGHT_OFFSET: 120,
  FILE_ICON_START_Y: 30,
  FILE_ICON_SPACING: 90,

  // Animation timings (ms)
  ANIMATION_DURATION: 300,
  NOTIFICATION_DURATION: 3000,
  RESIZE_DEBOUNCE: 250,

  // Z-index layers
  Z_INDEX_WINDOW: 100,
  Z_INDEX_ACTIVE_WINDOW: 200,
  Z_INDEX_LAUNCHER: 1000,
  Z_INDEX_DIALOG: 2000,
  Z_INDEX_NOTIFICATION: 3000,

  // Overlap threshold for window positioning (percentage)
  OVERLAP_THRESHOLD: 0.25,

  // Category display order
  CATEGORY_ORDER: ['game', 'utility', 'entertainment'],

  // Category display names
  CATEGORY_NAMES: {
    game: '🎮 Games',
    utility: '🛠️ Utilities',
    entertainment: '🎪 Entertainment'
  },

  // Notification colors
  NOTIFICATION_COLORS: {
    info: '#3182ce',
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    system: '#8b5cf6'
  }
};

// Freeze to prevent accidental modification
Object.freeze(Constants);
Object.freeze(Constants.CATEGORY_ORDER);
Object.freeze(Constants.CATEGORY_NAMES);
Object.freeze(Constants.NOTIFICATION_COLORS);
