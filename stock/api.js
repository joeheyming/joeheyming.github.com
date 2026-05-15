// Stock Ticker API — talks to Yahoo Finance through window.proxyService.
//
// We never hit Yahoo directly (CORS blocks GitHub Pages), so every request is funneled
// through /proxy.js with skipDirect: true.
//
// All endpoints return JSON; the proxy returns raw text, so we JSON.parse on this side.

/**
 * @typedef {Object} OHLCPoint
 * @property {number} t       Unix ms timestamp.
 * @property {number} [o]     Open.
 * @property {number} [h]     High.
 * @property {number} [l]     Low.
 * @property {number} c       Close (always present).
 * @property {number} [v]     Volume.
 */

/**
 * @typedef {Object} StockMeta
 * @property {string} symbol
 * @property {string} [shortName]
 * @property {string} [longName]
 * @property {string} [currency]
 * @property {string} [exchangeName]
 * @property {number} [regularMarketPrice]
 * @property {number} [chartPreviousClose]
 * @property {number} [regularMarketDayHigh]
 * @property {number} [regularMarketDayLow]
 * @property {number} [regularMarketVolume]
 * @property {number} [fiftyTwoWeekHigh]
 * @property {number} [fiftyTwoWeekLow]
 * @property {number} [firstTradeDate]      Unix seconds.
 * @property {string} [instrumentType]
 */

/**
 * @typedef {Object} ChartSeries
 * @property {string} symbol
 * @property {StockMeta} meta
 * @property {OHLCPoint[]} points
 */

/**
 * @typedef {Object} SearchHit
 * @property {string} symbol
 * @property {string} name
 * @property {string} exchange
 * @property {string} type
 */

/**
 * @typedef {Object} NewsItem
 * @property {string} title
 * @property {string} url
 * @property {string} publisher
 * @property {number} publishedAtMs
 */

/**
 * @typedef {Object} ExtendedQuote   Raw-ish quote summary suitable for a "stats" panel.
 * @property {string} symbol
 * @property {string} [shortName]
 * @property {string} [longName]
 * @property {string} [currency]
 * @property {string} [exchange]
 * @property {string} [marketState]
 * @property {number} [regularMarketPrice]
 * @property {number} [regularMarketChange]
 * @property {number} [regularMarketChangePercent]
 * @property {number} [regularMarketDayHigh]
 * @property {number} [regularMarketDayLow]
 * @property {number} [regularMarketOpen]
 * @property {number} [regularMarketPreviousClose]
 * @property {number} [regularMarketVolume]
 * @property {number} [averageDailyVolume3Month]
 * @property {number} [averageDailyVolume10Day]
 * @property {number} [marketCap]
 * @property {number} [trailingPE]
 * @property {number} [forwardPE]
 * @property {number} [priceToBook]
 * @property {number} [dividendYield]
 * @property {number} [trailingAnnualDividendYield]
 * @property {number} [dividendRate]
 * @property {number} [trailingAnnualDividendRate]
 * @property {number} [fiftyTwoWeekHigh]
 * @property {number} [fiftyTwoWeekLow]
 * @property {number} [fiftyTwoWeekHighChangePercent]
 * @property {number} [fiftyTwoWeekLowChangePercent]
 * @property {number} [fiftyDayAverage]
 * @property {number} [twoHundredDayAverage]
 * @property {number} [beta]
 * @property {number} [epsTrailingTwelveMonths]
 * @property {number} [epsForward]
 * @property {number} [bookValue]
 * @property {number} [sharesOutstanding]
 * @property {number} [floatShares]
 * @property {number} [bid]
 * @property {number} [ask]
 * @property {number} [preMarketPrice]
 * @property {number} [preMarketChange]
 * @property {number} [preMarketChangePercent]
 * @property {number} [postMarketPrice]
 * @property {number} [postMarketChange]
 * @property {number} [postMarketChangePercent]
 * @property {number} [earningsTimestamp]
 * @property {string} [quoteType]
 */

