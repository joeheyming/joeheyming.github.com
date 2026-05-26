// Universal Proxy Service Module - supports both simfiles and ROM files.
// Agnostic of target origin; callers pass options for behavior:
//   options.skipDirect: true — skip direct fetch (use when origin blocks CORS).
//   options.deferProxies: string[] — try these proxy URL prefixes last (e.g. ['https://corsproxy.io/']).
//   options.timeout, options.maxRetries, options.headers — passed through.
//   options.signal — optional AbortSignal (e.g. jsh Ctrl+C); merged with timeout for each fetch.
//   options.validate: (text)=>boolean — optional body check; on false the proxy
//     is treated as failed and the chain advances. `fetchJson` sets this by
//     default to reject non-JSON bodies (catches codetabs' rate-limit garbage).

const PROXY_HEALTH_STORAGE_KEY = 'heyming.proxyService.v1';

/**
 * Cheap pre-flight check used by `fetchJson`'s default `validate`. CORS
 * proxies that silently fail (e.g. codetabs returning the plain-text body
 * `Edge: Too Many Requests` with a 200 status) get caught here so the chain
 * advances to the next proxy instead of caching garbage. All JSON APIs we
 * call return objects or arrays at the top level, so a `{` / `[` first char
 * is a sufficient guard.
 */
function looksLikeJsonBody(text) {
  if (typeof text !== 'string' || !text) return false;
  const trimmed = text.trimStart();
  if (!trimmed) return false;
  const first = trimmed[0];
  return first === '{' || first === '[';
}

