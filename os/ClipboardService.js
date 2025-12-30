/**
 * Heyming OS - Clipboard Service
 * Handles cross-app clipboard operations for files
 *
 * Similar to DragService, this provides shared clipboard state
 * that both the Desktop and File Manager can access.
 *
 * Unlike DragService, clipboard data does NOT expire automatically.
 * This matches real OS behavior where clipboard persists until:
 * - Explicitly cleared
 * - Overwritten by new copy/cut
 * - Cut items are pasted (then auto-cleared)
 */

import { debug } from './config.js';

export const ClipboardService = {
  _items: [],
  _operation: null, // 'copy' or 'cut'
  _source: null,
  _timestamp: null,

  /**
   * Copy items to clipboard
   * @param {string[]} paths - Array of file paths
   * @param {string} source - Source identifier (e.g., 'desktop', 'filemanager')
   */
  copy(paths, source = 'unknown') {
    this._items = [...paths];
    this._operation = 'copy';
    this._source = source;
    this._timestamp = Date.now();
    debug('ClipboardService.copy:', paths, 'from:', source);
  },

  /**
   * Cut items to clipboard
   * @param {string[]} paths - Array of file paths
   * @param {string} source - Source identifier
   */
  cut(paths, source = 'unknown') {
    this._items = [...paths];
    this._operation = 'cut';
    this._source = source;
    this._timestamp = Date.now();
    debug('ClipboardService.cut:', paths, 'from:', source);
  },

  /**
   * Get clipboard contents
   * @returns {{ items: string[], operation: 'copy'|'cut'|null }}
   */
  get() {
    return {
      items: this._items,
      operation: this._operation
    };
  },

  /**
   * Get all clipboard data including metadata
   * @returns {{ items: string[], operation: string|null, source: string|null }}
   */
  getData() {
    return {
      items: this._items,
      operation: this._operation,
      source: this._source
    };
  },

  /**
   * Check if clipboard has items
   * @returns {boolean}
   */
  hasItems() {
    return this._items.length > 0;
  },

  /**
   * Get the operation type
   * @returns {'copy'|'cut'|null}
   */
  getOperation() {
    return this._operation;
  },

  /**
   * Clear clipboard (call after cut operation completes)
   */
  clear() {
    debug('ClipboardService.clear');
    this._items = [];
    this._operation = null;
    this._source = null;
    this._timestamp = null;
  },

  /**
   * Clear only if operation was 'cut' (after paste)
   */
  clearIfCut() {
    if (this._operation === 'cut') {
      this.clear();
    }
  }
};
