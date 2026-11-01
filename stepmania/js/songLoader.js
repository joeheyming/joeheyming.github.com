// Song Loader - ES Module
// Handles loading songs from Zenius-I-Vanisher

import { SimfileParser, danceSingleCharts } from './simfileParser.js';
import { dwiToSm } from './dwi.js';
import {
  createDefaultSongProxyTransport,
  ZIP_DOWNLOAD_TIMEOUT,
  ZIP_MAX_RETRIES
} from './songProxyTransport.js';

/** Network/loading settings */
const FETCH_TIMEOUT = 15000;
const MAX_RETRIES = 3;

export const ZENIUS_ORIGIN = 'https://zenius-i-vanisher.com';
export const ZENIUS_V52 = 'https://zenius-i-vanisher.com/v5.2/';

/**
 * Resolve a href from a Zenius HTML page against the site origin.
 * Handles relative paths, absolute URLs, protocol-relative URLs, and `&amp;`.
 * @param {string|null|undefined} href
 * @returns {string|null}
 */
export function resolveZeniusUrl(href) {
  if (href == null || typeof href !== 'string') return null;
  const decoded = href.replace(/&amp;/g, '&').trim();
  if (!decoded) return null;
  let abs;
  try {
    abs = new URL(decoded, ZENIUS_V52);
  } catch {
    return null;
  }
  if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
  return abs.href;
}

/**
 * Turn a proxy / fetch failure into a short overlay line (no raw "Error protocol").
 * @param {unknown} err
 * @returns {string}
 */
export function formatLoadError(err) {
  const msg = err instanceof Error ? err.message : err == null ? '' : String(err);
  if (/content type is not allowed on the free plan/i.test(msg)) {
    return 'The download proxy blocked this audio file. Try Retry or pick another song.';
  }
  if (/media files are not supported/i.test(msg)) {
    return 'The download proxy blocked this audio file. Try Retry or pick another song.';
  }
  if (/protocol/i.test(msg)) {
    return 'Could not download this song (bad file URL). Try Retry or another song.';
  }
  if (/all proxies failed/i.test(msg)) {
    return 'Could not download this song through any proxy. Try Retry or another song.';
  }
  if (!msg.trim()) {
    return 'Could not download the audio for this song. Try Retry or pick another.';
  }
  return msg;
}

/**
 * Helper to fetch simfiles through proxy with appropriate settings
 * @param {string} url - URL to fetch
 * @param {import('./songProxyTransport.js').SongProxyTransport} [transport]
 * @returns {Promise<string>} Fetched content
 */
