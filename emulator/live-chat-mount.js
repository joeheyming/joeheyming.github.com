// Live chat for the emulator hub and every console page. One shared room.
// launch.js starts this with the page and awaits it again before the play
// path, because the keyboard guard has to wrap addEventListener before
// SOCD and EmulatorJS register their key handlers.

/** @type {Promise<void> | null} */
let mounted = null;

function ensureChatCss() {
  if (document.querySelector('link[data-live-chat-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/live-chat/live-chat.css';
  link.dataset.liveChatCss = '';
  (document.head || document.documentElement).appendChild(link);
}

/**
 * Sit the chip in the top-right cluster, immediately left of Share.
 * The panel stays on the chat root, so it still opens from that button.
 * @param {Document} [doc]
 */
export function dockEmulatorChat(doc = document) {
  const root = doc.querySelector('.live-chat');
  const overlay = doc.querySelector('.share-overlay');
  if (!root || !overlay || root.parentElement === overlay) return;
  overlay.prepend(root);
}

/** @returns {Promise<void>} */
export function mountEmulatorChat() {
  if (!mounted) {
    ensureChatCss();
    mounted = import('/live-chat/index.js')
      .then((mod) => {
        mod.mountLiveChat({ room: 'emulator', toggle: true });
        dockEmulatorChat();
      })
      .catch((err) => {
        console.warn('[emulator] live chat did not load:', err);
      });
  }
  return mounted;
}
