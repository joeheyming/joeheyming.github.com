// Paint — the rulers and guides on screen (PhotoCraft rulers.rs draw_rulers / draw_guides).
//
// The rulers are #ruler-top / #ruler-left canvases in .canvas-column; .rulers-on on the column
// shows them and moves #canvas-area out of their way. Guides are lines in #guide-layer inside the
// canvas stack, so they pan, zoom, and turn with the document. Drag down out of the top ruler
// for a horizontal guide and right out of the left one for a vertical guide (⌥ turns it, Shift
// snaps to the ticks). With the Move tool and unlocked guides, drag a guide to move it; let go
// off the canvas or on a ruler to delete it. The math is paint/guides.js.

import { RULER_SIZE, finishGuideDrag, rulerStep, rulerTicks } from './guides.js';
import { docToView, viewOf, viewToDoc } from './view.js';
import { shows } from './snap.js';

// A guide is this many screen pixels wide to grab (the line itself is one).
const GRAB = 7;

/**
 * @param {{
 *   state: any,
 *   W: () => number,
 *   H: () => number,
 *   toView: (clientX: number, clientY: number) => [number, number],
 *   viewToClient: (vx: number, vy: number) => [number, number],
 *   commit: (r: { guides: any, label: string }) => void,
 *   doc?: Document
 * }} deps
 */
export function initGuides({ state, W, H, toView, viewToClient, commit, doc = document }) {
  const column = doc.querySelector('.canvas-column');
  const top = doc.getElementById('ruler-top');
  const left = doc.getElementById('ruler-left');
  const layer = doc.getElementById('guide-layer');
  const area = doc.getElementById('canvas-area');
  let drag = null;

  const docPoint = (e) => viewToDoc(viewOf(state), W(), H(), ...toView(e.clientX, e.clientY));
  const inside = (el, e) => {
    if (!el || !state.showRulers) return false;
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  const corner = doc.getElementById('ruler-corner');
  const overRuler = (e) => inside(top, e) || inside(left, e) || inside(corner, e);

  function dragPos(e) {
    const p = docPoint(e)[drag.vertical ? 0 : 1];
    if (!e.shiftKey) return p;
    const tick = rulerStep(state.zoom) / 10;
    return Math.round(p / tick) * tick;
  }

  function renderGuides() {
    if (!layer) return;
    layer.hidden = !shows(state, 'guides');
    layer.classList.toggle('guides-movable', state.tool === 'select' && !state.guidesLocked);
    layer.replaceChildren();
    const z = Math.max(state.zoom, 1e-4);
    const lines = [];
    for (const vertical of [true, false]) {
      state.guides[vertical ? 'vertical' : 'horizontal'].forEach((pos, index) => {
        if (drag && drag.index === index && drag.vertical === vertical) return;
        lines.push({ vertical, index, pos });
      });
    }
    if (drag) lines.push({ vertical: drag.vertical, index: drag.index, pos: drag.pos, live: true });
    for (const g of lines) {
      const hit = doc.createElement('div');
      hit.className = `guide ${g.vertical ? 'guide-v' : 'guide-h'}${g.live ? ' guide-live' : ''}`;
      hit.dataset.vertical = String(g.vertical);
      if (g.index != null) hit.dataset.index = String(g.index);
      const off = `${g.pos - GRAB / z / 2}px`;
      const size = `${GRAB / z}px`;
      Object.assign(
        hit.style,
        g.vertical ? { left: off, width: size, top: '0', height: '100%' } : { top: off, height: size, left: '0', width: '100%' }
      );
      const line = doc.createElement('div');
      line.className = 'guide-line';
      line.style.setProperty('--guide-w', `${1 / z}px`);
      hit.appendChild(line);
      layer.appendChild(hit);
    }
  }

  function renderRuler(canvas, vertical) {
    // Each ruler runs the canvas area's length (the status bar sits under the area).
    const length = area ? (vertical ? area.offsetHeight : area.offsetWidth) : 0;
    if (!length) return;
    canvas.style[vertical ? 'height' : 'width'] = `${length}px`;
    const dpr = globalThis.devicePixelRatio || 1;
    const along = Math.round(length * dpr),
      across = Math.round(RULER_SIZE * dpr);
    if (vertical ? canvas.height !== along : canvas.width !== along) {
      canvas.width = vertical ? across : along;
      canvas.height = vertical ? along : across;
    }
    const c = canvas.getContext('2d');
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(canvas);
    c.clearRect(0, 0, vertical ? RULER_SIZE : length, vertical ? length : RULER_SIZE);
    // Rulers stay level on a turned view: 0 sits where the canvas draws the document origin.
    const v = viewOf(state);
    const [cx, cy] = viewToClient(...docToView(v, W(), H(), 0, 0));
    const r = canvas.getBoundingClientRect();
    const origin = vertical ? cy - r.top : cx - r.left;
    const scale = vertical ? v.zoom : v.flip ? -v.zoom : v.zoom;
    c.strokeStyle = cs.color;
    c.fillStyle = cs.color;
    c.font = '9px sans-serif';
    c.textBaseline = 'top';
    c.beginPath();
    for (const t of rulerTicks(origin, scale, length)) {
      const at = Math.round(t.at) + 0.5;
      if (vertical) {
        c.moveTo(RULER_SIZE - t.len, at);
        c.lineTo(RULER_SIZE, at);
      } else {
        c.moveTo(at, RULER_SIZE - t.len);
        c.lineTo(at, RULER_SIZE);
      }
      if (t.label == null) continue;
      if (vertical) {
        // Stacked digits, as in Photoshop.
        [...t.label].forEach((ch, i) => c.fillText(ch, 3, at + 2 + i * 8.5));
      } else {
        c.fillText(t.label, at + 2, 1);
      }
    }
    c.stroke();
  }

  function renderRulers() {
    column?.classList.toggle('rulers-on', !!state.showRulers);
    if (!state.showRulers) return;
    if (top) renderRuler(top, false);
    if (left) renderRuler(left, true);
  }

  function begin(e, d) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag = d;
    drag.pos = dragPos(e);
    if (drag.index == null) drag.press = drag.pos;
    renderGuides();
  }

  for (const [el, vertical] of [
    [top, false],
    [left, true]
  ]) {
    el?.addEventListener('pointerdown', (e) => {
      // ⌥ turns the guide the other way (rulers.rs #5698).
      begin(e, { vertical: vertical !== e.altKey, index: null, press: 0, ruler: vertical });
    });
  }

  layer?.addEventListener('pointerdown', (e) => {
    const hit = e.target.closest?.('.guide');
    if (!hit || hit.dataset.index == null || state.guidesLocked || state.tool !== 'select') return;
    const vertical = hit.dataset.vertical === 'true';
    const press = docPoint(e)[vertical ? 0 : 1];
    begin(e, { vertical, index: Number(hit.dataset.index), press });
  });

  doc.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.ruler !== undefined) drag.vertical = drag.ruler !== e.altKey;
    drag.pos = dragPos(e);
    renderGuides();
  });

  doc.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = { ...drag, overRuler: overRuler(e) };
    drag = null;
    const r = finishGuideDrag(state.guides, d, W(), H(), state.zoom);
    if (r) commit(r);
    renderGuides();
  });

  return {
    render() {
      renderGuides();
      renderRulers();
    },
    renderRulers,
    renderGuides
  };
}