async function fetchSimfile(url, transport) {
  const t = transport ?? createDefaultSongProxyTransport();
  return t.fetchText(url, {
    skipDirect: true, // origin blocks CORS
    headers: {
      Accept: 'text/plain,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: FETCH_TIMEOUT,
    maxRetries: MAX_RETRIES
  });
}

/**
 * Extract simfile ID from a Zenius URL
 * @param {string} zeniusUrl - Full Zenius URL
 * @returns {string|null} Simfile ID or null if not found
 */
export function extractSimfileId(zeniusUrl) {
  try {
    const url = new URL(zeniusUrl);
    return url.searchParams.get('simfileid');
  } catch (error) {
    console.error('Error parsing Song Library URL:', error);
    return null;
  }
}

/**
 * @returns {((type: string) => string) | null}
 */
export function defaultCanPlayType() {
  if (typeof document === 'undefined') return null;
  try {
    const audio = document.createElement('audio');
    if (typeof audio.canPlayType !== 'function') return null;
    return (type) => audio.canPlayType(type);
  } catch {
    return null;
  }
}

/**
 * Pick the audio file this browser can decode. Ogg is preferred when both
 * exist, except where canPlayType rejects it (Safari), which then uses mp3.
 * The other file is returned as a fallback when the first download will not play.
 *
 * @param {string|null|undefined} oggUrl
 * @param {string|null|undefined} mp3Url
 * @param {((type: string) => string) | null} [canPlayType]
 * @returns {{ url: string|null, alternateUrl: string|null }}
 */
export function chooseAudioUrl(oggUrl, mp3Url, canPlayType = defaultCanPlayType()) {
  const ogg = oggUrl || null;
  const mp3 = mp3Url || null;
  const supported = (type) => {
    if (!canPlayType) return true;
    return canPlayType(type) !== '';
  };
  const oggOk = supported('audio/ogg; codecs="vorbis"');
  const mp3Ok = supported('audio/mpeg');
  if (mp3 && ogg && mp3Ok && !oggOk) return { url: mp3, alternateUrl: ogg };
  if (ogg && oggOk) return { url: ogg, alternateUrl: mp3 && mp3 !== ogg ? mp3 : null };
  if (mp3) return { url: mp3, alternateUrl: ogg && ogg !== mp3 ? ogg : null };
  return { url: ogg || mp3, alternateUrl: null };
}

/**
 * #MUSIC is often a path relative to the chart, including ../Another Song/file.ogg.
 * @param {string} simfileText
 * @param {string} simfileDirectUrl
 * @returns {string|null}
 */
function musicUrlFromSimfile(simfileText, simfileDirectUrl) {
  const match = simfileText.match(/#MUSIC:([^;\r\n]*)/i);
  if (!match) return null;
  const raw = match[1].trim().replace(/\\/g, '/');
  if (!raw) return null;
  let abs;
  try {
    abs = new URL(raw, simfileDirectUrl).href;
  } catch {
    return null;
  }
  if (!/\.(ogg|mp3|wav)(?:$|\?)/i.test(abs)) return null;
  return resolveZeniusUrl(abs);
}

/**
 * Zenius sometimes links a file as download.php?type=ogg instead of a .ogg path.
 * @param {string} html
 * @param {string} type
 * @returns {string|null}
 */
function matchTypedDownload(html, type) {
  const typed = new RegExp('href="([^"]*[?&](?:amp;)?type=' + type + '(?:&|&amp;)[^"]*)"', 'i');
  const typedAtEnd = new RegExp('href="([^"]*[?&](?:amp;)?type=' + type + ')"', 'i');
  const match = html.match(typed) || html.match(typedAtEnd);
  return match ? resolveZeniusUrl(match[1]) : null;
}

/**
 * @param {string} html
 * @param {string} type
 * @returns {string|null}
 */
function matchPackDownload(html, type) {
  const match = html.match(
    new RegExp('href="([^"]*download\\.php\\?type=' + type + '(?:&|&amp;|")[^"]*)"', 'i')
  );
  return match ? resolveZeniusUrl(match[1]) : null;
}

/**
 * What a Zenius simfile page actually offers. A removed id comes back as the
 * site homepage. A listed song can still have no file links, only a pack, or
 * a chart that is not a 4-arrow single.
 * @param {string} html
 * @param {string} simfileId
 */
export function inspectZeniusPage(html, simfileId) {
  const page = String(html || '');
  const titleTag = (page.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const id = String(simfileId || '').replace(/[^\d]/g, '');
  const gone =
    /^\s*Home - ZIv\s*$/i.test(titleTag.replace(/\s+/g, ' ').trim()) &&
    !new RegExp('simfileid=' + id + '\\b').test(page);

  let simfileMatch = page.match(/href="([^"]*\.(?:ssc|sma|sm))"[^>]*>.*?(?:SSC|SMA|SM).*?<\/a>/i);
  let oggMatch = page.match(/href="([^"]*\.ogg)"[^>]*>.*?OGG.*?<\/a>/);
  let mp3Match = page.match(/href="([^"]*\.mp3)"[^>]*>.*?MP3.*?<\/a>/);
  let backgroundMatch = page.match(/href="([^"]*\.png)"[^>]*>.*?Background.*?<\/a>/);
  let aviMatch = page.match(/href="([^"]*\.avi)"[^>]*>.*?AVI.*?<\/a>/);
  if (!simfileMatch) simfileMatch = page.match(/href="([^"]*\.(?:ssc|sma|sm))"/i);
  if (!oggMatch) oggMatch = page.match(/href="([^"]*\.ogg)"/);
  if (!mp3Match) mp3Match = page.match(/href="([^"]*\.mp3)"/);
  if (!backgroundMatch) backgroundMatch = page.match(/href="([^"]*\.png)"/);
  if (!aviMatch) aviMatch = page.match(/href="([^"]*\.avi)"/);

  const simfileHref = simfileMatch ? simfileMatch[1] : null;
  const typedChart =
    matchTypedDownload(page, 'ssc') ||
    matchTypedDownload(page, 'sm') ||
    matchTypedDownload(page, 'simfile');
  const simfileUrl = resolveZeniusUrl(simfileHref) || typedChart;
  let oggUrl = oggMatch ? resolveZeniusUrl(oggMatch[1]) : null;
  let mp3Url = mp3Match ? resolveZeniusUrl(mp3Match[1]) : null;
  if (!oggUrl) oggUrl = matchTypedDownload(page, 'ogg');
  if (!mp3Url) mp3Url = matchTypedDownload(page, 'mp3');

  /** @type {string[]} */
  const packUrls = [];
  const standardPack = matchPackDownload(page, 'ddrsimfile(?!custom)');
  const customPack = matchPackDownload(page, 'ddrsimfilecustom');
  if (standardPack) packUrls.push(standardPack);
  if (customPack) packUrls.push(customPack);

  const heading = page.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const artistMatch = page.match(/by\s+([^<]+)/);
  const categoryMatch = page.match(
    /href="viewsimfilecategory\.php\?categoryid=(\d+)"[^>]*>([^<]+)</
  );

  return {
    gone,
    title: heading ? heading[1].trim() : '',
    artist: artistMatch ? artistMatch[1].trim() : '',
    categoryId: categoryMatch ? categoryMatch[1] : null,
    categoryName: categoryMatch ? categoryMatch[2].trim() : null,
    simfileUrl,
    oggUrl,
    mp3Url,
    backgroundUrl: backgroundMatch ? resolveZeniusUrl(backgroundMatch[1]) : null,
    aviUrl: aviMatch ? resolveZeniusUrl(aviMatch[1]) : null,
    packUrls
  };
}

