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

  // Helper function to proxy simfile URLs through AllOrigins
  proxySimfile(url) {
    if (url && url.includes('.sm') && (url.startsWith('http://') || url.startsWith('https://'))) {
      return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    }
    return url;
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

  // Shuffle array to randomize proxy selection (but keep best ones more likely to be first)
  shuffleArray(array) {
    const shuffled = [...array];
    // Use weighted shuffle - better proxies are more likely to be near the front
    for (let i = 0; i < shuffled.length - 1; i++) {
      const j = i + Math.floor(Math.random() * (shuffled.length - i));
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

    // Get proxies ordered by performance score
    const orderedProxies = this.getOrderedProxies();

    // Shuffle proxies but keep best ones more likely to be first
    const shuffledProxies = this.shuffleArray(orderedProxies);

    for (let retry = 0; retry <= maxRetries; retry++) {
      for (const proxy of shuffledProxies) {
        try {
          const proxyUrl = proxy + encodeURIComponent(url);
          const startTime = Date.now();

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
window.proxyService = proxyService;
window.proxySimfile = proxyService.proxySimfile.bind(proxyService);

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ProxyService, proxyService };
}
