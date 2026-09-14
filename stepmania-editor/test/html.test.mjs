import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../index.html'),
  'utf8'
);

describe('stepmania-editor index.html', () => {
  it('allows indexing and has a canonical URL', () => {
    assert.match(html, /name="robots" content="index, follow"/);
    assert.match(html, /rel="canonical" href="https:\/\/joeheyming.github.io\/stepmania-editor\/"/);
    assert.match(html, /<title>StepMania Editor — Make a Simfile Pack/);
  });

  it('loads JSZip and the editor module', () => {
    assert.match(html, /jszip/);
    assert.match(html, /type="module" src="index.js"/);
  });

  it('makes the chart workspace primary and setup panels secondary', () => {
    assert.match(html, /class="ed-guide" aria-label="Editor controls"/);
    assert.match(html, /class="ed-info" aria-label="Chart information"/);
    assert.match(html, /id="song-panel" aria-label="Song setup"/);
    assert.match(html, /id="timing-panel" aria-label="Timing setup"/);
    assert.match(html, /aria-controls="song-panel" aria-expanded="false"/);
    assert.match(html, /aria-controls="timing-panel"/);
  });

  it('exposes native-style live editor information', () => {
    for (const id of [
      'info-beat',
      'info-second',
      'info-snap',
      'info-selection',
      'info-taps',
      'info-holds',
      'info-rolls',
      'info-mines',
      'info-lifts',
      'info-fakes',
      'info-timing-mode',
      'info-offset'
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), id);
    }
  });

  it('hosts full gameplay as an editor preview state', () => {
    assert.match(html, /src="\/coi-serviceworker\.js"/);
    assert.match(html, /id="game-preview"[^>]*hidden/);
    assert.match(html, /id="editor-gameplay-surface"/);
    assert.match(html, /id="editor-gameplay-video"/);
    assert.match(html, /id="editor-gameplay-audio"/);
    assert.match(html, /id="btn-return-to-edit"/);
  });

  it('launches gameplay in place rather than navigating away', () => {
    assert.match(html, /<button type="button" class="ed-play" id="btn-play-sm">/);
    assert.doesNotMatch(html, /id="btn-play-sm"[^>]*href=/);
  });
});
