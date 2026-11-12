// Live chat for the doom room. The picker mounts it when idle; launch
// awaits it too, because its keyboard guard has to wrap addEventListener
// before uzdoom.js registers the engine's key handlers.

/** @type {Promise<void> | null} */
let mounted = null;

/** @returns {Promise<void>} */
export function mountDoomChat() {
  if (!mounted) {
    mounted = import('/live-chat/index.js')
      .then((mod) => {
        mod.mountLiveChat({ room: 'doom' });
      })
      .catch((err) => {
        console.warn('[doom] live chat did not load:', err);
      });
  }
  return mounted;
}
