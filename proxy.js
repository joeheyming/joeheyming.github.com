// Universal Proxy Service Module - supports both simfiles and ROM files.
//
// =============================================================================
// Caller Interface (narrow surface — prefer these)
// =============================================================================
//   proxyService.fetchJson(url, options?)
//   proxyService.fetchHtml(url, options?)
//   proxyService.fetchBinary(url, options?)       // alias of fetchBinaryWithProxy
//   proxyService.fetchBinaryStream(url, options?)
//
// Shared options on the Interface methods:
//   options.signal   — AbortSignal (e.g. jsh Ctrl+C); merged with per-request timeout
//   options.timeout  — ms; overrides the service default for that call
//   options.skipDirect, options.maxRetries, options.headers — passed through
//   options.validate / options.validateBinary — optional body checks; on false the
//     chain advances. `fetchJson` defaults validate to reject non-JSON bodies.
//
// Internal (chain / scoring / diagnostics — not the default caller contract):
//   fetchWithProxy, fetchBinaryWithProxy, postWithProxy,
//   tryDirectFetch, tryDirectBinaryFetch, getOrderedProxies, encodeUrlForProxy,
//   updateProxyScore, disableProxy / enableProxy, getProxyStats, cachedFetch, …
//
// Test Adapter: `new ProxyService({ fetchImpl, storageImpl })` injects fetch and
// storage so unit tests can use recorded responses / in-memory storage without
// real network. Production keeps `window.proxyService = new ProxyService()`.
//
// =============================================================================
// Behavior notes
// =============================================================================
// Agnostic of target origin; callers pass options for behavior:
//   options.skipDirect: true — skip direct fetch (use when origin blocks CORS).
//   options.deferProxies: string[] — try these proxy URL prefixes last.
//
// Auto-invalidation: proxies that return well-known "dead" response bodies
// (paywall blobs, "domain not registered", "bad request" landing JSON) are
// banned for a long TTL so we don't burn budget hammering services that
// pulled the rug. Bans are scoped by mode ('text' | 'binary' | '*') because
// a host can be fine for HTML and useless for a ROM (cors.dev's 6 MiB cap
// is the current case). Bans persist via storageImpl (default localStorage)
// so a reload doesn't re-probe the same dead services.

const PROXY_HEALTH_STORAGE_KEY = 'heyming.proxyService.v1';
const DEAD_PROXY_TTL_MS = 24 * 60 * 60 * 1000;

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

/**
 * Terminal failure after the proxy chain is exhausted. Callers catch this
 * and update their own UI. It is not suppressed in analytics: an uncaught
 * one means a caller forgot to handle it.
 */
class ProxyExhaustedError extends Error {
  /**
   * @param {string} message
   * @param {{ attempts: number, cause?: unknown }} [info]
   */
  constructor(message, info) {
    super(message);
    this.name = 'ProxyExhaustedError';
    this.attempts = info && typeof info.attempts === 'number' ? info.attempts : 0;
    if (info && info.cause) this.cause = info.cause;
  }
}

/**
 * @param {'text' | 'post' | 'binary'} kind
 * @param {number} attempts
 * @param {unknown} lastError
 */
function proxyExhausted(kind, attempts, lastError) {
  const detail =
    lastError && typeof lastError === 'object' && 'message' in lastError && lastError.message
      ? String(lastError.message)
      : 'Unknown error';
  const prefix = kind === 'post' ? 'All POST proxies failed' : 'All proxies failed';
  return new ProxyExhaustedError(`${prefix} after ${attempts} attempts: ${detail}`, {
    attempts,
    cause: lastError || undefined
  });
}

/**
 * Signatures that identify a proxy as terminally broken (paywall, dead
 * endpoint, missing domain registration). When a response body matches
 * one of these, the proxy gets banned for `DEAD_PROXY_TTL_MS` so we
 * don't keep trying it.
 *
 * `mode` controls the ban scope:
 *   - 'binary' — only ban for binary requests (proxy may still work for text).
 *   - '*'      — ban universally.
 *
 * `ttlMs` overrides {@link DEAD_PROXY_TTL_MS} for failures that advertise
 * themselves as temporary (rate limits) rather than structural (paywalls).
 *
 * Add new signatures here when a proxy starts failing in a recognizable
 * way; the regex needs to match an excerpt of the body that uniquely
 * identifies the failure mode.
 *
 * @type {Array<{ name: string, mode: 'binary' | '*', re: RegExp, ttlMs?: number }>}
 */
const DEAD_PROXY_SIGNATURES = [
  // corsproxy.io free plan (mid-2026) — blocks binary content types but
  // still serves HTML, so this is a binary-only kill. The full body is
  // {"error":"This content type is not allowed on the free plan. Upgrade at https://corsproxy.io/pricing/"}
  {
    name: 'corsproxy_paywall_content_type',
    mode: 'binary',
    re: /content type is not allowed on the free plan/i
  },
  // corsproxy.io also blocks server-side requests on the free plan; if we
  // ever hit this from a Node test runner we want to ban universally so the
  // test doesn't loop. From a real browser this path shouldn't fire.
  {
    name: 'corsproxy_paywall_serverside',
    mode: '*',
    re: /server-side requests are not allowed on your plan/i
  },
  // corsproxy.io retired anonymous `?<url>` requests in September 2026 and
  // now answers every keyless call with this 403 JSON. There is no free
  // keyless shape left, so the ban is universal.
  {
    name: 'corsproxy_keyless_legacy',
    mode: '*',
    re: /"error"\s*:\s*"keyless_legacy_url"/i
  },
  // cors.eu.org sits behind Cloudflare and serves this interstitial with a
  // 429 when the shared instance is saturated. It recovers on its own, so
  // the ban is short — just long enough to stop burning the request budget
  // on a host that is currently refusing everyone.
  {
    name: 'cors_eu_rate_limited',
    mode: '*',
    ttlMs: 15 * 60 * 1000,
    re: /This website has been temporarily rate limited/i
  },
  // corsfix.com requires the calling domain to be registered with their
  // service; for an unregistered domain every request fails the same way.
  {
    name: 'corsfix_domain_unregistered',
    mode: '*',
    re: /"corsfix_error"\s*:\s*"domain_not_registered"/i
  },
  {
    name: 'corsfix_invalid_origin',
    mode: '*',
    re: /"corsfix_error"\s*:\s*"invalid_origin"/i
  },
  // codetabs's /v1/proxy endpoint started returning this for every input
  // shape in 2026. No URL variant works.
  {
    name: 'codetabs_bad_request',
    mode: '*',
    re: /Bad request, valid format is.*api\.codetabs\.com/i
  },
  // blkproxy.vercel.app blocks video/audio content types, .mp4/.mp3
  // extensions, and range requests with this body. Scoped to 'binary'
  // because text mode never asks for media URLs. The host itself was
  // pruned in October 2026 (Vercel firewall deny); the signature stays
  // so a re-add doesn't cache that body as a ROM.
  {
    name: 'blkproxy_media_blocked',
    mode: 'binary',
    re: /Media files are not supported/i
  },
  // proxy.cors.dev free tier caps responses at 6 MiB and answers oversize
  // requests in a few hundred milliseconds with HTTP 502 and this JSON.
  // Binary-only: HTML and JSON stay on this host (it has the highest
  // anonymous rate limit in the pool). The next binary call skips it.
  {
    name: 'cors_dev_response_too_large',
    mode: 'binary',
    re: /"error"\s*:\s*"response_too_large"/i
  }
];

