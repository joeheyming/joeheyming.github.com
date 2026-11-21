/**
 * Turn a proxy or fetch failure into a short overlay line.
 * Kept out of songLoader.js so the song library can open without parsing
 * the simfile reader and the zip loader.
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
