// assuming google analytics is already loaded
// onload
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
  gtag('config', 'G-Q62Q3E20Y0');

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

// Function to manually track errors
window.trackError = function (errorData) {
  try {
    const errorType = errorData.type || 'unknown';
    const errorMessage = errorData.message || 'Unknown error';
    window.trackEvent('error', 'Error', `${errorType}: ${errorMessage}`);
    console.error('Error tracked:', errorData);
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
    window.trackEvent('page_load', 'Performance', window.location.pathname, loadTime);
  } catch (error) {
    console.error('Failed to track performance:', error);
  }
};

// Track performance when page is fully loaded
window.addEventListener('load', function () {
  setTimeout(trackPerformance, 1000); // Wait a bit for everything to settle
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
