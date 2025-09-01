// Proxy Service Module
class ProxyService {
  constructor() {
    this.proxyOptions = [
      'https://api.allorigins.win/raw?url=',
      'https://cors-anywhere.herokuapp.com/',
      'https://thingproxy.freeboard.io/fetch/'
    ];
    this.cache = new Map();
  }

  // Helper function to proxy simfile URLs through AllOrigins
  proxySimfile(url) {
    if (url && url.includes('.sm') && (url.startsWith('http://') || url.startsWith('https://'))) {
      return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    }
    return url;
  }

  // Fetch content through multiple proxy options with fallback
  async fetchWithProxy(url, options = {}) {
    const cacheKey = `${url}-${JSON.stringify(options)}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    let lastError = null;

    for (const proxy of this.proxyOptions) {
      try {
        const proxyUrl = proxy + encodeURIComponent(url);
        const response = await fetch(proxyUrl, {
          method: 'GET',
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            ...options.headers
          },
          ...options
        });

        if (response.ok) {
          const content = await response.text();
          this.cache.set(cacheKey, content);
          return content;
        }
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    throw new Error(`All proxies failed: ${lastError?.message || 'Unknown error'}`);
  }

  // Fetch simfile content specifically
  async fetchSimfile(url) {
    const options = {
      headers: {
        Accept: 'text/plain,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    };
    return this.fetchWithProxy(url, options);
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
  }

  // Get cache size
  getCacheSize() {
    return this.cache.size;
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
