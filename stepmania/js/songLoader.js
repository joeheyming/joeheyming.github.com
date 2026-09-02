// Song Loader - ES Module
// Handles loading songs from Zenius-I-Vanisher

import { SimfileParser } from './simfileParser.js';
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
 * Fetch and parse simfile data from Zenius-I-Vanisher
 * @param {string} simfileId - The simfile ID to fetch
 * @param {import('./songProxyTransport.js').SongProxyTransport} [transport]
 * @returns {Promise<Object>} Parsed simfile data
 */
export async function fetchZeniusSimfile(simfileId, transport) {
  const t = transport ?? createDefaultSongProxyTransport();
  const zeniusPageUrl = 'https://zenius-i-vanisher.com/v5.2/viewsimfile.php?simfileid=' + simfileId;

  const html = await t.fetchText(zeniusPageUrl, { skipDirect: true });

  // Try to match file links with descriptive text first, then fall back to any match
  let simfileMatch = html.match(/href="([^"]*\.sm)"[^>]*>.*?SM.*?<\/a>/);
  let oggMatch = html.match(/href="([^"]*\.ogg)"[^>]*>.*?OGG.*?<\/a>/);
  let mp3Match = html.match(/href="([^"]*\.mp3)"[^>]*>.*?MP3.*?<\/a>/);
  let backgroundMatch = html.match(/href="([^"]*\.png)"[^>]*>.*?Background.*?<\/a>/);
  let aviMatch = html.match(/href="([^"]*\.avi)"[^>]*>.*?AVI.*?<\/a>/);

  if (!simfileMatch) {
    simfileMatch = html.match(/href="([^"]*\.sm)"/);
  }
  if (!oggMatch) {
    oggMatch = html.match(/href="([^"]*\.ogg)"/);
  }
  if (!mp3Match) {
    mp3Match = html.match(/href="([^"]*\.mp3)"/);
  }
  if (!backgroundMatch) {
    backgroundMatch = html.match(/href="([^"]*\.png)"/);
  }
  if (!aviMatch) {
    aviMatch = html.match(/href="([^"]*\.avi)"/);
  }

  // Use OGG if available, otherwise fall back to MP3
  const audioMatch = oggMatch || mp3Match;

  if (!simfileMatch || !audioMatch) {
    throw new Error('Could not find simfile or audio files on Zenius page');
  }

  const audioUrl = resolveZeniusUrl(audioMatch[1]);
  const simfileDirectUrl = resolveZeniusUrl(simfileMatch[1]);
  const backgroundUrl = backgroundMatch ? resolveZeniusUrl(backgroundMatch[1]) : null;
  const aviUrl = aviMatch ? resolveZeniusUrl(aviMatch[1]) : null;

  if (!audioUrl || !simfileDirectUrl) {
    throw new Error('Could not resolve simfile or audio URLs on Zenius page');
  }

  // Extract title and artist from page
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const artistMatch = html.match(/by\s+([^<]+)/);

  const title = titleMatch ? titleMatch[1].trim() : 'Zenius Song ' + simfileId;
  const artist = artistMatch ? artistMatch[1].trim() : 'Unknown Artist';

  // Extract category info from breadcrumbs/links
  // Look for links like: <a href="viewsimfilecategory.php?categoryid=123">Category Name</a>
  let categoryId = null;
  let categoryName = null;
  const categoryMatch = html.match(
    /href="viewsimfilecategory\.php\?categoryid=(\d+)"[^>]*>([^<]+)</
  );
  if (categoryMatch) {
    categoryId = categoryMatch[1];
    categoryName = categoryMatch[2].trim();
  }

  // Fetch the actual simfile content
  const simfileText = await fetchSimfile(simfileDirectUrl, t);

  return {
    title,
    artist,
    simfileText,
    audioUrl,
    backgroundUrl,
    aviUrl,
    categoryId,
    categoryName
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

  const songKey = `zenius_${simfileId}`;
  const songData = {
    title: simfileData.title,
    artist: simfileData.artist,
    url: simfileData.audioUrl,
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
    // No deferProxies: corsproxy.io is the most reliable proxy for
    // zenius binaries. Deferring it forced the ZIP fetch through 3
    // less-reliable proxies first, which all 400/403'd on mobile;
    // by the time the chain reached corsproxy.io it had been rate-
    // limited by the spotlight page-load fetches and 403'd too.
    // Default proxy order works.
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

    // Find audio file in ZIP (prefer OGG, then MP3)
    let audioFile = null;
    let audioType = null;

    for (const filename of Object.keys(zip.files)) {
      const lowerName = filename.toLowerCase();
      if (lowerName.endsWith('.ogg')) {
        audioFile = zip.files[filename];
        audioType = 'audio/ogg';
        break; // Prefer OGG
      } else if (lowerName.endsWith('.mp3') && !audioFile) {
        audioFile = zip.files[filename];
        audioType = 'audio/mpeg';
      }
    }

    if (!audioFile) {
      console.warn('No audio file found in ZIP');
      return null;
    }

    // Extract audio as blob - JSZip returns a Blob directly, no need to re-wrap
    const audioBlob = await audioFile.async('blob');
    return { audioBlob, audioType };
  } catch (error) {
    console.error('Failed to download/extract ZIP:', error);
    return null;
  }
}
