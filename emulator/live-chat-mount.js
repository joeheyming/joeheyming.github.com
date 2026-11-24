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

/** @returns {Promise<void>} */
export function mountEmulatorChat() {
  if (!mounted) {
    ensureChatCss();
    mounted = import('/live-chat/index.js')
      .then((mod) => {
        mod.mountLiveChat({ room: 'emulator' });
      })
      .catch((err) => {
        console.warn('[emulator] live chat did not load:', err);
      });
  }
  return mounted;
}
