// History helpers for apps that swap a list view and a detail view in one page.
//
// Opening an item pushes an entry (`?book=…`) and carries a `viewOpen` marker
// in its state, so the browser Back button returns to the list underneath it,
// the way /emulator/<console>/?rom= does. An item opened from a deep link has
// no list entry below it, so closing it replaces the URL instead of leaving.
//
// Both writes go through `pushHistorySilent` / `replaceHistorySilent` from
// `/analytics.js` when present: gtag wraps `history.pushState` and would
// record each in-page view as another page_view.

const MARKER = 'viewOpen';

/**
 * @param {Record<string, string | null>} params query keys to set; null drops the key
 * @param {Location} [loc]
 * @returns {string}
 */
export function urlWithParams(params, loc = window.location) {
  const url = new URL(loc.href);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return url.pathname + url.search + url.hash;
}

/** Add a history entry for an opened item. */
export function pushView(params) {
  const next = urlWithParams(params);
  const state = { [MARKER]: true };
  if (typeof window.pushHistorySilent === 'function') window.pushHistorySilent(state, next);
  else History.prototype.pushState.call(history, state, '', next);
}

/**
 * Rewrite the URL of the current entry. Pass `open: true` to keep the entry
 * marked as having a list underneath it.
 */
export function replaceView(params, { open = false } = {}) {
  const next = urlWithParams(params);
  const state = open ? { [MARKER]: true } : null;
  if (typeof window.replaceHistorySilent === 'function') window.replaceHistorySilent(state, next);
  else History.prototype.replaceState.call(history, state, '', next);
}

/** True when Back would land on the list this item was opened from. */
export function hasListBelow() {
  return Boolean(history.state && history.state[MARKER]);
}

/**
 * Leave the open item. Back when this page pushed it, so the history stack
 * stays honest; otherwise rewrite the URL in place and run `showList` directly.
 * The `popstate` listener owns showing the list after a Back.
 * @param {Record<string, null>} clearParams
 * @param {() => void} showList
 */
export function closeView(clearParams, showList) {
  if (hasListBelow()) {
    history.back();
    return;
  }
  replaceView(clearParams);
  showList();
}
