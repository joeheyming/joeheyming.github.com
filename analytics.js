// =====================================================================
// KEY EVENTS (GA4 conversions)
//
// GA4 reports "0 Key Events" until each event below is explicitly toggled
// in GA4 Admin → Data display → Events → "Mark as key event". The events
// themselves fire from `window.trackConversion(name, value)` already; the
// toggle is a one-time UI config per event name.
//
// Marked-as-Key-Event recommendations (high → low priority):
//
//   deep_engagement       2+ min engaged on any page    (analytics.js)
//   project_opened        Any project/app launched      (analytics.js → trackProjectOpen)
//   multi_app_session     ≥2 distinct apps in tab       (analytics.js → trackProjectOpen)
//   pwa_install           Installed as standalone app   (analytics.js → appinstalled)
//   game_completed        Finished a game/song          (2048, stepmania, pacman)
//   content_shared        Shared a page/score           (share.js, doom/share-button.js)
//   hero_cta_launch       Clicked the home-page CTA     (index.html data-event-conversion)
//   engaged_session       30s+ engaged                  (analytics.js — lower-bar baseline)
//
// Existing events already firing — toggle in GA4 Admin only (no code):
//
//   doom_engine_launched  WASM engine booted             (DOOM)
//   zenius_search         StepMania song-library search  (Stepmania)
//   song_browser_open     Opened StepMania library       (Stepmania)
//   doom_flavor_pick      Committed to a DOOM flavor     (DOOM)
//   featured_strip_visible Top-of-fold brand impression  (home gallery)
//
// GA4-standard event names we fire IN PARALLEL with custom ones (so
// GA4's built-in reports work alongside our custom labels):
//
//   share                  Standard GA4 share event       (share.js, doom/share-button.js)
//   view_search_results    Standard GA4 site-search event (index.js home filters, stepmania zenius)
//
// When adding a new Key Event: call `window.trackConversion('your_name', value)`
// from the surface that produces the signal, then add the event name and a
// one-line description here so the GA4 admin toggle list stays accurate.
// =====================================================================

// =====================================================================
// Theme bootstrap — runs on every page, before first paint.
//
// analytics.js is loaded as a synchronous <script> in <head> on all 58
// sitemap pages (including the home page) before any themed stylesheet
// (brand.css) is fetched, which makes it the cheapest single place to
// set <html data-theme="..."> before paint. The home toggle persists
// 'light', 'dark', or 'auto' to localStorage under 'hos-theme'; this
// block reads that key and mirrors it onto the <html> data-theme
// attribute so brand.css's :root[data-theme] override blocks win
// before any pixels paint.
//
// Default policy: when nothing is saved (first-time visitor, cleared
// storage, or unparseable value), the site renders in dark mode. The
// explicit 'auto' value — written only when the user clicks Auto in
// the home switcher — clears data-theme and lets brand.css's
// prefers-color-scheme rule follow the OS preference instead.
//
// Wrapped in try/catch because localStorage access throws in private
// mode and on file:// URLs. A theme failure must never block GA.
//
// Load-order contract: this script MUST stay synchronous (no defer /
// async) and MUST be loaded before any themed stylesheet. If you ever
// switch this to defer/async, restore the inline bootstrap that used
// to live in index.html, or you'll reintroduce a light-mode flash on
// first paint.
// =====================================================================
(function bootHeymingTheme() {
  try {
    const t = localStorage.getItem('hos-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.dataset.theme = t;
    } else if (t !== 'auto') {
      // No saved choice (or unparseable) — dark is the site default.
      document.documentElement.dataset.theme = 'dark';
    }
    // t === 'auto' falls through with no data-theme attribute, so
    // brand.css's @media (prefers-color-scheme) rule decides.
  } catch (e) {
    // localStorage unavailable (private mode, file://). Still apply
    // the dark default so the page matches the rest of the site.
    try {
      document.documentElement.dataset.theme = 'dark';
    } catch (_) {
      /* document not ready — extremely unlikely from <head> sync script */
    }
  }
})();

