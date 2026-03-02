// Universal Proxy Service Module - supports both simfiles and ROM files.
// Agnostic of target origin; callers pass options for behavior:
//   options.skipDirect: true — skip direct fetch (use when origin blocks CORS).
//   options.deferProxies: string[] — try these proxy URL prefixes last (e.g. ['https://corsproxy.io/']).
//   options.timeout, options.maxRetries, options.headers — passed through.
class ProxyService {
  constructor() {
    // Proxy services ordered roughly by reliability (as of late 2024-2025)
    // Note: Free proxies can become unreliable - check/update periodically
    this.proxyOptions = [
      'https://corsproxy.io/?', // Most reliable as of 2025
      'https://api.codetabs.com/v1/proxy?quest=', // Rate limited but works
      'https://api.allorigins.win/raw?url=', // Can be unreliable; run test:proxy to verify
      'https://proxy.corsfix.com/?url=' // Same format as allorigins; 400 if using ? only
    ];
    this.cache = new Map();
    this.timeoutMs = 15000; // 15 second timeout (some proxies are slow)
    this.binaryTimeoutMs = 25000; // Longer for video/audio
    this.maxRetries = 3; // More retries for better success rate

    // Circuit breaker: skip a proxy for this long after it fails (avoids hammering a down proxy)
    this.proxyCooldownMs = 30000; // 30 seconds
    this.proxyLastFailure = new Map();

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

  // Get proxies ordered by score (best first).
  // options.deferProxies: string[] — URL prefixes to try last (e.g. ['https://corsproxy.io/']).
  getOrderedProxies(options = {}) {
    const byScore = this.proxyOptions
      .map((proxy) => ({
        proxy,
        score: this.proxyScores.get(proxy) || 1.0,
        attempts: this.proxyAttempts.get(proxy) || 0,
        successes: this.proxySuccesses.get(proxy) || 0
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.proxy);
    const defer = options.deferProxies;
    if (!Array.isArray(defer) || defer.length === 0) return byScore;
    const deferred = byScore.filter((p) => defer.some((prefix) => p.startsWith(prefix)));
    const rest = byScore.filter((p) => !defer.some((prefix) => p.startsWith(prefix)));
    return deferred.length && rest.length ? [...rest, ...deferred] : byScore;
  }

  // Encode URL for proxy query: decode once first so we never double-encode (e.g. %20 -> %2520).
  encodeUrlForProxy(url) {
    try {
      return encodeURIComponent(decodeURIComponent(url));
    } catch {
      return encodeURIComponent(url);
    }
  }

  // Create a timeout promise
  createTimeoutPromise(timeoutMs) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  // Try direct fetch first (in case server allows CORS). Caller passes skipDirect: true to skip.
  async tryDirectFetch(url, options = {}) {
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

    const orderedProxies = this.getOrderedProxies(options);
    console.log(`Trying ${orderedProxies.length} proxies for: ${url.substring(0, 80)}...`);

    for (let retry = 0; retry <= maxRetries; retry++) {
      for (const proxy of orderedProxies) {
        // Circuit breaker: skip proxy briefly after a failure to try others first
        const lastFail = this.proxyLastFailure.get(proxy);
        if (lastFail && Date.now() - lastFail < this.proxyCooldownMs) continue;

        try {
          const proxyUrl = proxy + this.encodeUrlForProxy(url);
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
            this.proxyLastFailure.set(proxy, Date.now());
          }
        } catch (error) {
          lastError = error;
          console.warn(`Proxy ${proxy} failed (attempt ${retry + 1}):`, error.message);
          this.updateProxyScore(proxy, false);
          this.proxyLastFailure.set(proxy, Date.now());
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

  // Try direct binary fetch first (in case server allows CORS). Caller passes skipDirect: true to skip.
  async tryDirectBinaryFetch(url, options = {}) {
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
          const proxyUrl = proxy + this.encodeUrlForProxy(url);
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

    const timeoutMs = options.timeout || this.binaryTimeoutMs;
    const maxRetries = options.maxRetries || this.maxRetries;
    let lastError = null;

    const orderedProxies = this.getOrderedProxies(options);

    for (let retry = 0; retry <= maxRetries; retry++) {
      for (const proxy of orderedProxies) {
        const lastFail = this.proxyLastFailure.get(proxy);
        if (lastFail && Date.now() - lastFail < this.proxyCooldownMs) continue;

        try {
          const proxyUrl = proxy + this.encodeUrlForProxy(url);
          const startTime = Date.now();

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
            this.proxyLastFailure.set(proxy, Date.now());
          }
        } catch (error) {
          lastError = error;
          console.warn(`Proxy ${proxy} failed (attempt ${retry + 1}):`, error.message);
          this.updateProxyScore(proxy, false);
          this.proxyLastFailure.set(proxy, Date.now());
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
