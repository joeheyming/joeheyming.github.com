// Unit tests for ProxyService Adapter seams (fetchImpl / storageImpl).
//
// Phase 6 deepening: callers use the narrow Interface; tests construct
// `new ProxyService({ fetchImpl, storageImpl })` with recorded responses
// and in-memory storage — no real network.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SOURCE = await readFile(new URL('../proxy.js', import.meta.url), 'utf8');

const HEXLET = 'https://allorigins.hexlet.app/raw?url=';
const CORS_EU = 'https://cors.eu.org/';
const JSON_URL = 'https://api.example.com/data.json';
const ROM_URL = 'https://cdn.example.com/game.rom';

function makeLocalStorage() {
  const store = new Map();
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
}

function textResponse(body, contentType = 'application/json') {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => (String(name).toLowerCase() === 'content-type' ? contentType : null)
    },
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer
  };
}

/** ZIP magic keeps `_looksLikeTextErrorPayload` from rejecting the body. */
function binaryResponse() {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) =>
        String(name).toLowerCase() === 'content-type' ? 'application/octet-stream' : null
    },
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => ''
  };
}

function paywallBinaryResponse() {
  const body =
    '{"error":"This content type is not allowed on the free plan. Upgrade at https://corsproxy.io/pricing/"}';
  return textResponse(body, 'application/json');
}

/**
 * Load ProxyService from proxy.js in a vm, then construct with injected Adapters.
 * @param {{ fetchImpl: typeof fetch, storageImpl?: ReturnType<typeof makeLocalStorage> | null }} deps
 */
