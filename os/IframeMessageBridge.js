/**
 * Central window.postMessage listener for iframe apps talking to Heyming OS.
 */
import { MessageTypes, IframeActions } from './constants.js';

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
      os.launchApp(msg.app, 'iframe_message');
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
