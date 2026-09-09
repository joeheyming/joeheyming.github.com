import {
  ENGINES,
  NARRATION,
  autoRedirects,
  buildShareUrl,
  destinationUrl,
  openingCopy,
  parseRequest,
  parseTo,
  playerHeading,
  promptPlaceholder,
  radioValue,
  shouldSkipAnimation,
  typingDelayMs
} from './lmatfy.js';

const PUNCHLINE_HOLD_MS = 2600;

/** Bumping this cancels any in-flight playback (Skip, Make another, restart). */
let playToken = 0;
/** @type {{ query: string, engines: import('./lmatfy.js').EngineId[], preview: boolean } | null} */
let playing = null;

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

const promptInput = () => /** @type {HTMLTextAreaElement} */ ($('prompt'));
const shareInput = () => /** @type {HTMLInputElement} */ ($('share-url'));

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function selectedEngines() {
  const checked = document.querySelector('input[name="engine"]:checked');
  return parseTo(checked instanceof HTMLInputElement ? checked.value : 'chatgpt');
}

function currentQuery() {
  return promptInput().value.trim();
}

function setNarrator(text, tone) {
  const strip = $('narrator');
  strip.textContent = text;
  strip.dataset.tone = tone || 'idle';
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Repaint the fake chat chrome for whichever engine is selected. */
function applyEngine(engines) {
  document.body.dataset.engine = engines.length > 1 ? 'all' : engines[0];
  $('brand').textContent = engines.length > 1 ? 'Ask an AI' : ENGINES[engines[0]].label;
  $('greeting').textContent = playerHeading(engines);
  promptInput().placeholder = promptPlaceholder(engines);
}

function hideShare() {
  $('share').hidden = true;
  shareInput().value = '';
}

function showShare(query, engines) {
  shareInput().value = buildShareUrl({ query, engines, origin: window.location.origin });
  $('share').hidden = false;
}

/** Replace the punchline buttons with one "Open X" link per destination. */
function renderDestinations(engines, query) {
  const actions = $('destinations');
  actions.replaceChildren();
  for (const id of engines) {
    const link = document.createElement('a');
    link.className = 'destination';
    link.href = destinationUrl(id, query);
    link.rel = 'noopener noreferrer';
    link.textContent = `Open ${ENGINES[id].label}`;
    actions.append(link);
  }
  actions.hidden = false;
}

function moveCursorTo(target, duration) {
  const cursor = $('cursor');
  const stageBox = $('stage').getBoundingClientRect();
  const box = target.getBoundingClientRect();
  const x = box.left - stageBox.left + Math.min(28, box.width * 0.5);
  const y = box.top - stageBox.top + box.height * 0.6;
  cursor.style.transitionDuration = `${duration}ms`;
  cursor.style.transform = `translate(${x}px, ${y}px)`;
  return delay(duration);
}

async function pressSend() {
  $('cursor').classList.add('is-clicking');
  $('send').classList.add('is-pressed');
  await delay(160);
  $('cursor').classList.remove('is-clicking');
  $('send').classList.remove('is-pressed');
}

async function typeInto(query, token) {
  const field = promptInput();
  field.value = '';
  const step = typingDelayMs(query.length);
  for (let i = 1; i <= query.length; i += 1) {
    if (token !== playToken) return;
    field.value = query.slice(0, i);
    await delay(step);
  }
}

function enterPlaybackMode() {
  $('authoring').hidden = true;
  $('playback-bar').hidden = false;
  $('cursor').hidden = false;
  promptInput().readOnly = true;
  hideShare();
  $('destinations').hidden = true;
}

function exitPlaybackMode() {
  playToken += 1;
  playing = null;
  // Drop ?q= so a reload starts fresh instead of replaying the joke.
  if (window.location.search) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  $('authoring').hidden = false;
  $('playback-bar').hidden = true;
  $('cursor').hidden = true;
  $('destinations').hidden = true;
  promptInput().readOnly = false;
  promptInput().value = '';
  hideShare();
  setNarrator(NARRATION.authorIdle);
  applyEngine(selectedEngines());
}

/** Land the punchline, then send them where they were too lazy to go. */
async function finish(engines, query, preview) {
  setNarrator(NARRATION.playPunchline, 'punchline');
  $('opening').textContent = openingCopy(engines);
  renderDestinations(engines, query);
  if (preview || !autoRedirects(engines)) return;
  await delay(PUNCHLINE_HOLD_MS);
  window.location.assign(destinationUrl(engines[0], query));
}

async function play(request) {
  playing = request;
  const token = ++playToken;
  enterPlaybackMode();
  applyEngine(request.engines);

  if (shouldSkipAnimation(request.instant, reducedMotion())) {
    promptInput().value = request.query;
    await finish(request.engines, request.query, request.preview);
    return;
  }

  setNarrator(NARRATION.playTyping);
  const cursor = $('cursor');
  cursor.style.transitionDuration = '0ms';
  cursor.style.transform = 'translate(40px, 260px)';
  await delay(300);
  if (token !== playToken) return;

  await moveCursorTo($('prompt-box'), 560);
  if (token !== playToken) return;
  await delay(200);
  await typeInto(request.query, token);
  if (token !== playToken) return;

  await delay(300);
  await moveCursorTo($('send'), 400);
  if (token !== playToken) return;
  await pressSend();
  await delay(240);
  if (token !== playToken) return;

  await finish(request.engines, request.query, request.preview);
}

function skipToEnd() {
  if (!playing) return;
  const { engines, query, preview } = playing;
  playToken += 1;
  promptInput().value = query;
  // Redirect from the click gesture itself so the browser never blocks it.
  setNarrator(NARRATION.playPunchline, 'punchline');
  $('opening').textContent = openingCopy(engines);
  renderDestinations(engines, query);
  if (!preview && autoRedirects(engines)) {
    window.location.assign(destinationUrl(engines[0], query));
  }
}

function bindAuthoring() {
  for (const input of document.querySelectorAll('input[name="engine"]')) {
    input.addEventListener('change', () => {
      const engines = selectedEngines();
      applyEngine(engines);
      if (!$('share').hidden && currentQuery()) showShare(currentQuery(), engines);
    });
  }

  promptInput().addEventListener('input', () => {
    if (!$('share').hidden) hideShare();
    $('copy').textContent = 'Copy URL';
    setNarrator(NARRATION.authorIdle);
  });

  $('compose').addEventListener('submit', async (event) => {
    event.preventDefault();
    // The recipient can click the mock send button mid-animation; that must
    // not run the authoring flow and stomp the narrator.
    if (playing) return;
    const query = currentQuery();
    if (!query) {
      setNarrator('You have to actually ask something.', 'warn');
      promptInput().focus();
      return;
    }
    const engines = selectedEngines();
    showShare(query, engines);
    setNarrator(NARRATION.authorDone, 'done');
    const copied = await copyText(shareInput().value);
    $('copy').textContent = copied ? 'Copied!' : 'Copy URL';
  });

  $('copy').addEventListener('click', async () => {
    const url = shareInput().value;
    if (!url) return;
    const copied = await copyText(url);
    $('copy').textContent = copied ? 'Copied!' : 'Copy URL';
  });

  $('preview').addEventListener('click', () => {
    const query = currentQuery();
    if (!query) {
      setNarrator('You have to actually ask something.', 'warn');
      promptInput().focus();
      return;
    }
    play({ query, engines: selectedEngines(), instant: false, preview: true });
  });

  $('skip').addEventListener('click', skipToEnd);
  $('restart').addEventListener('click', exitPlaybackMode);
}

function boot() {
  bindAuthoring();
  const request = parseRequest(window.location.search);
  if (!request.query) {
    applyEngine(selectedEngines());
    setNarrator(NARRATION.authorIdle);
    return;
  }

  const radio = document.querySelector(
    `input[name="engine"][value="${radioValue(request.engines)}"]`
  );
  if (radio instanceof HTMLInputElement) radio.checked = true;
  play({ ...request, preview: false });
}

boot();
