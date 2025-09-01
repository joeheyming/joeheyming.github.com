// Proxy Service Module
class ProxyService {
  constructor() {
    this.proxyOptions = [
      'https://cors-anywhere.herokuapp.com/',
      'https://api.codetabs.com/v1/proxy?quest=',
      'https://corsproxy.io/?',
      'https://cors.bridged.cc/',
      'https://api.allorigins.win/raw?url='
    ];
    this.cache = new Map();
    this.timeoutMs = 10000; // 10 second timeout
    this.maxRetries = 2;
  }

  // Helper function to proxy simfile URLs through AllOrigins
  proxySimfile(url) {
    if (url && url.includes('.sm') && (url.startsWith('http://') || url.startsWith('https://'))) {
      return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    }
    return url;
  }

  // Shuffle array to randomize proxy selection
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Create a timeout promise
  createTimeoutPromise(timeoutMs) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  // Fetch content through multiple proxy options with fallback, timeout, and retries
  async fetchWithProxy(url, options = {}) {
    const cacheKey = `${url}-${JSON.stringify(options)}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const timeoutMs = options.timeout || this.timeoutMs;
    const maxRetries = options.maxRetries || this.maxRetries;
    let lastError = null;

    // Shuffle proxies for random selection
    const shuffledProxies = this.shuffleArray(this.proxyOptions);

    for (let retry = 0; retry <= maxRetries; retry++) {
      for (const proxy of shuffledProxies) {
        try {
          const proxyUrl = proxy + encodeURIComponent(url);

          // Create a race between the fetch and timeout
          const fetchPromise = fetch(proxyUrl, {
            method: 'GET',
            headers: {
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              ...options.headers
            },
            ...options
          });

          const response = await Promise.race([fetchPromise, this.createTimeoutPromise(timeoutMs)]);

          if (response.ok) {
            const content = await response.text();
            this.cache.set(cacheKey, content);
            return content;
          } else {
            console.warn(`Proxy ${proxy} returned status ${response.status}`);
          }
        } catch (error) {
          lastError = error;
          console.warn(`Proxy ${proxy} failed (attempt ${retry + 1}):`, error.message);
          continue;
        }
      }

      // If we get here, all proxies failed for this retry
      if (retry < maxRetries) {
        console.log(`All proxies failed, retrying... (${retry + 1}/${maxRetries})`);
        // Wait a bit before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
      }
    }

    throw new Error(
      `All proxies failed after ${maxRetries + 1} attempts: ${
        lastError?.message || 'Unknown error'
      }`
    );
  }

  // Fetch simfile content specifically
  async fetchSimfile(url) {
    const options = {
      headers: {
        Accept: 'text/plain,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 15000, // Longer timeout for simfiles
      maxRetries: 3 // More retries for simfiles
    };
    return this.fetchWithProxy(url, options);
  }

  // Set timeout for all requests
  setTimeout(timeoutMs) {
    this.timeoutMs = timeoutMs;
  }

  // Set max retries for all requests
  setMaxRetries(maxRetries) {
    this.maxRetries = maxRetries;
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
  }

  // Get cache size
  getCacheSize() {
    return this.cache.size;
  }

  // Get proxy statistics
  getProxyStats() {
    return {
      proxyCount: this.proxyOptions.length,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      cacheSize: this.cache.size
    };
  }
}

// Create global instance
const proxyService = new ProxyService();

// Make globally accessible
window.proxyService = proxyService;
window.proxySimfile = proxyService.proxySimfile.bind(proxyService);

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ProxyService, proxyService };
}