const YF_SEARCH = 'https://query2.finance.yahoo.com/v1/finance/search';
const YF_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YF_QUOTE = 'https://query1.finance.yahoo.com/v7/finance/quote';
const YF_QUOTE_SUMMARY = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary';

function requireProxy() {
  if (!window.proxyService || typeof window.proxyService.fetchWithProxy !== 'function') {
    throw new Error('proxy.js not loaded — window.proxyService unavailable');
  }
  return window.proxyService;
}

function buildUrl(base, params) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${base}?${qs}` : base;
}

/**
 * Search Yahoo Finance for matching tickers/companies. Also returns news hits.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {number} [opts.newsCount]   How many news items to include (0 by default).
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ hits: SearchHit[], news: NewsItem[] }>}
 */
export async function searchTickersFull(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return { hits: [], news: [] };

  const url = buildUrl(YF_SEARCH, {
    q,
    quotesCount: 10,
    newsCount: opts.newsCount ?? 0,
    lang: 'en-US',
    region: 'US'
  });

  const proxy = requireProxy();
  const text = await proxy.fetchWithProxy(url, {
    skipDirect: true,
    timeout: 12000,
    maxRetries: 1,
    signal: opts.signal
  });

  /** @type {{ quotes?: any[], news?: any[] }} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Search returned non-JSON response');
  }

  const hits = Array.isArray(data.quotes)
    ? data.quotes
        .map((q) => ({
          symbol: String(q.symbol || ''),
          name: String(q.longname || q.shortname || q.name || ''),
          exchange: String(q.exchDisp || q.exchange || ''),
          type: String(q.typeDisp || q.quoteType || '')
        }))
        .filter((hit) => hit.symbol)
    : [];

  const news = Array.isArray(data.news)
    ? data.news
        .map((n) => ({
          title: String(n.title || ''),
          url: String(n.link || n.url || ''),
          publisher: String(n.publisher || ''),
          publishedAtMs:
            typeof n.providerPublishTime === 'number'
              ? n.providerPublishTime * 1000
              : Number(n.providerPublishTime) || 0
        }))
        .filter((n) => n.title && n.url)
    : [];

  return { hits, news };
}

/** Convenience wrapper that returns just the ticker hits. */
export async function searchTickers(query, opts = {}) {
  const { hits } = await searchTickersFull(query, opts);
  return hits;
}

/** Convenience wrapper that returns just the news items for a ticker. */
export async function fetchNews(symbolOrQuery, opts = {}) {
  const { news } = await searchTickersFull(symbolOrQuery, {
    newsCount: opts.count ?? 8,
    signal: opts.signal
  });
  return news;
}

/**
 * Map a UI range preset to Yahoo's `range` + `interval` query params.
 *
 * @param {string} rangeId  '1d','5d','1mo','3mo','6mo','1y','5y','max'.
 */
export function rangeToYahooParams(rangeId) {
  switch (rangeId) {
    case '1d':
      return { range: '1d', interval: '5m' };
    case '5d':
      return { range: '5d', interval: '30m' };
    case '1mo':
      return { range: '1mo', interval: '90m' };
    case '3mo':
      return { range: '3mo', interval: '1d' };
    case '6mo':
      return { range: '6mo', interval: '1d' };
    case '1y':
      return { range: '1y', interval: '1d' };
    case '5y':
      return { range: '5y', interval: '1wk' };
    case 'max':
      return { range: 'max', interval: '1mo' };
    default:
      return { range: '1mo', interval: '1d' };
  }
}

/**
 * Fetch OHLC + volume for a single ticker.
 *
 * @param {string} symbol
 * @param {string} rangeId
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<ChartSeries>}
 */
export async function fetchChart(symbol, rangeId, opts = {}) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('symbol is required');

  const { range, interval } = rangeToYahooParams(rangeId);
  const url = buildUrl(`${YF_CHART}/${encodeURIComponent(sym)}`, {
    range,
    interval,
    includePrePost: 'false',
    events: 'div,splits'
  });

  const proxy = requireProxy();
  const text = await proxy.fetchWithProxy(url, {
    skipDirect: true,
    timeout: 15000,
    maxRetries: 2,
    signal: opts.signal
  });

  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Chart for ${sym} returned non-JSON response`);
  }

  const result = data?.chart?.result?.[0];
  const err = data?.chart?.error;
  if (err) {
    throw new Error(err.description || err.code || `No data for ${sym}`);
  }
  if (!result) {
    throw new Error(`No chart data for ${sym}`);
  }

  const ts = Array.isArray(result.timestamp) ? result.timestamp : [];
  const q = result.indicators?.quote?.[0] || {};
  const adjclose = result.indicators?.adjclose?.[0]?.adjclose;

  /** @type {OHLCPoint[]} */
  const points = [];
  for (let i = 0; i < ts.length; i++) {
    // Prefer adj close (handles splits/divs); fall back to raw close.
    const close = typeof adjclose?.[i] === 'number' ? adjclose[i] : q.close?.[i];
    if (typeof close !== 'number' || !Number.isFinite(close)) continue;
    /** @type {OHLCPoint} */
    const p = { t: ts[i] * 1000, c: close };
    if (typeof q.open?.[i] === 'number') p.o = q.open[i];
    if (typeof q.high?.[i] === 'number') p.h = q.high[i];
    if (typeof q.low?.[i] === 'number') p.l = q.low[i];
    if (typeof q.volume?.[i] === 'number') p.v = q.volume[i];
    points.push(p);
  }

  const meta = result.meta || {};
  /** @type {StockMeta} */
  const out = {
    symbol: String(meta.symbol || sym),
    shortName: meta.shortName,
    longName: meta.longName,
    currency: meta.currency,
    exchangeName: meta.exchangeName || meta.fullExchangeName,
    regularMarketPrice:
      typeof meta.regularMarketPrice === 'number'
        ? meta.regularMarketPrice
        : points.length
          ? points[points.length - 1].c
          : undefined,
    chartPreviousClose:
      typeof meta.chartPreviousClose === 'number'
        ? meta.chartPreviousClose
        : typeof meta.previousClose === 'number'
          ? meta.previousClose
          : undefined,
    regularMarketDayHigh:
      typeof meta.regularMarketDayHigh === 'number' ? meta.regularMarketDayHigh : undefined,
    regularMarketDayLow:
      typeof meta.regularMarketDayLow === 'number' ? meta.regularMarketDayLow : undefined,
    regularMarketVolume:
      typeof meta.regularMarketVolume === 'number' ? meta.regularMarketVolume : undefined,
    fiftyTwoWeekHigh:
      typeof meta.fiftyTwoWeekHigh === 'number' ? meta.fiftyTwoWeekHigh : undefined,
    fiftyTwoWeekLow:
      typeof meta.fiftyTwoWeekLow === 'number' ? meta.fiftyTwoWeekLow : undefined,
    firstTradeDate:
      typeof meta.firstTradeDate === 'number' ? meta.firstTradeDate : undefined,
    instrumentType: typeof meta.instrumentType === 'string' ? meta.instrumentType : undefined
  };

  return { symbol: out.symbol, meta: out, points };
}

