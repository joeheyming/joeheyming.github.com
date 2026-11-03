import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem(key) {
    return mem.has(key) ? mem.get(key) : null;
  },
  setItem(key, value) {
    mem.set(key, String(value));
  },
  removeItem(key) {
    mem.delete(key);
  }
};

const {
  bySymbol,
  registerCustomElement,
  removeCustomElement,
  formatCustomSymbol,
  isRealElementSymbol
} = await import('../periodic-speller/elements.js');
const { decomposeWord } = await import('../periodic-speller/decompose.js');

function spell(word) {
  return decomposeWord(word).map(function (item) {
    return item.unmatched ? item.unmatched : item.symbol;
  });
}

test('formatCustomSymbol titles a chord and stops at six letters', function () {
  assert.equal(formatCustomSymbol('rT'), 'Rt');
  assert.equal(formatCustomSymbol('  xyz!!'), 'Xyz');
  assert.equal(formatCustomSymbol('robertx'), 'Robert');
  assert.equal(formatCustomSymbol(''), '');
});

test('real element symbols stay preferred and cannot be overwritten', function () {
  assert.equal(isRealElementSymbol('He'), true);
  assert.equal(isRealElementSymbol('rt'), false);
  assert.deepEqual(spell('he'), ['He']);
  assert.deepEqual(spell('co'), ['Co']);
  assert.deepEqual(spell('bacon'), ['Ba', 'Co', 'N']);
  assert.deepEqual(spell('genius'), ['Ge', 'Ni', 'U', 'S']);

  var helium = bySymbol.he.name;
  assert.match(registerCustomElement('He', 'Nope', 200), /already a real element/);
  assert.equal(bySymbol.he.name, helium);
  assert.equal(bySymbol.he.custom, undefined);
});

test('a custom symbol can chord letters that are not elements', function () {
  assert.deepEqual(spell('rt'), ['r', 't']);
  try {
    assert.equal(registerCustomElement('rt', 'Rutium', 119), '');
    assert.equal(bySymbol.rt.symbol, 'Rt');
    assert.equal(bySymbol.rt.custom, true);
    assert.deepEqual(spell('rt'), ['Rt']);
    assert.deepEqual(spell('start'), ['S', 'Ta', 'Rt']);
    assert.deepEqual(spell('robert'), ['r', 'O', 'Be', 'Rt']);

    assert.equal(registerCustomElement('r', 'Rium', 121), '');
    assert.deepEqual(spell('rt'), ['Rt']);
    assert.deepEqual(spell('r'), ['R']);

    assert.equal(registerCustomElement('xyz', 'Xyzium', 120), '');
    assert.deepEqual(spell('xyz'), ['Xyz']);
  } finally {
    removeCustomElement('rt');
    removeCustomElement('r');
    removeCustomElement('xyz');
  }

  assert.deepEqual(spell('rt'), ['r', 't']);
  assert.deepEqual(spell('xyz'), ['x', 'Y', 'z']);
});
