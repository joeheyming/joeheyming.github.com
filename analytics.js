// assuming google analytics is already loaded
// onload
// Normalize page path by removing index.html
function normalizePagePath(path) {
  return path.replace(/\/index\.html$/, '/');
}

window.onload = function () {
  if (location.hostname === 'localhost') {
    window.gtag = function () {};
    window.trackError = function () {}; // No-op for localhost
    return;
  }
  window.gtag = function () {
    dataLayer.push(arguments);
  };
  gtag('js', new Date());

  // Configure GA with normalized page path to consolidate /page/ and /page/index.html
  gtag('config', 'G-Q62Q3E20Y0', {
    page_path: normalizePagePath(window.location.pathname)
  });

  // Initialize error tracking
  initErrorTracking();

  // Initialize data-event click tracking
  initDataEventTracking();
};

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
        trackError({
          type: 'resource_error',
          message: 'Failed to load resource',
          resource: event.target.src || event.target.href || 'Unknown resource',
          tagName: event.target.tagName,
          url: window.location.href,
          timestamp: new Date().toISOString()
        });
      }
    },
    true
  );
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

    window.trackEvent('error_occurred', 'Error', errorLabel);

    // Track exception separately for better categorization
    if (errorData.stack) {
      window.trackEvent('exception', 'Error', `${errorType} - ${errorMessage.substring(0, 100)}`);
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
    window.trackEvent('shared_link_arrival', pageName, normalizePagePath(window.location.pathname));
    console.log('Tracked shared link arrival:', pageName, 'referrer:', referrer);

    // Track referrer if present
    if (referrer) {
      window.trackEvent('shared_link_referrer', pageName, referrer);
    }
  }
}

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
    if (location.hostname === 'localhost') {
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
  if (location.hostname === 'localhost') {
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
