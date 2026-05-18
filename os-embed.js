/**
 * Shared HeymingOS embed bridge.
 *
 * Apps that can run either standalone OR inside a HeymingOS iframe use
 * this module so they don't each re-derive the postMessage protocol,
 * the embed-detection check, and the notify-via-parent fallback.
 *
 * Two adapters exist today:
 *   • Standalone: notifications paint locally (delegated to a notifier
 *     created by `/notifications.js`); "save" calls a host-supplied
 *     `onSaveStandalone` (typically a Blob download).
 *   • Embedded:   notifications forward to `window.parent.HeymingOS.
 *     notifications`; save / save-as / open-file flow over postMessage
 *     using the protocol defined in `os/constants.js`.
 *
 * Source of truth for the protocol IDs is `os/constants.js`. We
 * defensively copy the strings here so a non-HeymingOS app can use
 * this module without importing OS internals (and so the bridge keeps
 * working if `os/` reorganizes).
 *
 * Usage:
 *
 *     import { createOSEmbed } from '/os-embed.js';
 *
 *     const embed = createOSEmbed({
 *       app: 'paint',
 *       fileTypes: ['.paintproj', 'image/*'],
 *       title: 'Open in Paint',
 *       onOpenFile: ({ content, fileName }) => loadProject(content, fileName),
 *       notifier: localNotifier,  // from /notifications.js (used when standalone)
 *     });
 *
 *     // Anywhere in the app:
 *     embed.notify('Saved.', { kind: 'success' });
 *     embed.requestOpenDialog();
 *     embed.saveAs(blobOrString, 'untitled.paintproj');
 *
 *     // To grow the file menu only when embedded:
 *     if (embed.isEmbedded) embed.installSaveMenu(fileMenuListEl, [
 *       { label: 'Paint project (.paintproj)', save: () => projectBytes() },
 *       { label: 'PNG image',                  save: () => pngDataUrl() }
 *     ]);
 */

// Protocol constants — kept in lock-step with `os/constants.js` MessageTypes
// + IframeActions. Defensive copy so a standalone app doesn't have to
// import from /os/.
const MSG = {
  IFRAME_MESSAGE: 'iframe-message',
  REQUEST_PENDING_FILE: 'requestPendingFile',
  OPEN_FILE_DIALOG: 'openFileDialog',
  OPEN_FILE: 'openFile',
  FILE_SAVED: 'fileSaved',
  FILESYSTEM_CHANGE: 'filesystem-change'
};

const ACTION = {
  OPEN_FILE: 'openFile',
  OPEN_DESKTOP_FILE: 'openDesktopFile',
  SAVE: 'save',
  SAVE_AS: 'saveAs',
  LAUNCH: 'launch',
  FILESYSTEM_CHANGED: 'filesystemChanged'
};

/**
 * @returns {boolean} true when running inside a HeymingOS iframe
 *   (parent window has `HeymingOS`).
 */
export function isOsEmbedded() {
  try {
    return window.self !== window.top && !!window.parent?.HeymingOS;
  } catch {
    // Cross-origin parent throws on access — treat as not-embedded.
    return false;
  }
}

/**
 * Lightweight "are we inside ANY iframe" check for apps that just want
 * to detect ambient embedding without relying on parent.HeymingOS being
 * present (e.g. a hostile-iframe sniff used to disable destructive
 * features by default).
 */
export function isInIframe() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * @typedef {Object} OSEmbedConfig
 * @property {string} app                     App id (used by host to route OPEN_FILE replies).
 * @property {string[]} [fileTypes]           Default fileTypes for OPEN_FILE_DIALOG.
 * @property {string} [title]                 Default title for OPEN_FILE_DIALOG.
 * @property {(file: { content: any, fileName?: string, mimeType?: string }) => void} [onOpenFile]
 *                                            Called when host posts OPEN_FILE in response to a
 *                                            requestOpenDialog or a desktop "Open With…".
 * @property {(args: { content: any, suggestedName?: string }) => void} [onSaveStandalone]
 *                                            Called when not embedded and `saveAs` is invoked
 *                                            (typical implementation: trigger a Blob download).
 * @property {{ notify: (msg: string, opts?: { kind?: string }) => unknown }} [notifier]
 *                                            Local notifier used when running standalone. When
 *                                            embedded, notifications go through the parent's
 *                                            HeymingOS NotificationService instead.
 */

/**
 * Create an embed bridge for `app`. The returned bridge is safe to call
 * unconditionally — methods that only make sense when embedded (e.g.
 * `installSaveMenu`) are no-ops standalone.
 *
 * @param {OSEmbedConfig} config
 */
