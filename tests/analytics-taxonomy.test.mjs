import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED = new Set([
  'doom_engine_launched',
  'pacman_game_start',
  'song_complete',
  'watch_played',
  'speller_word_rendered',
  'content_shared',
  'exception',
  'error_occurred',
  'web_vital_inp',
  'watch_playback_error',
  'doom_flavor_failed',
  'pwa_install'
]);

const SKIP_DIRS = new Set(['.git', 'node_modules', '.playwright-cli', '.gsc-profile']);

const SKIP_FILES = new Set(['uzdoom.js']);

const CALL_RE =
  /\b(?:window\.)?(?:trackEvent|trackConversion|trackDoomEvent|trackWatch|trackWatchConversion)\(\s*(['"])([^'"]+)\1/g;
const DATA_EVENT_RE = /\bdata-event(?:-conversion)?=["']([^"']+)["']/g;
const GTAG_LITERAL_RE = /\bgtag\(\s*['"]event['"]\s*,\s*(['"`])([^'"`]+)\1/g;
const TEMPLATE_CALL_RE =
  /\b(?:window\.)?(?:trackEvent|trackConversion|trackDoomEvent|trackWatch|trackWatchConversion)\(\s*`/g;

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const rel = path.relative(ROOT, full);
    if (rel.startsWith('scripts/.gsc-profile')) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, files);
      continue;
    }
    if (SKIP_FILES.has(name)) continue;
    if (!/\.(js|mjs|html)$/.test(name)) continue;
    files.push(full);
  }
  return files;
}

test('custom GA event names stay inside the retained taxonomy', () => {
  const found = [];
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    for (const re of [CALL_RE, DATA_EVENT_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const name = m[m.length - 1];
        if (!ALLOWED.has(name)) found.push(`${rel}: ${name}`);
      }
    }
  }
  assert.deepEqual(found, [], `unexpected custom events:\n${found.join('\n')}`);
});

test('direct gtag event literals live only in analytics.js', () => {
  const found = [];
  for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file);
    if (rel === 'analytics.js') continue;
    const src = readFileSync(file, 'utf8');
    GTAG_LITERAL_RE.lastIndex = 0;
    let m;
    while ((m = GTAG_LITERAL_RE.exec(src))) {
      found.push(`${rel}: ${m[2]}`);
    }
  }
  assert.deepEqual(found, [], `direct gtag('event') outside analytics.js:\n${found.join('\n')}`);
});

test('custom GA calls do not use template-literal event names', () => {
  const found = [];
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    TEMPLATE_CALL_RE.lastIndex = 0;
    let m;
    while ((m = TEMPLATE_CALL_RE.exec(src))) {
      found.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(found, [], `template-literal GA event names:\n${found.join('\n')}`);
});
