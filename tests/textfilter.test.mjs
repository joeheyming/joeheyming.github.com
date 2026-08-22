// Verifies the pinned CDN mapping without network or browser startup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOXICITY_URL } from '../posts/textfilter.js';

test('toxicity URL pins tfjs core and converter to 4.22.0', () => {
  assert.match(TOXICITY_URL, /@tensorflow\/tfjs-core@4\.22\.0/);
  assert.match(TOXICITY_URL, /@tensorflow\/tfjs-converter@4\.22\.0/);
  assert.doesNotMatch(TOXICITY_URL, /@tensorflow\/tfjs-core@\^1/);
});
