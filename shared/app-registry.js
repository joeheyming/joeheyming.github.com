/**
 * Application registry client.
 *
 * One load of apps-registry.json, one way to build a link, and one listing
 * rule. Classic script: it publishes `window.HeymingRegistry`. site.js loads
 * shared/registry-path.js and then this file before the chrome that reads it.
 * The home page loads app.js first; when AppModule already has the entries,
 * this reuses them and does not fetch again.
 */
(function (global) {
  'use strict';

  /**
   * Site-absolute path, query string kept.
   * `./doom/?manual=browse` → `/doom/?manual=browse`.
   * @param {{ path?: string, id?: string }} entry
   * @returns {string}
   */
  function hrefFor(entry) {
    const path = (entry && entry.path) || '';
    if (!path) return entry && entry.id ? '/' + entry.id + '/' : '/';
    const match = path.match(/^([^?#]*)(.*)$/);
    const base = (match ? match[1] : path)
      .replace(/^\.\//, '')
      .replace(/^\//, '')
      .replace(/\/$/, '');
    const suffix = match ? match[2] : '';
    return '/' + base + '/' + suffix;
  }

  /**
   * Entries a surface should show. `nav` and `gallery` use the same rule:
   * drop `listed: false`, and drop a query-string variant when another entry
   * owns that path with no query. `navKeepQueryChildren` on the canonical
   * entry keeps the variants.
   * @param {object[]} entries
   * @param {'nav' | 'gallery'} surface
   * @returns {object[]}
   */
  function listed(entries, surface) {
    if (surface !== 'nav' && surface !== 'gallery') {
      throw new Error('Unknown registry surface: ' + surface);
    }
    const list = Array.isArray(entries) ? entries : [];
    const canonicalBasePaths = new Set();
    const keepQueryChildrenBases = new Set();
    for (const app of list) {
      const entryPath = app.path || '';
      if (entryPath && !entryPath.includes('?')) {
        canonicalBasePaths.add(entryPath);
        if (app.navKeepQueryChildren) keepQueryChildrenBases.add(entryPath);
      }
    }
    return list.filter((app) => {
      if (app.listed === false) return false;
      const entryPath = app.path || '';
      if (!entryPath) return false;
      if (!entryPath.includes('?')) return true;
      const base = entryPath.split('?')[0];
      if (keepQueryChildrenBases.has(base)) return true;
      return !canonicalBasePaths.has(base);
    });
  }

  /**
   * @param {object[]} entries
   * @param {{ pathname?: string, search?: string }} location
   * @returns {object | null}
   */
  function current(entries, location) {
    const api = global.HeymingRegistryPath;
    if (!api) return null;
    return api.resolveAppFromLocation(entries, location);
  }

  /**
   * @param {object[]} entries
   * @param {string} id
   * @returns {object[]}
   */
  function related(entries, id) {
    const list = Array.isArray(entries) ? entries : [];
    const app = list.find((entry) => entry && entry.id === id);
    const ids = app && Array.isArray(app.related) ? app.related : [];
    return ids
      .map((relatedId) => list.find((entry) => entry && entry.id === relatedId))
      .filter(Boolean);
  }

  function entriesFromAppModule() {
    if (!global.AppModule || typeof global.AppModule.getAllApps !== 'function') return null;
    const apps = global.AppModule.getAllApps();
    return Array.isArray(apps) ? apps : null;
  }

  const reused = entriesFromAppModule();
  /** @type {Promise<object[]>} */
  const ready = reused
    ? Promise.resolve(reused)
    : global
        .fetch('/apps-registry.json', { cache: 'default' })
        .then((res) => {
          if (!res.ok) throw new Error('registry HTTP ' + res.status);
          return res.json();
        })
        .then((data) => (Array.isArray(data) ? data : []))
        .catch((error) => {
          (global.console || console).warn(
            '[HeymingRegistry] Could not load apps-registry.json',
            error
          );
          const wrapped = new Error('Could not load apps-registry.json');
          wrapped.name = 'RegistryLoadError';
          wrapped.cause = error;
          throw wrapped;
        });

  global.HeymingRegistry = { ready, hrefFor, listed, current, related };
})(typeof window !== 'undefined' ? window : globalThis);
