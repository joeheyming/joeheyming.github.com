// Paint — top menu bar (File, Edit, Image, Layer, Select, Filter, View).
//
// Each `.menu-bar-menu` holds a `.menu-bar-btn` and an `.action-menu-list`.
// buildMenuBar fills the lists from COMMANDS (paint/commands.js) in PhotoCraft
// catalog order; initMenuBar owns opening and closing. Once a menu is open,
// hovering a sibling title switches to it, the way desktop menu bars behave.

import { CATALOG } from './menu-catalog.js';
import { formatShortcut } from './commands.js';

const SEP = '---';

/**
 * Plan every menu's entries: { path → [{ cmd } | { sep: true } | { sub: path }] }, paths
 * joined with ' > '. Commands go in catalog order (a Paint-only command right after its
 * `after` id), submenus where their first catalog row is, and separators where the catalog
 * has one between two shown entries. `extraPaths` are paths that hold static content.
 */
export function planMenus(commands, extraPaths = []) {
  const byId = new Map(commands.map((c) => [c.id, c]));
  const followers = new Map();
  for (const c of commands) {
    if (!c.after) continue;
    if (!followers.has(c.after)) followers.set(c.after, []);
    followers.get(c.after).push(c);
  }
  const live = new Set();
  const addLive = (parts) => {
    for (let i = 1; i <= parts.length; i++) live.add(parts.slice(0, i).join(' > '));
  };
  for (const c of commands) addLive(c.menu);
  for (const p of extraPaths) addLive(p.split(' > '));

  const plan = new Map();
  const list = (path) => {
    if (!plan.has(path)) plan.set(path, []);
    return plan.get(path);
  };
  const reach = (path) => {
    const parts = path.split(' > ');
    for (let i = 1; i < parts.length; i++) {
      const parent = list(parts.slice(0, i).join(' > '));
      const sub = parts.slice(0, i + 1).join(' > ');
      if (!parent.some((e) => e.sub === sub)) parent.push({ sub });
    }
    return list(path);
  };
  const placed = new Set();
  const place = (c) => {
    if (placed.has(c.id)) return;
    placed.add(c.id);
    reach(c.menu.join(' > ')).push({ cmd: c });
    for (const f of followers.get(c.id) ?? []) place(f);
  };
  for (const [path, , , id] of CATALOG) {
    if (!live.has(path)) continue;
    const entries = reach(path);
    if (id === SEP) entries.push({ sep: true });
    else if (byId.has(id) && !byId.get(id).after) place(byId.get(id));
  }
  // Paint-only commands whose anchor is missing, and catalog-less commands, go last.
  for (const c of commands) place(c);

  for (const [path, entries] of plan) {
    const out = [];
    for (const e of entries) {
      if (e.sep && (!out.length || out[out.length - 1].sep)) continue;
      out.push(e);
    }
    while (out.length && out[out.length - 1].sep) out.pop();
    plan.set(path, out);
  }
  return plan;
}

function renderEntries(doc, path, plan, mac, into) {
  for (const e of plan.get(path) ?? []) {
    if (e.sep) {
      const sep = doc.createElement('div');
      sep.className = 'action-menu-sep';
      into.appendChild(sep);
    } else if (e.sub) {
      const item = doc.createElement('div');
      item.className = 'action-menu-item has-submenu';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('aria-haspopup', 'true');
      item.dataset.menuPath = e.sub;
      item.appendChild(doc.createTextNode(e.sub.split(' > ').pop()));
      const subList = doc.createElement('div');
      subList.className = 'action-submenu';
      subList.setAttribute('role', 'menu');
      renderEntries(doc, e.sub, plan, mac, subList);
      item.appendChild(subList);
      into.appendChild(item);
    } else {
      const { cmd } = e;
      const btn = doc.createElement('button');
      btn.className = 'action-menu-item';
      btn.setAttribute(
        'role',
        cmd.radio ? 'menuitemradio' : cmd.checked ? 'menuitemcheckbox' : 'menuitem'
      );
      btn.dataset.command = cmd.id;
      for (const [k, v] of Object.entries(cmd.attrs)) btn.setAttribute(k, v);
      const label = doc.createElement('span');
      label.className = 'menu-label';
      label.textContent = cmd.label;
      btn.appendChild(label);
      if (cmd.shortcut) {
        const sc = doc.createElement('span');
        sc.className = 'menu-shortcut';
        sc.textContent = formatShortcut(cmd.shortcut, mac);
        btn.appendChild(sc);
      }
      into.appendChild(btn);
    }
  }
}

