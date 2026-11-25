import { ensureProxy } from './ensureProxy.js';
import { simfileItemsFromHtml } from './zeniusParsers.js';

// A macrotask, so a tap can run before the next list is parsed. A microtask
// would let every finished download parse in one turn.
function gapForInput() {
  if (typeof window.afterNextPaint === 'function') return window.afterNextPaint();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function fetchTopSimfilesFromListUrl(listUrl, limit, signal) {
  await ensureProxy();
  const html = await window.proxyService.fetchWithProxy(listUrl, { skipDirect: true, signal });
  return simfileItemsFromHtml(html, limit, gapForInput);
}
