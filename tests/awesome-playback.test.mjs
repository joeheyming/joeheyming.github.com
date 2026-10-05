import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadAwesome() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'http://localhost/'
  });
  dom.window.eval(readFileSync(path.join(ROOT, 'awesome/awesome.js'), 'utf8'));
  return dom;
}

test('play handles a rejected audio promise without starting effects', async () => {
  const dom = loadAwesome();
  const error = new dom.window.DOMException('Playback was blocked', 'NotAllowedError');
  let playCalls = 0;
  const warnings = [];
  dom.window.console.warn = (...args) => warnings.push(args);
  const instance = {
    audio: {
      play() {
        playCalls += 1;
        return Promise.reject(error);
      }
    }
  };

  await dom.window.awesomeNamespace.Awesome.prototype.play.call(instance);

  assert.equal(playCalls, 1);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1], error);
  dom.window.close();
});

test('audio play event starts the timer and visual effects', () => {
  const dom = loadAwesome();
  const calls = [];
  dom.window.cursorNamespace = { enable: () => calls.push('cursor') };
  dom.window.discoNamespace = { enable: () => calls.push('disco') };
  dom.window.fireworksNamespace = {
    enable: (interval) => calls.push(`fireworks:${interval}`)
  };
  dom.window.heymingAchievements = { unlockForCurrentApp: () => calls.push('achievement') };
  const instance = { showTimer: () => calls.push('timer') };

  dom.window.awesomeNamespace.Awesome.prototype.onAudioPlay.call(instance);

  assert.deepEqual(calls, ['timer', 'achievement', 'cursor', 'disco', 'fireworks:3000']);
  dom.window.close();
});
