// Song Loader - ES Module
// Handles loading songs from Zenius-I-Vanisher and local simfiles

import { SimfileParser } from './simfileParser.js';

/** Network/loading settings */
const FETCH_TIMEOUT = 15000;
const MAX_RETRIES = 3;

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
  let backgroundMatch = html.match(/href="([^"]*\.png)"[^>]*>.*?Background.*?<\/a>/);

  if (!simfileMatch) {
    simfileMatch = html.match(/href="([^"]*\.sm)"/);
  }
  if (!oggMatch) {
    oggMatch = html.match(/href="([^"]*\.ogg)"/);
  }
  if (!backgroundMatch) {
    backgroundMatch = html.match(/href="([^"]*\.png)"/);
  }

  if (!simfileMatch || !oggMatch) {
    throw new Error('Could not find simfile or audio files on Zenius page');
  }

  const oggUrl = 'https://zenius-i-vanisher.com' + oggMatch[1];
  const backgroundUrl = backgroundMatch
    ? 'https://zenius-i-vanisher.com' + backgroundMatch[1]
    : null;

  // Extract title and artist from page
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const artistMatch = html.match(/by\s+([^<]+)/);

  const title = titleMatch ? titleMatch[1].trim() : 'Zenius Song ' + simfileId;
  const artist = artistMatch ? artistMatch[1].trim() : 'Unknown Artist';

  // Fetch the actual simfile content
  const simfileDirectUrl = 'https://zenius-i-vanisher.com' + simfileMatch[1];
  const simfileText = await fetchSimfile(simfileDirectUrl);

  return {
    title,
    artist,
    simfileText,
    oggUrl,
    backgroundUrl
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
    url: simfileData.oggUrl,
    background: simfileData.backgroundUrl || '/stepmania/songs/Lost/background.png',
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