// assuming google analytics is already loaded
// onload
// Normalize page path by removing index.html and ensuring trailing slashes for directories
function normalizePagePath(path) {
  // Remove index.html
  let normalized = path.replace(/\/index\.html$/, '/');

  // Ensure trailing slash for directory paths (but not root)
  // If path doesn't end with a slash and isn't root, and doesn't have a file extension, add trailing slash
  if (normalized !== '/' && !normalized.endsWith('/')) {
    // Check if it looks like a directory (no file extension)
    const hasExtension = /\.\w+$/.test(normalized.split('/').pop());
    if (!hasExtension) {
      normalized += '/';
    }
  }

  return normalized;
}

// Loopback (127/8), RFC1918 private ranges (10/8, 172.16/12, 192.168/16),
// and link-local (169.254/16). Loose octet matching is fine here — this
// gates analytics, not a firewall.
const PRIVATE_IPV4 =
  /^(?:127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+)$/;

function isLocalDevHost() {
  const h = location.hostname;
  if (h === 'localhost' || h === '::1' || h === '') return true;
  if (PRIVATE_IPV4.test(h)) return true;
  // mDNS / Bonjour, e.g. `joes-macbook.local`
  if (/\.local$/.test(h)) return true;
  // Headless test runners (Playwright / playwright-cli, Puppeteer)
  if (/HeadlessChrome|Playwright/i.test(navigator.userAgent)) return true;
  return false;
}

const CANONICAL_HOST = 'joeheyming.github.io';

function getParentHost() {
  try {
    return window.top.location.hostname;
  } catch (e) {
    try {
      if (document.referrer) return new URL(document.referrer).hostname;
    } catch (_) {
      /* malformed referrer */
    }
    return '(cross-origin)';
  }
}

function trackOffsiteUsage() {
  const path = normalizePagePath(window.location.pathname);
  const currentHost = location.hostname;

  if (currentHost !== CANONICAL_HOST) {
    window.trackEvent('offsite_hostname', 'Embed', `${currentHost} | path=${path}`);
  }

  if (window.top !== window.self) {
    const parentHost = getParentHost();
    if (parentHost !== CANONICAL_HOST) {
      const ref = document.referrer || 'none';
      window.trackEvent(
        'iframe_embed',
        'Embed',
        `parent=${parentHost} | host=${currentHost} | path=${path} | ref=${ref}`
      );
    }
  }
}

// Error tracking functionality
function initErrorTracking() {
  // Track JavaScript errors
  window.addEventListener('error', function (event) {
    trackError({
      type: 'javascript_error',
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error ? event.error.stack : 'No stack trace available',
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString()
    });
  });

  // Track unhandled promise rejections
  window.addEventListener('unhandledrejection', function (event) {
    trackError({
      type: 'unhandled_promise_rejection',
      message: event.reason ? event.reason.toString() : 'Unknown promise rejection',
      stack: event.reason && event.reason.stack ? event.reason.stack : 'No stack trace available',
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString()
    });
  });

  // Track resource loading errors
  window.addEventListener(
    'error',
    function (event) {
      if (event.target !== window) {
        const resource = event.target.src || event.target.href || 'Unknown resource';
        const tagName = event.target.tagName || 'Unknown';
        // Reduce a full URL to the host + last path segment so labels stay
        // under GA's ~100-char cap while still being triagable. We get one
        // bucket per (tag, host, file) instead of one giant bucket for
        // every resource error on the site.
        const shortResource = summarizeResourceUrl(resource);
        // Pages that need richer triage (e.g. stepmania video failures
        // need the song title) can opt in by setting
        // `el.dataset.errorContext` on the element. We pick it up here
        // and append to the GA event_label.
        const elementContext = (event.target.dataset && event.target.dataset.errorContext) || '';
        trackError({
          type: 'resource_error',
          message: `Failed to load ${tagName}: ${shortResource}`,
          resource: resource,
          tagName: tagName,
          context: elementContext,
          url: window.location.href,
          timestamp: new Date().toISOString()
        });
      }
    },
    true
  );
}

