/**
 * Heyming OS - Drag Service
 * Handles cross-iframe drag/drop data sharing
 *
 * Why this exists:
 * - dataTransfer.getData() doesn't work reliably across iframe boundaries
 * - We need a shared location for drag data that both the OS and apps can access
 * - This provides a clean API instead of raw window.top._heymingDragData access
 */

import { debug } from './config.js';

// How long before drag data is considered stale (5 seconds)
const STALE_TIMEOUT_MS = 5000;

export const DragService = {
  _data: null,
  _source: null,
  _timestamp: null,

  /**
   * Set drag data when starting a drag operation
   * @param {Object} data - Drag data object
   * @param {string} data.path - File path being dragged
   * @param {string} data.action - 'move' or 'copy'
   * @param {string} source - Source identifier (e.g., 'desktop', 'filemanager')
   */
  setData(data, source = 'unknown') {
    this._data = data;
    this._source = source;
    this._timestamp = Date.now();

    debug('DragService.setData:', data, 'from:', source);
  },

  /**
   * Get current drag data
   * Automatically clears stale data (>30 seconds old)
   * @returns {Object|null} Drag data or null if none/stale
   */
  getData() {
    if (this.isStale()) {
      this.clear();
      return null;
    }
    return this._data;
  },

  /**
   * Get the source of the current drag
   * @returns {string|null} Source identifier or null
   */
  getSource() {
    return this._source;
  },

  /**
   * Clear drag data (call on dragend or drop)
   */
  clear() {
    debug('DragService.clear');
    this._data = null;
    this._source = null;
    this._timestamp = null;
  },

  /**
   * Check if there's active drag data
   * @returns {boolean}
   */
  hasData() {
    return this._data !== null;
  },

  /**
   * Check if drag data is stale (older than 30 seconds)
   * Helps prevent orphaned drag data from causing issues
   * @returns {boolean}
   */
  isStale() {
    if (!this._timestamp) return true;
    return Date.now() - this._timestamp > STALE_TIMEOUT_MS;
  },

  /**
   * Get data and clear in one operation (atomic consume)
   * @returns {Object|null} Drag data or null
   */
  consume() {
    const data = this._data;
    this.clear();
    return data;
  }
};
