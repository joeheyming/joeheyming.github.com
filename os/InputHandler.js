/**
 * Heyming OS - Input Handler
 * Unified mouse/touch event handling
 */

import { Constants } from './constants.js';

export const InputHandler = {
  // Keyboard state tracking
  _metaKeyAlone: false,
  _modifierCallbacks: [],

  /**
   * Check if current viewport is mobile-sized
   * @returns {boolean}
   */
  isMobile() {
    return window.innerWidth <= Constants.MOBILE_BREAKPOINT;
  },

  /**
   * Initialize keyboard state tracking
   * Call once during OS initialization
   */
  initKeyboardTracking() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Meta') {
        this._metaKeyAlone = true;
      } else if (e.metaKey) {
        // Another key was pressed with Meta, so it's a combo (like Cmd+C)
        this._metaKeyAlone = false;
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Meta' && this._metaKeyAlone) {
        // Fire registered callbacks when Meta was pressed alone
        this._modifierCallbacks.forEach((cb) => cb('meta'));
      }
      this._metaKeyAlone = false;
    });
  },

  /**
   * Register callback for when Meta key is pressed and released alone
   * @param {Function} callback - Called with 'meta' when key released alone
   * @returns {Function} Unregister function
   */
  onMetaKeyAlone(callback) {
    this._modifierCallbacks.push(callback);
    return () => {
      const idx = this._modifierCallbacks.indexOf(callback);
      if (idx !== -1) this._modifierCallbacks.splice(idx, 1);
    };
  },

  /**
   * Get pointer coordinates from mouse or touch event
   * @param {Event} e - Mouse or touch event
   * @returns {{clientX: number, clientY: number}}
   */
  getPointerCoordinates(e) {
    const ev = /** @type {MouseEvent|TouchEvent} */ (e);
    if ('touches' in ev && ev.touches.length > 0) {
      return {
        clientX: ev.touches[0].clientX,
        clientY: ev.touches[0].clientY
      };
    }
    return {
      clientX: /** @type {MouseEvent} */ (ev).clientX,
      clientY: /** @type {MouseEvent} */ (ev).clientY
    };
  },

  /**
   * Add unified pointer event listeners (mouse + touch)
   * @param {HTMLElement} element - Element to attach listeners to
   * @param {Object} handlers - Event handlers { onStart, onMove, onEnd }
   * @returns {Function} Cleanup function to remove listeners
   */
  addDragListeners(element, handlers) {
    const { onStart, onMove, onEnd } = handlers;
    let isActive = false;

    const cleanup = () => {
      isActive = false;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleEnd);
      window.removeEventListener('blur', handleEnd);
    };

    const handleStart = (e) => {
      isActive = true;
      if (onStart) {
        onStart(e, this.getPointerCoordinates(e));
      }

      // Add move/end listeners
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleEnd);
      document.addEventListener('touchmove', handleMove, { passive: false });
      document.addEventListener('touchend', handleEnd);
      document.addEventListener('touchcancel', handleEnd);
      // Cancel drag if window loses focus (mouse released outside browser)
      window.addEventListener('blur', handleEnd);
    };

    const handleMove = (e) => {
      if (!isActive) return;

      // Safety check: if mouse button is no longer pressed, end the drag
      // e.buttons is 0 when no buttons are pressed (handles missed mouseup)
      if (e.type === 'mousemove' && e.buttons === 0) {
        handleEnd(e);
        return;
      }

      if (onMove) {
        onMove(e, this.getPointerCoordinates(e));
      }
      e.preventDefault();
    };

    const handleEnd = (e) => {
      if (!isActive) return;
      if (onEnd) {
        onEnd(e);
      }
      cleanup();
    };

    // Add start listeners
    element.addEventListener('mousedown', handleStart);
    element.addEventListener('touchstart', handleStart, { passive: false });

    // Return cleanup function
    return () => {
      element.removeEventListener('mousedown', handleStart);
      element.removeEventListener('touchstart', handleStart);
      cleanup();
    };
  },

  /**
   * Add double-tap/double-click handler with mobile single-tap support
   * @param {HTMLElement} element - Element to attach listener to
   * @param {Function} callback - Handler to call on activation
   * @returns {Function} Cleanup function
   */
  addDoubleTapHandler(element, callback) {
    const handleDblClick = (e) => {
      e.preventDefault();
      callback();
    };

    const handleTouchEnd = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Single tap on mobile - immediate response
      callback();
    };

    const handleTouchStart = (e) => {
      e.preventDefault();
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    // Desktop double-click
    element.addEventListener('dblclick', handleDblClick);

    // Mobile single tap
    element.addEventListener('touchend', handleTouchEnd, { passive: false });
    element.addEventListener('touchstart', handleTouchStart, { passive: false });
    element.addEventListener('contextmenu', handleContextMenu);

    // Return cleanup function
    return () => {
      element.removeEventListener('dblclick', handleDblClick);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('contextmenu', handleContextMenu);
    };
  }
};