// Collapse a resource URL into "host/lastSegment" (or the raw value if it
// isn't parseable) so resource_error labels are distinguishable in GA
// without blowing past the label length limit.
function summarizeResourceUrl(resource) {
  if (!resource || typeof resource !== 'string') return 'unknown';
  try {
    const u = new URL(resource, window.location.href);
    const segments = u.pathname.split('/').filter(Boolean);
    const tail = segments.length ? segments[segments.length - 1] : '/';
    return `${u.host}/${tail}`;
  } catch (_) {
    return resource.slice(0, 80);
  }
}

// Errors we know we cannot meaningfully fix from our own JS. Each entry
// corresponds to a real category we observed dominating the noise floor
// in GA4 (third-party CDN flake, Emscripten-side pointer-lock cooldowns,
// CORS-proxy timeouts, etc.). Suppressed errors still emit a single
// `console.warn` so devtools can show them during local development;
// they just don't fire a GA event.
//
// Regex authoring rule: keep patterns to the SHORTEST uniquely-identifying
// substring. The first version of this list used long literal phrases like
// "Pointer lock cannot be acquired immediately after the user" — but the
// actual Chrome message is "…following a request to exit pointer lock"
// (not "after the user"), so the regex never matched and ~37 false-fire
// events per day kept flowing to GA. Verified by the 2026-06-13 dashboard
// pull: exception count dropped only -36% post-Lever D vs predicted -70%.
// Verbose regexes that *look* defensive are actually the opposite — they're
// trivially defeated by browsers changing one word in the error text.
const SUPPRESSED_ERROR_PATTERNS = [
  // Pointer-lock failures inside the Emscripten-compiled engine
  // (`doom/uzdoom.js`). SDL2 calls `canvas.requestPointerLock()` from
  // compiled C, so the Promise rejection is unreachable from our JS.
  // The browser cooldown rule ("you can't reacquire pointer lock for
  // ~1.25s after the user exits it") fires several hundred times a
  // week as users tap-out and tap-in.
  {
    match: /pointer lock cannot be acquired immediately/i,
    types: ['unhandled_promise_rejection', 'javascript_error']
  },
  {
    match: /pointer is already locked/i,
    types: ['unhandled_promise_rejection', 'javascript_error']
  },
  {
    match: /user has exited the lock before/i,
    types: ['unhandled_promise_rejection', 'javascript_error']
  },
  {
    match: /WrongDocumentError.*root document of this element/i,
    types: ['unhandled_promise_rejection', 'javascript_error']
  },
  {
    match: /NotSupportedError.*options asked for in this request/i,
    types: ['unhandled_promise_rejection']
  },
  // proxy.js callers — `window.proxyService` rotates through a list of
  // free CORS proxies, all of which flake unpredictably. Per the
  // module's design, retries and circuit-breakers handle most of it
  // and rejections that escape the wrapper are not actionable.
  {
    match: /^TypeError:?\s*Failed to fetch/i,
    types: ['unhandled_promise_rejection']
  }
];

// Resource URLs whose host (or full URL substring) is known to be
// third-party flake or cached scrape content. These show up in GA as
// `resource_error` rows but never represent a fixable bug on our side.
const SUPPRESSED_RESOURCE_HOSTS = [
  // Moddb scrape (mod browser): cached pages reference giphy/moddb
  // assets that get rate-limited or expire. Not loaded by our code.
  'media.giphy.com',
  'media.moddb.com',
  // canvas-toBlob polyfill referenced by some moddb-cached page
  // content; not loaded by our code directly. Modern browsers
  // implement canvas.toBlob natively, so the polyfill is unneeded.
  'cdnjs.cloudflare.com',
  // Third-party CDNs — periodic transient outages. If tailwind or
  // emulatorjs is down, the user's page is broken; the GA event
  // about it is redundant.
  'cdn.tailwindcss.com',
  'cdn.emulatorjs.org'
];

function shouldSuppressError(errorType, errorMessage, resource) {
  for (const entry of SUPPRESSED_ERROR_PATTERNS) {
    if (entry.types && !entry.types.includes(errorType)) continue;
    const matches =
      entry.match instanceof RegExp
        ? entry.match.test(errorMessage)
        : typeof errorMessage === 'string' && errorMessage.includes(entry.match);
    if (matches) return true;
  }
  if (resource && errorType === 'resource_error') {
    try {
      const host = new URL(resource, window.location.href).host;
      if (SUPPRESSED_RESOURCE_HOSTS.includes(host)) return true;
    } catch (_) {
      /* unparseable URL — fall through */
    }
  }
  return false;
}

