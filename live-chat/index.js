/**
 * Live chat panel — reusable floating overlay (desktop only).
 *
 * Usage:
 *   import { mountLiveChat } from '/live-chat/index.js';
 *   mountLiveChat({ room: 'doom' });
 */

import { CONFIG, isConfigured } from './config.js';
import { fetchTab, isEnabledCell, parseMessages } from './gviz.js';
import { generateNick, loadStoredNick, sanitizeNick, storeNick, validateNick } from './nick.js';
import {
  assertChatTextSafe,
  canRunClientToxicity,
  preloadTextModel,
  validateMessageShape
} from './moderate.js';

/**
 * @typedef {import('./gviz.js').ChatMessage} ChatMessage
 */

function isDesktop() {
  try {
    if (window.matchMedia('(max-width: 768px)').matches) return false;
    if (
      window.matchMedia('(pointer: coarse)').matches &&
      window.matchMedia('(hover: none)').matches
    ) {
      return false;
    }
  } catch {
    // Ignore.
  }
  return true;
}

/** @param {EventTarget|null|undefined} el */
function isLiveChatField(el) {
  return !!(el && /** @type {Element} */ (el).closest?.('.live-chat input, .live-chat textarea'));
}

/**
 * UZDoom/Emscripten registers window/document key handlers that call
 * preventDefault() when WASM returns true — that blocks typing in inputs.
 * Wrap those listeners (once) so they no-op while a live-chat field is focused.
 * Must run before the engine attaches its handlers (mount is at page load).
 */
let keyboardGuardInstalled = false;
function installKeyboardGuard() {
  if (keyboardGuardInstalled) return;
  keyboardGuardInstalled = true;

  /** @type {WeakMap<EventListenerOrEventListenerObject, EventListener>} */
  const wrapMap = new WeakMap();
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;
  const keyTypes = new Set(['keydown', 'keyup', 'keypress']);

  /** @param {EventTarget} target */
  function shouldWrapTarget(target) {
    return (
      target === window ||
      target === document ||
      target === document.documentElement ||
      target === document.body ||
      (target instanceof Element && target.id === 'canvas')
    );
  }

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (!keyTypes.has(type) || !listener || !shouldWrapTarget(this)) {
      return origAdd.call(this, type, listener, options);
    }
    let wrapped = wrapMap.get(listener);
    if (!wrapped) {
      wrapped = function (e) {
        if (
          isLiveChatField(document.activeElement) ||
          isLiveChatField(/** @type {Node} */ (e.target))
        ) {
          return;
        }
        if (typeof listener === 'function') return listener.call(this, e);
        return listener.handleEvent(e);
      };
      wrapMap.set(listener, wrapped);
    }
    return origAdd.call(this, type, wrapped, options);
  };

  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const wrapped = listener ? wrapMap.get(listener) : null;
    return origRemove.call(this, type, wrapped || listener, options);
  };

  // Belt-and-suspenders: ignore preventDefault on keys while chatting.
  const origPD = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function () {
    if (
      keyTypes.has(this.type) &&
      (isLiveChatField(document.activeElement) ||
        isLiveChatField(/** @type {Node} */ (this.target)))
    ) {
      return;
    }
    return origPD.call(this);
  };
}

function releaseGameKeyboard() {
  try {
    if (document.pointerLockElement) document.exitPointerLock();
  } catch {
    // Ignore.
  }
  try {
    const canvas = document.getElementById('canvas');
    if (canvas && typeof canvas.blur === 'function') canvas.blur();
  } catch {
    // Ignore.
  }
}

function getUuid() {
  try {
    let id = localStorage.getItem(CONFIG.uuidKey);
    if (id && /^[0-9a-f-]{36}$/i.test(id)) return id;
    id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
    localStorage.setItem(CONFIG.uuidKey, id);
    return id;
  } catch {
    return `ephemeral-${Date.now()}`;
  }
}

function loadOpenPref() {
  try {
    const v = localStorage.getItem(CONFIG.openKey);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    // Ignore.
  }
  return false; // default minimized
}

function storeOpenPref(open) {
  try {
    localStorage.setItem(CONFIG.openKey, open ? '1' : '0');
  } catch {
    // Ignore.
  }
}

