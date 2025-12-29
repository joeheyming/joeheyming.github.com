// URL Utilities - ES Module
// Centralized URL parameter handling

/**
 * Get all URL parameters as an object
 * @returns {{song: string|null, difficulty: string|null, zenius: string|null, autoplay: boolean}}
 */
export function getURLParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    song: params.get('song'),
    difficulty: params.get('difficulty'),
    zenius: params.get('zenius'),
    autoplay: params.get('autoplay') !== 'false' && params.get('autoplay') !== null
  };
}

/**
 * Get a specific URL parameter
 * @param {string} key - The parameter key
 * @returns {string|null}
 */
export function getURLParam(key) {
  const params = new URLSearchParams(window.location.search);
  return params.get(key);
}

/**
 * Update URL parameters without reloading
 * @param {Object} params - Parameters to set
 * @param {boolean} pushState - Whether to push to history (default true)
 */
export function updateURLParams(params, pushState = true) {
  const url = new URL(window.location);

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }

  if (pushState) {
    window.history.pushState({}, '', url);
  } else {
    window.history.replaceState({}, '', url);
  }
}

/**
 * Clear all game-related URL parameters
 */
export function clearURLParams() {
  const url = new URL(window.location);
  url.searchParams.delete('zenius');
  url.searchParams.delete('song');
  url.searchParams.delete('difficulty');
  window.history.pushState({}, '', url);
}
