/**
 * Shared registry path → app identity.
 *
 * One Module for “which apps-registry entry matches this URL?” so nav and
 * achievements stay aligned on query-specific paths
 * (e.g. /doom/?manual=browse → doom-mods).
 */
(function (global) {
  'use strict';

  function normalizePathname(pathname) {
    let path = (pathname || '/').replace(/\/index\.html$/i, '');
    path = path.replace(/\/+$/, '');
    return path || '/';
  }

  /**
   * Split a registry `path` (`./play/drums/` or `./doom/?manual=browse`)
   * into a normalized pathname + search string (including leading `?`).
   */
  function registryPathParts(app) {
    const raw = app?.path || '';
    const withoutDot = raw.startsWith('./')
      ? '/' + raw.slice(2)
      : raw.startsWith('/')
        ? raw
        : raw
          ? '/' + raw
          : '/';
    const q = withoutDot.indexOf('?');
    const pathPart = q >= 0 ? withoutDot.slice(0, q) : withoutDot;
    const search = q >= 0 ? withoutDot.slice(q) : '';
    return { pathname: normalizePathname(pathPart), search };
  }

  function locationMatchesApp(app, location) {
    const parts = registryPathParts(app);
    const here = normalizePathname(location?.pathname);
    if (here !== parts.pathname) return false;
    if (!parts.search) return true;
    const required = new URLSearchParams(parts.search);
    const actual = new URLSearchParams(location?.search || '');
    for (const [key, value] of required.entries()) {
      if (actual.get(key) !== value) return false;
    }
    return true;
  }

  /**
   * Longest path+query match wins so nested apps beat their hubs.
   * @returns {object|null} registry entry
   */
  function resolveAppFromLocation(registry, location) {
    let best = null;
    let bestScore = -1;
    for (const app of registry || []) {
      if (!app?.id || !app.path) continue;
      if (!locationMatchesApp(app, location)) continue;
      const parts = registryPathParts(app);
      const score = parts.pathname.length + parts.search.length;
      if (score > bestScore) {
        best = app;
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * @param {object[]} registry
   * @param {{ pathname?: string, search?: string }} location
   * @param {{ fallback?: (here: string) => string }} [options]
   *   Default fallback: first path segment, or `'home'`.
   */
  function resolveAppIdFromLocation(registry, location, options) {
    const match = resolveAppFromLocation(registry, location);
    if (match) return match.id;
    const here = normalizePathname(location?.pathname);
    if (typeof options?.fallback === 'function') {
      return options.fallback(here);
    }
    const segments = here.split('/').filter(Boolean);
    return segments[0] || 'home';
  }

  global.HeymingRegistryPath = {
    normalizePathname,
    registryPathParts,
    locationMatchesApp,
    resolveAppFromLocation,
    resolveAppIdFromLocation
  };
})(typeof window !== 'undefined' ? window : globalThis);