/**
 * Failures of the song itself. Proxy and network errors are not in this set,
 * so a rate limit does not hide the song from the picker.
 * @param {string} message
 */
export function isStructuralSongFailure(message) {
  return /no longer on Zenius|no chart or audio|no chart file|has no charts|lists audio for this song but no chart|no 4-arrow singles|no playable charts|no dance-single/i.test(
    String(message || '')
  );
}

/**
 * @param {Array<{ type?: string }>} charts
 * @returns {string}
 */
export function unplayableChartMessage(charts) {
  /** @type {string[]} */
  const types = [];
  for (const chart of charts || []) {
    const label = chart.type || 'unknown';
    if (!types.includes(label)) types.push(label);
  }
  if (!types.length) return 'This simfile has no charts.';
  return `This song has no 4-arrow singles (found ${types.join(', ')}).`;
}

/**
 * @param {{ files: Record<string, { dir?: boolean, async: (kind: string) => Promise<string|Blob> }> }} zip
 */
async function filesFromZip(zip) {
  const names = Object.keys(zip.files || {}).filter(
    (name) => zip.files[name] && !zip.files[name].dir
  );
  const chartName =
    names.find((name) => name.toLowerCase().endsWith('.ssc')) ||
    names.find((name) => name.toLowerCase().endsWith('.sma')) ||
    names.find((name) => name.toLowerCase().endsWith('.sm')) ||
    names.find((name) => name.toLowerCase().endsWith('.dwi')) ||
    null;
  let simfileText = null;
  if (chartName) {
    const raw = await zip.files[chartName].async('string');
    simfileText = chartName.toLowerCase().endsWith('.dwi') ? dwiToSm(raw) : raw;
  }
  const chosen = chooseAudioUrl(
    names.find((name) => name.toLowerCase().endsWith('.ogg')) || null,
    names.find((name) => name.toLowerCase().endsWith('.mp3')) || null
  );
  /** @type {Blob|null} */
  let audioBlob = null;
  /** @type {string|null} */
  let audioType = null;
  /** @type {Blob|null} */
  let alternateBlob = null;
  /** @type {string|null} */
  let alternateType = null;
  if (chosen.url && zip.files[chosen.url]) {
    audioBlob = await zip.files[chosen.url].async('blob');
    audioType = chosen.url.toLowerCase().endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg';
  }
  if (chosen.alternateUrl && zip.files[chosen.alternateUrl]) {
    alternateBlob = await zip.files[chosen.alternateUrl].async('blob');
    alternateType = chosen.alternateUrl.toLowerCase().endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg';
  }
  return { simfileText, audioBlob, audioType, alternateBlob, alternateType };
}

