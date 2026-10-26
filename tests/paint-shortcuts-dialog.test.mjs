import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { COMMANDS, COMMANDS_BY_ID, commandForKey } from '../paint/commands.js';
import { initShortcutsDialog, shortcutSections } from '../paint/shortcuts-dialog.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function opened() {
  const { window } = new JSDOM(html);
  const doc = window.document;
  const dialog = initShortcutsDialog(doc, COMMANDS, { mac: false });
  // Run the Edit › Keyboard Shortcuts… command the way the menu bar does.
  COMMANDS_BY_ID.get('edit.keyboardShortcuts').run({ openKeyboardShortcuts: dialog.open });
  return { window, doc, modal: doc.getElementById('shortcuts-modal') };
}

const visibleRows = (doc) =>
  [...doc.querySelectorAll('#shortcuts-list .shortcut-row')]
    .filter((r) => !r.hidden && !r.closest('.shortcut-section').hidden)
    .map((r) => [
      r.querySelector('.shortcut-label').textContent,
      r.querySelector('.shortcut-key').textContent
    ]);

test('Edit › Keyboard Shortcuts… is a catalog command on Cmd+Alt+Shift+K', () => {
  const cmd = COMMANDS_BY_ID.get('edit.keyboardShortcuts');
  assert.deepEqual(cmd.menu, ['Edit']);
  assert.equal(cmd.label, 'Keyboard Shortcuts…');
  const e = { code: 'KeyK', key: 'K', metaKey: true, altKey: true, shiftKey: true };
  assert.equal(commandForKey(e), cmd);
});

test('the command opens the dialog grouped by top menu, then Tools', () => {
  const { doc, modal } = opened();
  assert.equal(modal.classList.contains('hidden'), false);
  const titles = [...doc.querySelectorAll('.shortcut-section h3')].map((h) => h.textContent);
  assert.deepEqual(titles.slice(0, 2), ['File', 'Edit']);
  assert.equal(titles.at(-1), 'Tools');
  assert.ok(titles.indexOf('Filter') > titles.indexOf('Select'));
  const rows = visibleRows(doc);
  assert.ok(rows.some(([l, k]) => l === 'Undo' && k === 'Ctrl+Z'));
  const edit = [...doc.querySelectorAll('.shortcut-section')].find(
    (s) => s.querySelector('h3').textContent === 'Edit'
  );
  assert.ok(edit.textContent.includes('Undo'));
  const tools = doc.querySelectorAll('.shortcut-section')[titles.length - 1];
  const brush = [...tools.querySelectorAll('.shortcut-row')].find(
    (r) => r.querySelector('.shortcut-label').textContent === 'Brush'
  );
  assert.equal(brush.querySelector('.shortcut-key').textContent, 'B');
  assert.match(modal.textContent, /fixed/);
});

test('every command and every tool with a key is listed', () => {
  const sections = shortcutSections(COMMANDS);
  const count = sections.slice(0, -1).reduce((n, s) => n + s.rows.length, 0);
  assert.equal(count, COMMANDS.length);
  const tools = sections.at(-1).rows;
  assert.ok(tools.some((r) => r.label === 'Move' || r.shortcut === 'V'));
  assert.ok(tools.some((r) => r.shortcut === 'M'));
});

test('the search field filters rows to the query', () => {
  const { window, doc } = opened();
  const search = doc.getElementById('shortcuts-search');
  search.value = 'blur';
  search.dispatchEvent(new window.Event('input'));
  const rows = visibleRows(doc);
  assert.ok(rows.length > 5);
  for (const [label, key] of rows) assert.match(`${label} ${key}`, /blur/i);
  assert.ok(rows.some(([l]) => l === 'Blur > Gaussian Blur…'));
  assert.ok(!rows.some(([l]) => l === 'Undo'));
  // Sections with nothing left are hidden.
  const file = [...doc.querySelectorAll('.shortcut-section')].find(
    (s) => s.querySelector('h3').textContent === 'File'
  );
  assert.equal(file.hidden, true);

  search.value = '';
  search.dispatchEvent(new window.Event('input'));
  assert.ok(visibleRows(doc).some(([l]) => l === 'Undo'));
});

test('Escape closes the dialog without reaching the app', () => {
  const { window, doc, modal } = opened();
  let reached = false;
  doc.addEventListener('keydown', () => (reached = true));
  modal.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(reached, false);
});
