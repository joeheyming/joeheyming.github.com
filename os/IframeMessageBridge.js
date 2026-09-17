/**
 * Central window.postMessage listener for iframe apps talking to Heyming OS.
 */
import { MessageTypes, IframeActions } from './constants.js';
import { Config, saveHostname } from './config.js';
import { loadPrefs, patchPrefs } from './prefs.js';

/**
 * @param {object} os — HeymingOS instance (launchApp, openFileWithApp, saveFileToFilesystem, …)
 * @returns {() => void} unsubscribe
 */
export function bindIframeMessageListener(os) {
  const handler = (e) => {
    const data = e.data;
    if (data.type !== MessageTypes.IFRAME_MESSAGE) return;

    const msg = data.message;
    if (msg?.type === IframeActions.LAUNCH) {
      os.launchApp(msg.app);
    } else if (msg?.type === IframeActions.OPEN_FILE) {
      os.openFileWithApp(msg.app, msg.path, msg.content, msg.fileName);
    } else if (msg?.type === IframeActions.SAVE) {
      os.saveFileToFilesystem(msg.path, msg.content, msg.fileName);
    } else if (msg?.type === IframeActions.SAVE_AS) {
      os.showSaveAsDialog(msg.content, msg.suggestedName, msg.sourceWindow, e.source);
    } else if (msg?.type === IframeActions.OPEN_DESKTOP_FILE) {
      void os.openDesktopFile(msg.file).catch((err) => {
        console.error('[HeymingOS] openDesktopFile (iframe) failed', err);
        os.notifications?.error?.(`Could not open file: ${err?.message || err}`);
      });
    } else if (msg?.type === IframeActions.FILESYSTEM_CHANGED) {
      os.desktop.refresh();
    } else if (msg?.type === IframeActions.SET_OS_PREFS) {
      const patch = msg.patch && typeof msg.patch === 'object' ? msg.patch : {};
      if (typeof patch.hostname === 'string') {
        saveHostname(patch.hostname);
        delete patch.hostname;
      }
      if (Object.keys(patch).length) {
        patchPrefs(patch);
      }
      void os.applyPrefs();
      _replyPrefs(e.source);
    } else if (msg?.type === IframeActions.GET_OS_PREFS) {
      _replyPrefs(e.source);
    } else if (msg?.type === IframeActions.OPEN_ABOUT) {
      os.openAboutDialog();
    } else if (msg?.type === IframeActions.RESET_OS) {
      os.resetOs();
    } else if (msg?.type === MessageTypes.REQUEST_PENDING_FILE) {
      if (os.pendingFileOpen && os.pendingFileOpen.app === msg.app) {
        e.source.postMessage(
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
    } else if (msg?.type === MessageTypes.OPEN_FILE_DIALOG) {
      os.showOpenFileDialog(msg.fileTypes, msg.title, e.source);
    }
  };

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

function _replyPrefs(source) {
  if (!source || typeof source.postMessage !== 'function') return;
  const prefs = loadPrefs();
  source.postMessage(
    {
      type: MessageTypes.OS_PREFS,
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