/**
 * Open a Zenius song pack. A "File not found" body is not a zip and returns null
 * so the caller can try the other pack link.
 * @param {ArrayBuffer|Uint8Array} data
 * @param {typeof JSZip} [Zip]
 */
export async function simfileFromPackBytes(data, Zip = globalThis.JSZip) {
  if (data == null) return null;
  if (!Zip) throw new Error('Could not open the song pack.');
  let zip;
  try {
    zip = await Zip.loadAsync(data);
  } catch {
    return null;
  }
  return filesFromZip(zip);
}

/**
 * @param {string[]} packUrls
 * @param {import('./songProxyTransport.js').SongProxyTransport} transport
 */
async function loadChartFromPacks(packUrls, transport) {
  /** @type {unknown} */
  let lastError = null;
  for (const url of packUrls) {
    /** @type {ArrayBuffer} */
    let data;
    try {
      data = await transport.fetchBinary(url, {
        skipDirect: true,
        timeout: ZIP_DOWNLOAD_TIMEOUT,
        maxRetries: ZIP_MAX_RETRIES
      });
    } catch (error) {
      // A later pack (the custom zip, usually) may be the one with the chart.
      lastError = error;
      continue;
    }
    const packed = await simfileFromPackBytes(data);
    if (!packed) continue;
    if (packed.simfileText) return packed;
  }
  if (lastError) throw lastError;
  return null;
}

/**
 * Fetch and parse simfile data from Zenius-I-Vanisher
 * @param {string} simfileId - The simfile ID to fetch
 * @param {import('./songProxyTransport.js').SongProxyTransport} [transport]
 * @returns {Promise<Object>} Parsed simfile data
 */
export async function fetchZeniusSimfile(simfileId, transport) {
  const t = transport ?? createDefaultSongProxyTransport();
  const zeniusPageUrl = 'https://zenius-i-vanisher.com/v5.2/viewsimfile.php?simfileid=' + simfileId;

  const html = await t.fetchText(zeniusPageUrl, { skipDirect: true });
  const page = inspectZeniusPage(html, simfileId);
  if (page.gone) {
    throw new Error('This song is no longer on Zenius.');
  }

  const chosenAudio = chooseAudioUrl(page.oggUrl, page.mp3Url);
  /** @type {string|null} */
  let simfileText = null;
  /** @type {Blob|null} */
  let audioBlob = null;
  /** @type {string|null} */
  let audioType = null;
  /** @type {Blob|null} */
  let alternateBlob = null;
  /** @type {string|null} */
  let alternateType = null;
  /** @type {string|null} */
  let simfileDirectUrl = page.simfileUrl;

  if (page.simfileUrl) {
    simfileText = await fetchSimfile(page.simfileUrl, t);
  } else if (page.packUrls.length) {
    const packed = await loadChartFromPacks(page.packUrls, t);
    if (!packed?.simfileText) {
      throw new Error(
        chosenAudio.url
          ? 'Zenius lists audio for this song but no chart.'
          : 'The song pack has no chart file.'
      );
    }
    simfileText = packed.simfileText;
    audioBlob = packed.audioBlob;
    audioType = packed.audioType;
    alternateBlob = packed.alternateBlob;
    alternateType = packed.alternateType;
    simfileDirectUrl = page.packUrls[0];
  } else if (!chosenAudio.url) {
    throw new Error('Zenius has no chart or audio for this song.');
  } else {
    throw new Error('Zenius lists audio for this song but no chart.');
  }

  const audioUrl = chosenAudio.url || musicUrlFromSimfile(simfileText, simfileDirectUrl);

  return {
    title: page.title || 'Zenius Song ' + simfileId,
    artist: page.artist || 'Unknown Artist',
    simfileText,
    audioUrl,
    alternateAudioUrl: chosenAudio.alternateUrl,
    audioBlob,
    audioType,
    alternateBlob,
    alternateType,
    backgroundUrl: page.backgroundUrl,
    aviUrl: page.aviUrl,
    categoryId: page.categoryId,
    categoryName: page.categoryName
  };
}

