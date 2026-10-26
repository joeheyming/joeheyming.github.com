// Fast tips for every control that has a title. The browser's native tip waits about a
// second (longer on the first one); this shows in a fraction of that, and the next tip is
// immediate while the pointer is still moving across controls.

export const TOOLTIP_SHOW_MS = 120;
export const TOOLTIP_WARM_MS = 400;

/** Place a tip under `rect`, flipping above when it would leave the viewport. */
export function tooltipPosition(rect, tipW, tipH, vw, vh) {
  let left = rect.left + rect.width / 2 - tipW / 2;
  let top = rect.bottom + 6;
  if (top + tipH > vh - 4) top = rect.top - tipH - 6;
  left = Math.max(4, Math.min(left, vw - tipW - 4));
  top = Math.max(4, top);
  return { left: Math.round(left), top: Math.round(top) };
}

function titled(node) {
  const el = node?.closest?.('[title], [data-tip]');
  return el ?? null;
}

/**
 * @param {Document | HTMLElement} root
 */
export function initTooltips(root = document) {
  const doc = root.nodeType === 9 ? /** @type {Document} */ (root) : root.ownerDocument;
  if (!doc || doc.documentElement.dataset.paintTips === 'on') return;
  doc.documentElement.dataset.paintTips = 'on';
  const host = root.nodeType === 9 ? doc : root;

  const tip = doc.createElement('div');
  tip.className = 'paint-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  doc.body.appendChild(tip);

  let timer = 0;
  let current = null;
  let warmUntil = 0;

  const stash = (el) => {
    if (!el.hasAttribute('title')) return;
    el.dataset.tip = el.getAttribute('title') ?? '';
    el.removeAttribute('title');
  };
  const restore = (el) => {
    if (!el || el.hasAttribute('title') || el.dataset.tip == null) return;
    el.setAttribute('title', el.dataset.tip);
  };
  const hide = () => {
    if (timer) clearTimeout(timer);
    timer = 0;
    if (current) warmUntil = Date.now() + TOOLTIP_WARM_MS;
    restore(current);
    current = null;
    tip.hidden = true;
  };
  const show = (el) => {
    const text = el.dataset.tip || el.getAttribute('title') || '';
    if (!text) return;
    stash(el);
    tip.textContent = text;
    tip.hidden = false;
    const rect = el.getBoundingClientRect();
    const view = doc.defaultView;
    const pos = tooltipPosition(
      rect,
      tip.offsetWidth,
      tip.offsetHeight,
      view?.innerWidth ?? 0,
      view?.innerHeight ?? 0
    );
    tip.style.left = `${pos.left}px`;
    tip.style.top = `${pos.top}px`;
  };
  const arm = (el) => {
    if (timer) clearTimeout(timer);
    if (current && current !== el) restore(current);
    stash(el);
    current = el;
    tip.hidden = true;
    const wait = Date.now() < warmUntil ? 0 : TOOLTIP_SHOW_MS;
    if (wait === 0) {
      show(el);
      return;
    }
    timer = setTimeout(() => {
      timer = 0;
      if (current === el) show(el);
    }, wait);
  };

  host.addEventListener('pointerover', (e) => {
    const el = titled(/** @type {Element} */ (e.target));
    if (!el || el === current) return;
    arm(el);
  });
  host.addEventListener('pointerout', (e) => {
    const leaving = titled(/** @type {Element} */ (e.target));
    if (!leaving) return;
    const next = titled(/** @type {Node | null} */ (e.relatedTarget));
    if (next === leaving) return;
    hide();
  });
  host.addEventListener('pointerdown', () => hide());
}
