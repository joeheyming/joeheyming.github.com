/**
 * Heyming OS message protocol.
 *
 * One Module for the messages between the OS and an Application running
 * in a window. Classic script: it publishes `window.HeymingOsProtocol`
 * so both classic scripts and ES modules can use it. `os/index.html`
 * loads this before `os/index.js`.
 */
(function (global) {
  'use strict';

  const MessageTypes = Object.freeze({
    IFRAME_MESSAGE: 'iframe-message',
    REQUEST_PENDING_FILE: 'requestPendingFile',
    OPEN_FILE_DIALOG: 'openFileDialog',
    OPEN_FILE: 'openFile',
    FILE_SAVED: 'fileSaved',
    FILESYSTEM_CHANGE: 'filesystem-change',
    OS_PREFS: 'osPrefs'
  });

  const IframeActions = Object.freeze({
    OPEN_FILE: 'openFile',
    OPEN_DESKTOP_FILE: 'openDesktopFile',
    SAVE: 'save',
    SAVE_AS: 'saveAs',
    LAUNCH: 'launch',
    FILESYSTEM_CHANGED: 'filesystemChanged',
    SET_OS_PREFS: 'setOsPrefs',
    GET_OS_PREFS: 'getOsPrefs',
    OPEN_ABOUT: 'openAbout',
    RESET_OS: 'resetOs'
  });

  /** Actions an Application may send, always wrapped in iframe-message. */
  const ACTIONS = new Set([
    ...Object.values(IframeActions),
    MessageTypes.REQUEST_PENDING_FILE,
    MessageTypes.OPEN_FILE_DIALOG
  ]);

  /**
   * @param {string} action
   * @param {Record<string, unknown>} [payload]
   */
  function request(action, payload) {
    if (!ACTIONS.has(action)) {
      throw new Error('Unknown Heyming OS action: ' + action);
    }
    const message = payload && typeof payload === 'object' ? { ...payload } : {};
    message.type = action;
    return { type: MessageTypes.IFRAME_MESSAGE, message };
  }

  /**
   * @param {string} action
   * @param {Record<string, unknown>} [payload]
   * @returns {boolean}
   */
  function sendToOs(action, payload) {
    const message = request(action, payload);
    try {
      if (global.self === global.top) return false;
      if (!global.parent || !global.parent.HeymingOS) return false;
      global.parent.postMessage(message, '*');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {unknown} data
   * @param {Record<string, (payload: Record<string, unknown>, source: unknown) => void>} [handlers]
   * @param {unknown} [source]
   * @returns {'handled' | 'ignored' | 'unknown'}
   */
  function routeRequest(data, handlers, source) {
    if (!data || typeof data !== 'object' || !('type' in data)) return 'ignored';
    if (data.type !== MessageTypes.IFRAME_MESSAGE) return 'ignored';
    const message = 'message' in data ? data.message : undefined;
    const action =
      message && typeof message === 'object' && 'type' in message ? message.type : undefined;
    if (typeof action !== 'string' || !ACTIONS.has(action)) return 'unknown';
    const handler = handlers && handlers[action];
    if (typeof handler !== 'function') return 'unknown';
    handler(/** @type {Record<string, unknown>} */ (message), source);
    return 'handled';
  }

  global.HeymingOsProtocol = {
    MessageTypes,
    IframeActions,
    request,
    sendToOs,
    routeRequest
  };
})(typeof window !== 'undefined' ? window : globalThis);
