/**
 * Browser global for MIME resolution (loaded before app.js).
 * Logic duplicated from mime-handlers-core.mjs — keep in sync or generate.
 */
(function attachMimeHandlers(global) {
  /**
   * @param {string | null | undefined} mimeType
   * @param {Array<{ id: string; name: string; shortName?: string; icon?: string; handles?: string[] }>} registry
   */
  function getAppsForMimeType(mimeType, registry) {
    if (!mimeType) return [];

    const [type] = mimeType.split('/');
    const seen = new Set();
    const exact = [];
    const wildcard = [];

    for (const app of registry) {
      if (!app.handles) continue;

      let matchType = null;
      for (const pattern of app.handles) {
        if (pattern === mimeType) {
          matchType = 'exact';
          break;
        }
        if (!matchType && pattern.endsWith('/*')) {
          const patternType = pattern.slice(0, -2);
          if (type === patternType) {
            matchType = 'wildcard';
          }
        }
      }

      if (matchType && !seen.has(app.id)) {
        seen.add(app.id);
        const entry = {
          appId: app.id,
          appName: app.name,
          shortName: app.shortName || app.name,
          icon: app.icon || '📦'
        };
        if (matchType === 'exact') {
          exact.push(entry);
        } else {
          wildcard.push(entry);
        }
      }
    }

    return [...exact, ...wildcard];
  }

  global.MimeHandlers = { getAppsForMimeType };
})(typeof window !== 'undefined' ? window : globalThis);