/**
 * Parse a simfile and create song data
 * @param {Object} simfileData - Data from fetchZeniusSimfile
 * @param {string} simfileId - The simfile ID
 * @returns {Object} Object containing parsedData and songData
 */
export function parseZeniusSimfile(simfileData, simfileId) {
  const parser = new SimfileParser();
  const parsedData = parser.parse(simfileData.simfileText);
  const allCharts = parsedData.charts;
  parsedData.charts = danceSingleCharts(allCharts);
  if (!parsedData.charts.length) {
    throw new Error(unplayableChartMessage(allCharts));
  }

  const songKey = `zenius_${simfileId}`;
  const songData = {
    title: simfileData.title,
    artist: simfileData.artist,
    url: simfileData.audioUrl,
    alternateUrl: simfileData.alternateAudioUrl || null,
    audioBlob: simfileData.audioBlob || null,
    audioType: simfileData.audioType || null,
    alternateBlob: simfileData.alternateBlob || null,
    alternateType: simfileData.alternateType || null,
    background: simfileData.backgroundUrl || null,
    video: simfileData.aviUrl || null, // AVI video if available (will be converted by videoConverter)
    simfile: null
  };

  return {
    songKey,
    songData,
    parsedData
  };
}

/**
 * Download simfile ZIP and extract audio as fallback when direct audio download fails
 * @param {string} simfileId - The simfile ID
 * @param {import('./songProxyTransport.js').SongProxyTransport} [transport]
 * @returns {Promise<{audioBlob: Blob, audioType: string}|null>} Audio blob and type, or null if failed
 */
export async function fetchZeniusAudioFromZip(simfileId, transport) {
  const t = transport ?? createDefaultSongProxyTransport();
  const zipUrl = `https://zenius-i-vanisher.com/v5.2/download.php?type=ddrsimfile&simfileid=${simfileId}`;

  try {
    // Default proxy order. The shared list leads with the high-quota
    // hosts; pinning or deferring a specific one is what made mobile
    // ZIP fetches die on rate limits.
    const zipData = await t.fetchBinary(zipUrl, {
      skipDirect: true,
      timeout: ZIP_DOWNLOAD_TIMEOUT,
      maxRetries: ZIP_MAX_RETRIES
    });

    // Check if JSZip is available
    if (typeof JSZip === 'undefined') {
      console.error('JSZip not loaded');
      return null;
    }

    // Extract ZIP
    const zip = await JSZip.loadAsync(zipData);

    const names = Object.keys(zip.files);
    const chosen = chooseAudioUrl(
      names.find((name) => name.toLowerCase().endsWith('.ogg')) || null,
      names.find((name) => name.toLowerCase().endsWith('.mp3')) || null
    );

    if (!chosen.url) {
      console.warn('No audio file found in ZIP');
      return null;
    }

    const audioFile = zip.files[chosen.url];
    const audioType = chosen.url.toLowerCase().endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg';
    const audioBlob = await audioFile.async('blob');

    let alternateBlob = null;
    let alternateType = null;
    if (chosen.alternateUrl && zip.files[chosen.alternateUrl]) {
      alternateType = chosen.alternateUrl.toLowerCase().endsWith('.ogg')
        ? 'audio/ogg'
        : 'audio/mpeg';
      alternateBlob = await zip.files[chosen.alternateUrl].async('blob');
    }

    return { audioBlob, audioType, alternateBlob, alternateType };
  } catch (error) {
    console.error('Failed to download/extract ZIP:', error);
    return null;
  }
}
