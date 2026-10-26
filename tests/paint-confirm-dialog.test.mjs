import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { initConfirmDialog } from '../paint/confirm-dialog.js';

function mount() {
  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const { window } = new JSDOM(html);
  const dialog = initConfirmDialog({ doc: window.document });
  return { dialog, doc: window.document };
}

test('openConfirm shows Cancel + OK; OK runs onOk and hides the modal', () => {
  const { dialog, doc } = mount();
  const calls = [];
  dialog.openConfirm(
    'Discard changes?',
    () => calls.push('ok'),
    () => calls.push('cancel')
  );
  const modal = doc.getElementById('confirm-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal(doc.getElementById('confirm-message').textContent, 'Discard changes?');
  assert.equal(doc.getElementById('confirm-cancel').hidden, false);
  doc.getElementById('confirm-ok').click();
  assert.deepEqual(calls, ['ok']);
  assert.equal(modal.classList.contains('hidden'), true);
});

test('Cancel runs onCancel without onOk', () => {
  const { dialog, doc } = mount();
  const calls = [];
  dialog.openConfirm(
    'Restore?',
    () => calls.push('ok'),
    () => calls.push('cancel')
  );
  doc.getElementById('confirm-cancel').click();
  assert.deepEqual(calls, ['cancel']);
});

test('openAlert hides Cancel and only needs OK', () => {
  const { dialog, doc } = mount();
  const calls = [];
  dialog.openAlert('Could not open project: boom', () => calls.push('ok'));
  assert.equal(doc.getElementById('confirm-cancel').hidden, true);
  doc.getElementById('confirm-ok').click();
  assert.deepEqual(calls, ['ok']);
});

test('paint.js does not call window.confirm or window.alert', () => {
  const src = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /(?<![\w.])confirm\(/);
  assert.doesNotMatch(src, /(?<![\w.])alert\(/);
  assert.match(src, /confirmDialog\.openConfirm/);
  assert.match(src, /confirmDialog\.openAlert/);
});
