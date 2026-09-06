// =====================================================================
// CUSTOM GA4 EVENTS
//
// Keep this list deliberately small. GA4 already supplies page_view,
// acquisition, and user_engagement; custom events are reserved for product
// outcomes and actionable health signals.
//
// Product outcomes (marked as Key Events in GA4):
//   doom_engine_launched   Doom WASM actually started
//   pacman_game_start      Pac-Man / Infinite play started
//   song_complete          StepMania song finished
//   watch_played           Watch playback succeeded (not every watch_play_start)
//   speller_word_rendered  Periodic Speller produced a spelling
//   content_shared         Shared via share.js / share FAB
//
// Actionable health:
//   exception             JavaScript errors with a stack
//   error_occurred        Resource/manual errors without a stack
//   web_vital_inp         Slowest interaction on a page
//   watch_playback_error  Watch exhausted its playback fallbacks
//   doom_flavor_failed    Doom failed to launch a selected engine
//
// High-intent platform outcome:
//   pwa_install           Site installed as a PWA
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
  // Chrome's remaining Doom volume: NotAllowedError on
  // canvas.requestPointerLock() (user-gesture / cooldown). Distinct from
  // TypeError "is not a function", which is a missing API and stays visible.
  {
    match: /NotAllowedError.*requestPointerLock/i,
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
  // Doom IDBFS: Emscripten flushes IndexedDB on tab close. Chrome throws
  // InvalidStateError once the IDB connection is already closing. The
  // loader in doom/uzdoom-loader-idbfs.js swallows most of these; leftovers
  // still hit the global handler and were the bulk of sitewide `exception`.
  // Keep RuntimeError / WASM abort unsuppressed — those are real crashes.
  {
    match: /database connection is closing/i,
    types: ['javascript_error', 'unhandled_promise_rejection']
  },
  {
    match: /transaction has finished/i,
    types: ['javascript_error', 'unhandled_promise_rejection']
  },
  {
    match: /InvalidStateError.*(?:IDBDatabase|IDBTransaction|indexedDB)/i,
    types: ['javascript_error', 'unhandled_promise_rejection']
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

// Watch walks a playback URL queue (archive.org → .ia.mp4 → IA CDN).
// Each failed <video> src fires a capture-phase resource_error before
// watch_playback_error fires once at exhaustion. Poster <img> 404s from
// TVMaze do the same. Match the whole IA / TVMaze host family so we
// don't enumerate every iaNNNN.us.archive.org edge. StepMania empty-src
// VIDEO errors stay visible (those are same-origin / data URLs).
function isSuppressedResourceHost(host) {
  if (!host) return false;
  if (SUPPRESSED_RESOURCE_HOSTS.includes(host)) return true;
  if (host === 'archive.org' || host.endsWith('.archive.org')) return true;
  if (host === 'tvmaze.com' || host.endsWith('.tvmaze.com')) return true;
  return false;
}

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
      if (isSuppressedResourceHost(host)) return true;
    } catch (_) {
      /* unparseable URL — fall through */
    }
  }
  return false;
}

// jsdom tests load this file and assert filter behavior without going
// through GA. Not a public API.
window.__analyticsShouldSuppressError = shouldSuppressError;

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