export function isMacPlatform() {
  return /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
}

/**
 * Fill each menu in the bar from `commands`. Static elements already in a list that carry
 * data-menu-path (the adjustment list, the Select › Modify radius field) move to the top of
 * that submenu. Clicking an enabled item runs it with `ctx`. Returns refresh(), which re-reads
 * every command's enabled(state) / checked(state); it also runs whenever a menu opens.
 *
 * @param {HTMLElement} bar
 * @param {Array<any>} commands
 * @param {{ state?: any, ctx?: any, mac?: boolean }} [opts]
 */
export function buildMenuBar(bar, commands, { state = {}, ctx = {}, mac = isMacPlatform() } = {}) {
  const doc = bar.ownerDocument;
  const byId = new Map(commands.map((c) => [c.id, c]));
  const statics = [...bar.querySelectorAll('.action-menu-list [data-menu-path]')];
  const plan = planMenus(
    commands,
    statics.map((el) => el.dataset.menuPath)
  );
  for (const menu of menusIn(bar)) {
    const top = menu.querySelector('.menu-bar-btn')?.textContent.trim();
    const list = menu.querySelector('.action-menu-list');
    if (!top || !list || !plan.has(top)) continue;
    const frag = doc.createDocumentFragment();
    renderEntries(doc, top, plan, mac, frag);
    list.insertBefore(frag, list.firstChild);
  }
  for (const el of statics) {
    const path = el.dataset.menuPath;
    const sub = bar.querySelector(`.has-submenu[data-menu-path="${path}"] > .action-submenu`);
    if (sub) sub.insertBefore(el, sub.firstChild);
  }

  const refresh = () => {
    for (const btn of bar.querySelectorAll('button[data-command]')) {
      const cmd = byId.get(btn.dataset.command);
      if (!cmd) continue;
      btn.disabled = !cmd.enabled(state);
      const label = btn.querySelector('.menu-label');
      if (cmd.labelFor && label) label.textContent = cmd.labelFor(state);
      if (cmd.checked) btn.setAttribute('aria-checked', String(!!cmd.checked(state)));
    }
  };
  // Capture: the title's own click handler stops propagation.
  bar.addEventListener(
    'click',
    (e) => {
      if (/** @type {HTMLElement} */ (e.target).closest('.menu-bar-btn')) refresh();
    },
    true
  );
  bar.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-command]');
    const cmd = btn && byId.get(btn.dataset.command);
    if (cmd && !btn.disabled && cmd.enabled(state)) cmd.run(ctx);
  });
  refresh();
  return refresh;
}

function menusIn(bar) {
  return [...bar.querySelectorAll('.menu-bar-menu')];
}

function setOpen(menu, open) {
  menu.querySelector('.action-menu-list')?.classList.toggle('hidden', !open);
  menu.querySelector('.menu-bar-btn')?.setAttribute('aria-expanded', String(open));
}

function isOpen(menu) {
  return menu.querySelector('.menu-bar-btn')?.getAttribute('aria-expanded') === 'true';
}

/** Close every menu in the bar. */
export function closeMenus(bar = document.getElementById('menu-bar')) {
  if (!bar) return;
  for (const menu of menusIn(bar)) setOpen(menu, false);
}

/** @param {HTMLElement | null} bar */
export function initMenuBar(bar = document.getElementById('menu-bar')) {
  if (!bar) return;
  const menus = menusIn(bar);
  for (const menu of menus) {
    const btn = menu.querySelector('.menu-bar-btn');
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !isOpen(menu);
      closeMenus(bar);
      setOpen(menu, willOpen);
    });
    btn?.addEventListener('pointerenter', () => {
      if (isOpen(menu) || !menus.some(isOpen)) return;
      closeMenus(bar);
      setOpen(menu, true);
    });
    menu.querySelector('.action-menu-list')?.addEventListener('click', (e) => {
      const item = /** @type {HTMLElement} */ (e.target).closest('button.action-menu-item');
      if (item && !item.hasAttribute('disabled')) closeMenus(bar);
    });
  }
  document.addEventListener('click', (e) => {
    if (!bar.contains(/** @type {Node} */ (e.target))) closeMenus(bar);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menus.some(isOpen)) closeMenus(bar);
  });
}