/** @param {number} timeoutMs @param {AbortSignal|undefined|null} userSignal */
function mergeFetchAbortSignal(timeoutMs, userSignal) {
  const t = AbortSignal.timeout(timeoutMs);
  if (!userSignal) {
    return t;
  }
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([t, userSignal]);
  }
  const c = new AbortController();
  const bust = () => {
    try {
      c.abort();
    } catch (_) {
      /* ignore */
    }
  };
  t.addEventListener('abort', bust);
  userSignal.addEventListener('abort', bust);
  return c.signal;
}

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
    /** @type {number | null} */
    this._persistHealthTimer = null;
    this.maxCacheEntries = 80;
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

    this._loadPersistedProxyHealth();
  }

  _cacheSet(key, value) {
    this.cache.set(key, value);
    while (this.cache.size > this.maxCacheEntries) {
      const first = this.cache.keys().next();
      if (first.done) break;
      this.cache.delete(first.value);
    }
  }

  _loadPersistedProxyHealth() {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      const raw = localStorage.getItem(PROXY_HEALTH_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const data = JSON.parse(raw);
      const proxies = data && data.proxies;
      if (!proxies || typeof proxies !== 'object') {
        return;
      }
      for (const proxy of this.proxyOptions) {
        const row = proxies[proxy];
        if (!row || typeof row !== 'object') {
          continue;
        }
        if (typeof row.score === 'number' && !Number.isNaN(row.score)) {
          this.proxyScores.set(proxy, Math.min(2.0, Math.max(0.1, row.score)));
        }
        if (typeof row.attempts === 'number' && row.attempts >= 0) {
          this.proxyAttempts.set(proxy, row.attempts);
        }
        if (typeof row.successes === 'number' && row.successes >= 0) {
          this.proxySuccesses.set(proxy, row.successes);
        }
      }
    } catch {
      /* ignore corrupt or private mode */
    }
  }

  _schedulePersistProxyHealth() {
    if (typeof localStorage === 'undefined') {
      return;
    }
    if (this._persistHealthTimer != null) {
      clearTimeout(this._persistHealthTimer);
    }
    this._persistHealthTimer = setTimeout(() => {
      this._persistHealthTimer = null;
      try {
        const proxies = {};
        for (const proxy of this.proxyOptions) {
          proxies[proxy] = {
            score: this.proxyScores.get(proxy) ?? 1.0,
            attempts: this.proxyAttempts.get(proxy) ?? 0,
            successes: this.proxySuccesses.get(proxy) ?? 0
          };
        }
        localStorage.setItem(
          PROXY_HEALTH_STORAGE_KEY,
          JSON.stringify({ v: 1, savedAt: Date.now(), proxies })
        );
      } catch {
        /* quota, private mode */
      }
    }, 400);
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
    this._schedulePersistProxyHealth();
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

  // Try direct fetch first (in case server allows CORS). Caller passes skipDirect: true to skip.
  async tryDirectFetch(url, options = {}) {
    try {
      const timeoutMs = options.timeout || 3000; // Short timeout for direct attempt
      const signal = mergeFetchAbortSignal(timeoutMs, options.signal);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...options.headers
        },
        mode: 'cors',
        signal
      });
      if (response.ok) {
        console.log('Direct fetch succeeded (no proxy needed)');
        return await response.text();
      }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw error;
      }
      // Expected - most sites block CORS, continue to proxies
      console.log(`Direct fetch blocked (expected): ${error && error.message}`);
    }
    return null;
  }

  // Fetch content through multiple proxy options with fallback, timeout, and retries
  async fetchWithProxy(url, options = {}) {
    const { signal: userAbort, ...optionsForKey } = options;
    const cacheKey = `${url}-${JSON.stringify(optionsForKey)}`;

    // Check cache first (skip cache when caller may cancel — signal is not part of key).
    // Also skip empty cached entries — a previous empty-body failure may have slipped in.
    if (!userAbort && this.cache.has(cacheKey) && this.cache.get(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Try direct fetch first (skip proxy if server allows CORS)
    if (!options.skipDirect) {
      const directResult = await this.tryDirectFetch(url, options);
      if (directResult) {
        this._cacheSet(cacheKey, directResult);
        return directResult;
      }
    }

    const timeoutMs = options.timeout || this.timeoutMs;
    const maxRetries = options.maxRetries || this.maxRetries;
    let lastError = null;

    const orderedProxies = this.getOrderedProxies(options);
    console.log(`Trying ${orderedProxies.length} proxies for: ${url.substring(0, 80)}...`);

    for (let retry = 0; retry <= maxRetries; retry++) {
      if (userAbort && userAbort.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      for (const proxy of orderedProxies) {
        // Circuit breaker: skip proxy briefly after a failure to try others first
        const lastFail = this.proxyLastFailure.get(proxy);
        if (lastFail && Date.now() - lastFail < this.proxyCooldownMs) continue;

        try {
          const proxyUrl = proxy + this.encodeUrlForProxy(url);
          const startTime = Date.now();
          console.log(`Trying proxy: ${proxy.substring(0, 30)}...`);

          const signal = mergeFetchAbortSignal(timeoutMs, userAbort);
          const response = await fetch(proxyUrl, {
            method: 'GET',
            headers: {
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
              ...options.headers
            },
            signal
          });
          const responseTime = Date.now() - startTime;

          if (response.ok) {
            const content = await response.text();

            // Empty body = proxy silently failed (e.g. codetabs returning 200
            // with no body when the target site blocks it). Treat as failure so
            // the next proxy gets a chance.
            if (!content) {
              console.warn(`Proxy ${proxy} returned empty body — treating as failure`);
              this.updateProxyScore(proxy, false);
              this.proxyLastFailure.set(proxy, Date.now());
              continue;
            }

            // Caller-supplied body validation. Catches proxies that return 200 OK
            // with a non-empty body that isn't what we asked for — e.g. codetabs
            // returning "Edge: Too Many Requests" as a plain-text 23-byte body
            // when rate-limited. Without this check we'd cache that string and
            // surface it to every caller for the same URL.
            if (typeof options.validate === 'function' && !options.validate(content)) {
              console.warn(`Proxy ${proxy} returned body failing validation — treating as failure`);
              this.updateProxyScore(proxy, false);
              this.proxyLastFailure.set(proxy, Date.now());
              continue;
            }

            this._cacheSet(cacheKey, content);

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
          if (error && error.name === 'AbortError') {
            throw error;
          }
          lastError = error;
          console.warn(`Proxy ${proxy} failed (attempt ${retry + 1}):`, error.message);
          this.updateProxyScore(proxy, false);
          this.proxyLastFailure.set(proxy, Date.now());
          continue;
        }
      }

      // If we get here, all proxies failed for this retry
      if (retry < maxRetries) {
        if (userAbort && userAbort.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
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
      const signal = mergeFetchAbortSignal(timeoutMs, options.signal);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/octet-stream,*/*',
          ...options.headers
        },
        mode: 'cors',
        signal
      });
      if (response.ok) {
        console.log('Direct binary fetch succeeded (no proxy needed)');
        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw error;
      }
      // Expected - most sites block CORS
      console.log(`Direct binary fetch blocked (expected): ${error && error.message}`);
    }
    return null;
  }

  // Fetch content via POST through proxy
  async postWithProxy(url, body, options = {}) {
    const userAbort = options.signal;
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
      if (userAbort && userAbort.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      for (const proxy of postCapableProxies) {
        try {
          const proxyUrl = proxy + this.encodeUrlForProxy(url);
          const startTime = Date.now();
          console.log(`Trying POST via proxy: ${proxy.substring(0, 30)}...`);

          const signal = mergeFetchAbortSignal(timeoutMs, userAbort);
          const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              ...options.headers
            },
            body: body,
            signal
          });
          const responseTime = Date.now() - startTime;

          if (response.ok) {
            const content = await response.text();
            console.log(`POST via ${proxy} succeeded in ${responseTime}ms`);
            return content;
          } else {
            console.warn(`POST proxy ${proxy} returned status ${response.status}`);
          }
        } catch (error) {
          if (error && error.name === 'AbortError') {
            throw error;
          }
          lastError = error;
          console.warn(
            `POST proxy ${proxy} failed (attempt ${retry + 1}):`,
            error && error.message
          );
          continue;
        }
      }

      if (retry < maxRetries) {
        if (userAbort && userAbort.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
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
    const { signal: userAbort, ...optionsForKey } = options;
    const cacheKey = `binary-${url}-${JSON.stringify(optionsForKey)}`;

    if (!userAbort && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    if (!options.skipDirect) {
      const directResult = await this.tryDirectBinaryFetch(url, options);
      if (directResult) {
        this._cacheSet(cacheKey, directResult);
        return directResult;
      }
    }

    const timeoutMs = options.timeout || this.binaryTimeoutMs;
    const maxRetries = options.maxRetries || this.maxRetries;
    let lastError = null;

    const orderedProxies = this.getOrderedProxies(options);

    for (let retry = 0; retry <= maxRetries; retry++) {
      if (userAbort && userAbort.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      for (const proxy of orderedProxies) {
        const lastFail = this.proxyLastFailure.get(proxy);
        if (lastFail && Date.now() - lastFail < this.proxyCooldownMs) continue;

        try {
          const proxyUrl = proxy + this.encodeUrlForProxy(url);
          const startTime = Date.now();

          const signal = mergeFetchAbortSignal(timeoutMs, userAbort);
          const response = await fetch(proxyUrl, {
            method: 'GET',
            headers: {
              Accept: 'application/octet-stream,*/*',
              'Accept-Language': 'en-US,en;q=0.5',
              ...options.headers
            },
            signal
          });
          const responseTime = Date.now() - startTime;

          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            this._cacheSet(cacheKey, uint8Array);

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
          if (error && error.name === 'AbortError') {
            throw error;
          }
          lastError = error;
          console.warn(`Proxy ${proxy} failed (attempt ${retry + 1}):`, error && error.message);
          this.updateProxyScore(proxy, false);
          this.proxyLastFailure.set(proxy, Date.now());
          continue;
        }
      }

      if (retry < maxRetries) {
        if (userAbort && userAbort.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        console.log(`All proxies failed, retrying... (${retry + 1}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
      }
    }

    throw new Error(
      `All proxies failed after ${maxRetries + 1} attempts: ${
        lastError?.message || 'Unknown error'
      }`
    );
  }

  /**
   * Stream-download a binary URL through the proxy chain with progress
   * callbacks. Same proxy-fallback contract as `fetchBinaryWithProxy`,
   * but reads the response body chunk-by-chunk via `getReader()` so
   * the caller can render a percentage while a large file (a 300 MB
   * MP4 episode, say) downloads.
   *
   * Returns a `Blob` (instead of the `Uint8Array` from the buffered
   * variant) because the typical destination is IndexedDB, where
   * Blobs are stored as on-disk files rather than memory-resident
   * typed arrays. Pass `contentType` to set the Blob's MIME type;
   * defaults to `application/octet-stream`.
   *
   * @param {string} url
   * @param {{
   *   onProgress?: (p: { received: number, total: number, ratio: number }) => void,
   *   signal?: AbortSignal,
   *   skipDirect?: boolean,
   *   maxRetries?: number,
   *   contentType?: string,
   *   headers?: Record<string, string>,
   *   deferProxies?: string[]
   * }} [options]
   * @returns {Promise<Blob>}
   */
  async fetchBinaryStream(url, options = {}) {
    const userAbort = options.signal;
    const contentType = options.contentType || 'application/octet-stream';
    const maxRetries = options.maxRetries ?? this.maxRetries;

    // Try direct first — if the upstream allows CORS we save the
    // round-trip through a public proxy (which adds latency and is
    // rate-limited). Failure is expected for archive.org's MP4 URLs
    // because the 302 redirect lands on dn710203.ca.archive.org, an
    // origin that doesn't set Access-Control-Allow-Origin.
    if (!options.skipDirect) {
      try {
        const blob = await this._streamToBlob(url, {
          signal: userAbort,
          onProgress: options.onProgress,
          contentType,
          headers: options.headers
        });
        if (blob) {
          console.log('Direct binary stream succeeded (no proxy needed)');
          return blob;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        console.log(`Direct binary stream blocked: ${err && err.message}`);
      }
    }

    const orderedProxies = this.getOrderedProxies(options);
    let lastError = null;
    for (let retry = 0; retry <= maxRetries; retry += 1) {
      if (userAbort && userAbort.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      for (const proxy of orderedProxies) {
        const lastFail = this.proxyLastFailure.get(proxy);
        if (lastFail && Date.now() - lastFail < this.proxyCooldownMs) continue;
        try {
          const proxyUrl = proxy + this.encodeUrlForProxy(url);
          const startTime = Date.now();
          console.log(`Trying streamed proxy: ${proxy.substring(0, 30)}...`);
          const blob = await this._streamToBlob(proxyUrl, {
            signal: userAbort,
            onProgress: options.onProgress,
            contentType,
            headers: options.headers
          });
          if (blob) {
            this.updateProxyScore(proxy, true, Date.now() - startTime);
            return blob;
          }
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          lastError = err;
          console.warn(`Streamed proxy ${proxy} failed:`, err && err.message);
          this.updateProxyScore(proxy, false);
          this.proxyLastFailure.set(proxy, Date.now());
        }
      }
      if (retry < maxRetries) {
        if (userAbort && userAbort.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
      }
    }
    throw new Error(
      `All proxies failed after ${maxRetries + 1} attempts: ${
        lastError?.message || 'Unknown error'
      }`
    );
  }

  /**
   * Shared streaming-fetch helper. Reads `url` via `getReader()` and
   * collects chunks into a Blob, firing `onProgress` after each chunk.
   * Cancels the reader on AbortSignal so a half-downloaded file
   * doesn't leak the underlying connection.
   *
   * @private
   * @param {string} url
   * @param {{
   *   signal?: AbortSignal,
   *   onProgress?: (p: { received: number, total: number, ratio: number }) => void,
   *   contentType: string,
   *   headers?: Record<string, string>
   * }} ctx
   */
  async _streamToBlob(url, ctx) {
    const { signal, onProgress, contentType, headers } = ctx;
    const res = await fetch(url, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'application/octet-stream,*/*',
        ...headers
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error('No response body');
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    /** @type {Uint8Array[]} */
    const chunks = [];
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal && signal.aborted) {
          await reader.cancel().catch(() => {});
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        chunks.push(value);
        received += value.byteLength;
        if (onProgress) {
          onProgress({
            received,
            total,
            ratio: total > 0 ? received / total : 0
          });
        }
      }
    } catch (err) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw err;
    }
    return new Blob(chunks, { type: contentType });
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

  /**
   * Fetch a JSON endpoint through the proxy chain.
   *
   * Single helper that absorbs the four-step "guard proxy → fetchWithProxy →
   * JSON.parse → friendly-error" pattern that ~10 callers were each
   * re-deriving (stock/api.js had four copies on its own; the recent
   * deslop pass had to touch each by hand).
   *
   * `skipDirect` defaults to true — most JSON APIs that need a proxy
   * are CORS-blocked, so the direct attempt just wastes the 3 s budget.
   *
   * Throws a single friendly Error string regardless of which step failed
   * (proxy-chain failure, empty body, JSON parse error). Callers that
   * need to distinguish should catch and inspect — but in practice every
   * caller just wants to surface the message via toast.
   *
   * @param {string} url
   * @param {Object} [options] — passed to fetchWithProxy.
   * @param {string} [options.friendlyError] — message used when proxy
   *        succeeds but JSON.parse fails. Default: "Couldn't read the
   *        response from <hostname>."
   * @returns {Promise<any>}
   */
  async fetchJson(url, options = {}) {
    // Per-call default validator: bodies that aren't JSON-shaped (i.e. don't
    // start with `{` or `[`) get rejected before we cache them, so the proxy
    // chain falls through to the next proxy instead of memoizing garbage.
    // Caller can still pass their own `validate` to override.
    const opts = { skipDirect: true, validate: looksLikeJsonBody, ...options };
    const text = await this.fetchWithProxy(url, opts);
    if (!text) {
      throw new Error("That source didn't return anything readable. Try again in a moment.");
    }
    try {
      return JSON.parse(text);
    } catch {
      const fallback = options.friendlyError;
      if (typeof fallback === 'string' && fallback) throw new Error(fallback);
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch {
        /* keep host empty */
      }
      throw new Error(
        host ? `Couldn't read the response from ${host}.` : "Couldn't read the response."
      );
    }
  }

  /**
   * Fetch HTML and return a parsed `Document`. Used by the scrapers in
   * play/strings/echords-source.js, doom/moddb-browser-net.js, etc.
   *
   * `skipDirect` defaults to false — some HTML sources do allow CORS.
   *
   * @param {string} url
   * @param {Object} [options] — passed to fetchWithProxy.
   * @returns {Promise<Document>}
   */
  async fetchHtml(url, options = {}) {
    const text = await this.fetchWithProxy(url, options);
    if (!text) {
      throw new Error("That page didn't load. Try again in a moment.");
    }
    return new DOMParser().parseFromString(text, 'text/html');
  }

  /**
   * Alias for `fetchBinaryWithProxy` — exists so the new "named-shape"
   * API (`fetchHtml` / `fetchJson` / `fetchBinary`) reads consistently.
   * Old name is kept for backwards compat.
   */
  async fetchBinary(url, options = {}) {
    return this.fetchBinaryWithProxy(url, options);
  }

  /**
   * localStorage-backed cache fronting any async fetcher. Replaces the
   * ad-hoc `moddb.cache.v1:*` shape and lets future apps opt in without
   * each re-implementing TTL bookkeeping.
   *
   *   const html = await proxy.cachedFetch(
   *     `moddb:listing:${page}`,
   *     30 * 60 * 1000,
   *     () => proxy.fetchHtml(listingUrl)
   *   );
   *
   * - Cache key is namespaced under `proxy.cache.v1:` so it doesn't
   *   collide with app-specific keys.
   * - Quota errors / private-mode failures are swallowed: a cache miss
   *   just means we hit the network, which is the right fallback.
   * - The fetcher's return value is JSON.stringified, so it should be
   *   a plain JSON-able shape (not a `Document` — apps that cache
   *   parsed HTML should serialize/deserialize themselves).
   *
   * @template T
   * @param {string} cacheKey       — short logical key (no prefix needed).
   * @param {number} ttlMs           — how long the cached value is valid.
   * @param {() => Promise<T>} fetcher
   * @returns {Promise<T>}
   */
  async cachedFetch(cacheKey, ttlMs, fetcher) {
    const fullKey = `proxy.cache.v1:${cacheKey}`;
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(fullKey);
        if (raw) {
          const entry = JSON.parse(raw);
          if (entry && typeof entry.savedAt === 'number' && Date.now() - entry.savedAt < ttlMs) {
            return entry.value;
          }
        }
      } catch {
        /* corrupt entry — treat as miss */
      }
    }
    const value = await fetcher();
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(fullKey, JSON.stringify({ savedAt: Date.now(), value }));
      } catch {
        /* quota / private mode — pretend we cached */
      }
    }
    return value;
  }

  // Reset all proxy scores (useful for testing)
  resetProxyScores() {
    this.proxyOptions.forEach((proxy) => {
      this.proxyScores.set(proxy, 1.0);
      this.proxyAttempts.set(proxy, 0);
      this.proxySuccesses.set(proxy, 0);
    });
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(PROXY_HEALTH_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
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
