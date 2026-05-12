import { tap as hapticTap } from '../shared/haptics.js';
import { registersForHand } from './accordion-registers.js';

/** @typedef {import('./accordion-instruments.js').AccordionSynth} AccordionSynth */

export const registerPatch = {
  currentHand: 'right',
  activeRightRegisterId: 'M',
  activeLeftRegisterId: 'master',
  /** @type {AccordionSynth | null} */
  synth: null
};

const registerOptionsEl = document.getElementById('register-options');
const registerToggleEl = document.getElementById('register-toggle');
const registerStripEl = document.querySelector('.register-strip');
const accordionStageEl = document.querySelector('.accordion-stage');
const accordionViewEl = document.getElementById('accordion-view');
const instrumentControlsEl = document.querySelector('.instrument-controls');

/**
 * Render the register switches as a strip of physical-accordion-style stop
 * buttons. Each button is a black pill with a silver "stop" plate inset;
 * the plate has a vertical engraved spine, and black dots are punched on
 * the spine at the H (top) / M (middle) / L (bottom) positions to show
 * which reed banks the register engages. Inactive positions show no dot —
 * just the bare spine — exactly like a real instrument. Radio-style
 * behaviour: exactly one register is active at a time.
 *
 * The set rendered depends on `registerPatch.currentHand`: the right (treble) side gets
 * the full L/M/H matrix; the left (Stradella) side gets the simpler
 * tenor / master toggle that's typical on real instruments.
 */
/**
 * Lay out a register's reeds as dots on the silver stop plate. Returns
 * the CSS class suffix for each reed:
 *
 *   - L / H reeds → single dot at `l` (bottom) / `h` (top)
 *   - Single M (no musette pair) → single dot at `m` (centre)
 *   - Musette MM (two M reeds at different detune) → two dots stacked
 *     vertically just above and below centre (`m1` / `m2`), the visual
 *     convention real Italian-style accordion stops use to distinguish
 *     "single M" (`Clarinet`) from "double M" (`Musette`).
 */
const reedDotClasses = (reeds) => {
  const classes = [];
  const mReeds = reeds.filter((r) => r.semis === 0);
  for (const r of reeds) {
    if (r.semis === -12) classes.push('l');
    else if (r.semis === 12) classes.push('h');
    else if (r.semis === 0) {
      // Two-or-more M reeds → split visually as m1 / m2 so the player
      // can see at a glance that this is a musette stop, not a plain M.
      // We allocate by index in the M-only list to stay stable across
      // the m1/m2 positions regardless of cent-detune sign.
      if (mReeds.length === 1) {
        classes.push('m');
      } else {
        const idx = mReeds.indexOf(r);
        classes.push(idx === 0 ? 'm1' : 'm2');
      }
    }
  }
  return classes;
};

const appendStopDots = (stopEl, reeds) => {
  for (const cls of reedDotClasses(reeds)) {
    const dot = document.createElement('span');
    dot.className = `register-dot ${cls}`;
    stopEl.appendChild(dot);
  }
};

const syncRegisterToggle = () => {
  if (!registerToggleEl) return;
  const set = registersForHand(registerPatch.currentHand);
  const activeId =
    registerPatch.currentHand === 'left'
      ? registerPatch.activeLeftRegisterId
      : registerPatch.activeRightRegisterId;
  const reg = set.find((r) => r.id === activeId) || set[0];
  if (!reg) return;
  const stopEl = registerToggleEl.querySelector('.register-toggle-stop');
  const nameEl = registerToggleEl.querySelector('.register-toggle-name');
  if (stopEl) {
    stopEl.innerHTML = '';
    appendStopDots(stopEl, reg.reeds);
  }
  if (nameEl) nameEl.textContent = reg.label;
  registerToggleEl.title = `${reg.label} — ${reg.name}`;
};

export const renderRegisterOptions = () => {
  if (!registerOptionsEl) return;
  registerOptionsEl.innerHTML = '';
  const set = registersForHand(registerPatch.currentHand);
  const activeId =
    registerPatch.currentHand === 'left'
      ? registerPatch.activeLeftRegisterId
      : registerPatch.activeRightRegisterId;
  set.forEach((reg) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'register-button';
    btn.dataset.register = reg.id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(reg.id === activeId));
    btn.setAttribute('aria-label', `${reg.label} (${reg.name})`);
    btn.title = `${reg.label} — ${reg.name}`;
    if (reg.id === activeId) btn.classList.add('selected');

    const stop = document.createElement('span');
    stop.className = 'register-stop';
    stop.setAttribute('aria-hidden', 'true');
    appendStopDots(stop, reg.reeds);
    btn.appendChild(stop);

    const label = document.createElement('span');
    label.className = 'register-label';
    label.textContent = reg.label;
    btn.appendChild(label);

    registerOptionsEl.appendChild(btn);
  });
  syncRegisterToggle();
};

