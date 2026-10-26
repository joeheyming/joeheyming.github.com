// The small right-click / footer popup menu shared by the Layers and Paths panels.

let closeOpenMenu = null;

/**
 * A popup menu of { label, run, disabled } items at (x, y); above that point when `up`. Picking
 * an item, Escape, or a press elsewhere closes it. Only one is open at a time.
 */
export function openPopupMenu(host, x, y, items, up = false) {
  closeOpenMenu?.();
  const doc = host.ownerDocument;
  const menu = doc.createElement('div');
  menu.className = 'layer-popup-menu';
  menu.setAttribute('role', 'menu');
  menu.style.left = `${x}px`;
  if (up) menu.style.bottom = `${(doc.defaultView?.innerHeight ?? 0) - y}px`;
  else menu.style.top = `${y}px`;
  const close = () => {
    menu.remove();
    doc.removeEventListener('pointerdown', onOutside, true);
    doc.removeEventListener('keydown', onKey, true);
    if (closeOpenMenu === close) closeOpenMenu = null;
  };
  const onOutside = (e) => {
    if (!menu.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  for (const item of items) {
    const btn = doc.createElement('button');
    btn.className = 'action-menu-item';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = item.label;
    btn.disabled = !!item.disabled;
    btn.addEventListener('click', () => {
      close();
      item.run();
    });
    menu.appendChild(btn);
  }
  host.appendChild(menu);
  doc.addEventListener('pointerdown', onOutside, true);
  doc.addEventListener('keydown', onKey, true);
  closeOpenMenu = close;
  return menu;
}
