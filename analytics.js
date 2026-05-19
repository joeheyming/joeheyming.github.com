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
        trackError({
          type: 'resource_error',
          message: `Failed to load ${tagName}: ${shortResource}`,
          resource: resource,
          tagName: tagName,
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

// Function to manually track errors with enhanced context
window.trackError = function (errorData) {
  try {
    const errorType = errorData.type || 'unknown';
    const errorMessage = errorData.message || 'Unknown error';
    const context = errorData.context || '';
    const recoverable = errorData.recoverable !== false;

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
      window.trackEvent(
        'exception',
        'Error',
        `${errorType} - ${errorMessage.substring(0, 100)}`
      );
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

// Data-event click tracking functionality
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
      }
    },
    true
  ); // Use capture phase to catch events early
}

// Engagement Time Tracking
// Track how long users spend on each page and send periodic engagement pings
(function initEngagementTracking() {
  let pageStartTime = Date.now();
  let lastPingTime = Date.now();
  let isPageVisible = !document.hidden;
  let totalEngagedTime = 0;

  const PAGE_NAME = getPageName();
  const PING_INTERVAL = 30000; // Send engagement ping every 30 seconds
  const MIN_ENGAGEMENT_TIME = 10000; // Min 10 seconds before tracking

  // Track visibility changes
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      // User switched away - record time
      const engagedDuration = Date.now() - lastPingTime;
      totalEngagedTime += engagedDuration;
      isPageVisible = false;
    } else {
      // User came back
      isPageVisible = true;
      lastPingTime = Date.now();
    }
  });

  // Send periodic engagement pings while user is active
  const engagementInterval = setInterval(function () {
    if (isPageVisible) {
      const currentTime = Date.now();
      const engagedDuration = currentTime - lastPingTime;
      totalEngagedTime += engagedDuration;

      // Send engagement ping
      window.trackEvent(
        'engagement_ping',
        'Engagement',
        PAGE_NAME,
        Math.round(totalEngagedTime / 1000)
      );

      lastPingTime = currentTime;
    }
  }, PING_INTERVAL);

  // Track total time on page when user leaves
  window.addEventListener('beforeunload', function () {
    const totalTime = Date.now() - pageStartTime;
    const finalEngagedTime = isPageVisible
      ? totalEngagedTime + (Date.now() - lastPingTime)
      : totalEngagedTime;

    // Only track if user spent meaningful time
    if (finalEngagedTime >= MIN_ENGAGEMENT_TIME) {
      window.trackEvent('page_exit', 'Engagement', PAGE_NAME, Math.round(finalEngagedTime / 1000));

      // Track as conversion if user was engaged for 30+ seconds
      if (finalEngagedTime >= 30000) {
        window.trackConversion('engaged_session', 1);
      }
    }
  });

  // Track pagehide event for better mobile support
  window.addEventListener('pagehide', function () {
    const finalEngagedTime = isPageVisible
      ? totalEngagedTime + (Date.now() - lastPingTime)
      : totalEngagedTime;

    if (finalEngagedTime >= MIN_ENGAGEMENT_TIME) {
      window.trackEvent('page_hide', 'Engagement', PAGE_NAME, Math.round(finalEngagedTime / 1000));
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

// Track when users open/interact with projects
window.trackProjectOpen = function (projectName) {
  window.trackEvent('project_open', 'Projects', projectName);
  window.trackConversion('project_opened', 1);
};

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
