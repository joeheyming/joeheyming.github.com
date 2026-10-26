// Edit › Keyboard Shortcuts… (PhotoCraft shortcuts_ui.rs), read-only: Paint's shortcuts are
// fixed. The rows come from COMMANDS (grouped by top menu, in the catalog's menu order) and the
// tool letters in TOOL_KEYS (toolbox order). The markup is #shortcuts-modal in index.html; the
// search field hides every row whose label, menu path, or shortcut does not contain the query.

import { CATALOG } from './menu-catalog.js';
import { formatShortcut } from './commands.js';
import { TOOLS } from './tools.js';
import { TOOL_GROUPS, toolKey } from './tool-groups.js';
import { isMacPlatform } from './menu-bar.js';

const TOP_MENUS = [...new Set(CATALOG.map((r) => r[0].split(' > ')[0]))];

/**
 * The dialog's sections: one per top menu that has a command, then Tools.
 * @returns {{ title: string, rows: { label: string, path: string, shortcut: string }[] }[]}
 */
export function shortcutSections(commands, { mac = false, tools = TOOLS } = {}) {
  const byMenu = new Map();
  for (const cmd of commands) {
    const [top, ...sub] = cmd.menu;
    if (!byMenu.has(top)) byMenu.set(top, []);
    byMenu.get(top).push({
      label: cmd.label,
      path: sub.join(' > '),
      shortcut: [cmd.shortcut, ...cmd.aliases]
        .filter(Boolean)
        .map((s) => formatShortcut(s, mac))
        .join(', ')
    });
  }
  const order = (m) => (TOP_MENUS.includes(m) ? TOP_MENUS.indexOf(m) : TOP_MENUS.length);
  const sections = [...byMenu.keys()]
    .sort((a, b) => order(a) - order(b))
    .map((title) => ({ title, rows: byMenu.get(title) }));
  const toolRows = TOOL_GROUPS.flat()
    .filter((id) => tools[id])
    .map((id) => ({ label: tools[id].label ?? id, path: '', shortcut: toolKey(id) }));
  sections.push({ title: 'Tools', rows: toolRows });
  return sections;
}

/** Whether a row matches the search text (case-insensitive, any of label / path / shortcut). */
export function rowMatches(row, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.label, row.path, row.shortcut].some((s) => s.toLowerCase().includes(q));
}

/** Fill `list` with one section per menu; each row is a .shortcut-row with label and key. */
export function renderShortcutList(list, sections) {
  const doc = list.ownerDocument;
  list.replaceChildren();
  for (const { title, rows } of sections) {
    const section = doc.createElement('section');
    section.className = 'shortcut-section';
    const h = doc.createElement('h3');
    h.textContent = title;
    section.append(h);
    for (const row of rows) {
      const el = doc.createElement('div');
      el.className = 'shortcut-row';
      el.dataset.search = [row.label, row.path, row.shortcut].join('\n');
      const name = doc.createElement('span');
      name.className = 'shortcut-label';
      name.textContent = row.path ? `${row.path} > ${row.label}` : row.label;
      const key = doc.createElement('kbd');
      key.className = 'shortcut-key';
      key.textContent = row.shortcut;
      el.append(name, key);
      section.append(el);
    }
    list.append(section);
  }
}

/** Hide rows that do not match `query`, and sections left with no visible row. */
export function filterShortcutList(list, query) {
  for (const section of list.querySelectorAll('.shortcut-section')) {
    let any = false;
    for (const el of section.querySelectorAll('.shortcut-row')) {
      const [label, path, shortcut] = el.dataset.search.split('\n');
      el.hidden = !rowMatches({ label, path, shortcut }, query);
      if (!el.hidden) any = true;
    }
    section.hidden = !any;
  }
}

/**
 * Wire #shortcuts-modal. Returns { open } for the Edit › Keyboard Shortcuts… command.
 * @param {Document} doc
 * @param {object[]} commands
 */
export function initShortcutsDialog(doc, commands, { mac = isMacPlatform() } = {}) {
  const modal = doc.getElementById('shortcuts-modal');
  const list = doc.getElementById('shortcuts-list');
  const search = doc.getElementById('shortcuts-search');
  if (!modal || !list || !search) return { open() {} };
  const close = () => modal.classList.add('hidden');
  search.addEventListener('input', () => filterShortcutList(list, search.value));
  doc.getElementById('shortcuts-close')?.addEventListener('click', close);
  modal.addEventListener('keydown', (e) => {
    // The app's keydown handler would read Escape as Deselect.
    if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && e.target !== search)) close();
  });
  return {
    open() {
      renderShortcutList(list, shortcutSections(commands, { mac }));
      search.value = '';
      modal.classList.remove('hidden');
      setTimeout(() => search.focus(), 50);
    }
  };
}