function createProxyService(deps) {
  const module = { exports: {} };
  const context = {
    window: { location: { href: 'http://localhost:8000/' } },
    module,
    exports: module.exports,
    // Ambient defaults unused when tests inject — still required for the
    // script-level `new ProxyService()` singleton at the bottom of proxy.js.
    fetch: async () => {
      throw new Error('ambient fetch should not be used by injected tests');
    },
    localStorage: makeLocalStorage(),
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    AbortController,
    AbortSignal,
    DOMException,
    DOMParser: class {
      parseFromString() {
        return { documentElement: { tagName: 'HTML' } };
      }
    },
    Date,
    Blob: globalThis.Blob
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  const { ProxyService } = module.exports;
  assert.equal(typeof ProxyService, 'function', 'ProxyService should export via module.exports');
  return new ProxyService(deps);
}

describe('ProxyService ambient storage', () => {
  it('constructs inside a sandbox whose localStorage getter throws', async () => {
    const module = { exports: {} };
    const context = {
      window: { location: { href: 'http://localhost:8000/' } },
      module,
      exports: module.exports,
      fetch: async () => textResponse('{"ok":true}'),
      console: { log() {}, warn() {}, error() {} },
      setTimeout,
      clearTimeout,
      URL,
      URLSearchParams,
      TextDecoder,
      TextEncoder,
      AbortController,
      AbortSignal,
      DOMException,
      DOMParser: class {},
      Date,
      Blob: globalThis.Blob
    };
    // An opaque-origin document throws on access, so even `typeof` fails.
    Object.defineProperty(context, 'localStorage', {
      get() {
        throw new Error("Failed to read the 'localStorage' property from 'Window'");
      }
    });
    vm.createContext(context);

    // The singleton at the bottom of proxy.js runs during evaluation.
    vm.runInContext(SOURCE, context);

    const service = new module.exports.ProxyService();
    assert.equal(service.storageImpl, null, 'falls back to no persistence');
    // Persistence paths must stay no-ops rather than throwing.
    service._markProxyDead(service.proxyOptions[0], '*', 'test');
    assert.equal(service.isProxyDead(service.proxyOptions[0], 'text'), true);
  });
});

describe('ProxyService Adapter seams', () => {
  /** @type {ReturnType<typeof makeLocalStorage>} */
  let storage;

  beforeEach(() => {
    storage = makeLocalStorage();
  });

  it('falls back to the next proxy when the first fails', async () => {
    /** @type {string[]} */
    const fetched = [];
    const fetchImpl = async (url) => {
      fetched.push(String(url));
      if (String(url).startsWith(HEXLET)) {
        throw new TypeError('Failed to fetch');
      }
      if (
        String(url).startsWith(CORS_EU) ||
        String(url).includes('proxy') ||
        String(url).includes('cors')
      ) {
        return textResponse('{"ok":true,"source":"fallback"}');
      }
      throw new TypeError('unexpected URL: ' + url);
    };

    const service = createProxyService({ fetchImpl, storageImpl: storage });
    const data = await service.fetchJson(JSON_URL, { maxRetries: 0, timeout: 1000 });

    // Property checks — deepEqual can trip on vm-realm object identity.
    assert.equal(data.ok, true);
    assert.equal(data.source, 'fallback');
    assert.ok(
      fetched.some((u) => u.startsWith(HEXLET)),
      'should have tried the first (hexlet) proxy'
    );
    assert.ok(
      fetched.some((u) => !u.startsWith(HEXLET)),
      'should have fallen through to a later proxy'
    );
  });

  it('bans a proxy on a dead-signature body and skips it on the next call', async () => {
    /** @type {string[]} */
    const fetched = [];
    let hexletHits = 0;

    const fetchImpl = async (url) => {
      const u = String(url);
      fetched.push(u);
      // Direct probe — refuse so we enter the proxy chain.
      if (u === ROM_URL || u.startsWith('https://cdn.example.com/')) {
        throw new TypeError('Failed to fetch');
      }
      if (u.startsWith(HEXLET)) {
        hexletHits += 1;
        return paywallBinaryResponse();
      }
      return binaryResponse();
    };

    const service = createProxyService({ fetchImpl, storageImpl: storage });
    // Avoid cooldown / retry sleeps.
    service.proxyCooldownMs = 0;

    const first = await service.fetchBinary(ROM_URL, { maxRetries: 0, timeout: 1000 });
    assert.equal(first.length, 8);
    assert.equal(hexletHits, 1, 'hexlet should be tried once and banned');
    assert.equal(
      service.isProxyDead(HEXLET, 'binary'),
      true,
      'paywall body should ban hexlet for binary'
    );

    fetched.length = 0;
    hexletHits = 0;
    const second = await service.fetchBinary(ROM_URL, { maxRetries: 0, timeout: 1000 });
    assert.equal(second.length, 8);
    assert.equal(hexletHits, 0, 'banned proxy must not be re-probed while TTL is active');
    assert.ok(
      fetched.every((u) => !u.startsWith(HEXLET)),
      'second call should skip the banned hexlet prefix'
    );
  });

  it('bans corsproxy.io for every mode once it demands an API key', async () => {
    const CORSPROXY = 'https://corsproxy.io/?';
    const keyless =
      '{"success":false,"status":403,"error":"keyless_legacy_url",' +
      '"message":"Anonymous legacy proxy URLs are no longer supported."}';

    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.startsWith(CORSPROXY)) return textResponse(keyless);
      return textResponse('{"ok":true}');
    };

    const service = createProxyService({ fetchImpl, storageImpl: storage });
    service.proxyCooldownMs = 0;
    // Order by score so corsproxy.io is reached on the first pass.
    service.proxyOptions.forEach((p) => service.proxyScores.set(p, p === CORSPROXY ? 2 : 1));

    await service.fetchJson(JSON_URL, { maxRetries: 0, timeout: 1000 });

    assert.equal(service.isProxyDead(CORSPROXY, 'text'), true);
    assert.equal(service.isProxyDead(CORSPROXY, 'binary'), true, 'keyless ban is universal');
  });

  it('bans a rate-limited proxy only briefly', async () => {
    const rateLimited =
      '<html><head><title>This website has been temporarily rate limited</title></head></html>';

    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.startsWith(CORS_EU)) return textResponse(rateLimited, 'text/html');
      return textResponse('{"ok":true}');
    };

    const service = createProxyService({ fetchImpl, storageImpl: storage });
    service.proxyCooldownMs = 0;
    service.proxyOptions.forEach((p) => service.proxyScores.set(p, p === CORS_EU ? 2 : 1));

    const before = Date.now();
    await service.fetchJson(JSON_URL, { maxRetries: 0, timeout: 1000 });

    assert.equal(service.isProxyDead(CORS_EU, 'text'), true);
    const banMs = service.proxyDeadUntil.get(`${CORS_EU}|*`) - before;
    assert.ok(
      banMs >= 15 * 60 * 1000 && banMs < 20 * 60 * 1000,
      `a temporary rate limit should ban for ~15m, not the default 24h (got ${banMs}ms)`
    );
  });

  it('persists dead-proxy bans through storageImpl across a fresh instance', async () => {
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u === ROM_URL || u.startsWith('https://cdn.example.com/')) {
        throw new TypeError('Failed to fetch');
      }
      if (u.startsWith(HEXLET)) {
        return paywallBinaryResponse();
      }
      return binaryResponse();
    };

    const first = createProxyService({ fetchImpl, storageImpl: storage });
    first.proxyCooldownMs = 0;
    await first.fetchBinary(ROM_URL, { maxRetries: 0, timeout: 1000 });
    assert.equal(first.isProxyDead(HEXLET, 'binary'), true);

    // Persist is debounced by 400ms.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const second = createProxyService({
      fetchImpl: async () => {
        throw new Error('second instance should not need network for ban check');
      },
      storageImpl: storage
    });
    assert.equal(second.isProxyDead(HEXLET, 'binary'), true, 'ban should reload from storageImpl');
  });
});
