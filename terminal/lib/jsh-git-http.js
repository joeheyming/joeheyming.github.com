// HTTP for isomorphic-git:
// - isomorphic-git does NOT rewrite URLs when you pass a custom `http` client — it still passes
//   https://github.com/... to request(). We map those to https://cors.isomorphic-git.org/github.com/...
//   (same shape as @isomorphic-git/cors-proxy) when corsProxyBase is set, then direct fetch only.
// - Git smart HTTP URLs never use proxy.js (corsproxy.io etc.): free tiers block git content types.
// - Without corsProxyBase, non-git GETs may use fetchBinaryWithProxy; raw git POST still fails CORS.
// - git-upload-pack POST: stream the response body by default (avoids res.arrayBuffer() doubling RAM).
//
// Debug tracing (browser console): localStorage.setItem('jsh_git_debug', '1') then reload, or set
// window.JSH_GIT_DEBUG = true before running git. Logs use console.debug with prefix [jsh-git].

function jshGitTrace(...args) {
  console.log('[jsh-git-http]', ...args);
}

function bytesHexPreview(u8, maxBytes = 32) {
  const n = Math.min(u8.length, maxBytes);
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(u8[i].toString(16).padStart(2, '0'));
  }
  const tail = u8.length > maxBytes ? ` …(+${u8.length - maxBytes} bytes)` : '';
  return `${parts.join(' ')}${tail}`;
}

/**
 * Map https://host/path?query → {corsOrigin}/host/path?query for @isomorphic-git/cors-proxy.
 */
function rewriteThroughCorsProxy(url, corsProxyBase) {
  if (!corsProxyBase || typeof url !== 'string') {
    return url;
  }
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return url;
  }
  let base;
  try {
    base = new URL(
      corsProxyBase.startsWith('http://') || corsProxyBase.startsWith('https://')
        ? corsProxyBase
        : `https://${corsProxyBase}`
    );
  } catch {
    return url;
  }
  if (u.hostname.toLowerCase() === base.hostname.toLowerCase()) {
    return url;
  }
  const pathOnProxy = `${u.hostname}${u.pathname}${u.search}`;
  return `${base.origin}/${pathOnProxy}`;
}

/** Git smart HTTP — never send through curl-style proxies (corsproxy.io free tier blocks these). */
function isGitSmartHttpUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const p = u.pathname;
    const q = u.search;
    if (p.includes('git-upload-pack') || p.includes('git-receive-pack')) return true;
    if (p.endsWith('/info/refs') || p.endsWith('info/refs')) {
      return q.includes('service=git-upload-pack') || q.includes('service=git-receive-pack');
    }
    return false;
  } catch {
    return false;
  }
}

function makeForwardProxyChecker(corsProxyBase) {
  const h = new Set(['cors.isomorphic-git.org']);
  const addBase = (base) => {
    if (base == null || String(base).trim() === '') return;
    try {
      const normalized = String(base).replace(/\/+$/, '');
      const u = new URL(normalized.startsWith('http') ? normalized : `https://${normalized}`);
      h.add(u.hostname.toLowerCase());
    } catch (_) {
      /* ignore */
    }
  };
  addBase(corsProxyBase);
  if (typeof window !== 'undefined') {
    addBase(window.JSH_GIT_CORS_PROXY);
  }

  return function isForwardProxyUrl(url) {
    try {
      const u = new URL(url);
      return h.has(u.hostname.toLowerCase());
    } catch {
      return false;
    }
  };
}

async function collectBody(body) {
  if (body == null) return null;
  if (body instanceof Uint8Array) {
    return body.byteLength ? body : null;
  }
  if (body instanceof ArrayBuffer) {
    const u8 = new Uint8Array(body);
    return u8.byteLength ? u8 : null;
  }
  const buffers = [];
  if (body[Symbol.asyncIterator]) {
    for await (const chunk of body) {
      if (chunk && chunk.byteLength) buffers.push(chunk);
    }
  } else if (body[Symbol.iterator]) {
    for (const chunk of body) {
      if (chunk && chunk.byteLength) buffers.push(chunk);
    }
  } else if (typeof body.next === 'function') {
    let r;
    while (!(r = await body.next()).done) {
      if (r.value && r.value.byteLength) buffers.push(r.value);
    }
  }
  if (buffers.length === 0) return null;
  const size = buffers.reduce((s, b) => s + b.byteLength, 0);
  const out = new Uint8Array(size);
  let i = 0;
  for (const b of buffers) {
    out.set(b, i);
    i += b.byteLength;
  }
  return out;
}

