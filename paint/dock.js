// Paint — right dock, PhotoCraft's panel groups top to bottom:
// Color | Swatches | Gradients | Patterns, Properties | Adjustments,
// Navigator | Histogram | Info, History, Layers | Channels | Paths, Brushes.
//
// Owns tab switching and the Brushes tab's Size range. Each `.dock-group` holds one `[role=tablist]`
// whose `[role=tab]` buttons point at their `[role=tabpanel]` through
// aria-controls. paint.js and ui.js fill the panels. A `.dock-split` on the bottom border of
// each visible group but the last drags that group's height; Layers keeps the rest.

function tabsIn(list) {
  return [...list.querySelectorAll('[role="tab"]')];
}

/** Select `tab` within its tablist and show only its panel. */
export function selectDockTab(tab) {
  const list = tab.closest('[role="tablist"]');
  if (!list) return;
  const doc = tab.ownerDocument;
  for (const t of tabsIn(list)) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = doc.getElementById(t.getAttribute('aria-controls'));
    if (panel) panel.hidden = !on;
  }
}

export const DOCK_MIN = 36;
export const LAYERS_MIN = 180;
export const LAYERS_FLOOR = 220;
export const DOCK_HEIGHTS_KEY = 'paint-dock-heights';
export const DOCK_TABS_KEY = 'paint-dock-tabs';
const TAB_DRAG_PX = 4;

/**
 * Drag the split under group `index` by `delta` px. `fill` is the Layers group's index; it
 * takes whatever height the others leave and never drops below LAYERS_MIN. Dragging the
 * split under Layers itself trades height with the group below it.
 * @param {number[]} heights
 * @param {number} index
 * @param {number} delta
 * @param {number} total
 * @param {number} [min]
 * @param {number} [fill]
 * @returns {number[]}
 */
export function splitDock(heights, index, delta, total, min = DOCK_MIN, fill = 4) {
  const out = heights.slice();
  const target = index === fill ? index + 1 : index;
  if (target < 0 || target >= out.length || target === fill) return out;
  const want = out[target] + (index === fill ? -delta : delta);
  const others = out.reduce((sum, h, i) => (i === fill || i === target ? sum : sum + h), 0);
  const max = Math.max(min, total - others - LAYERS_MIN);
  out[target] = Math.max(min, Math.min(max, want));
  if (fill >= 0 && fill < out.length) out[fill] = total - others - out[target];
  return out;
}

function groupKey(group) {
  return group.getAttribute('aria-label') ?? '';
}

function loadHeights(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(DOCK_HEIGHTS_KEY) ?? '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function saveHeights(storage, heights) {
  try {
    storage?.setItem(DOCK_HEIGHTS_KEY, JSON.stringify(heights));
  } catch {
    // Private mode or a full quota: the split still works for this session.
  }
}

function setGroupHeight(group, h) {
  // A saved height is a cap the group can shrink under, so Layers keeps its floor
  // when the column is short. flex 0 0 would refuse to shrink and clip the footer.
  group.style.flex = h == null ? '' : `0 1 ${h}px`;
  group.style.maxHeight = h == null ? '' : `${h}px`;
}

/** Show a split under every visible group except the last; call after Window hides one. */
export function syncDockSplits(dock = document.getElementById('dock')) {
  if (!dock) return;
  const visible = [...dock.querySelectorAll(':scope > .dock-group:not([hidden])')];
  const last = visible[visible.length - 1];
  for (const g of dock.querySelectorAll(':scope > .dock-group')) {
    const split = g.querySelector(':scope > .dock-split');
    if (split) split.hidden = g.hidden || g === last;
  }
}