// Function to manually track errors with enhanced context
window.trackError = function (errorData) {
  try {
    const errorType = errorData.type || 'unknown';
    const errorMessage = errorData.message || 'Unknown error';
    const context = errorData.context || '';
    const recoverable = errorData.recoverable !== false;

    if (shouldSuppressError(errorType, errorMessage, errorData.resource)) {
      console.warn('[analytics] suppressed error:', errorType, '-', errorMessage);
      return;
    }

    // Enhanced error tracking with context
    const errorLabel = context
      ? `${errorType}: ${errorMessage} [${context}]`
      : `${errorType}: ${errorMessage}`;

    // Fire exactly one GA event per error. Errors with a stack are reported as
    // `exception` (matches GA4's built-in name), everything else (resource
    // errors, manual errors without a stack) as `error_occurred`. Previously
    // both events fired for stack-bearing errors, which double-counted users
    // in the GA report.
    if (errorData.stack) {
      window.trackEvent('exception', 'Error', `${errorType} - ${errorMessage.substring(0, 100)}`);
    } else {
      window.trackEvent('error_occurred', 'Error', errorLabel);
    }

    // Log additional context for debugging
    console.error('Error tracked:', {
      type: errorType,
      message: errorMessage,
      context: context,
      recoverable: recoverable,
      stack: errorData.stack,
      url: errorData.url || window.location.href,
      timestamp: errorData.timestamp || new Date().toISOString()
    });

    // Log recoverable errors as warnings (applications can handle display themselves)
    if (recoverable) {
      console.warn(
        `[Recoverable Error] ${errorMessage}. The application will attempt to continue.`
      );
    }
  } catch (trackingError) {
    console.error('Failed to track error:', trackingError);
  }
};

// Function to track performance issues
window.trackPerformance = function () {
  try {
    if (!window.performance) return;

    const perfData = window.performance.timing;
    const loadTime = perfData.loadEventEnd - perfData.navigationStart;
    window.trackEvent(
      'page_load',
      'Performance',
      normalizePagePath(window.location.pathname),
      loadTime
    );
  } catch (error) {
    console.error('Failed to track performance:', error);
  }
};

// Track performance when page is fully loaded
window.addEventListener('load', function () {
  setTimeout(trackPerformance, 1000); // Wait a bit for everything to settle
});

// Track arrivals from shared URLs (someone clicked a shared link)
function trackSharedLinkArrival() {
  const searchParams = new URLSearchParams(window.location.search);
  const isSharedLink = searchParams.get('shared') === '1';
  const referrer = document.referrer;
  const pageName = getPageName();

  // Track generic shared link arrivals (from share button)
  if (isSharedLink) {
    // share_source identifies which surface produced the link (e.g. stepmania_score,
    // related_widget). Falls back to "unknown" so older shared URLs still report.
    const source = searchParams.get('share_source') || 'unknown';
    const path = normalizePagePath(window.location.pathname);
    window.trackEvent('shared_link_arrival', pageName, `${source} | ${path}`);
    console.log('Tracked shared link arrival:', pageName, 'source:', source, 'referrer:', referrer);

    // Track referrer if present
    if (referrer) {
      window.trackEvent('shared_link_referrer', pageName, `${source} | ${referrer}`);
    }
  }
}

// Build a URL pointing at the current page tagged for shared-link attribution.
// Sets ?shared=1 plus an optional share_source so GA can tell which surface
// produced the link. Strips any existing shared/share_source params first so
// chained shares don't accumulate stale tags.
window.buildSharedUrl = function (source) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('shared');
    url.searchParams.delete('share_source');
    url.searchParams.set('shared', '1');
    if (source) {
      url.searchParams.set('share_source', source);
    }
    return url.toString();
  } catch (_) {
    // Fallback for environments where URL construction fails (very old browsers).
    const sep = window.location.href.includes('?') ? '&' : '?';
    const sourceTag = source ? `&share_source=${encodeURIComponent(source)}` : '';
    return `${window.location.href}${sep}shared=1${sourceTag}`;
  }
};

