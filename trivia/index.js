const UUID_KEY = 'trivia-uuid';
const ANSWERS_PREFIX = 'trivia-answers:';
const OPT_IN_KEY = 'trivia-opted-in'; // legacy; cleared on load — opt-in is per round, not persisted

/** @type {typeof window.HEYMING_TRIVIA_CONFIG} */
const cfg = window.HEYMING_TRIVIA_CONFIG;

const els = {
  banner: /** @type {HTMLElement} */ (document.getElementById('banner')),
  status: /** @type {HTMLElement} */ (document.getElementById('round-status')),
  timer: /** @type {HTMLElement} */ (document.getElementById('round-timer')),
  roundBar: /** @type {HTMLElement} */ (document.getElementById('round-bar')),
  stage: /** @type {HTMLElement} */ (document.getElementById('stage'))
};

/**
 * @typedef {'gate' | 'waiting' | 'playing' | 'results'} Phase
 */

/** @type {{
 *   round: ReturnType<typeof parseRound> | null,
 *   current: ReturnType<typeof parseCurrent>,
 *   tallies: Map<string, ReturnType<typeof parseTallyRow>>,
 *   allTallies: Map<string, ReturnType<typeof parseTallyRow>>,
 *   localAnswers: Record<string, string>,
 *   optedIn: boolean,
 *   phase: Phase,
 *   playRoundId: string | null,
 *   playQuestions: ReturnType<typeof parseCurrent>,
 *   waitUntilMs: number,
 *   waitOutQuestionIds: string
 * }} */
const state = {
  round: null,
  current: [],
  tallies: new Map(),
  allTallies: new Map(),
  localAnswers: {},
  optedIn: false,
  phase: 'gate',
  playRoundId: null,
  playQuestions: [],
  waitUntilMs: 0,
  waitOutQuestionIds: '',
  /** @type {Record<string, string>} */
  estimateDrafts: {}
};

let pollTimer = 0;
let tickTimer = 0;
let burstUntilMs = 0;
let refreshInFlight = null;
let lastPollAt = 0;
let lastViewSig = '';
let lastTallySig = '';
let submitting = new Set();

function activePollMs() {
  if (Date.now() < burstUntilMs) {
    return Number(cfg.pollBurstMs) || 1500;
  }
  if (!state.optedIn || state.phase === 'gate') {
    return Number(cfg.pollIdleMs) || 30000;
  }
  return Number(cfg.pollIntervalMs) || 3000;
}

function kickBurst(ms = Number(cfg.pollBurstForMs) || 12000) {
  burstUntilMs = Math.max(burstUntilMs, Date.now() + ms);
  schedulePoll();
}

function schedulePoll() {
  window.clearInterval(pollTimer);
  const ms = activePollMs();
  pollTimer = window.setInterval(() => {
    // Re-arm if burst ended / phase changed so interval stays correct.
    if (activePollMs() !== ms) {
      schedulePoll();
      return;
    }
    refresh().catch((err) => console.warn('Trivia poll failed', err));
  }, ms);
}

/**
 * @param {{ force?: boolean }} [opts]
 */
