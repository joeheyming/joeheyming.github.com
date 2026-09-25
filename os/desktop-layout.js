/**
 * Pure desktop icon layout helpers (grid snap, prefs keys, default positions).
 * Safe to unit-test without a WindowManager.
 */

export const APP_KEY_PREFIX = 'app:';
export const VFS_KEY_PREFIX = 'vfs:';
export const MAX_LAYOUT_ENTRIES = 400;

/**
 * @param {string} appId
 * @returns {string}
 */
export function appIconKey(appId) {
  return `${APP_KEY_PREFIX}${appId}`;
}

/**
 * @param {string} path
 * @returns {string}
 */
export function vfsIconKey(path) {
  return `${VFS_KEY_PREFIX}${path}`;
}

/**
 * @param {unknown} key
 * @returns {{ kind: 'app', id: string } | { kind: 'vfs', path: string } | null}
 */
export function parseIconKey(key) {
  if (typeof key !== 'string' || key.length < 5) return null;
  if (key.startsWith(APP_KEY_PREFIX)) {
    const id = key.slice(APP_KEY_PREFIX.length);
    if (!id || id.length > 128) return null;
    return { kind: 'app', id };
  }
  if (key.startsWith(VFS_KEY_PREFIX)) {
    const path = key.slice(VFS_KEY_PREFIX.length);
    if (!path || path.length > 1024 || path.startsWith('data:')) return null;
    return { kind: 'vfs', path };
  }
  return null;
}

/**
 * @param {unknown} items
 * @returns {Array<{ type: string, path: string }>}
 */
export function desktopVfsItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item) =>
      item && typeof item.path === 'string' && (item.type === 'file' || item.type === 'directory')
  );
}

/**
 * @param {unknown} raw
 * @returns {Record<string, { x: number, y: number }>}
 */