// Helper to get page name from path
function getPageName() {
  const path = window.location.pathname;
  const segments = path.split('/').filter((s) => s);
  if (segments.length === 0) return 'Home';
  // Capitalize first letter
  const name = segments[segments.length - 1];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Run on page load
window.addEventListener('load', function () {
  setTimeout(trackSharedLinkArrival, 100);
});

// Helper function to track events (can be called from anywhere, including web components)
window.trackEvent = function (eventName, eventCategory, eventLabel, eventValue) {
  if (typeof gtag === 'undefined') {
    if (isLocalDevHost()) {
      console.log('GA Event tracked (localhost):', eventName, {
        event_category: eventCategory,
        event_label: eventLabel,
        value: eventValue
      });
    }
    return;
  }

  const eventParams = {
    event_category: eventCategory || 'Interaction',
    event_label: eventLabel || eventName
  };

  if (eventValue !== undefined && !isNaN(eventValue)) {
    eventParams.value = eventValue;
  }

  gtag('event', eventName, eventParams);

  // Log to console for development
  if (isLocalDevHost()) {
    console.log('GA Event tracked:', eventName, eventParams);
  }
};

// Data-event click tracking functionality.
//
// Attributes:
//   data-event              required, GA event name
//   data-event-category     optional, defaults to "Interaction"
//   data-event-label        optional, defaults to data-event
//   data-event-value        optional numeric value
//   data-event-conversion   optional — when present, ALSO fires
//                           trackConversion(<attr value>, <data-event-value or 1>)
//                           so high-intent CTAs can be marked as Key
//                           Events in GA4 Admin without touching JS.
function initDataEventTracking() {
  // Listen for clicks on elements with data-event attribute
  document.addEventListener(
    'click',
    function (event) {
      // Find the nearest element with data-event attribute (including the clicked element itself)
      const target = event.target.closest('[data-event]');

      if (target) {
        const dataEvent = target.getAttribute('data-event');
        const dataEventCategory = target.getAttribute('data-event-category') || 'Interaction';
        const dataEventLabel = target.getAttribute('data-event-label') || dataEvent;
        const valueAttr = target.getAttribute('data-event-value');
        const dataEventValue = valueAttr ? parseFloat(valueAttr) : undefined;

        window.trackEvent(dataEvent, dataEventCategory, dataEventLabel, dataEventValue);

        const conversionName = target.getAttribute('data-event-conversion');
        if (conversionName) {
          window.trackConversion(
            conversionName,
            dataEventValue !== undefined && !isNaN(dataEventValue) ? dataEventValue : 1
          );
        }
      }
    },
    true
  ); // Use capture phase to catch events early
}

// Engagement Time Tracking
// Track how long users spend on each page. Final engaged time is captured
// once on `pagehide` (mobile-reliable) and once on `beforeunload` (desktop
// fallback). Sessions ≥30s also fire the `engaged_session` conversion, and
// sessions ≥120s additionally fire the stronger `deep_engagement` Key Event.
//
// Note: we deliberately do NOT fire a periodic `engagement_ping` heartbeat.
// GA4's automatic `user_engagement` event already powers the "Average
// engagement time per page" metric in the standard Pages-and-screens
// report, which is the input to our quality-minutes calculation. A custom
// 30-second cumulative ping was redundant with that and dominated the
// event-count rankings, drowning out the sparse-but-actionable custom
// events (project_open, doom_flavor_pick, song_complete, etc.). If you
// want a session-survival curve in the future, prefer querying GA4's
// native engagement metrics instead of re-adding the ping here.
//
// The `deep_engagement` conversion at 120s is the exception: it fires
// EXACTLY ONCE per page-load (not a heartbeat) and represents a much
// stronger "got value" signal than the 30s `engaged_session` baseline.
// It's the primary Key Event candidate for GA4 Admin (see KEY_EVENTS
// block at top of file).
(function initEngagementTracking() {
  let lastVisibleAt = Date.now();
  let isPageVisible = !document.hidden;
  let totalEngagedTime = 0;

  const PAGE_NAME = getPageName();
  const MIN_ENGAGEMENT_TIME = 10000; // Min 10 seconds before tracking
  const DEEP_ENGAGEMENT_MS = 120000; // 2 minutes engaged → strong Key Event

  let deepEngagementFired = false;
  let deepEngagementTimer = null;

  function currentEngagedMs() {
    return isPageVisible ? totalEngagedTime + (Date.now() - lastVisibleAt) : totalEngagedTime;
  }

  // Fire `deep_engagement` exactly once per page-load when cumulative
  // engaged time (visibility-aware) crosses DEEP_ENGAGEMENT_MS. Scheduled
  // via setTimeout — when the tab goes hidden we cancel the pending fire
  // and reschedule on visible with the remaining time, so background tabs
  // don't accrue toward the threshold.
  function scheduleDeepEngagementCheck() {
    if (deepEngagementFired || !isPageVisible) return;
    if (deepEngagementTimer) clearTimeout(deepEngagementTimer);
    const remaining = DEEP_ENGAGEMENT_MS - currentEngagedMs();
    if (remaining <= 0) {
      fireDeepEngagement();
      return;
    }
    deepEngagementTimer = setTimeout(() => {
      if (currentEngagedMs() >= DEEP_ENGAGEMENT_MS) fireDeepEngagement();
      else scheduleDeepEngagementCheck();
    }, remaining);
  }

  function fireDeepEngagement() {
    if (deepEngagementFired) return;
    deepEngagementFired = true;
    if (deepEngagementTimer) {
      clearTimeout(deepEngagementTimer);
      deepEngagementTimer = null;
    }
    window.trackConversion(
      'deep_engagement',
      Math.max(120, Math.round(currentEngagedMs() / 1000))
    );
  }

  if (!document.hidden) scheduleDeepEngagementCheck();

  // Track visibility changes — going hidden flushes the current visible
  // window into `totalEngagedTime`; coming back resets the start anchor.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      const engagedDuration = Date.now() - lastVisibleAt;
      totalEngagedTime += engagedDuration;
      isPageVisible = false;
      if (deepEngagementTimer) {
        clearTimeout(deepEngagementTimer);
        deepEngagementTimer = null;
      }
    } else {
      isPageVisible = true;
      lastVisibleAt = Date.now();
      scheduleDeepEngagementCheck();
    }
  });

  // Track total time on page when user leaves
  window.addEventListener('beforeunload', function () {
    const finalEngagedTime = currentEngagedMs();

    // Only track if user spent meaningful time
    if (finalEngagedTime >= MIN_ENGAGEMENT_TIME) {
      window.trackEvent('page_exit', 'Engagement', PAGE_NAME, Math.round(finalEngagedTime / 1000));

      // Track as conversion if user was engaged for 30+ seconds
      if (finalEngagedTime >= 30000) {
        window.trackConversion('engaged_session', 1);
      }
      // Backstop: if the user blew past 120s without our timer firing
      // (e.g. they were continuously visible but the tab was throttled),
      // emit deep_engagement at unload so we don't undercount.
      if (finalEngagedTime >= DEEP_ENGAGEMENT_MS && !deepEngagementFired) {
        fireDeepEngagement();
      }
    }
  });

  // Track pagehide event for better mobile support
  window.addEventListener('pagehide', function () {
    const finalEngagedTime = currentEngagedMs();

    if (finalEngagedTime >= MIN_ENGAGEMENT_TIME) {
      window.trackEvent('page_hide', 'Engagement', PAGE_NAME, Math.round(finalEngagedTime / 1000));
    }
    if (finalEngagedTime >= DEEP_ENGAGEMENT_MS && !deepEngagementFired) {
      fireDeepEngagement();
    }
  });
})();

