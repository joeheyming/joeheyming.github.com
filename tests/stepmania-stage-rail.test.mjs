import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

import { syncStageRail } from '../stepmania/js/stageRail.js';

function mount() {
  const dom = new JSDOM(`<!doctype html><body>
    <div class="sm-toolbar">
      <div id="sm-play-rail" class="sm-play-rail">
        <button id="restart-btn" type="button">Restart</button>
        <button id="settings-btn" type="button">Keys</button>
        <button id="scoreToggle" type="button">Score</button>
        <div class="sm-speed"></div>
      </div>
      <difficulty-selector id="chart"></difficulty-selector>
    </div>
    <div id="sm-micro" class="is-home"></div>
  </body>`);
  globalThis.document = dom.window.document;
  return dom.window.document;
}

test('play controls stay in the header on the song menu', () => {
  const document = mount();
  document.getElementById('sm-micro').classList.add('sm-stage-roomy');
  syncStageRail();
  const rail = document.getElementById('sm-play-rail');
  assert.equal(rail.parentElement.className, 'sm-toolbar');
  assert.equal(rail.nextElementSibling.id, 'chart');
});

test('play controls move beside the lanes once a chart is showing', () => {
  const document = mount();
  const stage = document.getElementById('sm-micro');
  stage.classList.add('sm-stage-roomy');
  stage.classList.remove('is-home');
  syncStageRail();
  assert.equal(document.getElementById('sm-play-rail').parentElement, stage);
});

test('play controls return to the header when the stage has no gutter', () => {
  const document = mount();
  const stage = document.getElementById('sm-micro');
  const rail = document.getElementById('sm-play-rail');
  stage.classList.remove('is-home');
  stage.classList.add('sm-stage-roomy');
  syncStageRail();
  stage.classList.remove('sm-stage-roomy');
  syncStageRail();
  assert.equal(rail.parentElement.className, 'sm-toolbar');
  assert.equal(rail.nextElementSibling.id, 'chart');
});