export function normalizeIconLayout(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = /** @type {Record<string, { x: number, y: number }>} */ ({});
  let n = 0;
  for (const [key, val] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    if (n >= MAX_LAYOUT_ENTRIES) break;
    if (!parseIconKey(key)) continue;
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
    const rec = /** @type {{ x?: unknown, y?: unknown }} */ (val);
    const x = Number(rec.x);
    const y = Number(rec.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out[key] = { x: Math.round(x), y: Math.round(y) };
    n += 1;
  }
  return out;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} spacingX
 * @param {number} spacingY
 */
export function snapToGrid(x, y, spacingX, spacingY) {
  const sx = spacingX > 0 ? spacingX : 90;
  const sy = spacingY > 0 ? spacingY : 100;
  return {
    x: Math.round(x / sx) * sx,
    y: Math.round(y / sy) * sy
  };
}

/**
 * @param {number} x
 * @param {number} y
 * @param {{ minX?: number, minY?: number, maxX: number, maxY: number }} bounds
 */
export function clampIconPosition(x, y, bounds) {
  const minX = bounds.minX ?? 0;
  const minY = bounds.minY ?? 0;
  return {
    x: Math.max(minX, Math.min(bounds.maxX, x)),
    y: Math.max(minY, Math.min(bounds.maxY, y))
  };
}

/**
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ x: number, y: number }} grabOffset
 * @param {DOMRect | { left: number, top: number }} desktopRect
 * @param {number} spacingX
 * @param {number} spacingY
 * @param {{ minX?: number, minY?: number, maxX: number, maxY: number }} bounds
 */
export function dropPointToIconPosition(
  clientX,
  clientY,
  grabOffset,
  desktopRect,
  spacingX,
  spacingY,
  bounds
) {
  const x = clientX - grabOffset.x - desktopRect.left;
  const y = clientY - grabOffset.y - desktopRect.top;
  const snapped = snapToGrid(x, y, spacingX, spacingY);
  return clampIconPosition(snapped.x, snapped.y, bounds);
}

/**
 * @param {string[]} keys
 * @param {{ spacingX: number, spacingY: number }} layout
 * @param {{ ICONS_PER_ROW: number, ICON_START_X: number, ICON_START_Y: number }} constants
 * @returns {Record<string, { x: number, y: number }>}
 */
export function packLayoutToGrid(keys, layout, constants) {
  const spacingX = layout.spacingX;
  const spacingY = layout.spacingY;
  const perRow = Math.max(1, constants.ICONS_PER_ROW);
  const startX = constants.ICON_START_X;
  const startY = constants.ICON_START_Y;
  /** @type {Record<string, { x: number, y: number }>} */
  const next = {};
  keys.forEach((key, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    next[key] = {
      x: startX + col * spacingX,
      y: startY + row * spacingY
    };
  });
  return next;
}

/**
 * @param {{ desktopPosition?: { x: number, y: number }, system?: boolean }} app
 * @param {number} regularIndex
 * @param {{ spacingX: number, spacingY: number }} layout
 * @param {{ ICONS_PER_ROW: number, ICON_START_X: number, ICON_START_Y: number }} constants
 * @param {boolean} isMobile
 * @param {{ startX: number, startY: number, spacingX: number, spacingY: number, iconsPerRow: number }} mobile
 */
export function defaultAppPosition(app, regularIndex, layout, constants, isMobile, mobile) {
  if (isMobile) {
    const row = Math.floor(regularIndex / mobile.iconsPerRow);
    const col = regularIndex % mobile.iconsPerRow;
    return {
      x: mobile.startX + col * mobile.spacingX,
      y: mobile.startY + row * mobile.spacingY
    };
  }
  if (app.system && app.desktopPosition) {
    return { x: app.desktopPosition.x, y: app.desktopPosition.y };
  }
  const row = Math.floor(regularIndex / constants.ICONS_PER_ROW);
  const col = regularIndex % constants.ICONS_PER_ROW;
  return {
    x: constants.ICON_START_X + col * layout.spacingX,
    y: constants.ICON_START_Y + row * layout.spacingY
  };
}

/**
 * @param {number} index
 * @param {{ fileSpacing: number, rightOffset: number }} layout
 * @param {{ FILE_ICON_START_Y: number }} constants
 * @param {boolean} isMobile
 * @param {{ startX: number, startY: number, spacingX: number, spacingY: number, iconsPerRow: number }} mobile
 * @param {number} viewportWidth
 */
export function defaultFilePosition(index, layout, constants, isMobile, mobile, viewportWidth) {
  if (isMobile) {
    const row = Math.floor(index / mobile.iconsPerRow);
    const col = index % mobile.iconsPerRow;
    return {
      x: mobile.startX + col * mobile.spacingX,
      y: mobile.startY + row * mobile.spacingY
    };
  }
  return {
    x: viewportWidth - layout.rightOffset,
    y: constants.FILE_ICON_START_Y + index * layout.fileSpacing
  };
}

/**
 * @param {string} key
 * @param {Record<string, { x: number, y: number }>} layoutMap
 * @param {{ x: number, y: number }} fallback
 */
export function resolveIconPosition(key, layoutMap, fallback) {
  const saved = layoutMap?.[key];
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    return { x: saved.x, y: saved.y };
  }
  return fallback;
}

/**
 * Translate a group of origin positions so the anchor lands on `anchorPos`.
 * @param {Record<string, { x: number, y: number }>} origin
 * @param {string} anchorKey
 * @param {{ x: number, y: number }} anchorPos
 * @param {number} spacingX
 * @param {number} spacingY
 * @param {{ minX?: number, minY?: number, maxX: number, maxY: number }} bounds
 */
export function translateGroup(origin, anchorKey, anchorPos, spacingX, spacingY, bounds) {
  const from = origin[anchorKey];
  if (!from) {
    return { [anchorKey]: clampIconPosition(anchorPos.x, anchorPos.y, bounds) };
  }
  const dx = anchorPos.x - from.x;
  const dy = anchorPos.y - from.y;
  /** @type {Record<string, { x: number, y: number }>} */
  const next = {};
  for (const [key, pos] of Object.entries(origin)) {
    const snapped = snapToGrid(pos.x + dx, pos.y + dy, spacingX, spacingY);
    next[key] = clampIconPosition(snapped.x, snapped.y, bounds);
  }
  return next;
}