// Capture the slowest real interaction on each page so grouped Search
// Console INP reports can be traced back to an event and element. Event
// Timing exposes no input values or text; the label contains only the event
// type and a short structural selector such as "click button#submit".
function initInpTracking() {
  if (typeof PerformanceObserver === 'undefined') return;

  let worstInteraction = null;
  let lastReportedDuration = 0;
  let observer = null;

  function describeTarget(target) {
    if (!(target instanceof Element)) return 'unknown';
    let label = target.tagName.toLowerCase();
    if (target.id) {
      label += `#${target.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)}`;
    } else if (target.classList.length) {
      const classes = Array.from(target.classList)
        .slice(0, 2)
        .map((name) => name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24))
        .filter(Boolean);
      if (classes.length) label += `.${classes.join('.')}`;
    }
    return label.slice(0, 70);
  }

  function considerEntries(entries) {
    for (const entry of entries) {
      if (!entry.interactionId) continue;
      if (!worstInteraction || entry.duration > worstInteraction.duration) {
        worstInteraction = entry;
      }
    }
  }

  function reportWorstInteraction() {
    if (observer) considerEntries(observer.takeRecords());
    if (!worstInteraction || worstInteraction.duration <= lastReportedDuration) return;
    lastReportedDuration = worstInteraction.duration;
    window.trackEvent(
      'web_vital_inp',
      'Web Vitals',
      `${worstInteraction.name} ${describeTarget(worstInteraction.target)}`.slice(0, 100),
      Math.round(worstInteraction.duration)
    );
  }

  try {
    observer = new PerformanceObserver((list) => {
      considerEntries(list.getEntries());
    });
    observer.observe({ type: 'event', buffered: true, durationThreshold: 40 });
  } catch (_) {
    // Event Timing is not available in this browser.
    return;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) reportWorstInteraction();
  });
  window.addEventListener('pagehide', reportWorstInteraction);
}

// Build a URL pointing at the current page tagged for shared-link attribution.
// Sets ?shared=1 plus an optional share_source so GA can tell which surface
// produced the link. Also sets the three GA-standard utm_* params so chat
// apps and unfurlers that normalize URLs (Slack/Discord/iMessage/Gmail)
// preserve at least the utm tags — those are recognized universally, while
// custom `?shared=1` is often stripped. This closes the "94 share events → 4
// arrivals" attribution gap (see MONEYBALL Appendix C, Fix B).
//
// GA4 automatically maps utm_source/utm_medium/utm_campaign onto the
// Session source / Session medium / Session campaign dimensions, so shared
// arrivals show up in the standard Acquisition report next to google/bing/
// direct without any extra instrumentation.
//
// Strips any existing shared/share_source/utm_* params first so chained
// shares don't accumulate stale tags.
window.buildSharedUrl = function (source) {
  const utmSource = 'joeheyming';
  const utmMedium = 'share_link';
  const utmCampaign = source || 'share';
  try {
    const url = new URL(window.location.href);
    ['shared', 'share_source', 'utm_source', 'utm_medium', 'utm_campaign'].forEach((p) =>
      url.searchParams.delete(p)
    );
    url.searchParams.set('shared', '1');
    if (source) {
      url.searchParams.set('share_source', source);
    }
    url.searchParams.set('utm_source', utmSource);
    url.searchParams.set('utm_medium', utmMedium);
    url.searchParams.set('utm_campaign', utmCampaign);
    return url.toString();
  } catch (_) {
    const sep = window.location.href.includes('?') ? '&' : '?';
    const sourceTag = source ? `&share_source=${encodeURIComponent(source)}` : '';
    const utm =
      `&utm_source=${utmSource}` +
      `&utm_medium=${utmMedium}` +
      `&utm_campaign=${encodeURIComponent(utmCampaign)}`;
    return `${window.location.href}${sep}shared=1${sourceTag}${utm}`;
  }
};

// Yield control back to the browser so it can paint (and process other
// input) before the next chunk of JS runs. Heavy click handlers should
// paint a "working…" state, `await window.yieldToMain()`, and then do the
// long compute in the resumed continuation — post-yield work no longer
// counts toward the click's INP. Site-wide utility because every app has
// at least one interaction that could push INP past the 200ms threshold
// without the pattern.
//
// Uses `scheduler.yield()` when available (Chromium 129+ — highest-priority
// continuation, respects task priority, no throttling in background tabs).
// Falls back to a 0ms `setTimeout`, which still creates a new task boundary
// and gives the renderer a chance to paint. Placed on `analytics.js`
// because it loads synchronously in `<head>` on every page, so callers can
// rely on `window.yieldToMain` being defined before any user interaction.
window.yieldToMain = function yieldToMain() {
  if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
    return scheduler.yield();
  }
  return new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
};

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

  if (isLocalDevHost()) {
    console.log('Conversion tracked:', conversionType, value);
  }
};

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
// defined.
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
  initInpTracking();
}
