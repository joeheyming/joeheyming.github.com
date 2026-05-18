/**
 * Tiny helpers around the Permissions API + a coarse platform sniff so
 * the rest of the app can show platform-correct instructions when GPS
 * isn't available.
 *
 * Why a separate module: keeps `app.js` from sprawling with UA-string
 * regexes and the Permissions API's quirky surface (it's "experimental"
 * for geolocation in some browsers and missing entirely in Safari for
 * a long time, so we have to tolerate it being absent).
 */

/** @typedef {'android' | 'ios' | 'desktop' | 'other'} Platform */

/**
 * Coarse-grained "what kind of device is this" sniff. The only thing
 * that uses it is the help card copy — we are NOT branching app
 * behavior on it. Don't lean on this for anything load-bearing.
 *
 * @returns {Platform}
 */
export function getPlatform() {
  const ua = String(globalThis.navigator?.userAgent || '');
  if (/Android/i.test(ua)) {
    return 'android';
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return 'ios';
  }
  // Treat iPadOS-as-Safari-pretending-to-be-Mac as iOS for guidance
  // purposes — the settings path is the same as iPhone Safari.
  if (
    globalThis.navigator?.platform === 'MacIntel' &&
    typeof globalThis.navigator.maxTouchPoints === 'number' &&
    globalThis.navigator.maxTouchPoints > 1
  ) {
    return 'ios';
  }
  if (/Macintosh|Windows|Linux/i.test(ua) || /CrOS/i.test(ua)) {
    return 'desktop';
  }
  return 'other';
}

/** @typedef {'granted' | 'denied' | 'prompt' | 'unknown'} GeoState */

/**
 * Read the current geolocation permission, or `'unknown'` if the
 * Permissions API isn't available (e.g. older Safari).
 *
 * @returns {Promise<GeoState>}
 */
export async function getGeolocationState() {
  const perms = /** @type {Permissions | undefined} */ (globalThis.navigator?.permissions);
  if (!perms || typeof perms.query !== 'function') {
    return 'unknown';
  }
  try {
    const status = await perms.query({ name: /** @type {PermissionName} */ ('geolocation') });
    return /** @type {GeoState} */ (status.state);
  } catch {
    return 'unknown';
  }
}

/**
 * Subscribe to changes in the geolocation permission state (e.g. the
 * user flips it in another tab via site settings). The callback fires
 * once with the current state right away so callers don't have to
 * separately bootstrap. Returns a disposer.
 *
 * @param {(state: GeoState) => void} cb
 * @returns {() => void}
 */
export function onGeolocationStateChange(cb) {
  let disposed = false;
  /** @type {PermissionStatus | null} */
  let status = null;

  const perms = /** @type {Permissions | undefined} */ (globalThis.navigator?.permissions);
  if (!perms || typeof perms.query !== 'function') {
    cb('unknown');
    return () => {};
  }

  perms
    .query({ name: /** @type {PermissionName} */ ('geolocation') })
    .then((s) => {
      if (disposed) {
        return;
      }
      status = s;
      cb(/** @type {GeoState} */ (s.state));
      s.onchange = () => {
        if (disposed) {
          return;
        }
        cb(/** @type {GeoState} */ (s.state));
      };
    })
    .catch(() => {
      if (!disposed) {
        cb('unknown');
      }
    });

  return () => {
    disposed = true;
    if (status) {
      status.onchange = null;
    }
  };
}

/**
 * Android intent URL that opens the system Location settings page when
 * tapped from Chrome on Android. Useful when the *device* location is
 * off (different from the *site* permission being blocked).
 *
 * Returns null on every other platform so the caller can hide the link.
 *
 * @param {Platform} platform
 */
export function androidLocationSettingsHref(platform) {
  if (platform !== 'android') {
    return null;
  }
  return 'intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end';
}
