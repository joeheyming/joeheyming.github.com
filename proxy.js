// Universal Proxy Service Module - supports both simfiles and ROM files
class ProxyService {
  constructor() {
    // Proxy services ordered roughly by reliability (as of late 2024-2025)
    // Note: Free proxies can become unreliable - check/update periodically
    this.proxyOptions = [
      'https://corsproxy.io/?', // Most reliable as of 2025
      'https://api.codetabs.com/v1/proxy?quest=', // Rate limited but works
      'https://proxy.cors.sh/', // Works for many sites
      'https://api.allorigins.win/raw?url=', // Can be unreliable, sometimes returns 500
      'https://thingproxy.freeboard.io/fetch/', // Alternative
      'https://corsproxy.org/?', // Alternative to corsproxy.io
      'https://cors-anywhere.herokuapp.com/' // Requires activation at cors-anywhere.herokuapp.com/corsdemo
    ];
    this.cache = new Map();
    this.timeoutMs = 15000; // 15 second timeout (some proxies are slow)
    this.maxRetries = 3; // More retries for better success rate

    // Proxy scoring system
    this.proxyScores = new Map();
    this.proxyAttempts = new Map();
    this.proxySuccesses = new Map();

    // Initialize scores for all proxies
    this.proxyOptions.forEach((proxy) => {
      this.proxyScores.set(proxy, 1.0); // Start with neutral score
      this.proxyAttempts.set(proxy, 0);
      this.proxySuccesses.set(proxy, 0);
    });
  }

  // Update proxy score based on success/failure
  updateProxyScore(proxy, success, responseTime = null) {
    const currentScore = this.proxyScores.get(proxy) || 1.0;
    const attempts = this.proxyAttempts.get(proxy) || 0;
    const successes = this.proxySuccesses.get(proxy) || 0;

    this.proxyAttempts.set(proxy, attempts + 1);

    if (success) {
      this.proxySuccesses.set(proxy, successes + 1);

      // Boost score for success, with bonus for fast responses
      let scoreBoost = 0.1;
      if (responseTime && responseTime < 2000) {
        scoreBoost += 0.05; // Extra boost for fast responses
      }
      this.proxyScores.set(proxy, Math.min(2.0, currentScore + scoreBoost));
    } else {
      // Penalize score for failure
      this.proxyScores.set(proxy, Math.max(0.1, currentScore - 0.2));
    }
  }

