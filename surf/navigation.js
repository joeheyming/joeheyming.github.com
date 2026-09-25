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

  return { NavigationHistory, decorateHtml, isSameOrigin, normalizeAddress };
});