// Conversion Tracking
// Fires the conversionType as its own GA event under the Conversion category.
// Previously this funneled every call through a single `conversion` event with
// the conversion type stuffed into event_label, which made it impossible to
// separate engaged-session conversions from project-open conversions in GA.
window.trackConversion = function (conversionType, value) {
  if (typeof gtag === 'undefined') {
    if (isLocalDevHost()) {
      console.log('Conversion tracked (localhost):', conversionType, value);
    }
    return;
  }

  gtag('event', conversionType, {
    event_category: 'Conversion',
    value: value || 1
  });

  console.log('Conversion tracked:', conversionType, value);
};

// Track when users open/interact with projects. Also drives the
// `multi_app_session` Key Event below — when a single tab-session opens
// 2+ DISTINCT projects, that's a much stronger "explored the suite"
// signal than a single project_opened.
window.trackProjectOpen = function (projectName) {
  const name = projectName || 'unknown';
  window.trackEvent('project_open', 'Projects', name);
  window.trackConversion('project_opened', 1);
  trackMultiAppSession(name);
};

// sessionStorage-backed counter of distinct project names opened in
// this tab session. Fires `multi_app_session` exactly once, when the
// 2nd distinct project opens. We cap stored payload size to a handful
// of names to keep the JSON small; once we've fired the conversion
// the only thing we care about is the boolean "fired" flag.
const MULTI_APP_KEY = 'hos-session-projects';
const MULTI_APP_FIRED_KEY = 'hos-session-multi-fired';
function trackMultiAppSession(projectName) {
  try {
    if (sessionStorage.getItem(MULTI_APP_FIRED_KEY) === '1') return;
    const raw = sessionStorage.getItem(MULTI_APP_KEY);
    /** @type {string[]} */
    const prev = raw ? JSON.parse(raw) : [];
    if (prev.includes(projectName)) return;
    prev.push(projectName);
    // Cap at 8 names — we only need to know "have we seen ≥2 distinct".
    const trimmed = prev.slice(-8);
    sessionStorage.setItem(MULTI_APP_KEY, JSON.stringify(trimmed));
    if (trimmed.length >= 2) {
      sessionStorage.setItem(MULTI_APP_FIRED_KEY, '1');
      window.trackConversion('multi_app_session', trimmed.length);
    }
  } catch (_) {
    /* sessionStorage unavailable (private mode, sandboxed iframe) — skip */
  }
}

