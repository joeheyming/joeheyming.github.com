// Song Loader - ES Module
// Handles loading songs from Zenius-I-Vanisher and local simfiles

import { SimfileParser } from './simfileParser.js';

/** Network/loading settings */
const FETCH_TIMEOUT = 15000;
const MAX_RETRIES = 3;
const ZIP_DOWNLOAD_TIMEOUT = 60000; // ZIP files can be large, allow more time
const ZIP_MAX_RETRIES = 2;

/**
 * Helper to fetch simfiles through proxy with appropriate settings
 * @param {string} url - URL to fetch
 * @returns {Promise<string>} Fetched content
 */
async function fetchSimfile(url) {
  return window.proxyService.fetchWithProxy(url, {
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
 * @returns {Promise<Object>} Parsed simfile data
 */
export async function fetchZeniusSimfile(simfileId) {
  const zeniusPageUrl = 'https://zenius-i-vanisher.com/v5.2/viewsimfile.php?simfileid=' + simfileId;

  const html = await window.proxyService.fetchWithProxy(zeniusPageUrl);

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

  const audioUrl = 'https://zenius-i-vanisher.com' + audioMatch[1];
  const backgroundUrl = backgroundMatch
    ? 'https://zenius-i-vanisher.com' + backgroundMatch[1]
    : null;
  const aviUrl = aviMatch ? 'https://zenius-i-vanisher.com' + aviMatch[1] : null;

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
  const simfileDirectUrl = 'https://zenius-i-vanisher.com' + simfileMatch[1];
  const simfileText = await fetchSimfile(simfileDirectUrl);

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
    background: simfileData.backgroundUrl || '/stepmania/songs/Lost/background.png',
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
 * Load and parse a local simfile
 * @param {string} simfileUrl - URL to the simfile
 * @returns {Promise<Object>} Parsed simfile data
 */
export async function loadLocalSimfile(simfileUrl) {
  const response = await fetch(simfileUrl);
  const simfileText = await response.text();

  const parser = new SimfileParser();
  return parser.parse(simfileText);
}

/**
 * Download simfile ZIP and extract audio as fallback when direct audio download fails
 * @param {string} simfileId - The simfile ID
 * @returns {Promise<{audioBlob: Blob, audioType: string}|null>} Audio blob and type, or null if failed
 */
export async function fetchZeniusAudioFromZip(simfileId) {
  const zipUrl = `https://zenius-i-vanisher.com/v5.2/download.php?type=ddrsimfile&simfileid=${simfileId}`;

  try {
    // Download ZIP through proxy
    const zipData = await window.proxyService.fetchBinaryWithProxy(zipUrl, {
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