function demoKey(room) {
  return CONFIG.demoKeyPrefix + room;
}

/** @param {string} room */
function loadDemoMessages(room) {
  try {
    const raw = localStorage.getItem(demoKey(room));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** @param {string} room @param {ChatMessage[]} messages */
function saveDemoMessages(room, messages) {
  try {
    const trimmed = messages.slice(-CONFIG.maxMessagesPerRoom);
    localStorage.setItem(demoKey(room), JSON.stringify(trimmed));
  } catch {
    // Ignore.
  }
}

function newMsgId() {
  return (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(16).slice(2)
  ).slice(0, 36);
}

/**
 * @param {object} opts
 * @param {string} opts.room
 * @returns {{ destroy: () => void } | null}
 */
export function mountLiveChat(opts = {}) {
  const room = String(opts.room || 'default').trim() || 'default';
  if (!isDesktop()) return null;

  installKeyboardGuard();

  const configured = isConfigured();
  /** @type {ChatMessage[]} */
  let messages = configured ? [] : loadDemoMessages(room);
  // Optimistic on: show chip immediately. Meta!A1 FALSE is the kill switch
  // (only applied after a successful gviz read — fetch failure must not hide UI).
  let enabled = true;
  let open = loadOpenPref();
  let nick = loadStoredNick();
  let lastSendAt = 0;
  let burstUntil = 0;
  let pollTimer = 0;
  let metaNextAt = 0;
  let destroyed = false;
  let stickToBottom = true;

  const root = document.createElement('div');
  root.className = 'live-chat';
  root.dataset.room = room;
  root.hidden = false;
  root.innerHTML = `
    <button type="button" class="live-chat__chip" aria-label="Open live chat">Chat</button>
    <section class="live-chat__panel" aria-label="Live chat" hidden>
      <header class="live-chat__header">
        <div class="live-chat__title">Live chat</div>
        <button type="button" class="live-chat__min" aria-label="Minimize chat">−</button>
      </header>
      <div class="live-chat__demo" hidden>Demo mode — wire Form/Sheet to go live</div>
      <div class="live-chat__feed" role="log" aria-live="polite"></div>
      <div class="live-chat__nick-row">
        <label class="live-chat__nick-label" for="live-chat-nick">Name</label>
        <input id="live-chat-nick" class="live-chat__nick" type="text" maxlength="${CONFIG.maxNickChars}" autocomplete="nickname" spellcheck="false" />
        <button type="button" class="live-chat__regen" title="New name">↻</button>
      </div>
      <form class="live-chat__compose" autocomplete="off">
        <input type="text" name="website" class="live-chat__honeypot" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <input class="live-chat__input" type="text" maxlength="${CONFIG.maxMessageChars}" placeholder="Say something…" />
        <button type="submit" class="live-chat__send" aria-label="Send">
          <span class="live-chat__send-label">Send</span>
          <span class="live-chat__spinner" hidden aria-hidden="true"></span>
        </button>
      </form>
      <p class="live-chat__status" role="status"></p>
    </section>
  `;

  document.body.appendChild(root);

  const chip = /** @type {HTMLButtonElement} */ (root.querySelector('.live-chat__chip'));
  const panel = /** @type {HTMLElement} */ (root.querySelector('.live-chat__panel'));
  const feed = /** @type {HTMLElement} */ (root.querySelector('.live-chat__feed'));
  const demoBanner = /** @type {HTMLElement} */ (root.querySelector('.live-chat__demo'));
  const nickInput = /** @type {HTMLInputElement} */ (root.querySelector('.live-chat__nick'));
  const regenBtn = /** @type {HTMLButtonElement} */ (root.querySelector('.live-chat__regen'));
  const form = /** @type {HTMLFormElement} */ (root.querySelector('.live-chat__compose'));
  const input = /** @type {HTMLInputElement} */ (root.querySelector('.live-chat__input'));
  const honeypot = /** @type {HTMLInputElement} */ (root.querySelector('.live-chat__honeypot'));
  const statusEl = /** @type {HTMLElement} */ (root.querySelector('.live-chat__status'));
  const minBtn = /** @type {HTMLButtonElement} */ (root.querySelector('.live-chat__min'));
  const sendBtn = /** @type {HTMLButtonElement} */ (root.querySelector('.live-chat__send'));
  const sendLabel = /** @type {HTMLElement} */ (root.querySelector('.live-chat__send-label'));
  const sendSpinner = /** @type {HTMLElement} */ (root.querySelector('.live-chat__spinner'));

  demoBanner.hidden = configured;
  let sending = false;

  function setStatus(text, { busy = false } = {}) {
    statusEl.textContent = text || '';
    statusEl.classList.toggle('live-chat__status--busy', busy && !!text);
  }

  /** @param {boolean} on @param {string} [label] */
  function setSending(on, label) {
    sending = on;
    form.classList.toggle('live-chat--sending', on);
    sendBtn.disabled = on;
    input.disabled = on;
    sendLabel.hidden = on;
    sendSpinner.hidden = !on;
    if (on) {
      setStatus(label || 'Sending…', { busy: true });
    }
  }

  function applyOpen() {
    panel.hidden = !open;
    chip.hidden = open;
    chip.setAttribute('aria-expanded', open ? 'true' : 'false');
    storeOpenPref(open);
    if (open) {
      preloadTextModel();
      schedulePoll(true);
      if (stickToBottom) feed.scrollTop = feed.scrollHeight;
    }
  }

  function colorFor(name) {
    let h = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360} 55% 62%)`;
  }

  function renderFeed() {
    const frag = document.createDocumentFragment();
    for (const m of messages) {
      const row = document.createElement('div');
      row.className = 'live-chat__msg';
      row.dataset.id = m.id;
      const who = document.createElement('span');
      who.className = 'live-chat__who';
      who.style.color = colorFor(m.name);
      who.textContent = m.name;
      const body = document.createElement('span');
      body.className = 'live-chat__text';
      body.textContent = m.message;
      row.append(who, document.createTextNode(' '), body);
      frag.appendChild(row);
    }
    feed.replaceChildren(frag);
    if (stickToBottom) feed.scrollTop = feed.scrollHeight;
  }

  feed.addEventListener('scroll', () => {
    stickToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48;
  });

  async function ensureNick() {
    if (nick) {
      nickInput.value = nick;
      return;
    }
    nickInput.value = '…';
    nickInput.disabled = true;
    regenBtn.disabled = true;
    try {
      nick = storeNick(await generateNick());
      nickInput.value = nick;
    } finally {
      nickInput.disabled = false;
      regenBtn.disabled = false;
    }
  }

  async function refreshMeta() {
    if (!configured) {
      enabled = true;
      root.hidden = false;
      return;
    }
    try {
      const table = await fetchTab(CONFIG.metaTab);
      const cell = table.rows[0]?.[0];
      enabled = isEnabledCell(cell);
      root.hidden = !enabled;
      if (!enabled) {
        open = false;
        applyOpen();
      }
    } catch (err) {
      // Keep showing chat if Meta is unreachable (adblock / slow gviz).
      console.warn('Live chat Meta read failed — leaving UI visible', err);
    }
  }

  async function refreshMessages() {
    if (!enabled) return;
    if (!configured) {
      messages = loadDemoMessages(room);
      renderFeed();
      return;
    }
    try {
      const table = await fetchTab(CONFIG.messagesTab);
      messages = parseMessages(table, room).slice(-CONFIG.maxMessagesPerRoom);
      renderFeed();
    } catch (err) {
      console.warn('Live chat Messages read failed', err);
    }
  }

  function nextPollMs() {
    if (!open) return CONFIG.pollMinimizedMs;
    if (Date.now() < burstUntil) return CONFIG.pollBurstMs;
    return CONFIG.pollOpenMs;
  }

  function schedulePoll(immediate) {
    if (destroyed) return;
    clearTimeout(pollTimer);
    const run = async () => {
      if (destroyed) return;
      const now = Date.now();
      if (now >= metaNextAt) {
        metaNextAt = now + CONFIG.metaPollEveryMs;
        await refreshMeta();
      }
      if (enabled) await refreshMessages();
      pollTimer = window.setTimeout(run, nextPollMs());
    };
    pollTimer = window.setTimeout(run, immediate ? 0 : nextPollMs());
  }

  /**
   * @param {string} text
   * @param {string} name
   * @param {string} id
   */
  function postForm(text, name, id) {
    if (!configured) return;
    const body = new URLSearchParams();
    body.set(CONFIG.entryIds.uuid, getUuid());
    body.set(CONFIG.entryIds.room, room);
    body.set(CONFIG.entryIds.name, name);
    body.set(CONFIG.entryIds.message, text);
    body.set(CONFIG.entryIds.honeypot, honeypot.value || '');
    body.set(CONFIG.entryIds.id, id);
    fetch(CONFIG.formActionUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }).catch(() => {});
  }

  chip.addEventListener('click', () => {
    open = true;
    applyOpen();
  });
  minBtn.addEventListener('click', () => {
    open = false;
    applyOpen();
  });

  regenBtn.addEventListener('click', async () => {
    setStatus('');
    regenBtn.disabled = true;
    try {
      nick = storeNick(await generateNick());
      nickInput.value = nick;
    } finally {
      regenBtn.disabled = false;
    }
  });

  nickInput.addEventListener('change', () => {
    const cleaned = sanitizeNick(nickInput.value);
    const err = validateNick(cleaned);
    if (err) {
      setStatus(err);
      nickInput.value = nick || '';
      return;
    }
    nick = storeNick(cleaned);
    nickInput.value = nick;
    setStatus('');
  });

  // Keep key events in the chat fields; release pointer-lock so the game
  // does not keep eating WASD / preventDefault while typing.
  for (const el of [nickInput, input]) {
    el.addEventListener('focus', releaseGameKeyboard);
    for (const type of ['keydown', 'keyup', 'keypress']) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (honeypot.value) return;
    if (!enabled || sending) return;

    const text = input.value.trim();
    const name = sanitizeNick(nickInput.value || nick || '');
    const nickErr = validateNick(name);
    if (nickErr) {
      setStatus(nickErr);
      return;
    }
    const shapeErr = validateMessageShape(text);
    if (shapeErr) {
      setStatus(shapeErr);
      return;
    }

    const now = Date.now();
    if (now - lastSendAt < CONFIG.minSendGapMs) {
      setStatus('Slow down a sec…');
      return;
    }

    const waitLabel = canRunClientToxicity() ? 'Checking text…' : 'Sending…';
    setSending(true, waitLabel);
    try {
      await assertChatTextSafe(name, 'nick');
      await assertChatTextSafe(text, 'message');
    } catch (err) {
      setSending(false);
      setStatus(err instanceof Error ? err.message : 'Blocked');
      return;
    }

    nick = storeNick(name);
    nickInput.value = nick;
    const id = newMsgId();
    /** @type {ChatMessage} */
    const optimistic = {
      id,
      ts: now,
      uuid: getUuid(),
      room,
      name: nick,
      message: text
    };

    lastSendAt = now;
    burstUntil = now + CONFIG.pollBurstForMs;
    input.value = '';

    if (!configured) {
      messages = [...messages, optimistic].slice(-CONFIG.maxMessagesPerRoom);
      saveDemoMessages(room, messages);
      renderFeed();
    } else {
      // Optimistic append until next poll / Apps Script drain.
      if (!messages.some((m) => m.id === id)) {
        messages = [...messages, optimistic].slice(-CONFIG.maxMessagesPerRoom);
        renderFeed();
      }
      postForm(text, nick, id);
    }
    setSending(false);
    setStatus('');
    schedulePoll(true);
  });

  function syncChromeVisibility() {
    const fs = !!document.fullscreenElement;
    const moddb = document.body.classList.contains('moddb-open');
    root.classList.toggle('live-chat--chrome-hidden', fs || moddb);
  }

  document.addEventListener('fullscreenchange', syncChromeVisibility);
  const moddbObs = new MutationObserver(syncChromeVisibility);
  moddbObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // Boot
  applyOpen();
  ensureNick().then(() => {
    renderFeed();
    metaNextAt = 0;
    schedulePoll(true);
  });

  return {
    destroy() {
      destroyed = true;
      clearTimeout(pollTimer);
      document.removeEventListener('fullscreenchange', syncChromeVisibility);
      moddbObs.disconnect();
      root.remove();
    }
  };
}
