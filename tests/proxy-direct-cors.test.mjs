// Unit tests for proxy.js's direct-binary CORS memory.
//
// `fetchBinaryWithProxy` probes the target origin directly before falling
// back to the public proxy chain, because a permissive origin saves a slow
// hop. Origins like archive.org's CDN nodes never permit it, and every
// refused attempt makes the browser print a CORS error plus an ERR_FAILED
// entry that no try/catch can suppress. The only cure is to stop asking, so
// a refusal is remembered (and persisted, since each ROM launch is a fresh
// page load) and later downloads from that origin skip the probe.
//
// proxy.js is a classic script that assigns window.proxyService, so it runs
// in a vm context with hand-rolled window / localStorage / fetch stubs.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SOURCE = await readFile(new URL('../proxy.js', import.meta.url), 'utf8');
const ROM_URL = 'https://ia601604.us.archive.org/20/items/Curated/game.chd';
const ROM_ORIGIN = 'https://ia601604.us.archive.org';

function makeLocalStorage() {
  const store = new Map();
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
}

/** ZIP magic keeps `_looksLikeTextErrorPayload` from rejecting the body. */
function binaryResponse() {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/octet-stream' },
    arrayBuffer: async () => bytes.buffer,
    text: async () => ''
  };
}

/**
 * Boots a fresh ProxyService. `localStorage` can be shared across boots to
 * simulate a reload. Returns the service plus the list of fetched URLs.
 */
function bootProxyService(localStorage, directError) {
  /** @type {string[]} */
  const fetched = [];
  const fetchStub = async (url) => {
    fetched.push(url);
    if (url.startsWith(ROM_ORIGIN)) {
      // A cross-origin refusal surfaces in the browser as a bare TypeError.
      throw directError ? directError() : new TypeError('Failed to fetch');
    }
    return binaryResponse();
  };

  const context = {
    window: { location: { href: 'http://localhost:8000/emulator/ps1/' } },
    localStorage,
    fetch: fetchStub,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    TextDecoder,
    AbortController,
    AbortSignal,
    DOMException,
    Date
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  return { service: context.window.proxyService, fetched };
}

describe('proxy.js direct binary CORS memory', () => {
  let localStorage;

  beforeEach(() => {
    localStorage = makeLocalStorage();
  });

  it('probes the origin directly on the first download', async () => {
    const { service, fetched } = bootProxyService(localStorage);
    await service.fetchBinaryWithProxy(ROM_URL, { maxRetries: 0 });
    assert.equal(
      fetched.filter((u) => u.startsWith(ROM_ORIGIN)).length,
      1,
      'first download should still try direct — the origin may allow CORS'
    );
  });

  it('skips the probe for a second download from the same origin', async () => {
    const { service, fetched } = bootProxyService(localStorage);
    await service.fetchBinaryWithProxy(ROM_URL, { maxRetries: 0 });
    fetched.length = 0;
    await service.fetchBinaryWithProxy(`${ROM_ORIGIN}/20/items/Curated/other.chd`, {
      maxRetries: 0
    });
    assert.deepEqual(
      fetched.filter((u) => u.startsWith(ROM_ORIGIN)),
      [],
      'the refusal is already known — asking again only prints console noise'
    );
  });

  it('still probes a different origin', async () => {
    const { service, fetched } = bootProxyService(localStorage);
    await service.fetchBinaryWithProxy(ROM_URL, { maxRetries: 0 });
    fetched.length = 0;
    const other = 'https://cdn.example.com/rom.zip';
    await service.fetchBinaryWithProxy(other, { maxRetries: 0 });
    assert.equal(fetched[0], other, 'a block is scoped to the origin that refused');
  });

  it('remembers the refusal across a reload', async () => {
    const first = bootProxyService(localStorage);
    await first.service.fetchBinaryWithProxy(ROM_URL, { maxRetries: 0 });
    // The persist write is debounced by 400ms.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const second = bootProxyService(localStorage);
    assert.equal(
      second.service.directBinaryBlocked(ROM_URL),
      true,
      'each ROM launch is a fresh page load, so in-memory-only state would re-probe every time'
    );
  });

  it('expires the block so an origin that adds CORS headers is re-probed', async () => {
    const { service } = bootProxyService(localStorage);
    service.directBinaryBlockedUntil.set(ROM_ORIGIN, Date.now() - 1000);
    assert.equal(service.directBinaryBlocked(ROM_URL), false);
  });

  it('does not blame the origin when the probe merely times out', async () => {
    const { service } = bootProxyService(
      localStorage,
      () => new DOMException('The operation timed out.', 'AbortError')
    );
    const result = await service.tryDirectBinaryFetch(ROM_URL, {});
    assert.equal(result, null, 'a probe timeout falls through to the proxy chain');
    // A slow origin may still be perfectly willing to serve us cross-origin.
    assert.equal(service.directBinaryBlocked(ROM_URL), false);
  });
});