function initDockSplits(dock, storage) {
  const groups = [...dock.querySelectorAll(':scope > .dock-group')];
  const saved = loadHeights(storage);
  for (const g of groups) {
    if (g.classList.contains('dock-group-fill')) continue;
    const h = saved[groupKey(g)];
    if (typeof h === 'number' && h > 0) setGroupHeight(g, h);
  }
  for (const g of groups) {
    const split = dock.ownerDocument.createElement('div');
    split.className = 'dock-split';
    split.setAttribute('role', 'separator');
    split.setAttribute('aria-orientation', 'horizontal');
    split.setAttribute('aria-label', `Resize ${groupKey(g)}`);
    g.append(split);
    split.addEventListener('dblclick', () => {
      const heights = loadHeights(storage);
      const visible = [...dock.querySelectorAll(':scope > .dock-group:not([hidden])')];
      const i = visible.indexOf(g);
      const fill = visible.findIndex((v) => v.classList.contains('dock-group-fill'));
      const target = i === fill ? visible[i + 1] : g;
      if (!target) return;
      setGroupHeight(target, null);
      delete heights[groupKey(target)];
      saveHeights(storage, heights);
    });
    split.addEventListener('pointerdown', (e) => {
      const visible = [...dock.querySelectorAll(':scope > .dock-group:not([hidden])')];
      const index = visible.indexOf(g);
      const fill = visible.findIndex((v) => v.classList.contains('dock-group-fill'));
      const start = visible.map((v) => v.getBoundingClientRect().height);
      const total = dock.clientHeight;
      const y0 = e.clientY;
      e.preventDefault();
      split.setPointerCapture?.(e.pointerId);
      split.classList.add('dragging');
      let moved = null;
      const move = (ev) => {
        const next = splitDock(start, index, ev.clientY - y0, total, DOCK_MIN, fill);
        const target = index === fill ? index + 1 : index;
        if (!visible[target] || target === fill) return;
        setGroupHeight(visible[target], next[target]);
        moved = [visible[target], next[target]];
      };
      const up = () => {
        split.classList.remove('dragging');
        split.removeEventListener('pointermove', move);
        split.removeEventListener('pointerup', up);
        split.removeEventListener('pointercancel', up);
        if (!moved) return;
        const heights = loadHeights(storage);
        heights[groupKey(moved[0])] = Math.round(moved[1]);
        saveHeights(storage, heights);
      };
      split.addEventListener('pointermove', move);
      split.addEventListener('pointerup', up);
      split.addEventListener('pointercancel', up);
    });
  }
  syncDockSplits(dock);
}

/** Where `clientX` would insert among `tabs` (the dragged tab is already excluded). */
export function tabInsertIndex(tabs, clientX) {
  for (let i = 0; i < tabs.length; i++) {
    const r = tabs[i].getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return i;
  }
  return tabs.length;
}

function saveTabOrder(dock, storage) {
  if (!storage || !dock) return;
  const order = {};
  for (const g of dock.querySelectorAll(':scope > .dock-group')) {
    const ids = [...g.querySelectorAll(':scope > [role="tablist"] > [role="tab"]')].map(
      (t) => t.id
    );
    order[groupKey(g)] = ids;
  }
  try {
    storage.setItem(DOCK_TABS_KEY, JSON.stringify(order));
  } catch {
    // Private mode or a full quota: the move still applies for this session.
  }
}

function loadTabOrder(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(DOCK_TABS_KEY) ?? '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

/** The Layers panel's group is the one that keeps the leftover height. */
function syncFill(dock) {
  const group = dock.querySelector('#panel-layers')?.closest('.dock-group') ?? null;
  for (const g of dock.querySelectorAll(':scope > .dock-group')) {
    g.classList.toggle('dock-group-fill', g === group);
  }
}

/**
 * Move `tab` and its panel into `list` at `index` (among the tabs that aren't `tab`).
 * An emptied group hides. The group that receives the Layers panel becomes the fill group.
 * @param {HTMLElement} tab
 * @param {HTMLElement} list
 * @param {number} index
 * @param {Storage | null} [storage]
 */
export function placeDockTab(tab, list, index, storage = null, select = true) {
  const doc = tab.ownerDocument;
  const panel = doc.getElementById(tab.getAttribute('aria-controls') ?? '');
  const source = tab.closest('.dock-group');
  const target = list.closest('.dock-group');
  const dock = (target ?? source)?.closest('.dock');
  const siblings = [...list.querySelectorAll(':scope > [role="tab"]')].filter((t) => t !== tab);
  list.insertBefore(tab, siblings[index] ?? null);
  if (panel && target) {
    const split = target.querySelector(':scope > .dock-split');
    target.insertBefore(panel, split);
  }
  if (source && source !== target) {
    const still = [...source.querySelectorAll(':scope > [role="tablist"] > [role="tab"]')].some(
      (t) => !t.hidden
    );
    if (!still) source.hidden = true;
  }
  if (target) target.hidden = false;
  if (dock) syncFill(dock);
  if (select) selectDockTab(tab);
  if (dock) syncDockSplits(dock);
  saveTabOrder(dock, storage);
}

/**
 * Drop `tab` at `(x, y)`. Returns false when the point is not over a dock tab row.
 * @param {HTMLElement} tab
 * @param {number} x
 * @param {number} y
 * @param {Storage | null} [storage]
 */
export function dropDockTab(tab, x, y, storage = null) {
  const hit = tab.ownerDocument.elementFromPoint(x, y);
  const list = hit?.closest?.('[role="tablist"]');
  const dock = tab.closest('.dock');
  if (!list || !dock?.contains(list)) return false;
  const siblings = [...list.querySelectorAll(':scope > [role="tab"]')].filter((t) => t !== tab);
  placeDockTab(tab, list, tabInsertIndex(siblings, x), storage);
  return true;
}

function applyTabOrder(dock, storage) {
  const order = loadTabOrder(storage);
  const doc = dock.ownerDocument;
  for (const g of dock.querySelectorAll(':scope > .dock-group')) {
    const ids = order[groupKey(g)];
    if (!Array.isArray(ids)) continue;
    const list = g.querySelector(':scope > [role="tablist"]');
    if (!list) continue;
    ids.forEach((id, index) => {
      const tab = doc.getElementById(id);
      if (tab?.getAttribute('role') === 'tab') placeDockTab(tab, list, index, null, false);
    });
  }
}

function clearTabTarget(dock) {
  for (const list of dock.querySelectorAll('.dock-tab-target')) {
    list.classList.remove('dock-tab-target');
  }
}

function initTabDrag(dock, storage) {
  for (const tab of dock.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      const move = (ev) => {
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < TAB_DRAG_PX) return;
        dragging = true;
        tab.classList.add('dock-tab-dragging');
        tab.setPointerCapture?.(ev.pointerId);
        clearTabTarget(dock);
        const list = tab.ownerDocument
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest?.('[role="tablist"]');
        if (list && dock.contains(list)) list.classList.add('dock-tab-target');
      };
      const up = (ev) => {
        tab.removeEventListener('pointermove', move);
        tab.removeEventListener('pointerup', up);
        tab.removeEventListener('pointercancel', up);
        clearTabTarget(dock);
        tab.classList.remove('dock-tab-dragging');
        if (!dragging) return;
        dropDockTab(tab, ev.clientX, ev.clientY, storage);
        // The click that follows a drag would also select; the drop already did.
        tab.addEventListener(
          'click',
          (clickEv) => {
            clickEv.stopPropagation();
            clickEv.preventDefault();
          },
          { capture: true, once: true }
        );
      };
      tab.addEventListener('pointermove', move);
      tab.addEventListener('pointerup', up);
      tab.addEventListener('pointercancel', up);
    });
  }
}

