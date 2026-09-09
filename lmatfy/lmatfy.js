/** Let Me Ask That For You — share-link + destination helpers. */

/** @typedef {'chatgpt' | 'gemini' | 'brave'} EngineId */

export const ENGINES = {
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    placeholder: 'Ask anything',
    destination: (query) => `https://chatgpt.com/?q=${encodeURIComponent(query)}`
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    placeholder: 'Ask Gemini',
    destination: (query) => `https://gemini.google.com/app?q=${encodeURIComponent(query)}`
  },
  brave: {
    id: 'brave',
    label: 'Ask Brave',
    placeholder: 'Ask anything',
    destination: (query) => `https://search.brave.com/ask?q=${encodeURIComponent(query)}`
  }
};

/** @type {EngineId[]} */
export const ENGINE_ORDER = ['chatgpt', 'gemini', 'brave'];

/**
 * Narrator copy for the strip under the prompt box. This is the joke, so the
 * beats mirror letmegooglethat.com rather than inventing new wording.
 */
export const NARRATION = {
  authorIdle: 'Type a question, click the button.',
  authorDone: 'All done! Share the link below.',
  playTyping: 'Step 1: Type in your question',
  playPunchline: 'Come on… Was that really so hard?'
};

const ALIASES = {
  chatgpt: 'chatgpt',
  gpt: 'chatgpt',
  openai: 'chatgpt',
  gemini: 'gemini',
  bard: 'gemini',
  google: 'gemini',
  brave: 'brave',
  ask: 'brave',
  'ask-brave': 'brave',
  askbrave: 'brave'
};

/**
 * @param {string | null | undefined} raw
 * @returns {EngineId[]}
 */
export function parseTo(raw) {
  const value = String(raw || 'chatgpt')
    .toLowerCase()
    .trim();
  if (value === 'all') return [...ENGINE_ORDER];
  if (value === 'both') return ['chatgpt', 'gemini'];
  const parts = value
    .split(/[+,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set();
  /** @type {EngineId[]} */
  const engines = [];
  for (const part of parts) {
    const id = ALIASES[part];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    engines.push(id);
  }
  return engines.length ? engines : ['chatgpt'];
}

/**
 * @param {EngineId[]} engines
 */
function isAllEngines(engines) {
  return engines.length === ENGINE_ORDER.length && ENGINE_ORDER.every((id) => engines.includes(id));
}

/**
 * @param {EngineId[]} engines
 */
export function serializeTo(engines) {
  if (isAllEngines(engines)) return 'all';
  if (engines.length > 1) return engines.join(',');
  return engines[0] || 'chatgpt';
}

/**
 * The engine radio group only offers single engines plus "all", so a
 * hand-written `to=chatgpt,brave` link has no matching control.
 * @param {EngineId[]} engines
 */
export function radioValue(engines) {
  return engines.length > 1 ? 'all' : engines[0] || 'chatgpt';
}

/**
 * @param {string} search
 */
export function parseRequest(search) {
  const trimmed = String(search || '');
  const params = new URLSearchParams(trimmed.startsWith('?') ? trimmed.slice(1) : trimmed);
  const query = (params.get('q') || params.get('query') || '').trim();
  const engines = parseTo(params.get('to') || params.get('engine'));
  const instant = params.get('instant') === '1' || params.get('skip') === '1';
  return { query, engines, instant };
}

/**
 * @param {{ query: string, engines: EngineId[], origin?: string }} opts
 */
export function buildShareUrl(opts) {
  const origin = opts.origin || 'https://joeheyming.github.io';
  const url = new URL('/lmatfy/', origin.endsWith('/') ? origin : `${origin}/`);
  url.searchParams.set('q', opts.query);
  url.searchParams.set('to', serializeTo(opts.engines));
  return url.href;
}

/**
 * @param {EngineId} engineId
 * @param {string} query
 */
export function destinationUrl(engineId, query) {
  const engine = ENGINES[engineId] || ENGINES.chatgpt;
  return engine.destination(query);
}

/**
 * @param {EngineId[]} engines
 * @param {string} query
 */
export function destinationUrls(engines, query) {
  return engines.map((id) => destinationUrl(id, query));
}

/**
 * A single engine auto-redirects, so the copy promises it. Multi-engine
 * cannot: popup blockers kill `window.open` calls made after the redirect
 * delay, so the recipient picks from the buttons instead.
 * @param {EngineId[]} engines
 */
export function openingCopy(engines) {
  if (engines.length === 1) return `Opening ${ENGINES[engines[0]].label}…`;
  return 'Pick one.';
}

/**
 * @param {EngineId[]} engines
 */
export function autoRedirects(engines) {
  return engines.length === 1;
}

/**
 * @param {EngineId[]} engines
 */
export function playerHeading(engines) {
  if (engines.length !== 1) return 'Let me ask that for you';
  const headings = {
    chatgpt: 'Let me ChatGPT that for you',
    gemini: 'Let me Gemini that for you',
    brave: 'Let me Brave that for you'
  };
  return headings[engines[0]] || 'Let me ask that for you';
}

/**
 * @param {EngineId[]} engines
 */
export function promptPlaceholder(engines) {
  if (engines.length !== 1) return 'Ask anything';
  return ENGINES[engines[0]]?.placeholder || 'Ask anything';
}

/**
 * @param {number} length
 * @param {number} [budget]
 */
export function typingDelayMs(length, budget = 2800) {
  return Math.max(16, Math.min(72, Math.round(budget / Math.max(1, length))));
}

/**
 * @param {boolean} instant
 * @param {boolean} reducedMotion
 */
export function shouldSkipAnimation(instant, reducedMotion) {
  return Boolean(instant || reducedMotion);
}
