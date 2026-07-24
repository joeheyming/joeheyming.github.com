import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  LevelValidationError,
  decodeLevelData,
  encodeLevelData,
  canonicalizeLevelData,
  normalizeLevelData,
  validateLevelData
} from '../js/level-data.js';

function validLevel() {
  return {
    scale: 10,
    numGhosts: 1,
    map: [
      [2, 2, 2, 2, 2],
      [2, 6, 1, 5, 2],
      [2, 1, 3, 1, 2],
      [2, 1, 7, 1, 2],
      [2, 2, 2, 2, 2]
    ],
    teleports: []
  };
}

test('normalizes source coordinates into world coordinates', () => {
  const normalized = normalizeLevelData(validLevel());

  assert.equal(normalized.width, 5);
  assert.equal(normalized.height, 5);
  assert.deepEqual(normalized.pacmanStart, { x: 1, y: 3, level: 0 });
  assert.deepEqual(normalized.fruitSpawn, { x: 2, y: 1, level: 0 });
  assert.equal(normalized.numGhosts, 1);
});

test('all committed Pac-Man levels pass shared validation', async () => {
  for (let index = 0; index <= 7; index++) {
    const json = await readFile(new URL(`../levels/level${index}.json`, import.meta.url), 'utf8');
    const validation = validateLevelData(JSON.parse(json));
    assert.deepEqual(validation.errors, [], `level${index} should be valid`);
  }
});

test('reports structural and authoring errors', () => {
  const ragged = validLevel();
  ragged.map[2].pop();
  assert.ok(validateLevelData(ragged).errors.some((entry) => entry.code === 'ragged_map'));

  const duplicateStart = validLevel();
  duplicateStart.map[3][1] = 6;
  assert.ok(
    validateLevelData(duplicateStart).errors.some((entry) => entry.code === 'multiple_starts')
  );
});

test('rejects unreachable collectibles', () => {
  const data = validLevel();
  data.map[1][3] = 2;
  data.map[3][3] = 5;
  data.map[2][3] = 2;
  data.map[3][2] = 2;

  assert.ok(
    validateLevelData(data).errors.some((entry) => entry.code === 'unreachable_collectibles')
  );
});

test('normalizes pair and next teleport groups', () => {
  const data = validLevel();
  data.map[1][1] = 4;
  data.map[3][3] = 4;
  data.map[3][1] = 6;
  data.teleports = [
    {
      mode: 'next',
      endpoints: [
        { x: 1, y: 1 },
        { x: 3, y: 3 }
      ]
    }
  ];

  const normalized = normalizeLevelData(data);
  assert.equal(normalized.teleportGroups[0].mode, 'next');
  assert.deepEqual(normalized.teleportGroups[0].endpoints, [
    { x: 1, y: 3, level: 0 },
    { x: 3, y: 1, level: 0 }
  ]);
});

test('pair teleports connect opposite edges and use stable endpoint order', () => {
  const data = validLevel();
  data.map[2][0] = 4;
  data.map[2][4] = 4;
  data.teleports = [
    [
      { x: 4, y: 2 },
      { x: 0, y: 2 }
    ]
  ];

  const canonical = canonicalizeLevelData(data);
  assert.deepEqual(canonical.teleports[0].endpoints, [
    { x: 0, y: 2 },
    { x: 4, y: 2 }
  ]);

  data.teleports[0][0] = { x: 3, y: 2 };
  data.map[2][4] = 1;
  data.map[2][3] = 4;
  assert.ok(
    validateLevelData(data).errors.some((entry) => entry.code === 'invalid_pair_placement')
  );
});

test('custom level codec round trips canonical level data', () => {
  const data = validLevel();
  const code = encodeLevelData(data);
  const decoded = decodeLevelData(code);

  assert.deepEqual(decoded, data);
  assert.ok(code.length < JSON.stringify(data).length * 2);
});

test('custom level codec rejects malformed payloads', () => {
  assert.throws(() => decodeLevelData('not-valid!'), LevelValidationError);
  assert.throws(() => decodeLevelData(btoa(JSON.stringify({ v: 99 }))), LevelValidationError);
  assert.throws(() => decodeLevelData('a'.repeat(10_001)), LevelValidationError);
});
