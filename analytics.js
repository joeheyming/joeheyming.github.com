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
    // Ensure we have gtag available
    if (typeof gtag === 'undefined') {
      console.warn('Google Analytics not available for error tracking');
      return;
    }

    // Send error as a custom event to Google Analytics
    gtag('event', 'exception', {
      description: errorData.message || 'Unknown error',
      fatal: false,
      custom_map: {
        error_type: errorData.type || 'manual_error',
        error_stack: (errorData.stack || '').substring(0, 500), // Limit stack trace length
        error_filename: errorData.filename || '',
        error_line: errorData.line || '',
        error_column: errorData.column || '',
        error_url: errorData.url || window.location.href,
        error_timestamp: errorData.timestamp || new Date().toISOString(),
        error_user_agent: errorData.userAgent || navigator.userAgent,
        error_resource: errorData.resource || '',
        error_tag_name: errorData.tagName || ''
      }
    });

    // Also send as a custom event for easier filtering in GA
    gtag('event', 'error_occurred', {
      event_category: 'Error',
      event_label: errorData.type || 'manual_error',
      value: 1,
      custom_parameters: {
        error_message: (errorData.message || '').substring(0, 100),
        error_page: window.location.pathname,
        error_timestamp: errorData.timestamp || new Date().toISOString()
      }
    });

    // Log to console for development
    console.error('Error tracked:', errorData);
  } catch (trackingError) {
    console.error('Failed to track error:', trackingError);
  }
};

// Function to track performance issues
window.trackPerformance = function () {
  try {
    if (typeof gtag === 'undefined' || !window.performance) return;

    const perfData = window.performance.timing;
    const loadTime = perfData.loadEventEnd - perfData.navigationStart;
    const domReadyTime = perfData.domContentLoadedEventEnd - perfData.navigationStart;

    gtag('event', 'performance_metrics', {
      event_category: 'Performance',
      custom_parameters: {
        load_time: loadTime,
        dom_ready_time: domReadyTime,
        page_url: window.location.href
      }
    });
  } catch (error) {
    console.error('Failed to track performance:', error);
  }
};

// Track performance when page is fully loaded
window.addEventListener('load', function () {
  setTimeout(trackPerformance, 1000); // Wait a bit for everything to settle
});