/**
 * Mirror the active register's silver stop and label onto the compact
 * toggle pill. The pill is only visible when CSS collapses the strip
 * (short viewports / landscape phones), but we keep its content in
 * sync at all times so it's correct the moment it appears.
 */
export const setRegisterStripOpen = (open) => {
  if (!registerStripEl || !registerToggleEl) return;
  registerStripEl.dataset.collapsedOpen = open ? 'true' : 'false';
  registerToggleEl.setAttribute('aria-expanded', String(Boolean(open)));
};

/**
 * Re-syncs the synth and the rendered strip with the active register for
 * the current hand. Called on view changes and on register clicks.
 */
export const applyActiveHandRegister = () => {
  const set = registersForHand(registerPatch.currentHand);
  const activeId =
    registerPatch.currentHand === 'left'
      ? registerPatch.activeLeftRegisterId
      : registerPatch.activeRightRegisterId;
  const reg = set.find((r) => r.id === activeId) || set[0];
  if (!reg) return;
  if (registerPatch.currentHand === 'left') registerPatch.activeLeftRegisterId = reg.id;
  else registerPatch.activeRightRegisterId = reg.id;
  registerPatch.synth.setRegister(reg.reeds);
  renderRegisterOptions();
};

/* The register strip lives in two different DOM locations depending
 * on viewport: above the keyboard inside `.accordion-stage` on
 * desktop (where it has space to render the full row of stops), or
 * inline with the other chrome controls inside `.instrument-controls`
 * on mobile (where it collapses to a single "current register" pill
 * and a tap-popover, keeping the keyboard's vertical real-estate
 * intact). Physically moving the element rather than rendering twin
 * copies keeps state, accessibility, and event handlers in one place. */
const mobileRegisterMq = window.matchMedia('(max-width: 720px), (max-height: 540px)');

export const placeRegisterStrip = () => {
  if (!registerStripEl) return;
  const targetParent =
    mobileRegisterMq.matches && instrumentControlsEl ? instrumentControlsEl : accordionStageEl;
  if (!targetParent) return;
  if (registerStripEl.parentElement !== targetParent) {
    setRegisterStripOpen(false);
    if (targetParent === instrumentControlsEl) {
      instrumentControlsEl.appendChild(registerStripEl);
    } else if (accordionViewEl) {
      accordionStageEl.insertBefore(registerStripEl, accordionViewEl);
    } else {
      accordionStageEl.appendChild(registerStripEl);
    }
  }
  // Mark as placed so the CSS hide-until-placed guard releases.
  registerStripEl.dataset.placed = 'true';
};

/**
 * @param {{ persist: () => void }} opts
 */
export const initRegisterStrip = ({ persist }) => {
  if (registerOptionsEl) {
    registerOptionsEl.addEventListener('click', (event) => {
      const btn = event.target.closest('.register-button');
      if (!btn) return;
      const id = btn.dataset.register;
      const set = registersForHand(registerPatch.currentHand);
      if (!set.some((r) => r.id === id)) return;
      const currentId =
        registerPatch.currentHand === 'left'
          ? registerPatch.activeLeftRegisterId
          : registerPatch.activeRightRegisterId;
      // Always close the collapsed popover after a tap, even if the
      // active register didn't change — the user has made their pick.
      setRegisterStripOpen(false);
      if (id === currentId) return;
      if (registerPatch.currentHand === 'left') registerPatch.activeLeftRegisterId = id;
      else registerPatch.activeRightRegisterId = id;
      hapticTap();
      applyActiveHandRegister();
      persist();
    });
  }

  if (registerToggleEl) {
    registerToggleEl.addEventListener('click', () => {
      if (!registerStripEl) return;
      const isOpen = registerStripEl.dataset.collapsedOpen === 'true';
      setRegisterStripOpen(!isOpen);
    });
    // Tap outside the strip closes the popover. Pointerdown rather than
    // click so the popover is gone before the user's tap can land on
    // a button beneath it.
    document.addEventListener('pointerdown', (event) => {
      if (!registerStripEl) return;
      if (registerStripEl.dataset.collapsedOpen !== 'true') return;
      if (registerStripEl.contains(event.target)) return;
      setRegisterStripOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!registerStripEl) return;
      if (registerStripEl.dataset.collapsedOpen !== 'true') return;
      setRegisterStripOpen(false);
      registerToggleEl.focus();
    });
  }

  if (typeof mobileRegisterMq.addEventListener === 'function') {
    mobileRegisterMq.addEventListener('change', placeRegisterStrip);
  } else if (typeof mobileRegisterMq.addListener === 'function') {
    // Safari < 14 fallback.
    mobileRegisterMq.addListener(placeRegisterStrip);
  }
  placeRegisterStrip();
  renderRegisterOptions();
  applyActiveHandRegister();
};
