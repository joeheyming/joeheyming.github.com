// moddb mod browser. Lets the user search/sort/paginate Doom mods on
// moddb.com, pick one, fetch + extract it via window.proxyService, and
// hand it off to the existing UZDoomLoader.primeWith()/launch() flow.
//
// Architecture:
//   * All HTML parsing functions are pure (no DOM mutation, no fetch)
//     and live on window.UZDoomModdb.parsers so tests can exercise them
//     against fixtures without spinning up the full UI.
//   * Networking goes through window.proxyService (proxy.js). Direct
//     fetch is skipped because moddb does not send permissive CORS.
//   * Mod assets go through window.UZDoomModdbArchive for extraction
//     and window.UZDoomModdbIwad for the chosen IWAD.
//   * Launch happens via window.UZDoomLoader.primeWith() + launch().
//
// SELECTOR FRAGILITY: every CSS selector this file uses is co-located in
// the SELECTORS table near the top. moddb's DOM drifts; when scraping
// breaks, fix it here and re-run tests/moddb-browser.test.mjs against an
// updated fixture.
//
// COURTESY: every mod card always carries a direct link back to the
// moddb page so users can support the author on the actual site. We
// cache listing pages aggressively (24h via localStorage) so we don't
// hammer moddb's servers.

import { parsers } from './moddb-browser-parsers.js';
import {
  internal,
  fetchListing,
  fetchModInfo,
  resolveDownloadUrl,
  downloadAndExtract
} from './moddb-browser-net.js';
import { open, close, wireModdbBrowserEntryPoints } from './moddb-browser-ui.js';

export const UZDoomModdb = {
  open,
  close,
  parsers: parsers,
  fetchListing,
  fetchModInfo,
  resolveDownloadUrl,
  downloadAndExtract,
  _internal: internal
};

window.UZDoomModdb = UZDoomModdb;

wireModdbBrowserEntryPoints(open);

/**
 * @typedef {{
 *   slug: string, title: string, url: string, thumbUrl: string, summary: string,
 *   gameSlug: string|null, gameTitle: string|null
 * }} ModCard
 */
/**
 * @typedef {{
 *   title: string, url: string, version: string|null, ext: string,
 *   isFull: boolean, isPatch: boolean, isDemo: boolean, rawText: string
 * }} DownloadEntry
 */