/**
 * Fetch charts for multiple symbols in parallel.
 *
 * @param {string[]} symbols
 * @param {string} rangeId
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Array<{ symbol: string, series?: ChartSeries, error?: string }>>}
 */
export async function fetchManyCharts(symbols, rangeId, opts = {}) {
  return Promise.all(
    symbols.map(async (sym) => {
      try {
        const series = await fetchChart(sym, rangeId, opts);
        return { symbol: sym, series };
      } catch (err) {
        return { symbol: sym, error: err?.message || String(err) };
      }
    })
  );
}

/**
 * Fetch extended quote stats (market cap, P/E, 52-week range, etc.) for one or more symbols.
 *
 * Yahoo's v7/quote endpoint has been sporadically crumb-gated since 2023 but typically
 * works through CORS proxies. On failure we return an empty array — callers should fall
 * back to data derived from the chart series.
 *
 * @param {string[]} symbols
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<ExtendedQuote[]>}
 */
export async function fetchQuotes(symbols, opts = {}) {
  const syms = symbols.map((s) => String(s).toUpperCase()).filter(Boolean);
  if (!syms.length) return [];

  const url = buildUrl(YF_QUOTE, {
    symbols: syms.join(','),
    lang: 'en-US',
    region: 'US',
    formatted: 'false',
    fields: [
      'symbol',
      'shortName',
      'longName',
      'currency',
      'exchange',
      'marketState',
      'regularMarketPrice',
      'regularMarketChange',
      'regularMarketChangePercent',
      'regularMarketDayHigh',
      'regularMarketDayLow',
      'regularMarketOpen',
      'regularMarketPreviousClose',
      'regularMarketVolume',
      'averageDailyVolume3Month',
      'averageDailyVolume10Day',
      'marketCap',
      'trailingPE',
      'forwardPE',
      'priceToBook',
      'dividendYield',
      'trailingAnnualDividendYield',
      'dividendRate',
      'trailingAnnualDividendRate',
      'fiftyTwoWeekHigh',
      'fiftyTwoWeekLow',
      'fiftyTwoWeekHighChangePercent',
      'fiftyTwoWeekLowChangePercent',
      'fiftyDayAverage',
      'twoHundredDayAverage',
      'beta',
      'epsTrailingTwelveMonths',
      'epsForward',
      'bookValue',
      'sharesOutstanding',
      'floatShares',
      'bid',
      'ask',
      'preMarketPrice',
      'preMarketChange',
      'preMarketChangePercent',
      'postMarketPrice',
      'postMarketChange',
      'postMarketChangePercent',
      'earningsTimestamp',
      'quoteType'
    ].join(',')
  });

  const proxy = requireProxy();
  /** @type {string} */
  let text;
  try {
    text = await proxy.fetchWithProxy(url, {
      skipDirect: true,
      timeout: 12000,
      maxRetries: 1,
      signal: opts.signal
    });
  } catch {
    return [];
  }

  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }

  const list = data?.quoteResponse?.result;
  if (!Array.isArray(list)) return [];
  return /** @type {ExtendedQuote[]} */ (list);
}

