/**
 * Pure MIME-to-application resolution (no window, no DOM).
 * Used by the browser via mime-handlers.js and by Node unit tests.
 *
 * @param {string | null | undefined} mimeType
 * @param {Array<{ id: string; name: string; shortName?: string; icon?: string; handles?: string[] }>} registry
 * @returns {Array<{ appId: string; appName: string; shortName: string; icon: string }>}
 */
export function getAppsForMimeType(mimeType, registry) {
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