// PWA install — fires when the browser (Chrome/Edge/iOS Safari "Add to
// Home Screen") finishes installing the site as a standalone app. This
// is the highest-intent signal a casual visitor can produce and is a
// natural Key Event.
window.addEventListener('appinstalled', function () {
  window.trackConversion('pwa_install', 1);
});

// =====================================================================
// GA bootstrap — runs synchronously when this script finishes evaluating.
//
// Previously the config call lived inside `window.addEventListener('load', …)`,
// which fires only after every image, stylesheet, and async script has
// finished. On wordle-finder that meant jQuery + Plotly + Moment all had to
// load before the page_view ever went out — any visitor who bounced first
// landed in GA4's "(not set)" landing-page bucket.
//
// Running it at script-evaluation time fires the page_view far earlier,
// long before `load`. `analytics.js` is loaded as a regular sync `<script>`
// after the gtag/js loader, so `dataLayer` is safe to push into at this
// point — calls queue in the array and the gtag library drains them when
// it finishes loading. This block sits at the bottom of the file so every
// helper it transitively touches (window.trackEvent etc.) is already
// defined when trackOffsiteUsage runs.
// =====================================================================
window.dataLayer = window.dataLayer || [];

if (isLocalDevHost()) {
  // Keep `gtag` defined so callers don't crash, but no traffic to GA.
  // `trackEvent` / `trackError` already short-circuit on localhost via
  // their own `isLocalDevHost()` check, so we don't replace them here.
  window.gtag = function () {};
} else {
  window.gtag = function () {
    dataLayer.push(arguments);
  };
  gtag('js', new Date());

  // Normalized page path consolidates /page/ and /page/index.html into one
  // entry in GA reports.
  gtag('config', 'G-Q62Q3E20Y0', {
    page_path: normalizePagePath(window.location.pathname)
  });

  initErrorTracking();
  initDataEventTracking();

  // Track if the site is being served from an unexpected hostname
  // or embedded in an iframe outside of joeheyming.github.io.
  trackOffsiteUsage();
}
