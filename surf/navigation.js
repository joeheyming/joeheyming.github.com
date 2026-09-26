/* Pure navigation helpers shared by Surf and its browser-free tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SurfNavigation = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function normalizeAddress(value, baseHref) {
    const input = String(value || '').trim();
    if (!input) {
      throw new Error('Enter a web address.');
    }
    if (/\s/.test(input)) {
      throw new Error('Web addresses cannot contain spaces.');
    }

    let candidate = input;
    if (
      !/^[a-z][a-z\d+.-]*:/i.test(candidate) &&
      !candidate.startsWith('/') &&
      !candidate.startsWith('./') &&
      !candidate.startsWith('../')
    ) {
      candidate = `https://${candidate}`;
    }

    let url;
    try {
      url = new URL(candidate, baseHref);
    } catch {
      throw new Error('That web address is not valid.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Surf supports HTTP and HTTPS addresses.');
    }
    return url.href;
  }

  /**
   * Below this much visible text, a page is almost certainly a JavaScript
   * application rather than a document. DuckDuckGo's homepage ships 212KB
   * of HTML around ~487 characters of text; Hacker News has ~4k and
   * Wikipedia ~30k. Nothing useful renders from the first kind.
   */
  const MIN_RENDERABLE_TEXT = 700;

  /**
   * Strip what the preview frame cannot honor.
   *
   * The frame has an opaque origin, so page scripts cannot reach cookies,
   * storage, or their own APIs — they throw partway through startup and
   * leave a blank page. Removing them renders more, not less. `<noscript>`
   * holds the site's own no-JavaScript fallback, so it gets promoted.
   */
  function sanitizeDocument(doc, options) {
    const allowScripts = Boolean(options && options.allowScripts);

    if (!allowScripts) {
      doc.querySelectorAll('script').forEach((el) => el.remove());
      doc.querySelectorAll('noscript').forEach((el) => {
        const holder = doc.createElement('div');
        holder.innerHTML = el.childElementCount ? el.innerHTML : el.textContent;
        el.replaceWith(...holder.childNodes);
      });
      doc.querySelectorAll('*').forEach((el) => {
        for (const attr of [...el.attributes]) {
          if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
        }
      });
      doc.querySelectorAll('a[href^="javascript:" i]').forEach((el) => el.removeAttribute('href'));
    }

    // The frame inherits an HTTPS page, so insecure subresources are blocked
    // outright. Nearly every host serves the same asset over TLS.
    for (const attr of ['src', 'href']) {
      doc.querySelectorAll(`[${attr}^="http://" i]`).forEach((el) => {
        el.setAttribute(attr, el.getAttribute(attr).replace(/^http:\/\//i, 'https://'));
      });
    }
    return doc;
  }

  /** Visible text, used to tell a document apart from an empty app shell. */
  function extractVisibleText(doc) {
    if (!doc.body) return '';
    const clone = doc.body.cloneNode(true);
    clone.querySelectorAll('script, style, template, noscript').forEach((el) => el.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isSameOrigin(url, baseHref) {
    try {
      return new URL(url, baseHref).origin === new URL(baseHref).origin;
    } catch {
      return false;
    }
  }

  function escapeAttribute(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function decorateHtml(html, pageUrl) {
    const source = String(html || '');
    const base = /<base\b/i.test(source) ? '' : `<base href="${escapeAttribute(pageUrl)}">`;
    const bridge = `<script>
(function () {
  // The preview frame is sandboxed without allow-same-origin, so it has an
  // opaque origin where even reading window.localStorage throws. Pages that
  // touch storage at startup would die on their first line, so stand in with
  // an in-memory store that lasts as long as the page is on screen.
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try {
      if (window[name]) return;
    } catch (_) {
      /* Access threw — install the stand-in below. */
    }
    var data = Object.create(null);
    var store = {
      getItem: function (key) {
        var k = String(key);
        return k in data ? data[k] : null;
      },
      setItem: function (key, value) { data[String(key)] = String(value); },
      removeItem: function (key) { delete data[String(key)]; },
      clear: function () { data = Object.create(null); },
      key: function (index) {
        var keys = Object.keys(data);
        return index < keys.length ? keys[index] : null;
      }
    };
    Object.defineProperty(store, 'length', {
      get: function () { return Object.keys(data).length; }
    });
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return store; }
      });
    } catch (_) {
      /* Nothing else to try; the page keeps its own failure mode. */
    }
  });

  // document.cookie throws for the same reason. Sites commonly read it
  // during startup to restore a theme or locale, and an uncaught throw
  // there aborts the rest of their bootstrap.
  (function () {
    try {
      void document.cookie;
      return;
    } catch (_) {
      /* Fall through and install the jar. */
    }
    var jar = Object.create(null);
    function serialize() {
      return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
    }
    try {
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: serialize,
        set: function (value) {
          var pair = String(value).split(';')[0];
          var eq = pair.indexOf('=');
          if (eq < 1) return;
          jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
        }
      });
    } catch (_) {
      /* Leave the page's own failure mode in place. */
    }
  })();

  // An opaque origin cannot hold history state for a real URL, so routers
  // that call replaceState on load throw. Their navigation is meaningless
  // inside the preview anyway; swallowing it keeps the page alive.
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    if (typeof original !== 'function') return;
    history[name] = function () {
      try {
        return original.apply(history, arguments);
      } catch (_) {
        return undefined;
      }
    };
  });

  function send(url) {
    parent.postMessage({ type: 'surf-navigate', url: url }, '*');
  }
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download')) return;
    try {
      var url = new URL(link.href, document.baseURI);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      event.preventDefault();
      send(url.href);
    } catch (_) {
      /* Let malformed links behave normally. */
    }
  }, true);
  // GET forms are how search boxes work. Resolve them here so a query
  // becomes a Surf navigation instead of a framed cross-origin request
  // that the site's X-Frame-Options would refuse.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (event.defaultPrevented || !form || (form.method || 'get').toLowerCase() !== 'get') return;
    try {
      var url = new URL(form.action || document.baseURI, document.baseURI);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      url.search = new URLSearchParams(new FormData(form)).toString();
      event.preventDefault();
      send(url.href);
    } catch (_) {
      /* Fall back to the page's own submit handling. */
    }
  }, true);
})();
</script>`;
    const additions = `${base}${bridge}`;

    if (/<head[\s>]/i.test(source)) {
      return source.replace(/<head([^>]*)>/i, `<head$1>${additions}`);
    }
    if (/<html[\s>]/i.test(source)) {
      return source.replace(/<html([^>]*)>/i, `<html$1><head>${additions}</head>`);
    }
    return `<!doctype html><html><head>${additions}</head><body>${source}</body></html>`;
  }

  class NavigationHistory {
    constructor() {
      this.entries = [];
      this.index = -1;
    }

    get current() {
      return this.entries[this.index] || null;
    }

    get canGoBack() {
      return this.index > 0;
    }

    get canGoForward() {
      return this.index >= 0 && this.index < this.entries.length - 1;
    }

    push(entry) {
      this.entries.splice(this.index + 1);
      this.entries.push(entry);
      this.index = this.entries.length - 1;
      return this.current;
    }

    replace(entry) {
      if (this.index < 0) return this.push(entry);
      this.entries[this.index] = entry;
      return this.current;
    }

    back() {
      if (!this.canGoBack) return null;
      this.index -= 1;
      return this.current;
    }

    forward() {
      if (!this.canGoForward) return null;
      this.index += 1;
      return this.current;
    }
  }

  return {
    MIN_RENDERABLE_TEXT,
    NavigationHistory,
    decorateHtml,
    extractVisibleText,
    isSameOrigin,
    normalizeAddress,
    sanitizeDocument
  };
});
