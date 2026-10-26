import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { DEFAULT_DOC_NAME, docTabText, updateDocTab } from '../paint/doc-tab.js';
import { deserializeProject, serializeProject } from '../paint/project.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../paint/style.css', import.meta.url), 'utf8');

function load() {
  return new JSDOM(html).window.document;
}

test('.doc-tab is the second row of .paint-layout, between the menu bar and options bar', () => {
  const document = load();
  const rows = [...document.querySelector('.paint-layout').children];
  assert.equal(rows[0].id, 'menu-bar');
  assert.ok(rows[1].classList.contains('doc-tab'));
  assert.equal(rows[2].id, 'options-bar');
});

test('the tab reads Untitled-1 @ 100% (RGB/8) by default', () => {
  const document = load();
  const title = document.querySelector('.doc-tab #doc-tab-title');
  assert.equal(title.textContent.trim(), 'Untitled-1 @ 100% (RGB/8)');
  assert.equal(DEFAULT_DOC_NAME, 'Untitled-1');
  assert.equal(docTabText(DEFAULT_DOC_NAME, 1), title.textContent.trim());
});

test('the tab follows the zoom and the document name', () => {
  const document = load();
  const title = document.getElementById('doc-tab-title');
  updateDocTab({ docName: 'Untitled-1', zoom: 2 }, title);
  assert.equal(title.textContent, 'Untitled-1 @ 200% (RGB/8)');
  updateDocTab({ docName: 'Beach', zoom: 0.333 }, title);
  assert.equal(title.textContent, 'Beach @ 33% (RGB/8)');
  updateDocTab({ zoom: 1 }, title);
  assert.equal(title.textContent, 'Untitled-1 @ 100% (RGB/8)');
});

test('docName round-trips through .paintproj; a project without it opens as Untitled-1', async () => {
  const state = { docName: 'Beach', bgColor: '#ffffff', color: '#000000', layers: [], objects: [] };
  const data = JSON.parse(JSON.stringify(serializeProject(state, 4, 4)));
  assert.equal(data.docName, 'Beach');
  let out = null;
  await deserializeProject(data, (o) => (out = o));
  assert.equal(out.docName, 'Beach');

  delete data.docName;
  await deserializeProject(data, (o) => (out = o));
  assert.equal(out.docName, 'Untitled-1');
});

test('the doc tab clears the compact nav toggle', () => {
  const px = (block) => {
    const m = block.match(/padding(?:-left)?:\s*([^;]+);/);
    assert.ok(m, block);
    const parts = m[1].trim().split(/\s+/);
    return parseInt(m[0].includes('padding-left') ? parts[0] : parts[3] ?? parts[1], 10);
  };
  const base = css.match(/\n\.doc-tab \{[^}]*\}/)[0];
  assert.ok(px(base) >= 120, `desktop padding-left ${px(base)}`);
  const narrow = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/)[0];
  const narrowTab = narrow.match(/\.doc-tab \{[^}]*\}/)[0];
  assert.ok(px(narrowTab) >= 100, `640px padding-left ${px(narrowTab)}`);
});