/** Shrink the other groups until the Layers group is at least LAYERS_FLOOR, when measurable. */
export function protectLayersHeight(dock) {
  const fill = [...dock.querySelectorAll(':scope > .dock-group-fill:not([hidden])')][0];
  const total = dock.clientHeight;
  if (!fill || total < DOCK_MIN) return;
  const floor = Math.min(LAYERS_FLOOR, total);
  let need = floor - fill.clientHeight;
  if (need <= 1) return;
  const others = [
    ...dock.querySelectorAll(':scope > .dock-group:not(.dock-group-fill):not([hidden])')
  ];
  for (const g of others) {
    if (need <= 1) break;
    const h = g.clientHeight;
    const next = Math.max(DOCK_MIN, h - need);
    need -= h - next;
    if (next < h) setGroupHeight(g, Math.round(next));
  }
}

/**
 * @param {HTMLElement | null} dock
 * @param {Storage | null} [storage]
 */
export function initDock(
  dock = document.getElementById('dock'),
  storage = globalThis.localStorage ?? null
) {
  if (!dock) return;
  applyTabOrder(dock, storage);
  initDockSplits(dock, storage);
  initTabDrag(dock, storage);
  protectLayersHeight(dock);
  const Observer = dock.ownerDocument.defaultView?.ResizeObserver;
  if (typeof Observer === 'function') {
    let fitting = false;
    const observer = new Observer(() => {
      if (fitting) return;
      fitting = true;
      protectLayersHeight(dock);
      fitting = false;
    });
    observer.observe(dock);
  }
  for (const list of dock.querySelectorAll('[role="tablist"]')) {
    for (const tab of tabsIn(list)) tab.addEventListener('click', () => selectDockTab(tab));
    list.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      const tabs = tabsIn(list).filter((t) => !t.hidden);
      const i = tabs.indexOf(/** @type {HTMLElement} */ (e.target));
      if (!step || i < 0) return;
      e.preventDefault();
      const next = tabs[(i + step + tabs.length) % tabs.length];
      selectDockTab(next);
      next.focus();
    });
  }
}

/**
 * Bind the Brushes tab's Size range to `state.brushSize`, the size the brush
 * tools fall back to. `onChange(size)` runs after a drag writes it. Returns a
 * sync() that redraws the range after brushSize changes elsewhere.
 * @param {{ brushSize: number }} state
 * @param {(size: number) => void} [onChange]
 */
export function bindDockBrushSize(state, onChange = () => {}, doc = document) {
  const input = /** @type {HTMLInputElement | null} */ (doc.getElementById('dock-brush-size'));
  const out = doc.getElementById('dock-brush-size-value');
  if (!input) return () => {};
  const sync = () => {
    input.value = String(state.brushSize);
    if (out) out.textContent = `${state.brushSize} px`;
  };
  input.addEventListener('input', () => {
    state.brushSize = Number(input.value);
    sync();
    onChange(state.brushSize);
  });
  sync();
  return sync;
}
