// Site-wide achievements: persistent unlock state and desktop notifications.
(function () {
  'use strict';

  if (window.heymingAchievements) return;

  const STORAGE_KEY = 'heyming.achievements.v1';
  const listeners = new Set();
  let catalog = [];
  let registry = [];

  function emptyState() {
    return { version: 1, unlocked: {} };
  }

  function readState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !parsed.unlocked || typeof parsed.unlocked !== 'object') {
        return emptyState();
      }
      return parsed;
    } catch {
      return emptyState();
    }
  }

  let state = readState();

  function writeState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') {
          resolve();
          return;
        }
        if (src.includes('registry-path') && window.HeymingRegistryPath) {
          resolve();
          return;
        }
        if (src.includes('achievements-toast') && window.HeymingAchievementToasts) {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), {
          once: true
        });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      const timer = setTimeout(() => reject(new Error(`Timeout loading ${src}`)), 3000);
      script.addEventListener('load', () => {
        clearTimeout(timer);
        script.dataset.loaded = '1';
        resolve();
      });
      script.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`Failed to load ${src}`));
      });
      document.head.appendChild(script);
    });
  }

  function ensureRegistryPath() {
    if (window.HeymingRegistryPath) return Promise.resolve();
    return loadScript('/shared/registry-path.js');
  }

  function ensureToastModule() {
    if (window.HeymingAchievementToasts) {
      window.HeymingAchievementToasts.wire?.();
      return Promise.resolve();
    }
    return loadScript('/achievements-toast.js')
      .then(() => {
        window.HeymingAchievementToasts?.wire?.();
      })
      .catch((error) => {
        console.warn('[achievements] toast module failed to load', error);
      });
  }

  function getCurrentAppId() {
    const api = window.HeymingRegistryPath;
    if (!api) {
      const here = (window.location.pathname || '/')
        .replace(/\/index\.html$/i, '')
        .replace(/\/+$/, '');
      const segments = (here || '/').split('/').filter(Boolean);
      return segments[0] || 'home';
    }
    return api.resolveAppIdFromLocation(registry, {
      pathname: window.location.pathname,
      search: window.location.search
    });
  }

  function getDefinition(id) {
    return catalog.find((achievement) => achievement.id === id) || null;
  }

  function notifySubscribers(id, source) {
    const detail = { id, source, unlocked: getUnlocked() };
    for (const listener of listeners) {
      try {
        listener(detail);
      } catch (error) {
        console.warn('[achievements] subscriber failed', error);
      }
    }
    window.dispatchEvent(new CustomEvent('heyming-achievement-change', { detail }));
  }

  function getUnlocked() {
    return { ...state.unlocked };
  }

  function isUnlocked(id) {
    return Object.prototype.hasOwnProperty.call(state.unlocked, id);
  }

  async function unlock(id) {
    await ready;
    if (typeof id !== 'string' || isUnlocked(id)) return false;
    const definition = getDefinition(id);
    if (!definition) {
      console.warn(`[achievements] Unknown achievement: ${id}`);
      return false;
    }
    if (definition.requiresId && !isUnlocked(definition.requiresId)) {
      return false;
    }

    const unlockedAt = new Date().toISOString();
    state = {
      version: 1,
      unlocked: {
        ...state.unlocked,
        [id]: { unlockedAt }
      }
    };
    writeState();
    notifySubscribers(id, 'local');
    return true;
  }

  async function unlockForCurrentApp(slug) {
    await ready;
    return unlock(`${getCurrentAppId()}:${slug}`);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  const ready = ensureRegistryPath()
    .then(() =>
      Promise.all([
        fetch('/achievements-catalog.json').then((response) => {
          if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
          return response.json();
        }),
        fetch('/apps-registry.json').then((response) => {
          if (!response.ok) throw new Error(`registry HTTP ${response.status}`);
          return response.json();
        }),
        ensureToastModule()
      ])
    )
    .then(([catalogDocument, registryDocument]) => {
      catalog = Array.isArray(catalogDocument?.achievements) ? catalogDocument.achievements : [];
      registry = Array.isArray(registryDocument) ? registryDocument : [];
      // Toast may have subscribed before catalog resolved; re-wire with fresh ready.
      window.HeymingAchievementToasts?.wire?.();
      return { catalog: [...catalog], currentAppId: getCurrentAppId() };
    })
    .catch((error) => {
      console.warn('[achievements] initialization failed', error);
      return { catalog: [], currentAppId: getCurrentAppId() };
    });

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = readState();
    notifySubscribers(null, 'storage');
  });

  window.heymingAchievements = {
    ready,
    unlock,
    unlockForCurrentApp,
    isUnlocked,
    getUnlocked,
    getCurrentAppId,
    subscribe,
    storageKey: STORAGE_KEY
  };
})();