function refresh(opts = {}) {
  if (refreshInFlight) return refreshInFlight;
  if (!opts.force && Date.now() - lastPollAt < 400) {
    return Promise.resolve();
  }
  lastPollAt = Date.now();
  refreshInFlight = refreshBody()
    .catch((err) => {
      throw err;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function refreshBody() {
  const [roundTab, currentTab, talliesTab] = await Promise.all([
    fetchTab(cfg.roundTab || 'Round'),
    fetchTab(cfg.currentTab || 'Current'),
    fetchTab(cfg.talliesTab || 'Tallies')
  ]);

  const prevPhase = state.phase;
  const prevRoundId = state.round && state.round.roundId;

  state.round = parseRound(roundTab.cols, roundTab.rows);
  state.current = parseCurrent(currentTab.cols, currentTab.rows);
  state.allTallies = parseTallies(talliesTab.cols, talliesTab.rows);

  if (state.playRoundId) {
    state.localAnswers = loadLocalAnswers(state.playRoundId);
    state.tallies = talliesForRound(state.playRoundId);
  } else if (state.round) {
    state.localAnswers = loadLocalAnswers(state.round.roundId);
    state.tallies = talliesForRound(state.round.roundId);
  } else {
    state.localAnswers = {};
    state.tallies = new Map();
  }

  if (
    state.phase === 'playing' &&
    state.round &&
    state.playRoundId === state.round.roundId &&
    state.current.length
  ) {
    state.playQuestions = state.current.slice();
  }

  syncPhase();

  const typingEstimate =
    document.activeElement &&
    document.activeElement.classList &&
    document.activeElement.classList.contains('est-input');
  const sig = viewSignature();
  const tallySig = tallySignature();
  if (
    sig !== lastViewSig ||
    state.phase !== prevPhase ||
    (!typingEstimate && tallySig !== lastTallySig)
  ) {
    lastViewSig = sig;
    lastTallySig = tallySig;
    render();
  } else {
    updateChrome();
  }

  if (state.phase !== prevPhase || (state.round && state.round.roundId) !== prevRoundId) {
    schedulePoll();
  }
}

/** Stable signature of what the main stage should show (ignores live tallies). */
function viewSignature() {
  const qids = (state.playQuestions.length ? state.playQuestions : state.current)
    .map((q) => q.questionId)
    .join(',');
  const answers = Object.keys(state.localAnswers)
    .sort()
    .map((k) => `${k}=${state.localAnswers[k]}`)
    .join('|');
  const submittingIds = [...submitting].sort().join(',');
  return [
    state.phase,
    state.playRoundId || '',
    state.round && state.round.roundId,
    state.round && state.round.status,
    qids,
    answers,
    submittingIds,
    state.waitOutQuestionIds
  ].join('::');
}

function tallySignature() {
  return [...state.tallies.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, t]) => `${id}:${t.total || 0}:${JSON.stringify(t.counts || {})}`)
    .join('|');
}

function onBoundaryTick() {
  syncPhase();
  updateChrome();

  if (state.phase === 'waiting') {
    const el = els.stage.querySelector('.countdown-lg');
    if (el) el.textContent = formatCountdown(state.waitUntilMs);
    if (state.waitUntilMs && Date.now() >= state.waitUntilMs) {
      // Round should flip soon — pull Sheet now instead of waiting for poll.
      kickBurst(20000);
      refresh({ force: true }).catch(() => {});
    }
    if (state.phase === 'playing') render();
    return;
  }

  if (state.phase === 'playing') {
    const ends = playEndsAtMs();
    const el = els.stage.querySelector('.countdown-lg');
    if (el && ends) el.textContent = formatCountdown(ends);
    if (ends && Date.now() >= ends) {
      enterResults();
      render();
      kickBurst(20000);
      refresh({ force: true }).catch(() => {});
    }
  }
}

let liveListenersBound = false;

function startPolling() {
  window.clearInterval(tickTimer);
  schedulePoll();
  tickTimer = window.setInterval(onBoundaryTick, 250);

  if (!liveListenersBound) {
    liveListenersBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        kickBurst(8000);
        refresh({ force: true }).catch(() => {});
      }
    });
    window.addEventListener('focus', () => {
      refresh({ force: true }).catch(() => {});
    });
  }
}

function isConfigured() {
  return typeof window.heymingTriviaIsConfigured === 'function'
    ? window.heymingTriviaIsConfigured(cfg)
    : false;
}

function getUuid() {
  try {
    let id = localStorage.getItem(UUID_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(UUID_KEY, id);
    }
    return id;
  } catch {
    return `t-session-${Date.now().toString(36)}`;
  }
}

function clearLegacyOptIn() {
  try {
    sessionStorage.removeItem(OPT_IN_KEY);
  } catch {
    /* ignore */
  }
}

function setOptedIn(value) {
  state.optedIn = value;
}

function answersKey(roundId) {
  return `${ANSWERS_PREFIX}${roundId}`;
}