/**
 * Match a response body against {@link DEAD_PROXY_SIGNATURES}.
 *
 * @param {string} body — Response body text (or excerpt).
 * @returns {{ name: string, mode: 'binary' | '*', ttlMs?: number } | null}
 */
function detectDeadProxySignature(body) {
  if (typeof body !== 'string' || !body) return null;
  // Cap the regex work — dead-signature bodies are always tiny, but a
  // misclassified binary body could otherwise eat real CPU.
  const sample = body.length > 4096 ? body.slice(0, 4096) : body;
  for (const sig of DEAD_PROXY_SIGNATURES) {
    if (sig.re.test(sample)) {
      return { name: sig.name, mode: sig.mode, ttlMs: sig.ttlMs };
    }
  }
  return null;
}

/**
 * Resolve ambient `localStorage`, tolerating hosts that refuse it.
 *
 * A sandboxed iframe without `allow-same-origin` has an opaque origin, and
 * there even `typeof localStorage` throws a SecurityError because the check
 * invokes the getter. Surf frames arbitrary pages that way, so any page that
 * loads this file would otherwise die before the service is constructed.
 * Losing storage only costs proxy-health persistence.
 *
 * @returns {Storage | null}
 */
function resolveAmbientStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
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
  /**
   * @param {{
   *   fetchImpl?: typeof fetch,
   *   storageImpl?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
   * }} [deps] — optional Adapter seams for tests. Defaults: ambient `fetch`
   *   and `localStorage` (or null when storage is unavailable).
   */
  constructor(deps = {}) {
    // Adapter seams — production uses ambient globals; tests inject stubs.
    this.fetchImpl = deps.fetchImpl || ((input, init) => fetch(input, init));
    this.storageImpl = deps.storageImpl !== undefined ? deps.storageImpl : resolveAmbientStorage();

    // Proxy services ordered roughly by current reliability.
    //
    // The auto-ban system pulls a proxy from the pool when it either
    // returns a known dead-signature body (see DEAD_PROXY_SIGNATURES)
    // or racks up `autoBanHardFailureThreshold` consecutive "hard"
    // failures — timeouts, 5xx statuses, or network errors (see
    // `_recordProxyHardFailure`). Bans persist to localStorage with a
    // TTL so a periodically broken proxy gets re-probed automatically.
    //
    // If a proxy is confirmed dead in a way the auto-ban can't detect
    // (e.g. always returns 404 with the service's marketing HTML) it's
    // simpler to prune it here than to add a special-case signature.
    //
    // Note: Free proxies can become unreliable - check/update periodically.
    this.proxyOptions = [
      // Re-verified 31 Oct 2026 with Origin https://joeheyming.github.io.
      // Ordered so the generous anonymous quota is tried before hosts that
      // Cloudflare-rate-limit the whole internet.
      //
      // cors.dev: 600 requests/minute per IP, no daily or monthly quota.
      // GET and HEAD only. Echoes our origin. Text ~80–180ms. Bodies over
      // 6 MiB return HTTP 502 response_too_large in ~250ms; that signature
      // bans this prefix for binary only, and hexlet/corsmirror take the file.
      'https://proxy.cors.dev/?url=',
      // corsmirror /v1 was a 404 for every URL in July 2026 and is serving
      // real text and binary again. An 8-request burst did not 429.
      'https://corsmirror.com/v1?url=',
      // Hexlet allorigins fork. Slower (~0.7–1.5s) but returns real bodies
      // past cors.dev's 6 MiB cap, which is what ROMs and long songs need.
      'https://allorigins.hexlet.app/raw?url=',
      // Cloudflare-fronted and fast when it isn't saturated. On 31 Oct 2026
      // it answered 429 "temporarily rate limited" with no ACAO header.
      // Last in line; the cors_eu_rate_limited signature parks it for 15m
      // once a response body is readable.
      'https://cors.eu.org/'
      // Pruned 31 Oct 2026:
      //   - corsproxy.io/? — anonymous ?<url> retired Sept 2026
      //     (403 keyless_legacy_url). A key would not be safe in this file.
      //   - api.cors.syrins.tech/?url= — DNS does not resolve.
      //   - blkproxy.vercel.app/api/proxy?url= — Vercel firewall
      //     (x-vercel-mitigated: deny) rejects the request before the function.
      // Pruned July 2026, still true in the October re-probe unless noted:
      //   - api.codetabs.com/v1/proxy?quest= — 12s timeouts.
      //   - api.allorigins.win/raw?url= — works, but 2.5–3.5s. Not worth a
      //     slot ahead of the hosts above. Distinct from the Hexlet fork.
      //   - proxy.corsfix.com/?url= — domain_not_registered without a paid plan.
      //   - thingproxy.freeboard.io/fetch/ — DNS gone.
      //   - api.cors.lol/?url= — one success, then 429 "Rate limit exceeded"
      //     with no ACAO. Still too aggressive.
      //   - proxy.cors.sh/ — DNS gone (was 401 on any Origin without a key).
      //   - creprox.vercel.app/ — URL shape doesn't fit prefix + encodedUrl.
      //   - corsproxy.org/? — still returns its own HTML, no ACAO.
      // corsmirror.com/v1?url= was on the July prune list and is back above.
    ];
    this.cache = new Map();
    /** @type {number | null} */
    this._persistHealthTimer = null;
    this.maxCacheEntries = 80;
    this.timeoutMs = 15000; // 15 second timeout (some proxies are slow)
    this.binaryTimeoutMs = 25000; // Longer for video/audio
    this.maxRetries = 3; // More retries for better success rate

    // Origins that refused a direct (unproxied) binary request, mapped to the
    // time the block expires. The browser prints its own console error for
    // every blocked cross-origin request and that output cannot be suppressed
    // from JS — a try/catch around fetch() only hides the exception, not the
    // network log. So once an origin has refused us we skip the probe, which
    // also stops wasting its timeout budget. Persisted alongside proxy health
    // because each ROM launch is a fresh page load; the TTL re-probes in case
    // the origin starts sending Access-Control-Allow-Origin.
    /** @type {Map<string, number>} */
    this.directBinaryBlockedUntil = new Map();
    this.directBinaryBlockTtlMs = 24 * 60 * 60 * 1000; // 1 day

    // Circuit breaker: skip a proxy for this long after it fails (avoids hammering a down proxy).
    // Keys are `${proxy}|${mode}` so a slow HTML listing timeout does not skip the
    // same host for a subsequent ROM binary download (and vice versa).
    this.proxyCooldownMs = 30000; // 30 seconds
    this.proxyLastFailure = new Map();

    // Auto-ban tracking. Distinct from the 30s score-based cooldown
    // above — that only defers a proxy for one loop iteration and every
    // fresh call re-probes it. If a proxy is genuinely dead (as opposed
    // to "one slow request") it will burn 15s of timeout budget on
    // every subsequent call, which is exactly the "dirt slow" behavior
    // the previous version had for codetabs / allorigins.win.
    //
    // The counter increments on any "hard" failure — a timeout, a 5xx,
    // or a network error — and resets on the next success (see
    // `updateProxyScore`). Hitting the threshold triggers a mode-scoped
    // localStorage-persisted ban for `autoBanHardFailureTtlMs`.
    // Keys are `${proxy}|${mode}` (mode defaults to '*').
    /** @type {Map<string, number>} */
    this.proxyConsecutiveHardFailures = new Map();
    this.autoBanHardFailureThreshold = 3;
    this.autoBanHardFailureTtlMs = 60 * 60 * 1000; // 1 hour

    // Proxy scoring system
    this.proxyScores = new Map();
    this.proxyAttempts = new Map();
    this.proxySuccesses = new Map();

    // Hard-ban state. Keyed by "<proxy>|<mode>" where mode is 'binary' or
    // '*' (universal). Value is the timestamp the ban expires at, plus the
    // signature name that triggered the ban for diagnostics.
    /** @type {Map<string, number>} */
    this.proxyDeadUntil = new Map();
    /** @type {Map<string, string>} */
    this.proxyDeadReason = new Map();

    // Initialize scores for all proxies
    this.proxyOptions.forEach((proxy) => {
      this.proxyScores.set(proxy, 1.0); // Start with neutral score
      this.proxyAttempts.set(proxy, 0);
      this.proxySuccesses.set(proxy, 0);
    });

    this._loadPersistedProxyHealth();
  }

  /** Build the composite key used in {@link proxyDeadUntil}. */
  _deadKey(proxy, mode) {
    return `${proxy}|${mode || '*'}`;
  }

  /**
   * @param {string} proxy
   * @param {'text' | 'binary'} [mode] — request mode being attempted.
   * @returns {boolean} true if the proxy is currently banned for this mode.
   */
  isProxyDead(proxy, mode) {
    const now = Date.now();
    const universal = this.proxyDeadUntil.get(this._deadKey(proxy, '*'));
    if (universal && universal > now) return true;
    if (mode) {
      const scoped = this.proxyDeadUntil.get(this._deadKey(proxy, mode));
      if (scoped && scoped > now) return true;
    }
    return false;
  }

  /**
   * True when `getOrderedProxies` handed back a fully banned list so a
   * recovered host can be tried. The fetch loops must not skip those
   * entries: doing so makes one missing song brick every later song
   * until the persisted ban map is cleared.
   * @param {string[]} orderedProxies
   * @param {'text' | 'binary'} mode
   */
  _reprobingAllDead(orderedProxies, mode) {
    return orderedProxies.length > 0 && orderedProxies.every((p) => this.isProxyDead(p, mode));
  }

  /**
   * Count at most one hard failure per proxy per fetch. Retries and a
   * second audio URL would otherwise cross the ban threshold during a
   * single song that simply is not there.
   * @param {Set<string>} seen
   * @param {string} proxy
   * @param {string} failureType
   * @param {'text' | 'binary' | '*'} mode
   */
  _noteHardFailureOnce(seen, proxy, failureType, mode) {
    const key = `${proxy}|${mode}`;
    if (seen.has(key)) return;
    seen.add(key);
    this._recordProxyHardFailure(proxy, failureType, mode);
  }

  /**
   * Ban a proxy (mode-scoped or universal) for `ttlMs`. Persisted to
   * localStorage so the ban survives reloads.
   * @param {string} proxy
   * @param {'text' | 'binary' | '*'} mode
   * @param {string} reason — signature name or short tag.
   * @param {number} [ttlMs]
   */
  _markProxyDead(proxy, mode, reason, ttlMs = DEAD_PROXY_TTL_MS) {
    const key = this._deadKey(proxy, mode);
    this.proxyDeadUntil.set(key, Date.now() + ttlMs);
    this.proxyDeadReason.set(key, reason);
    const scope = mode === '*' ? 'all requests' : `${mode} requests`;
    const duration =
      ttlMs < 3600000 ? `${Math.round(ttlMs / 60000)}m` : `${Math.round(ttlMs / 3600000)}h`;
    console.warn(`Disabling proxy ${proxy} for ${duration} ` + `(${scope}): ${reason}`);
    this._schedulePersistProxyHealth();
  }

  /** Inspect a response body for known dead signatures and ban on match. */
  _maybeMarkDeadFromBody(proxy, body) {
    const sig = detectDeadProxySignature(body);
    if (!sig) return null;
    this._markProxyDead(proxy, sig.mode, sig.name, sig.ttlMs ?? DEAD_PROXY_TTL_MS);
    return sig;
  }

  /**
   * Proxies sometimes return HTML/JSON error pages with a binary-ish
   * Content-Type. Spot the common prefixes so we don't cache garbage as a ROM.
   * @param {Uint8Array} bytes
   * @returns {boolean}
   */
  _looksLikeTextErrorPayload(bytes) {
    if (!bytes || bytes.length < 1) return true;
    let i = 0;
    // Skip UTF-8 BOM / leading whitespace.
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
    while (
      i < bytes.length &&
      (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)
    ) {
      i += 1;
    }
    if (i >= bytes.length) return true;
    const c0 = bytes[i];
    // `<!` / `<?` / `<h` (html) / `{` / `[` JSON wrappers.
    if (c0 === 0x3c) return true; // <
    if (c0 === 0x7b || c0 === 0x5b) return true; // { [
    return false;
  }

  /** @param {string} proxy @param {'text' | 'binary' | '*'} [mode] */
  _cooldownKey(proxy, mode) {
    return `${proxy}|${mode || '*'}`;
  }

  _noteProxyFailure(proxy, mode) {
    this.proxyLastFailure.set(this._cooldownKey(proxy, mode || '*'), Date.now());
  }

  _proxyInCooldown(proxy, mode) {
    const lastFail = this.proxyLastFailure.get(this._cooldownKey(proxy, mode || '*'));
    return !!(lastFail && Date.now() - lastFail < this.proxyCooldownMs);
  }

  /**
   * Track "hard" failures — timeouts, 5xx statuses, and generic network
   * errors — separately from the score-based cooldown. After
   * `autoBanHardFailureThreshold` in a row for the same proxy+mode, apply a
   * mode-scoped ban for `autoBanHardFailureTtlMs` so the proxy stops eating
   * timeout budget on every subsequent request of that mode. A subsequent
   * success (via `updateProxyScore(_, true, _)`) resets the counter, so an
   * intermittent hiccup on a mostly-healthy proxy doesn't accumulate.
   *
   * Binary 502s must not ban a proxy for text. A size cap or a content-type
   * paywall should only take that host out of the binary rotation.
   *
   * @param {string} proxy
   * @param {string} failureType — short human-readable tag ("timeout",
   *   "HTTP 522", "network error") used only for the ban-reason log.
   * @param {'text' | 'binary' | '*'} [mode='*']
   */
  _recordProxyHardFailure(proxy, failureType, mode = '*') {
    const key = this._cooldownKey(proxy, mode);
    const count = (this.proxyConsecutiveHardFailures.get(key) || 0) + 1;
    this.proxyConsecutiveHardFailures.set(key, count);
    if (count >= this.autoBanHardFailureThreshold) {
      this._markProxyDead(
        proxy,
        mode,
        `auto-ban: ${count} consecutive ${failureType}`,
        this.autoBanHardFailureTtlMs
      );
      this.proxyConsecutiveHardFailures.set(key, 0);
    }
  }

  /**
   * Classify a caught fetch error as a "hard failure" if it's a
   * timeout, a network failure, or anything other than a caller-issued
   * AbortError. Returns the short tag for the ban reason, or null when
   * the error shouldn't be counted (e.g. the caller cancelled).
   */
  _hardFailureTypeForError(error) {
    if (!error) return 'unknown error';
    if (error.name === 'AbortError') return null;
    if (error.name === 'TimeoutError') return 'timeout';
    return 'network error';
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
    if (!this.storageImpl) {
      return;
    }
    try {
      const raw = this.storageImpl.getItem(PROXY_HEALTH_STORAGE_KEY);
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
      const dead = data && data.dead;
      if (dead && typeof dead === 'object') {
        const now = Date.now();
        for (const key of Object.keys(dead)) {
          const row = dead[key];
          if (!row || typeof row !== 'object') continue;
          const until = typeof row.until === 'number' ? row.until : 0;
          // Drop expired entries on load so the in-memory map is small.
          if (!until || until <= now) continue;
          // Also drop entries for proxies that are no longer in the
          // current list (e.g. after a prune). Keys are `${proxy}|${mode}`.
          const proxyPart = key.split('|')[0];
          if (!this.proxyOptions.includes(proxyPart)) continue;
          this.proxyDeadUntil.set(key, until);
          if (typeof row.reason === 'string') {
            this.proxyDeadReason.set(key, row.reason);
          }
        }
      }
      const cors = data && data.cors;
      if (cors && typeof cors === 'object') {
        const now = Date.now();
        for (const origin of Object.keys(cors)) {
          const until = cors[origin];
          if (typeof until !== 'number' || until <= now) continue;
          this.directBinaryBlockedUntil.set(origin, until);
        }
      }
    } catch {
      /* ignore corrupt or private mode */
    }
  }

  _schedulePersistProxyHealth() {
    if (!this.storageImpl) {
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
        const now = Date.now();
        const dead = {};
        for (const [key, until] of this.proxyDeadUntil.entries()) {
          if (typeof until !== 'number' || until <= now) continue;
          dead[key] = { until, reason: this.proxyDeadReason.get(key) || '' };
        }
        const cors = {};
        for (const [origin, until] of this.directBinaryBlockedUntil.entries()) {
          if (typeof until !== 'number' || until <= now) continue;
          cors[origin] = until;
        }
        this.storageImpl.setItem(
          PROXY_HEALTH_STORAGE_KEY,
          JSON.stringify({ v: 1, savedAt: Date.now(), proxies, dead, cors })
        );
      } catch {
        /* quota, private mode */
      }
    }, 400);
  }

  // Update proxy score based on success/failure.
  // `mode` is the fetch that just succeeded; a success clears that ban.
  updateProxyScore(proxy, success, responseTime = null, mode = null) {
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
      // Reset auto-ban counters (all modes) so intermittent blips don't
      // accumulate into a ban on a mostly-healthy proxy.
      for (const key of [...this.proxyConsecutiveHardFailures.keys()]) {
        if (key === proxy || key.startsWith(`${proxy}|`)) {
          this.proxyConsecutiveHardFailures.set(key, 0);
        }
      }
      // A real response lifts a stale ban for this mode. Otherwise the
      // all-dead re-probe succeeds once and the next song is skipped
      // again because the ban is still in localStorage.
      if (mode) {
        this.enableProxy(proxy, mode);
        this.enableProxy(proxy, '*');
      }
    } else {
      // Penalize score for failure
      this.proxyScores.set(proxy, Math.max(0.1, currentScore - 0.2));
    }
    this._schedulePersistProxyHealth();
  }

  // Get proxies ordered by score (best first).
  // options.deferProxies: string[] — URL prefixes to try last (e.g. ['https://corsproxy.io/']).
  // options.mode: 'text' | 'binary' — request mode used for dead-list filtering.
  getOrderedProxies(options = {}) {
    const mode = options.mode;
    const alive = this.proxyOptions.filter((p) => !this.isProxyDead(p, mode));
    // If every proxy is banned, fall back to the full list (lets recovered
    // services get a re-probe instead of blocking the user entirely).
    const candidates = alive.length > 0 ? alive : this.proxyOptions;
    const byScore = candidates
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
    const userAbort = options.signal;
    try {
      // Honor caller timeout when set (e.g. IA metadata often needs 10–45s).
      // Default stays a short CORS probe so blocked origins fall through fast.
      const timeoutMs = options.timeout != null ? options.timeout : 3000;
      const signal = mergeFetchAbortSignal(timeoutMs, userAbort);
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...options.headers
        },
        mode: 'cors',
        signal
      });
      if (response.ok) {
        const text = await response.text();
        if (!text) return null;
        if (typeof options.validate === 'function' && !options.validate(text)) {
          console.warn('Direct fetch failed validation — falling through to proxies');
          return null;
        }
        console.log('Direct fetch succeeded (no proxy needed)');
        return text;
      }
    } catch (error) {
      if (error && error.name === 'AbortError' && userAbort && userAbort.aborted) {
        throw error;
      }
      // Expected - most sites block CORS, continue to proxies
      console.log(`Direct fetch blocked (expected): ${error && error.message}`);
    }
    return null;
  }

  // Internal: text proxy chain. Prefer fetchJson / fetchHtml on the caller Interface.
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
    const maxRetries = options.maxRetries ?? this.maxRetries;
    let lastError = null;

    const orderedProxies = this.getOrderedProxies({ ...options, mode: 'text' });
    const reprobing = this._reprobingAllDead(orderedProxies, 'text');
    /** @type {Set<string>} */
    const hardCounted = new Set();
    console.log(`Trying ${orderedProxies.length} proxies for: ${url.substring(0, 80)}...`);

    for (let retry = 0; retry <= maxRetries; retry++) {
      if (userAbort && userAbort.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      // A pass of only HTTP 4xx is the target missing, not a dead proxy.
      // Retrying that pass is what made a missing song take the timeout
      // budget and then ban the pool for every song after it.
      const pass = { clientError: false, serverError: false, timeout: false, other: false };
      for (const proxy of orderedProxies) {
        // Skip proxies banned mid-loop. When every host is already banned,
        // this list is the re-probe and must actually run.
        if (!reprobing && this.isProxyDead(proxy, 'text')) continue;
        // Circuit breaker only on the first pass — later retries must re-probe
        // the same hosts or maxRetries is a no-op (cooldown is 30s; backoff is 1–3s).
        if (retry === 0 && this._proxyInCooldown(proxy, 'text')) continue;

        try {
          const proxyUrl = proxy + this.encodeUrlForProxy(url);
          const startTime = Date.now();
          console.log(`Trying proxy: ${proxy.substring(0, 30)}...`);

          const signal = mergeFetchAbortSignal(timeoutMs, userAbort);
          const response = await this.fetchImpl(proxyUrl, {
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
              this._noteProxyFailure(proxy, 'text');
              continue;
            }

            // Known-dead signature even on a 200 (some proxies return their
            // paywall blob with status 200 + JSON body). Ban and advance.
            if (this._maybeMarkDeadFromBody(proxy, content)) continue;

            // Caller-supplied body validation. Catches proxies that return 200 OK
            // with a non-empty body that isn't what we asked for — e.g. codetabs
            // returning "Edge: Too Many Requests" as a plain-text 23-byte body
            // when rate-limited. Without this check we'd cache that string and
            // surface it to every caller for the same URL.
            if (typeof options.validate === 'function' && !options.validate(content)) {
              console.warn(`Proxy ${proxy} returned body failing validation — treating as failure`);
              this.updateProxyScore(proxy, false);
              this._noteProxyFailure(proxy, 'text');
              continue;
            }

            this._cacheSet(cacheKey, content);

            // Update score for successful proxy
            this.updateProxyScore(proxy, true, responseTime, 'text');
            console.log(
              `Proxy ${proxy} succeeded in ${responseTime}ms (score: ${this.proxyScores
                .get(proxy)
                .toFixed(2)})`
            );

            return content;
          } else {
            // Read the (likely small) error body to check for dead signatures
            // before just penalizing the score. This is what catches the
            // corsproxy.io content-type paywall, codetabs's bad-request JSON,
            // and corsfix's domain_not_registered blob.
            let errBody = '';
            try {
              errBody = await response.text();
            } catch {
              /* ignore */
            }
            if (this._maybeMarkDeadFromBody(proxy, errBody)) continue;
            console.warn(`Proxy ${proxy} returned status ${response.status}`);
            lastError = new Error(`HTTP ${response.status}`);
            this.updateProxyScore(proxy, false);
            this._noteProxyFailure(proxy, 'text');
            if (response.status >= 500) {
              pass.serverError = true;
              this._noteHardFailureOnce(hardCounted, proxy, `HTTP ${response.status}`, 'text');
            } else if (response.status >= 400) {
              pass.clientError = true;
            }
          }
        } catch (error) {
          // Per-attempt AbortSignal.timeout() also surfaces as AbortError.
          // Only bail out of the whole chain when the *caller* aborted —
          // otherwise a single slow proxy would skip every remaining host
          // (especially painful on mobile networks).
          if (error && error.name === 'AbortError') {
            if (userAbort && userAbort.aborted) throw error;
            lastError = error;
            pass.timeout = true;
            console.warn(`Proxy ${proxy} timed out (attempt ${retry + 1})`);
            this.updateProxyScore(proxy, false);
            this._noteProxyFailure(proxy, 'text');
            this._noteHardFailureOnce(hardCounted, proxy, 'timeout', 'text');
            continue;
          }
          lastError = error;
          pass.other = true;
          console.warn(`Proxy ${proxy} failed (attempt ${retry + 1}):`, error.message);
          this.updateProxyScore(proxy, false);
          this._noteProxyFailure(proxy, 'text');
          const failureType = this._hardFailureTypeForError(error);
          if (failureType) this._noteHardFailureOnce(hardCounted, proxy, failureType, 'text');
          continue;
        }
      }

      // If we get here, all proxies failed for this retry.
      // A conclusive 4xx miss will not succeed on the next pass.
      const conclusiveMiss = pass.clientError && !pass.serverError && !pass.timeout && !pass.other;
      if (conclusiveMiss) break;
      if (retry < maxRetries) {
        if (userAbort && userAbort.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        console.log(`All proxies failed, retrying... (${retry + 1}/${maxRetries})`);
        // Wait a bit before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
      }
    }

    if (userAbort && userAbort.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    throw proxyExhausted('text', maxRetries + 1, lastError);
  }

  /** @returns {string} '' when the URL cannot be parsed. */
  _originOf(url) {
    try {
      return new URL(url, window.location.href).origin;
    } catch {
      return '';
    }
  }

  /** @returns {boolean} True when this origin refused a direct binary request recently. */
  directBinaryBlocked(url) {
    const origin = this._originOf(url);
    if (!origin) return false;
    const until = this.directBinaryBlockedUntil.get(origin);
    if (!until) return false;
    if (until <= Date.now()) {
      this.directBinaryBlockedUntil.delete(origin);
      return false;
    }
    return true;
  }

  _markDirectBinaryBlocked(url) {
    const origin = this._originOf(url);
    if (!origin) return;
    this.directBinaryBlockedUntil.set(origin, Date.now() + this.directBinaryBlockTtlMs);
    this._schedulePersistProxyHealth();
  }

  _clearDirectBinaryBlock(url) {
    const origin = this._originOf(url);
    if (origin && this.directBinaryBlockedUntil.delete(origin)) {
      this._schedulePersistProxyHealth();
    }
  }

  // Try direct binary fetch first (in case server allows CORS). Caller passes skipDirect: true to skip.
  async tryDirectBinaryFetch(url, options = {}) {
    const userAbort = options.signal;
    try {
      // Keep the probe short — options.timeout is for the full proxy chain
      // (often 30–120s for large ROMs). Spending that budget on a CORS
      // failure that will never succeed just delays the real download.
      const timeoutMs = 3000;
      const signal = mergeFetchAbortSignal(timeoutMs, userAbort);
      const response = await this.fetchImpl(url, {
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
        this._clearDirectBinaryBlock(url);
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        if (!uint8Array.length) return null;
        if (typeof options.validateBinary === 'function' && !options.validateBinary(uint8Array)) {
          console.warn('Direct binary fetch failed validation — falling through to proxies');
          return null;
        }
        return uint8Array;
      }
    } catch (error) {
      // Only rethrow a caller AbortSignal — probe timeouts must fall through.
      if (error && error.name === 'AbortError' && userAbort && userAbort.aborted) {
        throw error;
      }
      // A TypeError here is the CORS/network refusal; an AbortError is just the
      // probe timing out, which says nothing about the origin's CORS policy.
      if (!error || error.name !== 'AbortError') {
        this._markDirectBinaryBlocked(url);
      }
      // Expected - most sites block CORS
      console.log(`Direct binary fetch blocked (expected): ${error && error.message}`);
    }
    return null;
  }

  // Internal: POST through a small hard-coded proxy subset.
  async postWithProxy(url, body, options = {}) {
    const userAbort = options.signal;
    const timeoutMs = options.timeout || this.timeoutMs;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    let lastError = null;

    // No anonymous POST proxy is left in the pool. cors.dev's free tier is
    // GET/HEAD only, corsproxy.io now requires a key, and proxy.cors.sh
    // does not resolve. Nothing in the site calls this method.
    const postCapableProxies = [];

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
          const response = await this.fetchImpl(proxyUrl, {
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
            if (this._maybeMarkDeadFromBody(proxy, content)) continue;
            console.log(`POST via ${proxy} succeeded in ${responseTime}ms`);
            return content;
          } else {
            let errBody = '';
            try {
              errBody = await response.text();
            } catch {
              /* ignore */
            }
            if (this._maybeMarkDeadFromBody(proxy, errBody)) continue;
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

    throw proxyExhausted('post', maxRetries + 1, lastError);
  }

  // Internal buffered binary chain; prefer Interface method fetchBinary.
  async fetchBinaryWithProxy(url, options = {}) {
    const { signal: userAbort, validateBinary, ...optionsForKey } = options;
    const cacheKey = `binary-${url}-${JSON.stringify(optionsForKey)}`;

    if (!userAbort && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (
        cached &&
        cached.length &&
        !this._looksLikeTextErrorPayload(cached) &&
        !(typeof validateBinary === 'function' && !validateBinary(cached))
      ) {
        return cached;
      }
      this.cache.delete(cacheKey);
    }

    if (!options.skipDirect && !this.directBinaryBlocked(url)) {
      const directResult = await this.tryDirectBinaryFetch(url, options);
      if (directResult) {
        this._cacheSet(cacheKey, directResult);
        return directResult;
      }
    }

    const timeoutMs = options.timeout || this.binaryTimeoutMs;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    let lastError = null;

    // Oversized bodies are rejected by cors.dev's own signature (binary
    // ban) and the chain continues. Callers can still pass deferProxies.
    const binaryOpts = {
      ...options,
      mode: 'binary'
    };
    const orderedProxies = this.getOrderedProxies(binaryOpts);
    const reprobing = this._reprobingAllDead(orderedProxies, 'binary');
    /** @type {Set<string>} */
    const hardCounted = new Set();

    for (let retry = 0; retry <= maxRetries; retry++) {
      if (userAbort && userAbort.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      const pass = { clientError: false, serverError: false, timeout: false, other: false };
      for (const proxy of orderedProxies) {
        if (!reprobing && this.isProxyDead(proxy, 'binary')) continue;
        // Same as text path: cooldown only on the first pass so retries re-probe.
        if (retry === 0 && this._proxyInCooldown(proxy, 'binary')) continue;

        try {
          const proxyUrl = proxy + this.encodeUrlForProxy(url);
          const startTime = Date.now();

          const signal = mergeFetchAbortSignal(timeoutMs, userAbort);
          const response = await this.fetchImpl(proxyUrl, {
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
            // Some proxies return 200 with a JSON paywall/error blob instead
            // of the binary payload (corsproxy.io's free-plan content-type
            // gate is the canonical example). If the response advertises a
            // text/JSON content-type, read it as text first and check the
            // dead signatures. Real binary will have application/zip,
            // audio/*, application/octet-stream, etc.
            const ct = (response.headers.get('content-type') || '').toLowerCase();
            const looksTextual =
              ct.includes('application/json') || ct.startsWith('text/') || ct.includes('xml');
            if (looksTextual) {
              let bodyText = '';
              try {
                bodyText = await response.text();
              } catch {
                /* ignore */
              }
              if (this._maybeMarkDeadFromBody(proxy, bodyText)) continue;
              console.warn(
                `Proxy ${proxy} returned ${ct} for binary request — treating as failure`
              );
              this.updateProxyScore(proxy, false);
              this._noteProxyFailure(proxy, 'binary');
              continue;
            }
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            if (!uint8Array.length) {
              console.warn(`Proxy ${proxy} returned empty binary body — treating as failure`);
              this.updateProxyScore(proxy, false);
              this._noteProxyFailure(proxy, 'binary');
              continue;
            }
            // Reject HTML/JSON error pages mislabeled as octet-stream, and
            // let callers enforce format (e.g. ZIP magic for ROM zips).
            if (this._looksLikeTextErrorPayload(uint8Array)) {
              console.warn(`Proxy ${proxy} returned text error as binary — treating as failure`);
              this.updateProxyScore(proxy, false);
              this._noteProxyFailure(proxy, 'binary');
              continue;
            }
            if (
              typeof options.validateBinary === 'function' &&
              !options.validateBinary(uint8Array)
            ) {
              console.warn(
                `Proxy ${proxy} returned binary failing validation — treating as failure`
              );
              this.updateProxyScore(proxy, false);
              this._noteProxyFailure(proxy, 'binary');
              continue;
            }
            this._cacheSet(cacheKey, uint8Array);

            this.updateProxyScore(proxy, true, responseTime, 'binary');
            console.log(
              `Proxy ${proxy} succeeded in ${responseTime}ms (score: ${this.proxyScores
                .get(proxy)
                .toFixed(2)})`
            );

            return uint8Array;
          } else {
            let errBody = '';
            try {
              errBody = await response.text();
            } catch {
              /* ignore */
            }
            if (this._maybeMarkDeadFromBody(proxy, errBody)) continue;
            console.warn(`Proxy ${proxy} returned status ${response.status}`);
            lastError = new Error(`HTTP ${response.status}`);
            this.updateProxyScore(proxy, false);
            this._noteProxyFailure(proxy, 'binary');
            if (response.status >= 500) {
              pass.serverError = true;
              this._noteHardFailureOnce(hardCounted, proxy, `HTTP ${response.status}`, 'binary');
            } else if (response.status >= 400) {
              pass.clientError = true;
            }
          }
        } catch (error) {
          // Per-proxy AbortSignal.timeout must advance to the next host —
          // only a caller-supplied AbortSignal should abort the whole chain.
          // (Text fetchWithProxy already did this; binary used to throw on
          // every timeout and never tried another proxy.)
          if (error && error.name === 'AbortError') {
            if (userAbort && userAbort.aborted) throw error;
            lastError = error;
            pass.timeout = true;
            console.warn(`Proxy ${proxy} timed out (attempt ${retry + 1})`);
            this.updateProxyScore(proxy, false);
            this._noteProxyFailure(proxy, 'binary');
            this._noteHardFailureOnce(hardCounted, proxy, 'timeout', 'binary');
            continue;
          }
          lastError = error;
          pass.other = true;
          console.warn(`Proxy ${proxy} failed (attempt ${retry + 1}):`, error && error.message);
          this.updateProxyScore(proxy, false);
          this._noteProxyFailure(proxy, 'binary');
          const failureType = this._hardFailureTypeForError(error);
          if (failureType) this._noteHardFailureOnce(hardCounted, proxy, failureType, 'binary');
          continue;
        }
      }

      const conclusiveMiss = pass.clientError && !pass.serverError && !pass.timeout && !pass.other;
      if (conclusiveMiss) break;
      if (retry < maxRetries) {
        if (userAbort && userAbort.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        console.log(`All proxies failed, retrying... (${retry + 1}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
      }
    }

    throw proxyExhausted('binary', maxRetries + 1, lastError);
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
    if (!options.skipDirect && !this.directBinaryBlocked(url)) {
      try {
        const blob = await this._streamToBlob(url, {
          signal: userAbort,
          onProgress: options.onProgress,
          contentType,
          headers: options.headers
        });
        if (blob) {
          console.log('Direct binary stream succeeded (no proxy needed)');
          this._clearDirectBinaryBlock(url);
          return blob;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        this._markDirectBinaryBlocked(url);
        console.log(`Direct binary stream blocked: ${err && err.message}`);
      }
    }

    const orderedProxies = this.getOrderedProxies({
      ...options,
      mode: 'binary'
    });
    const reprobing = this._reprobingAllDead(orderedProxies, 'binary');
    /** @type {Set<string>} */
    const hardCounted = new Set();
    let lastError = null;
    for (let retry = 0; retry <= maxRetries; retry += 1) {
      if (userAbort && userAbort.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      const pass = { clientError: false, serverError: false, timeout: false, other: false };
      for (const proxy of orderedProxies) {
        if (!reprobing && this.isProxyDead(proxy, 'binary')) continue;
        if (retry === 0 && this._proxyInCooldown(proxy, 'binary')) continue;
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
            this.updateProxyScore(proxy, true, Date.now() - startTime, 'binary');
            return blob;
          }
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          lastError = err;
          console.warn(`Streamed proxy ${proxy} failed:`, err && err.message);
          if (err && err.proxyBody && this._maybeMarkDeadFromBody(proxy, err.proxyBody)) {
            continue;
          }
          this.updateProxyScore(proxy, false);
          this._noteProxyFailure(proxy, 'binary');
          // `_streamToBlob` throws `new Error('HTTP ${status}')` for
          // non-2xx responses; parse that back out so we can gate the
          // hard-failure counter on 5xx like the buffered paths do.
          const httpMatch = /^HTTP (\d+)$/.exec(err && err.message);
          if (httpMatch) {
            const status = Number(httpMatch[1]);
            if (status >= 500) {
              pass.serverError = true;
              this._noteHardFailureOnce(hardCounted, proxy, `HTTP ${status}`, 'binary');
            } else if (status >= 400) {
              pass.clientError = true;
            }
          } else {
            pass.other = true;
            const failureType = this._hardFailureTypeForError(err);
            if (failureType) this._noteHardFailureOnce(hardCounted, proxy, failureType, 'binary');
          }
        }
      }
      const conclusiveMiss = pass.clientError && !pass.serverError && !pass.timeout && !pass.other;
      if (conclusiveMiss) break;
      if (retry < maxRetries) {
        if (userAbort && userAbort.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
      }
    }
    throw proxyExhausted('binary', maxRetries + 1, lastError);
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
    const res = await this.fetchImpl(url, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'application/octet-stream,*/*',
        ...headers
      }
    });
    if (!res.ok) {
      // Buffered fetches read this body and match DEAD_PROXY_SIGNATURES.
      // Streaming has to do the same, or a fast 502 response_too_large
      // would count as a hard failure and drag the text score down.
      let errBody = '';
      try {
        const text = await res.text();
        errBody = text.length > 4096 ? text.slice(0, 4096) : text;
      } catch {
        /* ignore */
      }
      const err = new Error(`HTTP ${res.status}`);
      err.proxyBody = errBody;
      throw err;
    }
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
    const now = Date.now();
    const stats = [];
    this.proxyOptions.forEach((proxy) => {
      const attempts = this.proxyAttempts.get(proxy) || 0;
      const successes = this.proxySuccesses.get(proxy) || 0;
      const score = this.proxyScores.get(proxy) || 1.0;
      const successRate = attempts > 0 ? ((successes / attempts) * 100).toFixed(1) : '0.0';

      const bans = [];
      for (const mode of ['*', 'text', 'binary']) {
        const key = this._deadKey(proxy, mode);
        const until = this.proxyDeadUntil.get(key);
        if (until && until > now) {
          bans.push({
            mode,
            reason: this.proxyDeadReason.get(key) || '',
            until,
            remainingMs: until - now
          });
        }
      }

      stats.push({
        proxy,
        score: score.toFixed(2),
        attempts,
        successes,
        successRate: `${successRate}%`,
        bans
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
   * Manually ban a proxy. Useful from devtools / terminal when a proxy is
   * clearly misbehaving in a way the auto-detector doesn't catch yet.
   * @param {string} proxy — must match a `proxyOptions` entry exactly.
   * @param {{ mode?: 'text' | 'binary' | '*', ttlMs?: number, reason?: string }} [options]
   */
  disableProxy(proxy, options = {}) {
    if (!this.proxyOptions.includes(proxy)) {
      console.warn(`disableProxy: unknown proxy ${proxy}`);
      return false;
    }
    this._markProxyDead(
      proxy,
      options.mode || '*',
      options.reason || 'manual',
      options.ttlMs ?? DEAD_PROXY_TTL_MS
    );
    return true;
  }

  /**
   * Lift a previously-applied ban for a proxy. Clears the matching entry
   * (or all entries when `mode` is omitted).
   * @param {string} proxy
   * @param {'text' | 'binary' | '*'} [mode]
   */
  enableProxy(proxy, mode) {
    if (mode) {
      const key = this._deadKey(proxy, mode);
      this.proxyDeadUntil.delete(key);
      this.proxyDeadReason.delete(key);
    } else {
      for (const m of ['*', 'text', 'binary']) {
        const key = this._deadKey(proxy, m);
        this.proxyDeadUntil.delete(key);
        this.proxyDeadReason.delete(key);
      }
    }
    this._schedulePersistProxyHealth();
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
    if (this.storageImpl) {
      try {
        const raw = this.storageImpl.getItem(fullKey);
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
    if (this.storageImpl) {
      try {
        this.storageImpl.setItem(fullKey, JSON.stringify({ savedAt: Date.now(), value }));
      } catch {
        /* quota / private mode — pretend we cached */
      }
    }
    return value;
  }

  // Reset all proxy scores (useful for testing). Also clears the dead-list
  // and circuit-breaker state so a stuck client can recover without a
  // full storage wipe.
  resetProxyScores() {
    this.proxyOptions.forEach((proxy) => {
      this.proxyScores.set(proxy, 1.0);
      this.proxyAttempts.set(proxy, 0);
      this.proxySuccesses.set(proxy, 0);
    });
    this.proxyDeadUntil.clear();
    this.proxyDeadReason.clear();
    this.proxyLastFailure.clear();
    this.proxyConsecutiveHardFailures.clear();
    this.directBinaryBlockedUntil.clear();
    if (this.storageImpl) {
      try {
        this.storageImpl.removeItem(PROXY_HEALTH_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    console.log('Proxy scores reset to default values');
  }
}

// Create global instance (production Adapter: ambient fetch + localStorage)
const proxyService = new ProxyService();

// Make globally accessible — prefer Interface methods documented at file top.
window.proxyService = proxyService;

// Export for module systems / tests (`new ProxyService({ fetchImpl, storageImpl })`)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ProxyService, ProxyExhaustedError, proxyService };
}