  // Get proxies ordered by score (best first)
  getOrderedProxies() {
    return this.proxyOptions
      .map((proxy) => ({
        proxy,
        score: this.proxyScores.get(proxy) || 1.0,
        attempts: this.proxyAttempts.get(proxy) || 0,
        successes: this.proxySuccesses.get(proxy) || 0
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.proxy);
  }

  // Create a timeout promise
  createTimeoutPromise(timeoutMs) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  // Sites known to block CORS - skip direct fetch for these
  knownCorsBlockedDomains = ['zenius-i-vanisher.com', 'simfileshare.com'];

  // Check if URL is from a known CORS-blocked domain
  isKnownCorsBlocked(url) {
    try {
      const urlObj = new URL(url);
      return this.knownCorsBlockedDomains.some((domain) => urlObj.hostname.includes(domain));
    } catch {
      return false;
    }
  }

  // Try direct fetch first (in case server allows CORS)
  async tryDirectFetch(url, options = {}) {
    // Skip direct fetch for known CORS-blocked sites
    if (this.isKnownCorsBlocked(url)) {
      console.log(`Skipping direct fetch for known CORS-blocked site: ${url}`);
      return null;
    }

    try {
      const timeoutMs = options.timeout || 3000; // Short timeout for direct attempt
      const fetchPromise = fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...options.headers
        },
        mode: 'cors'
      });

      const response = await Promise.race([fetchPromise, this.createTimeoutPromise(timeoutMs)]);
      if (response.ok) {
        console.log('Direct fetch succeeded (no proxy needed)');
        return await response.text();
      }
    } catch (error) {
      // Expected - most sites block CORS, continue to proxies
      console.log(`Direct fetch blocked (expected): ${error.message}`);
    }
    return null;
  }

  // Fetch content through multiple proxy options with fallback, timeout, and retries
  async fetchWithProxy(url, options = {}) {
    const cacheKey = `${url}-${JSON.stringify(options)}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Try direct fetch first (skip proxy if server allows CORS)
    if (!options.skipDirect) {
      const directResult = await this.tryDirectFetch(url, options);
      if (directResult) {
        this.cache.set(cacheKey, directResult);
        return directResult;
      }
    }

    const timeoutMs = options.timeout || this.timeoutMs;
    const maxRetries = options.maxRetries || this.maxRetries;
    let lastError = null;

    // Get proxies ordered by performance score
    const orderedProxies = this.getOrderedProxies();
    console.log(`Trying ${orderedProxies.length} proxies for: ${url.substring(0, 80)}...`);

    for (let retry = 0; retry <= maxRetries; retry++) {
      for (const proxy of orderedProxies) {
        try {
          const proxyUrl = proxy + encodeURIComponent(url);
          const startTime = Date.now();
          console.log(`Trying proxy: ${proxy.substring(0, 30)}...`);

          // Create a race between the fetch and timeout
          const fetchPromise = fetch(proxyUrl, {
            method: 'GET',
            headers: {
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
              ...options.headers
            }
          });

          const response = await Promise.race([fetchPromise, this.createTimeoutPromise(timeoutMs)]);
          const responseTime = Date.now() - startTime;

          if (response.ok) {
            const content = await response.text();
            this.cache.set(cacheKey, content);

            // Update score for successful proxy
            this.updateProxyScore(proxy, true, responseTime);
            console.log(
              `Proxy ${proxy} succeeded in ${responseTime}ms (score: ${this.proxyScores
                .get(proxy)
                .toFixed(2)})`
            );

            return content;
          } else {
            console.warn(`Proxy ${proxy} returned status ${response.status}`);
            this.updateProxyScore(proxy, false);
          }
        } catch (error) {
          lastError = error;
          console.warn(`Proxy ${proxy} failed (attempt ${retry + 1}):`, error.message);
          this.updateProxyScore(proxy, false);
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

  // Try direct binary fetch first (in case server allows CORS)
  async tryDirectBinaryFetch(url, options = {}) {
    // Skip direct fetch for known CORS-blocked sites
    if (this.isKnownCorsBlocked(url)) {
      console.log(`Skipping direct binary fetch for known CORS-blocked site`);
      return null;
    }

    try {
      const timeoutMs = options.timeout || 3000;
      const fetchPromise = fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/octet-stream,*/*',
          ...options.headers
        },
        mode: 'cors'
      });

      const response = await Promise.race([fetchPromise, this.createTimeoutPromise(timeoutMs)]);
      if (response.ok) {
        console.log('Direct binary fetch succeeded (no proxy needed)');
        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      }
    } catch (error) {
      // Expected - most sites block CORS
      console.log(`Direct binary fetch blocked (expected): ${error.message}`);
    }
    return null;
  }

  // Fetch content via POST through proxy
  async postWithProxy(url, body, options = {}) {
    const timeoutMs = options.timeout || this.timeoutMs;
    const maxRetries = options.maxRetries || this.maxRetries;
    let lastError = null;

    // POST-capable proxies (not all support POST)
    const postCapableProxies = [
      'https://corsproxy.io/?', // Supports POST
      'https://proxy.cors.sh/' // May support POST
    ];

    console.log(`Trying POST request to: ${url.substring(0, 80)}...`);

    for (let retry = 0; retry <= maxRetries; retry++) {
      for (const proxy of postCapableProxies) {
        try {
          const proxyUrl = proxy + encodeURIComponent(url);
          const startTime = Date.now();
          console.log(`Trying POST via proxy: ${proxy.substring(0, 30)}...`);

          const fetchPromise = fetch(proxyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              ...options.headers
            },
            body: body
          });

          const response = await Promise.race([fetchPromise, this.createTimeoutPromise(timeoutMs)]);
          const responseTime = Date.now() - startTime;

          if (response.ok) {
            const content = await response.text();
            console.log(`POST via ${proxy} succeeded in ${responseTime}ms`);
            return content;
          } else {
            console.warn(`POST proxy ${proxy} returned status ${response.status}`);
          }
        } catch (error) {
          lastError = error;
          console.warn(`POST proxy ${proxy} failed (attempt ${retry + 1}):`, error.message);
          continue;
        }
      }

      if (retry < maxRetries) {
        console.log(`All POST proxies failed, retrying... (${retry + 1}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
      }
    }

    throw new Error(
      `All POST proxies failed after ${maxRetries + 1} attempts: ${
        lastError?.message || 'Unknown error'
      }`
    );
  }

  // Fetch content as binary (for ROMs)
  async fetchBinaryWithProxy(url, options = {}) {
    const cacheKey = `binary-${url}-${JSON.stringify(options)}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Try direct fetch first
    if (!options.skipDirect) {
      const directResult = await this.tryDirectBinaryFetch(url, options);
      if (directResult) {
        this.cache.set(cacheKey, directResult);
        return directResult;
      }
    }

    const timeoutMs = options.timeout || this.timeoutMs;
    const maxRetries = options.maxRetries || this.maxRetries;
    let lastError = null;

    // Get proxies ordered by performance score (best first)
    const orderedProxies = this.getOrderedProxies();

    for (let retry = 0; retry <= maxRetries; retry++) {
      for (const proxy of orderedProxies) {
        try {
          const proxyUrl = proxy + encodeURIComponent(url);
          const startTime = Date.now();

          // Create a race between the fetch and timeout
          const fetchPromise = fetch(proxyUrl, {
            method: 'GET',
            headers: {
              Accept: 'application/octet-stream,*/*',
              'Accept-Language': 'en-US,en;q=0.5',
              ...options.headers
            }
          });

          const response = await Promise.race([fetchPromise, this.createTimeoutPromise(timeoutMs)]);
          const responseTime = Date.now() - startTime;

          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            this.cache.set(cacheKey, uint8Array);

            // Update score for successful proxy
            this.updateProxyScore(proxy, true, responseTime);
            console.log(
              `Proxy ${proxy} succeeded in ${responseTime}ms (score: ${this.proxyScores
                .get(proxy)
                .toFixed(2)})`
            );

            return uint8Array;
          } else {
            console.warn(`Proxy ${proxy} returned status ${response.status}`);
            this.updateProxyScore(proxy, false);
          }
        } catch (error) {
          lastError = error;
          console.warn(`Proxy ${proxy} failed (attempt ${retry + 1}):`, error.message);
          this.updateProxyScore(proxy, false);
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

  // Get proxy statistics with scores
  getProxyStats() {
    const stats = [];
    this.proxyOptions.forEach((proxy) => {
      const attempts = this.proxyAttempts.get(proxy) || 0;
      const successes = this.proxySuccesses.get(proxy) || 0;
      const score = this.proxyScores.get(proxy) || 1.0;
      const successRate = attempts > 0 ? ((successes / attempts) * 100).toFixed(1) : '0.0';

      stats.push({
        proxy,
        score: score.toFixed(2),
        attempts,
        successes,
        successRate: `${successRate}%`
      });
    });

    return {
      proxyCount: this.proxyOptions.length,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      cacheSize: this.cache.size,
      proxyStats: stats.sort((a, b) => parseFloat(b.score) - parseFloat(a.score))
    };
  }

  // Reset all proxy scores (useful for testing)
  resetProxyScores() {
    this.proxyOptions.forEach((proxy) => {
      this.proxyScores.set(proxy, 1.0);
      this.proxyAttempts.set(proxy, 0);
      this.proxySuccesses.set(proxy, 0);
    });
    console.log('Proxy scores reset to default values');
  }
}

// Create global instance
const proxyService = new ProxyService();

// Make globally accessible
// Main API: window.proxyService.fetchWithProxy(url, options), .fetchBinaryWithProxy(url, options)
window.proxyService = proxyService;

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ProxyService, proxyService };
}
