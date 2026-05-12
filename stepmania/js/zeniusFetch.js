import { appendSimfileTableItemsToContent } from './zeniusParsers.js';

export async function fetchTopSimfilesFromListUrl(listUrl, limit, signal) {
  const html = await window.proxyService.fetchWithProxy(listUrl, { skipDirect: true, signal });
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const content = { type: 'unknown', items: [] };
  appendSimfileTableItemsToContent(doc, content);
  return content.items.slice(0, limit);
}
