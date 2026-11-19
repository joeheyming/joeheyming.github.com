/**
 * Central window.postMessage listener for iframe apps talking to Heyming OS.
 * Message shape lives in `/shared/os-protocol.js`. This module only decides
 * what each request does.
 */
import { Config, saveHostname } from './config.js';
import { osProtocol } from './constants.js';
import { loadPrefs, patchPrefs } from './prefs.js';

/**
 * @param {object} os — HeymingOS instance (launchApp, openFileWithApp, saveFileToFilesystem, …)
 * @returns {() => void} unsubscribe
 */
export function bindIframeMessageListener(os) {
  const { routeRequest, IframeActions, MessageTypes } = osProtocol();
  /** @type {NonNullable<Parameters<NonNullable<Window['HeymingOsProtocol']>['routeRequest']>[1]>} */
  const handlers = {
    [IframeActions.LAUNCH](msg) {
      os.launchApp(msg.app);
    },
    [IframeActions.OPEN_FILE](msg) {
      os.openFileWithApp(msg.app, msg.path, msg.content, msg.fileName);
    },
    [IframeActions.SAVE](msg) {
      os.saveFileToFilesystem(msg.path, msg.content, msg.fileName);
    },
    [IframeActions.SAVE_AS](msg, source) {
      os.showSaveAsDialog(msg.content, msg.suggestedName, msg.sourceWindow, source);
    },
    [IframeActions.OPEN_DESKTOP_FILE](msg) {
      void os.openDesktopFile(msg.file).catch((err) => {
        console.error('[HeymingOS] openDesktopFile (iframe) failed', err);
        os.notifications?.error?.(`Could not open file: ${err?.message || err}`);
      });
    },
    [IframeActions.FILESYSTEM_CHANGED]() {
      os.desktop.refresh();
    },
    [IframeActions.SET_OS_PREFS](msg, source) {
      const patch = msg.patch && typeof msg.patch === 'object' ? { ...msg.patch } : {};
      if (typeof patch.hostname === 'string') {
        saveHostname(patch.hostname);
        delete patch.hostname;
      }
      if (Object.keys(patch).length) {
        patchPrefs(patch);
      }
      void os.applyPrefs();
      _replyPrefs(source);
    },
    [IframeActions.GET_OS_PREFS](_msg, source) {
      _replyPrefs(source);
    },
    [IframeActions.OPEN_ABOUT]() {
      os.openAboutDialog();
    },
    [IframeActions.RESET_OS]() {
      os.resetOs();
    },
    [MessageTypes.REQUEST_PENDING_FILE](msg, source) {
      if (os.pendingFileOpen && os.pendingFileOpen.app === msg.app && source) {
        source.postMessage(
          {
            type: MessageTypes.OPEN_FILE,
            path: os.pendingFileOpen.path,
            content: os.pendingFileOpen.content,
            fileName: os.pendingFileOpen.fileName
          },
          { targetOrigin: '*' }
        );
        os.pendingFileOpen = null;
      }
    },
    [MessageTypes.OPEN_FILE_DIALOG](msg, source) {
      os.showOpenFileDialog(msg.fileTypes, msg.title, source);
    }
  };

  const handler = (/** @type {MessageEvent} */ e) => {
    const result = routeRequest(e.data, handlers, e.source);
    if (result === 'unknown') {
      console.warn('[HeymingOS] unknown iframe action:', actionOf(e.data));
    }
  };

  const view = globalThis.window;
  view.addEventListener('message', handler);
  return () => view.removeEventListener('message', handler);
}

/**
 * @param {unknown} data
 * @returns {string | undefined}
 */
function actionOf(data) {
  if (!data || typeof data !== 'object' || !('message' in data)) return undefined;
  const message = /** @type {{ message?: unknown }} */ (data).message;
  if (!message || typeof message !== 'object' || !('type' in message)) return undefined;
  const action = /** @type {{ type?: unknown }} */ (message).type;
  return typeof action === 'string' ? action : undefined;
}

/** @param {MessageEventSource | null} source */
function _replyPrefs(source) {
  if (!source || typeof source.postMessage !== 'function') return;
  const prefs = loadPrefs();
  source.postMessage(
    {
      type: osProtocol().MessageTypes.OS_PREFS,
      prefs,
      username: Config.USER,
      hostname: Config.HOSTNAME,
      version: Config.OS_VERSION,
      osName: Config.OS_NAME,
      tagline: Config.OS_TAGLINE
    },
    { targetOrigin: '*' }
  );
}