export function createOSEmbed(config) {
  const { app, notifier } = config;
  const embedded = isOsEmbedded();
  const defaultFileTypes = config.fileTypes || [];
  const defaultTitle = config.title || `Open in ${app}`;

  function postToHost(message) {
    if (!embedded) return;
    try {
      window.parent.postMessage({ type: MSG.IFRAME_MESSAGE, message }, '*');
    } catch {
      /* parent went away */
    }
  }

  // Host → app: OPEN_FILE delivers content for an opened file.
  function handleHostMessage(e) {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === MSG.OPEN_FILE) {
      if (typeof config.onOpenFile === 'function') {
        config.onOpenFile({
          content: data.content,
          fileName: data.fileName,
          mimeType: data.mimeType
        });
      }
    }
  }
  window.addEventListener('message', handleHostMessage);

  // On boot, ask the host whether there's a pending file the desktop
  // launched us with. Mirrors what fs-os.js / paint did inline.
  if (embedded) {
    try {
      window.parent.postMessage(
        { type: MSG.REQUEST_PENDING_FILE, app },
        '*'
      );
    } catch {
      /* parent went away */
    }
  }

  /** @param {string} message @param {{ kind?: string }} [opts] */
  function notify(message, opts = {}) {
    if (embedded) {
      // Forward to the parent's NotificationService. The OS picks
      // a method by kind ('success' / 'error' / 'warning' / 'info').
      const ns = window.parent?.HeymingOS?.notifications;
      if (ns) {
        const kind = opts.kind || 'info';
        const method = typeof ns[kind] === 'function' ? kind : 'info';
        try {
          ns[method](message);
          return;
        } catch {
          /* fall through to local */
        }
      }
    }
    if (notifier) notifier.notify(message, opts);
  }

  function requestOpenDialog(fileTypes, title) {
    if (!embedded) return false;
    postToHost({
      type: MSG.OPEN_FILE_DIALOG,
      fileTypes: fileTypes || defaultFileTypes,
      title: title || defaultTitle
    });
    return true;
  }

  /**
   * Save (host owns the path). When standalone, `onSaveStandalone` is
   * the host-app's fallback — usually a download.
   * @param {string} path
   * @param {any} content
   * @param {string} [fileName]
   */
  function save(path, content, fileName) {
    if (embedded) {
      postToHost({ type: ACTION.SAVE, path, content, fileName });
      return;
    }
    if (typeof config.onSaveStandalone === 'function') {
      config.onSaveStandalone({ content, suggestedName: fileName });
    }
  }

  /**
   * Save-As (host shows a dialog). Standalone falls back to
   * `onSaveStandalone` so the same call site works in both worlds.
   * @param {any} content
   * @param {string} [suggestedName]
   */
  function saveAs(content, suggestedName) {
    if (embedded) {
      postToHost({ type: ACTION.SAVE_AS, content, suggestedName });
      return;
    }
    if (typeof config.onSaveStandalone === 'function') {
      config.onSaveStandalone({ content, suggestedName });
    }
  }

  /**
   * Grow an existing file menu with "Open from OS…" + a "Save to OS"
   * submenu, but only when embedded. Standalone is a no-op so callers
   * can wire this unconditionally.
   *
   * @param {HTMLElement} fileMenuListEl
   * @param {Array<{ label: string, save: () => any | Promise<any>, suggestedName?: string }>} saveTargets
   * @param {{ openInsertAfter?: HTMLElement, separator?: boolean, closeMenu?: () => void }} [opts]
   * @returns {() => void} cleanup that removes the inserted nodes
   */
  function installSaveMenu(fileMenuListEl, saveTargets, opts = {}) {
    if (!embedded || !fileMenuListEl) return () => {};
    /** @type {HTMLElement[]} */
    const inserted = [];
    const closeMenu = typeof opts.closeMenu === 'function' ? opts.closeMenu : () => {};

    const openBtn = document.createElement('button');
    openBtn.className = 'action-menu-item';
    openBtn.textContent = 'Open from OS…';
    openBtn.addEventListener('click', () => {
      closeMenu();
      requestOpenDialog();
    });
    if (opts.openInsertAfter && opts.openInsertAfter.parentNode === fileMenuListEl) {
      opts.openInsertAfter.after(openBtn);
    } else {
      fileMenuListEl.appendChild(openBtn);
    }
    inserted.push(openBtn);

    if (opts.separator !== false) {
      const sep = document.createElement('div');
      sep.className = 'action-menu-sep';
      fileMenuListEl.appendChild(sep);
      inserted.push(sep);
    }

    const saveItem = document.createElement('div');
    saveItem.className = 'action-menu-item has-submenu';
    saveItem.setAttribute('role', 'menuitem');
    saveItem.setAttribute('aria-haspopup', 'true');
    saveItem.textContent = 'Save to OS';

    const submenu = document.createElement('div');
    submenu.className = 'action-submenu';
    submenu.setAttribute('role', 'menu');
    for (const target of saveTargets) {
      const btn = document.createElement('button');
      btn.className = 'action-menu-item';
      btn.textContent = target.label;
      btn.addEventListener('click', async () => {
        closeMenu();
        try {
          const content = await target.save();
          if (content != null) saveAs(content, target.suggestedName);
        } catch (err) {
          notify(`Couldn't save: ${err?.message || err}`, { kind: 'error' });
        }
      });
      submenu.appendChild(btn);
    }
    saveItem.appendChild(submenu);
    fileMenuListEl.appendChild(saveItem);
    inserted.push(saveItem);

    return function cleanup() {
      for (const el of inserted) el.remove();
    };
  }

  function notifyFilesystemChanged(path) {
    postToHost({ type: ACTION.FILESYSTEM_CHANGED, path });
  }

  /**
   * Ask the host OS to launch another app by id. Used by tool-using apps
   * (e.g. the Chat assistant calling `launchApp("paint")`). No-op when
   * standalone — the caller can fall back to a plain navigation.
   *
   * @param {string} appId
   * @returns {boolean} true when the message was sent to the host
   */
  function launchApp(appId) {
    if (!embedded || !appId) return false;
    postToHost({ type: ACTION.LAUNCH, app: appId });
    return true;
  }

  function dispose() {
    window.removeEventListener('message', handleHostMessage);
  }

  return {
    /** True when running inside a HeymingOS iframe. */
    isEmbedded: embedded,
    notify,
    requestOpenDialog,
    save,
    saveAs,
    installSaveMenu,
    notifyFilesystemChanged,
    launchApp,
    dispose
  };
}