/** Pull a raw or .raw-wrapped numeric from quoteSummary modules. */
function _summ(obj) {
  if (obj == null) return undefined;
  if (typeof obj === 'number') return obj;
  if (typeof obj === 'object' && typeof obj.raw === 'number') return obj.raw;
  return undefined;
}

/**
 * Fallback stats fetcher using Yahoo's v10/quoteSummary endpoint. Returns at most
 * one quote (per symbol). Crumb-gated more loosely than v7/quote — usually works
 * for `summaryDetail`, `price`, and `defaultKeyStatistics` modules.
 *
 * @param {string} symbol
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<ExtendedQuote|null>}
 */
export async function fetchQuoteSummary(symbol, opts = {}) {
  const sym = String(symbol).toUpperCase();
  if (!sym) return null;

  const url = buildUrl(`${YF_QUOTE_SUMMARY}/${encodeURIComponent(sym)}`, {
    modules: 'price,summaryDetail,defaultKeyStatistics',
    lang: 'en-US',
    region: 'US',
    formatted: 'false'
  });

  const proxy = requireProxy();
  /** @type {string} */
  let text;
  try {
    text = await proxy.fetchWithProxy(url, {
      skipDirect: true,
      timeout: 10000,
      maxRetries: 1,
      signal: opts.signal
    });
  } catch {
    return null;
  }

  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  const r = data?.quoteSummary?.result?.[0];
  if (!r) return null;

  const price = r.price || {};
  const sumDet = r.summaryDetail || {};
  const stats = r.defaultKeyStatistics || {};

  /** @type {ExtendedQuote} */
  const out = {
    symbol: String(price.symbol || sym),
    shortName: typeof price.shortName === 'string' ? price.shortName : undefined,
    longName: typeof price.longName === 'string' ? price.longName : undefined,
    currency: typeof price.currency === 'string' ? price.currency : undefined,
    exchange: typeof price.exchangeName === 'string' ? price.exchangeName : undefined,
    marketState: typeof price.marketState === 'string' ? price.marketState : undefined,
    regularMarketPrice: _summ(price.regularMarketPrice),
    regularMarketChange: _summ(price.regularMarketChange),
    regularMarketChangePercent:
      _summ(price.regularMarketChangePercent) != null
        ? /** @type {number} */ (_summ(price.regularMarketChangePercent)) * 100
        : undefined,
    regularMarketDayHigh: _summ(price.regularMarketDayHigh) ?? _summ(sumDet.dayHigh),
    regularMarketDayLow: _summ(price.regularMarketDayLow) ?? _summ(sumDet.dayLow),
    regularMarketOpen: _summ(price.regularMarketOpen) ?? _summ(sumDet.open),
    regularMarketPreviousClose:
      _summ(price.regularMarketPreviousClose) ?? _summ(sumDet.previousClose),
    regularMarketVolume: _summ(price.regularMarketVolume) ?? _summ(sumDet.regularMarketVolume),
    averageDailyVolume3Month:
      _summ(sumDet.averageVolume) ?? _summ(sumDet.averageDailyVolume3Month),
    averageDailyVolume10Day:
      _summ(sumDet.averageVolume10days) ?? _summ(sumDet.averageDailyVolume10Day),
    marketCap: _summ(price.marketCap) ?? _summ(sumDet.marketCap),
    trailingPE: _summ(sumDet.trailingPE),
    forwardPE: _summ(sumDet.forwardPE),
    priceToBook: _summ(stats.priceToBook),
    dividendYield: _summ(sumDet.dividendYield),
    trailingAnnualDividendYield: _summ(sumDet.trailingAnnualDividendYield),
    dividendRate: _summ(sumDet.dividendRate),
    trailingAnnualDividendRate: _summ(sumDet.trailingAnnualDividendRate),
    fiftyTwoWeekHigh: _summ(sumDet.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: _summ(sumDet.fiftyTwoWeekLow),
    fiftyDayAverage: _summ(sumDet.fiftyDayAverage),
    twoHundredDayAverage: _summ(sumDet.twoHundredDayAverage),
    beta: _summ(stats.beta) ?? _summ(sumDet.beta),
    epsTrailingTwelveMonths: _summ(stats.trailingEps),
    epsForward: _summ(stats.forwardEps),
    bookValue: _summ(stats.bookValue),
    sharesOutstanding: _summ(stats.sharesOutstanding),
    floatShares: _summ(stats.floatShares),
    bid: _summ(sumDet.bid),
    ask: _summ(sumDet.ask),
    earningsTimestamp: _summ(price.regularMarketTime),
    quoteType: typeof price.quoteType === 'string' ? price.quoteType : undefined
  };
  return out;
}

/**
 * Fetch extended quotes with graceful fallback chain:
 *   1. v7/finance/quote (batch) — most complete, often rate-limited.
 *   2. v10/finance/quoteSummary (per-symbol) — slower but more reliable.
 *
 * @param {string[]} symbols
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<ExtendedQuote[]>}
 */
export async function fetchQuotesWithFallback(symbols, opts = {}) {
  const primary = await fetchQuotes(symbols, opts);
  if (primary.length) return primary;
  const fallbacks = await Promise.all(
    symbols.map((s) => fetchQuoteSummary(s, opts).catch(() => null))
  );
  return /** @type {ExtendedQuote[]} */ (fallbacks.filter(Boolean));
}