async function* singleChunk(u8) {
  yield u8;
}

function concatUint8Arrays(chunks) {
  let n = 0;
  for (const c of chunks) {
    n += c.byteLength;
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/**
 * Stream upload-pack POST body when possible so we do not call res.arrayBuffer() (doubles RAM
 * with the response ~90MB+ and often triggers Aw, Snap). If the body is a raw packfile from
 * byte 0 (broken proxy), buffer fully and run through uploadPackBodyStreamForIsoGit.
 */
async function* streamUploadPackResponse(res) {
  const packMax = maxUploadPackBytes();

  if (!res.body || typeof res.body.getReader !== 'function') {
    const rawBuf = new Uint8Array(await res.arrayBuffer());
    jshGitTrace('upload-pack POST done', {
      status: res.status,
      fallback: 'arrayBuffer',
      bodyBytes: rawBuf.length
    });
    if (rawBuf.length > packMax) {
      throw new Error(
        `upload-pack response too large (${rawBuf.length} bytes; max ${packMax}). Try a smaller --depth, or set window.JSH_GIT_MAX_PACK_BYTES (capped at ${ABS_MAX_UPLOAD_PACK_BYTES}; large packs may OOM the tab).`
      );
    }
    const { body: normalized } = await uploadPackBodyStreamForIsoGit(rawBuf);
    for await (const part of normalized) {
      yield part;
    }
    return;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < 4) {
      const { done, value } = await reader.read();
      if (value && value.byteLength) {
        chunks.push(value);
        size += value.byteLength;
      }
      if (done) {
        let total = 0;
        for (const c of chunks) {
          total += c.byteLength;
          if (total > packMax) {
            throw new Error(
              `upload-pack response too large (>${packMax} bytes). Try --depth 1 or window.JSH_GIT_MAX_PACK_BYTES.`
            );
          }
          yield c;
        }
        jshGitTrace('upload-pack POST done', {
          status: res.status,
          streamed: true,
          bodyBytes: total
        });
        return;
      }
    }

    const head = new Uint8Array(4);
    let h = 0;
    for (const c of chunks) {
      for (let i = 0; i < c.length && h < 4; i++) {
        head[h++] = c[i];
      }
    }

    if (isRawPackFileFromStart(head)) {
      let chunk;
      do {
        chunk = await reader.read();
        if (chunk.value && chunk.value.byteLength) {
          chunks.push(chunk.value);
          size += chunk.value.byteLength;
          if (size > packMax) {
            throw new Error(
              `upload-pack response too large (${size} bytes; max ${packMax}). Try a smaller --depth or window.JSH_GIT_MAX_PACK_BYTES.`
            );
          }
        }
      } while (!chunk.done);
      const raw = concatUint8Arrays(chunks);
      jshGitTrace('upload-pack POST done', {
        status: res.status,
        rawPackFromByte0: true,
        bodyBytes: raw.length
      });
      const { body: normalized } = await uploadPackBodyStreamForIsoGit(raw);
      for await (const part of normalized) {
        yield part;
      }
      return;
    }

    let totalOut = 0;
    for (const c of chunks) {
      totalOut += c.byteLength;
      if (totalOut > packMax) {
        throw new Error(
          `upload-pack response too large (>${packMax} bytes). Try a smaller --depth or window.JSH_GIT_MAX_PACK_BYTES.`
        );
      }
      yield c;
    }
    let tail;
    do {
      tail = await reader.read();
      if (tail.value && tail.value.byteLength) {
        totalOut += tail.value.byteLength;
        if (totalOut > packMax) {
          throw new Error(
            `upload-pack response too large (${totalOut} bytes; max ${packMax}). Try a smaller --depth or window.JSH_GIT_MAX_PACK_BYTES.`
          );
        }
        yield tail.value;
      }
    } while (!tail.done);
    jshGitTrace('upload-pack POST done', {
      status: res.status,
      streamed: true,
      bodyBytes: totalOut
    });
  } finally {
    reader.releaseLock();
  }
}

function headersToObject(headers) {
  const o = {};
  if (headers && typeof headers.entries === 'function') {
    for (const [k, v] of headers.entries()) {
      o[k] = v;
    }
  }
  return o;
}

function urlPathnameIncludesGitUploadPack(urlStr) {
  try {
    return new URL(urlStr).pathname.includes('git-upload-pack');
  } catch {
    return String(urlStr).includes('git-upload-pack');
  }
}

function urlPathnameIncludesGitReceivePack(urlStr) {
  try {
    return new URL(urlStr).pathname.includes('git-receive-pack');
  } catch {
    return String(urlStr).includes('git-receive-pack');
  }
}

/**
 * True only when the HTTP body *is* a packfile from byte 0 (some proxies omit side-band-64k).
 * Do NOT scan the whole buffer for "PACK": that 4-byte sequence appears inside compressed pack
 * data often enough to split wrong, corrupt the stream, and hang or OOM the renderer (Chrome
 * "Aw, Snap!").
 */
function isRawPackFileFromStart(buf) {
  return (
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x41 && buf[2] === 0x43 && buf[3] === 0x4b
  );
}

const GIT_PKT_FLUSH = new Uint8Array([0x30, 0x30, 0x30, 0x30]);

/** Max data bytes per pkt-line payload after the 0x01 side-band byte (65520 total line − 4 len − 1). */
const SIDEBAND64K_MAX_CHUNK = 65515;

/** Default cap: shallow clones of large repos can still exceed 64 MiB; override with window.JSH_GIT_MAX_PACK_BYTES. */
const DEFAULT_MAX_UPLOAD_PACK_BYTES = 128 * 1024 * 1024;
const ABS_MAX_UPLOAD_PACK_BYTES = 512 * 1024 * 1024;

function maxUploadPackBytes() {
  try {
    const w = typeof window !== 'undefined' && window.JSH_GIT_MAX_PACK_BYTES;
    const n = Number(w);
    if (Number.isFinite(n) && n >= 8 * 1024 * 1024) {
      return Math.min(Math.floor(n), ABS_MAX_UPLOAD_PACK_BYTES);
    }
  } catch (_) {
    /* ignore */
  }
  return DEFAULT_MAX_UPLOAD_PACK_BYTES;
}

/**
 * One buffer for the whole synthetic side-band stream. A generator that yields thousands of
 * 64 KiB pkt-lines makes isomorphic-git's collect() hold huge temporary churn → Aw, Snap (OOM).
 */
function buildSyntheticSideband64k(packSlice) {
  const max = SIDEBAND64K_MAX_CHUNK;
  let total = 4;
  for (let o = 0; o < packSlice.length; o += max) {
    const clen = Math.min(max, packSlice.length - o);
    total += 4 + (1 + clen);
  }
  const out = new Uint8Array(total);
  let w = 0;
  for (let o = 0; o < packSlice.length; o += max) {
    const chunk = packSlice.subarray(o, Math.min(o + max, packSlice.length));
    const lineLen = 4 + 1 + chunk.length;
    const hex = lineLen.toString(16).padStart(4, '0');
    out[w] = hex.charCodeAt(0);
    out[w + 1] = hex.charCodeAt(1);
    out[w + 2] = hex.charCodeAt(2);
    out[w + 3] = hex.charCodeAt(3);
    w += 4;
    out[w] = 1;
    w += 1;
    out.set(chunk, w);
    w += chunk.length;
  }
  out.set(GIT_PKT_FLUSH, w);
  return out;
}

/**
 * @param {Uint8Array} raw
 * @returns {Promise<{ body: AsyncIterable<Uint8Array> }>}
 */
async function uploadPackBodyStreamForIsoGit(raw) {
  const willWrap = isRawPackFileFromStart(raw);
  jshGitTrace('upload-pack response', {
    totalBytes: raw.length,
    rawPackFromByte0: willWrap,
    rewrapAsSideband64k: willWrap,
    headHex: bytesHexPreview(raw)
  });
  if (!willWrap) {
    return { body: singleChunk(raw) };
  }
  jshGitTrace('upload-pack rewrap', { prefixBytes: 0, packBytes: raw.length });
  const rewritten = buildSyntheticSideband64k(raw);
  return { body: singleChunk(rewritten) };
}

async function responseToGitBody(res) {
  if (res.body && res.body.getReader) {
    return (async function* () {
      const reader = res.body.getReader();
      try {
        let r;
        do {
          r = await reader.read();
          if (r.value && r.value.byteLength) {
            yield r.value;
          }
        } while (!r.done);
      } finally {
        reader.releaseLock();
      }
    })();
  }
  return singleChunk(new Uint8Array(await res.arrayBuffer()));
}

/**
 * @param {{ corsProxyBase?: string, getAbortSignal?: () => AbortSignal | null | undefined }} [opts] - must match git's corsProxy so POST/GET are not double-proxied
 * @returns {{ request: (req: object) => Promise<object> }}
 */
export function createJshGitHttp(opts) {
  const corsProxyBase =
    opts && opts.corsProxyBase ? String(opts.corsProxyBase).replace(/\/+$/, '') : '';
  const getUserAbortSignal =
    opts && typeof opts.getAbortSignal === 'function' ? opts.getAbortSignal : null;
  const isForwardProxyUrl = makeForwardProxyChecker(corsProxyBase || undefined);
  return {
    async request({ url, method = 'GET', headers = {}, body }) {
      const upper = String(method).toUpperCase();
      const collected = await collectBody(body);
      const targetUrl = rewriteThroughCorsProxy(url, corsProxyBase);
      const forward = isForwardProxyUrl(targetUrl);
      const postNeedsBody =
        String(method).toUpperCase() === 'POST' &&
        (urlPathnameIncludesGitUploadPack(targetUrl) ||
          urlPathnameIncludesGitReceivePack(targetUrl));
      if (postNeedsBody && !(collected && collected.byteLength)) {
        throw new Error(
          'git smart HTTP POST had empty body (isomorphic-git passes an iterable body; jsh-git-http collectBody must consume it)'
        );
      }

      const runFetch = async () => {
        jshGitTrace('fetch', upper, { url: targetUrl, forwardProxy: forward });
        const userSig = getUserAbortSignal ? getUserAbortSignal() : null;

        const headerTimeoutCtrl = new AbortController();
        const headerTimeoutId = setTimeout(() => headerTimeoutCtrl.abort(), 600000);
        const signals = [headerTimeoutCtrl.signal];
        if (userSig) signals.push(userSig);
        const fetchSignal =
          typeof AbortSignal.any === 'function'
            ? AbortSignal.any(signals)
            : headerTimeoutCtrl.signal;

        const init = {
          method: upper,
          headers: { ...headers },
          signal: fetchSignal,
          mode: 'cors'
        };
        if (collected && collected.byteLength) {
          init.body = collected;
        }
        jshGitTrace('request body', {
          method: upper,
          collectedBytes: collected ? collected.byteLength : 0
        });

        let res;
        const fetchStartMs = Date.now();
        try {
          console.log('[jsh-git-http] fetch START', upper, targetUrl.slice(0, 120));
          res = await fetch(targetUrl, /** @type {RequestInit} */ (init));
        } catch (err) {
          clearTimeout(headerTimeoutId);
          console.error('[jsh-git-http] fetch FAILED', upper, targetUrl.slice(0, 120), err);
          const hint =
            err.name === 'TypeError' && !forward
              ? ' (set JSH_GIT_CORS_PROXY or use default cors proxy — see git --help)'
              : '';
          throw new Error(`${err.message || err}${hint}`);
        }
        clearTimeout(headerTimeoutId);
        console.log(
          '[jsh-git-http] fetch headers received in',
          ((Date.now() - fetchStartMs) / 1000).toFixed(1) + 's',
          'status=' + res.status
        );

        let body;
        if (
          upper === 'POST' &&
          res.body &&
          urlPathnameIncludesGitUploadPack(res.url || targetUrl)
        ) {
          console.log('[jsh-git-http] streaming upload-pack response body...');
          body = streamUploadPackResponse(res);
        } else {
          body = await responseToGitBody(res);
        }

        console.log(
          '[jsh-git-http] fetch COMPLETE in',
          ((Date.now() - fetchStartMs) / 1000).toFixed(1) + 's',
          upper,
          targetUrl.slice(0, 80)
        );
        return {
          url: res.url,
          method: upper,
          statusCode: res.status,
          statusMessage: res.statusText,
          headers: headersToObject(res.headers),
          body
        };
      };

      if (forward) {
        return runFetch();
      }

      if (upper === 'GET' && !collected && !isGitSmartHttpUrl(url)) {
        const proxy = typeof window !== 'undefined' ? window.proxyService : undefined;
        if (proxy && typeof proxy.fetchBinaryWithProxy === 'function') {
          try {
            const bytes = await proxy.fetchBinaryWithProxy(targetUrl, {
              headers: { ...headers },
              timeout: proxy.binaryTimeoutMs || 25000,
              maxRetries: 2
            });
            return {
              url: targetUrl,
              method: upper,
              statusCode: 200,
              statusMessage: 'OK',
              headers: {
                'content-type':
                  headers.accept || headers.Accept || 'application/x-git-upload-pack-advertisement'
              },
              body: singleChunk(bytes)
            };
          } catch (proxyErr) {
            console.warn(
              '[jsh-git-http] proxy fetch failed, falling through to direct fetch:',
              proxyErr.message || proxyErr
            );
          }
        }
      }

      return runFetch();
    }
  };
}