function loadLocalAnswers(roundId) {
  if (!roundId) return {};
  try {
    const raw = localStorage.getItem(answersKey(roundId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalAnswer(roundId, questionId, answer) {
  const map = loadLocalAnswers(roundId);
  map[questionId] = answer;
  try {
    localStorage.setItem(answersKey(roundId), JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
  state.localAnswers = map;
}

/**
 * @param {string} tab
 * @returns {Promise<{ cols: string[], rows: unknown[][] }>}
 */
async function fetchTab(tab) {
  const url = `https://docs.google.com/spreadsheets/d/${
    cfg.sheetId
  }/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
  const text = await fetch(url, { cache: 'no-store' }).then((r) => r.text());
  const m = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!m) throw new Error('gviz parse failed');
  const json = JSON.parse(m[1]);
  if (!json.table) return { cols: [], rows: [] };
  const cols = (json.table.cols || []).map((c) => (c && c.label) || '');
  const rows = (json.table.rows || []).map((r) => (r.c || []).map((c) => (c == null ? null : c.v)));
  return normalizeGvizTable(cols, rows);
}

/** When Sheets exports unlabeled cols, the header often lands in row 0. */
function normalizeGvizTable(cols, rows) {
  let labels = cols.map((c) => String(c || '').trim());
  let data = rows.slice();
  const rowLooksLikeHeader = (row) => {
    if (!row || !row.length) return false;
    const first = cellStr(row[0]).toLowerCase().replace(/\s+/g, '');
    return first === 'roundid' || first === 'id' || first === 'questionid' || first === 'uuid';
  };
  if (labels.every((l) => !l) && data.length && rowLooksLikeHeader(data[0])) {
    labels = data[0].map((c) => cellStr(c));
    data = data.slice(1);
  }
  data = data.filter((row) => !rowLooksLikeHeader(row));
  return { cols: labels, rows: data };
}

/**
 * @param {string[]} cols
 * @param {string[]} names
 */
function colIndex(cols, names) {
  const lower = cols.map((c) =>
    String(c || '')
      .toLowerCase()
      .replace(/\s+/g, '')
  );
  for (const name of names) {
    const want = name.toLowerCase().replace(/\s+/g, '');
    const i = lower.findIndex((c) => c === want || c.includes(want));
    if (i >= 0) return i;
  }
  return -1;
}

function cellStr(v) {
  if (v == null || v === '') return '';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

/** @param {unknown} v */
function parseGvizDateMs(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1e11) return v;
    if (v > 1e9) return v * 1000;
  }
  if (typeof v === 'string') {
    const m = v.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
    if (m) {
      return new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

function parseRound(cols, rows) {
  if (!rows.length) return null;
  const iId = colIndex(cols, ['roundid', 'round']);
  const iStart = colIndex(cols, ['startsat', 'starts']);
  const iEnd = colIndex(cols, ['endsat', 'ends']);
  const iStatus = colIndex(cols, ['status']);
  const iQids = colIndex(cols, ['questionids', 'questions']);
  // Prefer the last data row (Sheet should only have one; tolerate extras).
  const row = rows[rows.length - 1];
  const roundId = cellStr(row[iId >= 0 ? iId : 0]);
  if (!roundId || roundId.toLowerCase() === 'roundid') return null;
  const endsRaw = row[iEnd >= 0 ? iEnd : 2];
  const startsRaw = row[iStart >= 0 ? iStart : 1];
  return {
    roundId,
    startsAt: cellStr(startsRaw),
    endsAt: cellStr(endsRaw),
    status: cellStr(row[iStatus >= 0 ? iStatus : 3]).toLowerCase() || 'open',
    questionIds: cellStr(row[iQids >= 0 ? iQids : 4]),
    startsAtMs: parseGvizDateMs(startsRaw) || Date.parse(cellStr(startsRaw)) || 0,
    endsAtMs: parseGvizDateMs(endsRaw) || Date.parse(cellStr(endsRaw)) || 0
  };
}

/** Countdown target while the player is in an open round. */
function playEndsAtMs() {
  const round = state.round;
  if (!round || !round.endsAtMs) return 0;
  if (!state.playRoundId || round.roundId === state.playRoundId) return round.endsAtMs;
  // Fallback: Current rows carry the live round id if Round parse was briefly stale.
  const fromQ = (state.playQuestions[0] || state.current[0] || {}).roundId;
  if (fromQ && fromQ === round.roundId) return round.endsAtMs;
  return 0;
}

function parseCurrent(cols, rows) {
  const iRound = colIndex(cols, ['roundid']);
  const iQid = colIndex(cols, ['questionid']);
  const iSort = colIndex(cols, ['sort']);
  const iMode = colIndex(cols, ['mode']);
  const iFormat = colIndex(cols, ['format']);
  const iPrompt = colIndex(cols, ['prompt']);
  const iA = colIndex(cols, ['choice_a', 'choicea']);
  const iB = colIndex(cols, ['choice_b', 'choiceb']);
  const iC = colIndex(cols, ['choice_c', 'choicec']);
  const iD = colIndex(cols, ['choice_d', 'choiced']);
  const iUnit = colIndex(cols, ['estimate_unit', 'estimateunit']);

  const list = rows
    .map((row) => ({
      roundId: cellStr(row[iRound >= 0 ? iRound : 0]),
      questionId: cellStr(row[iQid >= 0 ? iQid : 1]),
      sort: Number(row[iSort >= 0 ? iSort : 2]) || 0,
      mode: cellStr(row[iMode >= 0 ? iMode : 3]).toLowerCase(),
      format: cellStr(row[iFormat >= 0 ? iFormat : 4]).toLowerCase(),
      prompt: cellStr(row[iPrompt >= 0 ? iPrompt : 5]),
      choice_a: cellStr(row[iA >= 0 ? iA : 6]),
      choice_b: cellStr(row[iB >= 0 ? iB : 7]),
      choice_c: cellStr(row[iC >= 0 ? iC : 8]),
      choice_d: cellStr(row[iD >= 0 ? iD : 9]),
      estimate_unit: cellStr(row[iUnit >= 0 ? iUnit : 10])
    }))
    .filter((q) => q.questionId && q.prompt);

  list.sort((a, b) => a.sort - b.sort);
  return list;
}

function parseTallyRow(cols, row) {
  const g = (names, fallback) => {
    const i = colIndex(cols, names);
    return i >= 0 ? row[i] : row[fallback];
  };
  return {
    roundId: cellStr(g(['roundid'], 0)),
    questionId: cellStr(g(['questionid'], 1)),
    mode: cellStr(g(['mode'], 2)).toLowerCase(),
    total: Number(g(['total'], 3)) || 0,
    choice_a_count: Number(g(['choice_a_count', 'choiceacount'], 4)) || 0,
    choice_b_count: Number(g(['choice_b_count', 'choicebcount'], 5)) || 0,
    choice_c_count: Number(g(['choice_c_count', 'choiceccount'], 6)) || 0,
    choice_d_count: Number(g(['choice_d_count', 'choicedcount'], 7)) || 0,
    numeric_sum: Number(g(['numeric_sum', 'numericsum'], 8)) || 0,
    numeric_count: Number(g(['numeric_count', 'numericcount'], 9)) || 0,
    correct: cellStr(g(['correct'], 10)),
    estimate_answer: cellStr(g(['estimate_answer', 'estimateanswer'], 11)),
    estimate_tolerance: cellStr(g(['estimate_tolerance', 'estimatetolerance'], 12)),
    status: cellStr(g(['status'], 13)).toLowerCase()
  };
}

function parseTallies(cols, rows) {
  /** @type {Map<string, ReturnType<typeof parseTallyRow>>} */
  const map = new Map();
  for (const row of rows) {
    const t = parseTallyRow(cols, row);
    if (t.questionId && t.roundId) map.set(`${t.roundId}\t${t.questionId}`, t);
    else if (t.questionId) map.set(t.questionId, t);
  }
  return map;
}

function talliesForRound(roundId) {
  /** @type {Map<string, ReturnType<typeof parseTallyRow>>} */
  const map = new Map();
  if (!roundId) return map;
  for (const t of state.allTallies.values()) {
    if (t.roundId === roundId) map.set(t.questionId, t);
  }
  return map;
}

function showBanner(text, tone = 'warn') {
  els.banner.hidden = !text;
  els.banner.textContent = text || '';
  els.banner.dataset.tone = tone === 'info' ? 'info' : 'warn';
}

function formatCountdown(targetMs) {
  if (!targetMs) return '';
  const ms = targetMs - Date.now();
  if (ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function nextHalfHourMs(fromMs = Date.now()) {
  const d = new Date(fromMs);
  const mins = d.getMinutes();
  d.setSeconds(0, 0);
  if (mins < 30) d.setMinutes(30);
  else {
    d.setMinutes(0);
    d.setHours(d.getHours() + 1);
  }
  return d.getTime();
}

function isSheetRoundOpen(round = state.round) {
  if (!round || round.status === 'closed') return false;
  if (round.endsAtMs && Date.now() >= round.endsAtMs) return false;
  return true;
}

/** Next moment a playable round can begin for someone who just opted in. */
function computeWaitUntilMs() {
  const round = state.round;
  if (!round) return nextHalfHourMs();
  if (isSheetRoundOpen(round) && round.endsAtMs) {
    // Mid-round: wait for this window to end (Apps Script then opens the next set).
    return round.endsAtMs;
  }
  if (round.endsAtMs && round.endsAtMs > Date.now()) return round.endsAtMs;
  return nextHalfHourMs();
}

function syncPhase() {
  if (!state.optedIn) {
    state.phase = 'gate';
    return;
  }

  const round = state.round;
  const now = Date.now();

  // Finished a play session — stay on results until they queue for the next game.
  if (state.phase === 'results' && state.playRoundId) {
    if (round && round.roundId !== state.playRoundId && isSheetRoundOpen(round)) {
      // New round already open; keep results until they click "Next round".
      return;
    }
    return;
  }

  if (state.phase === 'playing' && state.playRoundId) {
    const stillThis = round && round.roundId === state.playRoundId && isSheetRoundOpen(round);
    if (stillThis) return;
    // Timer done or sheet advanced — freeze questions and show results.
    enterResults();
    return;
  }

  if (state.phase === 'waiting') {
    // New open round (unique roundId, or same clock bucket with new questions).
    if (round && isSheetRoundOpen(round) && state.current.length && isFreshRoundForWait_(round)) {
      enterPlaying();
      return;
    }
    if (now < state.waitUntilMs) return;
    // Clock hit zero but sheet still shows the old round — keep polling.
    state.waitUntilMs = Math.max(state.waitUntilMs, now + 15000);
    return;
  }

  // opted in, fresh: go to waiting for next game
  beginWaiting_();
}

function isFreshRoundForWait_(round) {
  if (!state.playRoundId && !state.waitOutQuestionIds) return true;
  if (state.playRoundId && round.roundId !== state.playRoundId) return true;
  if (state.waitOutQuestionIds && round.questionIds !== state.waitOutQuestionIds) return true;
  return false;
}

function beginWaiting_() {
  state.phase = 'waiting';
  state.waitUntilMs = computeWaitUntilMs();
  // Do not stamp the current open round — waiting means "next open set after Start".
  state.playRoundId = null;
  state.waitOutQuestionIds = '';
  state.playQuestions = [];
}

function enterPlaying() {
  const round = state.round;
  if (!round || !state.current.length) return;
  state.phase = 'playing';
  state.playRoundId = round.roundId;
  state.playQuestions = state.current.slice();
  state.localAnswers = loadLocalAnswers(round.roundId);
  state.tallies = talliesForRound(round.roundId);
  state.estimateDrafts = {};
}

function enterResults() {
  if (state.playQuestions.length === 0 && state.current.length) {
    state.playQuestions = state.current.slice();
  }
  if (!state.playRoundId && state.round) state.playRoundId = state.round.roundId;
  state.phase = 'results';
  if (state.playRoundId) {
    state.localAnswers = loadLocalAnswers(state.playRoundId);
    state.tallies = talliesForRound(state.playRoundId);
  }
}

function enterGate() {
  setOptedIn(false);
  state.phase = 'gate';
  state.playRoundId = null;
  state.playQuestions = [];
  state.waitOutQuestionIds = '';
  state.waitUntilMs = 0;
  state.estimateDrafts = {};
}

/** Join now if a round is open; otherwise wait for the next open set. */
function startRoundFlow() {
  setOptedIn(true);
  const round = state.round;
  if (round && isSheetRoundOpen(round) && state.current.length) {
    enterPlaying();
  } else {
    beginWaiting_();
  }
  if (typeof window.trackEvent === 'function') {
    window.trackEvent('trivia_start', { mode: 'opt_in' });
  }
  schedulePoll();
  kickBurst(10000);
  refresh({ force: true }).catch(() => {});
  render();
}

function queueNextRound() {
  enterGate();
  render();
}

function updateChrome() {
  syncPhase();
  const phase = state.phase;

  if (phase === 'gate') {
    els.roundBar.hidden = true;
    return;
  }
  els.roundBar.hidden = false;

  if (phase === 'waiting') {
    els.status.textContent = 'Next round';
    els.status.dataset.state = 'waiting';
    els.timer.textContent = `${formatCountdown(state.waitUntilMs)} until the next game`;
    return;
  }

  if (phase === 'playing') {
    const ends = playEndsAtMs();
    els.status.textContent = 'Round open';
    els.status.dataset.state = 'open';
    els.timer.textContent = ends ? `${formatCountdown(ends)} until results` : 'Time left…';
    return;
  }

  if (phase === 'results') {
    els.status.textContent = 'Results';
    els.status.dataset.state = 'closed';
    els.timer.textContent = 'Round over';
  }
}

function choiceList(q) {
  const choices = [q.choice_a, q.choice_b, q.choice_c, q.choice_d]
    .map((c) => {
      if (c === true) return 'True';
      if (c === false) return 'False';
      return c == null ? '' : String(c).trim();
    })
    .filter((c) => c !== '');
  if (!choices.length && (q.format === 'truefalse' || q.format === 'boolean')) {
    return ['True', 'False'];
  }
  return choices;
}

function isEstimate(q) {
  return q.format === 'number';
}

async function submitAnswer(questionId, answer) {
  const roundId = state.playRoundId;
  if (!roundId || state.phase !== 'playing') return;
  if (submitting.has(questionId)) return;

  submitting.add(questionId);
  render();

  const body = new URLSearchParams();
  body.set(cfg.entryIds.uuid, getUuid());
  body.set(cfg.entryIds.roundId, roundId);
  body.set(cfg.entryIds.questionId, questionId);
  body.set(cfg.entryIds.answer, answer);
  body.set(cfg.entryIds.honeypot, '');

  try {
    await fetch(cfg.formActionUrl, {
      method: 'POST',
      mode: 'no-cors',
      body
    });
    saveLocalAnswer(roundId, questionId, answer);
    window.heymingAchievements?.unlockForCurrentApp('first-action');
    delete state.estimateDrafts[questionId];
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('trivia_answer', { question_id: questionId, mode: 'submit' });
    }
  } catch (err) {
    console.warn('Trivia submit failed', err);
    showBanner('Couldn’t send your answer. Try again in a moment.');
  } finally {
    submitting.delete(questionId);
    render();
    kickBurst();
    setTimeout(() => {
      refresh({ force: true }).catch(() => {});
    }, 800);
    setTimeout(() => {
      refresh({ force: true }).catch(() => {});
    }, 2500);
  }
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((100 * part) / total);
}

function renderResults(q, tally, revealed) {
  const wrap = document.createElement('div');
  wrap.className = 'results';

  if (!tally || tally.total <= 0) {
    const p = document.createElement('p');
    p.className = 'status-line';
    p.dataset.tone = 'muted';
    p.textContent = revealed ? 'No answers recorded for this question.' : 'Waiting for the crowd…';
    wrap.appendChild(p);
    return wrap;
  }

  if (isEstimate(q)) {
    const avg =
      tally.numeric_count > 0
        ? Math.round((tally.numeric_sum / tally.numeric_count) * 100) / 100
        : null;
    const p = document.createElement('p');
    p.className = 'status-line';
    p.dataset.tone = 'muted';
    p.textContent =
      avg == null
        ? `${tally.total} answer${tally.total === 1 ? '' : 's'}`
        : `${tally.total} answer${tally.total === 1 ? '' : 's'} · crowd average ${avg}${
            q.estimate_unit ? ` ${q.estimate_unit}` : ''
          }`;
    wrap.appendChild(p);
  } else {
    const choices = [
      [q.choice_a, tally.choice_a_count],
      [q.choice_b, tally.choice_b_count],
      [q.choice_c, tally.choice_c_count],
      [q.choice_d, tally.choice_d_count]
    ].filter(([label]) => label);

    for (const [label, count] of choices) {
      const row = document.createElement('div');
      row.className = 'result-row';
      const lab = document.createElement('span');
      lab.className = 'result-label';
      lab.textContent = String(label);
      const val = document.createElement('span');
      val.textContent = `${pct(Number(count) || 0, tally.total)}%`;
      const track = document.createElement('div');
      track.className = 'result-bar-track';
      const bar = document.createElement('div');
      bar.className = 'result-bar';
      bar.style.width = `${pct(Number(count) || 0, tally.total)}%`;
      track.appendChild(bar);
      row.append(lab, val, track);
      wrap.appendChild(row);
    }
  }

  if (revealed) {
    const reveal = document.createElement('div');
    reveal.className = 'reveal';
    const mine = state.localAnswers[q.questionId];
    if ((q.mode === 'fact' || q.mode === 'estimate') && tally.correct) {
      const ok = mine && norm(mine) === norm(tally.correct);
      reveal.innerHTML = `Answer: <strong>${escapeHtml(tally.correct)}</strong>${
        mine ? (ok ? ' — you got it' : ` — you said ${escapeHtml(mine)}`) : ''
      }`;
    } else if (isEstimate(q) && tally.estimate_answer !== '') {
      const truth = Number(tally.estimate_answer);
      const tol = Number(tally.estimate_tolerance) || 0;
      const guess = mine != null && mine !== '' ? Number(String(mine).replace(/,/g, '')) : NaN;
      let grade = '';
      if (Number.isFinite(guess) && Number.isFinite(truth)) {
        grade =
          Math.abs(guess - truth) <= tol
            ? ' — close enough'
            : ` — you guessed ${escapeHtml(String(mine))}`;
      }
      reveal.innerHTML = `Target: <strong>${escapeHtml(String(tally.estimate_answer))}${
        q.estimate_unit ? ` ${escapeHtml(q.estimate_unit)}` : ''
      }</strong>${grade}`;
    } else if (q.mode === 'opinion' && mine) {
      reveal.textContent = `You picked: ${mine}`;
    }
    if (reveal.innerHTML || reveal.textContent) wrap.appendChild(reveal);
  }

  return wrap;
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sameAnswer(a, b) {
  return norm(a) === norm(b);
}

function renderCard(q, { answering, revealed }) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.questionId = q.questionId;

  const top = document.createElement('div');
  top.className = 'card-top';
  const mode = document.createElement('span');
  mode.className = 'mode';
  mode.textContent = q.mode || 'question';
  const sort = document.createElement('span');
  sort.className = 'sort';
  sort.textContent = `#${q.sort || ''}`;
  top.append(mode, sort);

  const prompt = document.createElement('h2');
  prompt.className = 'prompt';
  prompt.textContent = q.prompt;

  card.append(top, prompt);

  const mine = state.localAnswers[q.questionId];
  const tally = state.tallies.get(q.questionId);
  const busy = submitting.has(q.questionId);

  if (answering) {
    if (isEstimate(q)) {
      const row = document.createElement('div');
      row.className = 'estimate-row';
      const input = document.createElement('input');
      input.className = 'est-input';
      input.type = 'number';
      input.inputMode = 'decimal';
      input.placeholder = 'Your guess';
      const draft = state.estimateDrafts[q.questionId];
      input.value = draft != null ? draft : mine || '';
      input.disabled = busy;
      input.addEventListener('input', () => {
        state.estimateDrafts[q.questionId] = input.value;
      });
      const unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = q.estimate_unit || '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'submit-est';
      btn.textContent = busy ? 'Sending…' : mine ? 'Update' : 'Submit';
      btn.disabled = busy;
      btn.addEventListener('click', () => {
        const v = input.value.trim();
        if (!v) {
          input.focus();
          return;
        }
        if (mine && sameAnswer(mine, v)) return;
        submitAnswer(q.questionId, v);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btn.click();
      });
      row.append(input, unit, btn);
      card.appendChild(row);
    } else {
      const labels = choiceList(q);
      if (!labels.length) {
        const missing = document.createElement('p');
        missing.className = 'status-line';
        missing.dataset.tone = 'muted';
        missing.textContent = 'This question is missing its choices. Try the next round.';
        card.appendChild(missing);
      } else {
        const choices = document.createElement('div');
        choices.className = 'choices';
        for (const label of labels) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'choice';
          btn.textContent = label;
          btn.disabled = busy;
          if (mine && sameAnswer(mine, label)) btn.setAttribute('aria-pressed', 'true');
          btn.addEventListener('click', () => {
            if (mine && sameAnswer(mine, label)) return;
            submitAnswer(q.questionId, label);
          });
          choices.appendChild(btn);
        }
        card.appendChild(choices);
      }
    }
    if (mine) {
      const status = document.createElement('p');
      status.className = 'status-line';
      status.textContent = busy ? 'Sending…' : 'You can change your answer until time is up.';
      card.appendChild(status);
    }
  } else if (mine) {
    const status = document.createElement('p');
    status.className = 'status-line';
    status.textContent = `You answered: ${mine}`;
    card.appendChild(status);
  } else if (revealed) {
    const status = document.createElement('p');
    status.className = 'status-line';
    status.dataset.tone = 'muted';
    status.textContent = 'You did not answer this one.';
    card.appendChild(status);
  }

  if (revealed || (tally && tally.total > 0)) {
    card.appendChild(renderResults(q, tally, revealed));
  }

  return card;
}

function renderGate() {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<p class="panel-lead">Same three questions for everyone on the site. Rounds last 30 minutes.</p>';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary';
  btn.textContent = 'Start';
  btn.addEventListener('click', startRoundFlow);
  panel.appendChild(btn);
  const note = document.createElement('p');
  note.className = 'panel-note';
  note.textContent =
    'If a round is already open, you join it. Otherwise you’ll wait for the next one.';
  panel.appendChild(note);
  return panel;
}

function renderWaiting() {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const cd = document.createElement('p');
  cd.className = 'countdown-lg';
  cd.textContent = formatCountdown(state.waitUntilMs);
  const label = document.createElement('p');
  label.className = 'panel-lead';
  label.textContent = 'until the next game';
  const note = document.createElement('p');
  note.className = 'panel-note';
  note.textContent = 'When the clock hits zero, the next round opens automatically.';
  panel.append(cd, label, note);
  return panel;
}

function renderResultsPhase() {
  const wrap = document.createElement('div');
  wrap.className = 'questions';
  const head = document.createElement('div');
  head.className = 'phase-head';
  head.innerHTML = '<h2 class="phase-title">Results</h2>';
  wrap.appendChild(head);

  const questions = state.playQuestions;
  if (!questions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No questions saved for this round.';
    wrap.appendChild(empty);
  } else {
    for (const q of questions) {
      wrap.appendChild(renderCard(q, { answering: false, revealed: true }));
    }
  }

  const actions = document.createElement('div');
  actions.className = 'phase-actions';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn-primary';
  next.textContent = 'Back to start';
  next.addEventListener('click', queueNextRound);
  actions.appendChild(next);
  wrap.appendChild(actions);
  return wrap;
}

function renderPlaying() {
  const wrap = document.createElement('div');
  wrap.className = 'questions';

  const ends = playEndsAtMs();
  const head = document.createElement('div');
  head.className = 'phase-head play-timer';
  const cd = document.createElement('p');
  cd.className = 'countdown-lg';
  cd.textContent = ends ? formatCountdown(ends) : '—';
  const label = document.createElement('p');
  label.className = 'panel-lead';
  label.textContent = 'until results';
  head.append(cd, label);
  wrap.appendChild(head);

  const questions = state.playQuestions.length ? state.playQuestions : state.current;
  if (!questions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Waiting for questions…';
    wrap.appendChild(empty);
    return wrap;
  }
  for (const q of questions) {
    wrap.appendChild(renderCard(q, { answering: true, revealed: false }));
  }
  return wrap;
}

function render() {
  const active = document.activeElement;
  /** @type {{ questionId: string, start: number|null, end: number|null } | null} */
  let restore = null;
  if (active && active.classList && active.classList.contains('est-input')) {
    const card = active.closest('[data-question-id]');
    if (card) {
      restore = {
        questionId: card.dataset.questionId,
        start: typeof active.selectionStart === 'number' ? active.selectionStart : null,
        end: typeof active.selectionEnd === 'number' ? active.selectionEnd : null
      };
      state.estimateDrafts[restore.questionId] = /** @type {HTMLInputElement} */ (active).value;
    }
  }

  updateChrome();
  els.stage.setAttribute('aria-busy', 'false');
  els.stage.replaceChildren();

  if (!state.round && state.optedIn) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML =
      '<p><strong>No round is live yet.</strong></p><p>Check back soon — a new set opens every half hour.</p>';
    els.stage.appendChild(empty);
    lastViewSig = viewSignature();
    lastTallySig = tallySignature();
    return;
  }

  if (state.phase === 'gate') {
    els.stage.appendChild(renderGate());
  } else if (state.phase === 'waiting') {
    els.stage.appendChild(renderWaiting());
  } else if (state.phase === 'results') {
    els.stage.appendChild(renderResultsPhase());
  } else {
    els.stage.appendChild(renderPlaying());
  }

  if (restore) {
    const input = els.stage.querySelector(
      `[data-question-id="${CSS.escape(restore.questionId)}"] .est-input`
    );
    if (input instanceof HTMLInputElement) {
      input.focus();
      if (restore.start != null && restore.end != null) {
        try {
          input.setSelectionRange(restore.start, restore.end);
        } catch {
          /* number inputs may reject selection in some browsers */
        }
      }
    }
  }

  lastViewSig = viewSignature();
  lastTallySig = tallySignature();
}

async function init() {
  clearLegacyOptIn();
  state.optedIn = false;
  state.phase = 'gate';

  if (!cfg || !isConfigured()) {
    showBanner('Trivia isn’t available right now.', 'warn');
    els.stage.innerHTML = '<div class="empty">Trivia isn’t connected yet. Try again later.</div>';
    els.roundBar.hidden = true;
    return;
  }

  showBanner('', 'info');
  els.stage.innerHTML = '<div class="loading">Loading…</div>';

  try {
    await refresh();
    if (state.phase === 'gate') render();
    startPolling();
  } catch (err) {
    console.error(err);
    showBanner('Couldn’t load this round. Try refreshing.');
    els.stage.innerHTML = '<div class="empty">Something went wrong loading Trivia.</div>';
  }
}

init();
