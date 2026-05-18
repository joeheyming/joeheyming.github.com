import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderJshOverviewPage, buildJshFallbackPage } from '../commands/system/man.js';

test('buildJshFallbackPage: contains JSH(1) title and capability section', () => {
  const page = buildJshFallbackPage();
  assert.match(page, /^JSH\(1\)/);
  assert.match(page, /CAPABILITIES/);
  assert.match(page, /LIMITATIONS/);
  assert.match(page, /SEE ALSO/);
});

test('renderJshOverviewPage: falls back to inline page when fetch is missing', async () => {
  const origFetch = globalThis.fetch;
  // @ts-expect-error - simulate non-browser environment
  globalThis.fetch = undefined;
  try {
    const page = await renderJshOverviewPage();
    assert.match(page, /^JSH\(1\)/);
    assert.match(page, /CAPABILITIES/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('renderJshOverviewPage: uses fetched spec text when available', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async text() {
      return '# jsh — what we claim vs bash\n\n' + 'x'.repeat(200) + '\n';
    }
  });
  try {
    const page = await renderJshOverviewPage();
    assert.match(page, /^JSH\(1\)/);
    assert.match(page, /jsh — what we claim/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('renderJshOverviewPage: falls back if fetch throws', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('net down');
  };
  try {
    const page = await renderJshOverviewPage();
    assert.match(page, /^JSH\(1\)/);
    assert.match(page, /CAPABILITIES/);
  } finally {
    globalThis.fetch = origFetch;
  }
});
