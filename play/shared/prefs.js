/**
 * Tiny localStorage wrapper that quietly ignores failures (private mode,
 * disabled storage, etc.). Each instrument page passes its own key.
 */

export function makePrefs(key) {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed ? parsed : {};
      } catch (_) {
        return {};
      }
    },
    save(obj) {
      try {
        localStorage.setItem(key, JSON.stringify(obj));
      } catch (_) {
        /* ignore */
      }
    }
  };
}
