import test from 'node:test';
import assert from 'node:assert/strict';

import { adjacentChartIndex } from '../chartNavigation.js';

const charts = [
  { type: 'dance-single', difficulty: 'Hard', rating: 9 },
  { type: 'dance-double', difficulty: 'Easy', rating: 4 },
  { type: 'dance-single', difficulty: 'Beginner', rating: 2 },
  { type: 'dance-single', difficulty: 'Medium', rating: 6 },
  { type: 'dance-single', difficulty: 'Challenge', rating: 12 }
];

test('F5/F6 order same-type charts by difficulty', () => {
  assert.equal(adjacentChartIndex(charts, 2, 1), 3);
  assert.equal(adjacentChartIndex(charts, 3, 1), 0);
  assert.equal(adjacentChartIndex(charts, 0, 1), 4);
  assert.equal(adjacentChartIndex(charts, 4, -1), 0);
});

test('chart navigation excludes other step types', () => {
  assert.equal(adjacentChartIndex(charts, 1, 1), 1);
  assert.equal(adjacentChartIndex(charts, 1, -1), 1);
});

test('chart navigation does not wrap at either end', () => {
  assert.equal(adjacentChartIndex(charts, 2, -1), 2);
  assert.equal(adjacentChartIndex(charts, 4, 1), 4);
});

test('unknown current chart is left unchanged', () => {
  assert.equal(adjacentChartIndex(charts, 99, 1), 99);
});
