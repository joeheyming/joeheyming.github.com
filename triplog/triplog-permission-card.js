/**
 * Permission help-card controller.
 *
 * Owns the "Trip Log can't see your location" panel and the platform-
 * specific step lists that go in it. Three reasons it can show:
 *   - `site-blocked` — browser-level deny for this origin
 *   - `system-off`   — OS-level location services off
 *   - `timeout`      — we asked but didn't get a fix
 *
 * Used by both the recorder's `onError` callback and the explicit
 * "Try again" button in the card itself.
 *
 * @typedef {'site-blocked' | 'system-off' | 'timeout'} PermissionReason
 */

import { setStatus } from './triplog-format.js';

/**
 * @param {{
 *   dom: {
 *     card: HTMLElement,
 *     title: HTMLElement,
 *     body: HTMLElement,
 *     androidLink: HTMLAnchorElement,
 *     retryBtn: HTMLButtonElement,
 *     dismissBtn: HTMLButtonElement,
 *     statusEl: HTMLElement
 *   },
 *   platform: ReturnType<typeof import('./triplog-permissions.js').getPlatform>,
 *   getLiveMap: () => ReturnType<typeof import('./triplog-map.js').createLiveMap> | null
 * }} deps
 */
export function createPermissionCard(deps) {
  const { dom, platform, getLiveMap } = deps;

  /** @param {PermissionReason} reason */
  function show(reason) {
    dom.body.replaceChildren();
    dom.androidLink.hidden = true;

    /** @param {string} text */
    const para = (text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    };

    /** @param {string[]} items */
    const steps = (items) => {
      const ol = document.createElement('ol');
      ol.className = 'mt-1 list-decimal space-y-0.5 pl-5';
      for (const t of items) {
        const li = document.createElement('li');
        li.textContent = t;
        ol.appendChild(li);
      }
      return ol;
    };

    if (reason === 'site-blocked') {
      dom.title.textContent = "Trip Log isn't allowed to use your location";
      if (platform === 'android') {
        dom.body.append(
          para('To fix this on your phone:'),
          steps([
            'Tap the lock icon to the left of the address bar.',
            'Tap "Permissions" (or "Reset permissions").',
            'Set Location to "Allow" — or tap Reset and reload the page.'
          ])
        );
      } else if (platform === 'ios') {
        dom.body.append(
          para('To fix this in Safari:'),
          steps([
            'Tap "AA" in the address bar.',
            'Tap "Website Settings".',
            'Set Location to "Allow".'
          ])
        );
      } else {
        dom.body.append(
          para('To fix this in your browser:'),
          steps([
            'Click the lock icon to the left of the address bar.',
            'Change "Location" to "Allow".',
            'Reload the page.'
          ])
        );
      }
    } else if (reason === 'system-off') {
      dom.title.textContent = "Your phone's location appears to be off";
      if (platform === 'android') {
        dom.body.append(
          para(
            'Turn on Location in your phone, then tap Try again. The button below jumps to the settings page on your phone.'
          )
        );
        dom.androidLink.hidden = false;
      } else if (platform === 'ios') {
        dom.body.append(
          para('To turn it on:'),
          steps([
            'Open the Settings app.',
            'Tap Privacy & Security, then Location Services.',
            'Make sure Location Services is on at the top.',
            'Scroll to Safari Websites and choose "While Using the App".'
          ])
        );
      } else {
        dom.body.append(
          para(
            "Your device's location service appears to be off. Turn it on in your system settings, then come back and tap Try again."
          )
        );
      }
    } else if (reason === 'timeout') {
      dom.title.textContent = "GPS couldn't get a fix";
      dom.body.append(
        para(
          'Try moving outside or near a window — indoor GPS is often unreliable. When you have signal, tap Try again.'
        )
      );
    }

    dom.card.hidden = false;
  }

  function hide() {
    dom.card.hidden = true;
  }

  /**
   * Re-check whether we can get a fix. Used by the "Try again" button.
   * If permission is granted and the device returns a position, the
   * card is hidden. Otherwise we re-show the right card based on the
   * new error.
   */
  function recheck() {
    if (!('geolocation' in navigator)) {
      return;
    }
    setStatus(dom.statusEl, 'Checking location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        hide();
        setStatus(dom.statusEl, '');
        getLiveMap()?.showInitialPosition({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          zoom: 15
        });
      },
      (err) => {
        setStatus(dom.statusEl, '');
        if (err.code === 1) {
          show('site-blocked');
        } else if (err.code === 2) {
          show('system-off');
        } else {
          show('timeout');
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
    );
  }

  return { show, hide, recheck };
}
