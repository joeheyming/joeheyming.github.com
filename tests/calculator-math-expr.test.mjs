import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileExpression } from '../calculator/math-expr.js';

/**
 * @param {string} source
 * @param {number} x
 */
function evalAt(source, x) {
  const result = compileExpression(source);
  assert.ok(!('error' in result), result.error);
  return result.evaluate(x);
}

test('compileExpression evaluates polynomials', () => {
  assert.equal(evalAt('x^2 + 2*x + 1', 3), 16);
  assert.equal(evalAt('2*x - 1', 4), 7);
});

test('compileExpression supports trig and constants', () => {
  assert.ok(Math.abs(evalAt('sin(x)', Math.PI / 2) - 1) < 1e-10);
  assert.ok(Math.abs(evalAt('cos(0)', 5) - 1) < 1e-10);
  assert.ok(Math.abs(evalAt('pi', 0) - Math.PI) < 1e-10);
});

test('compileExpression reports parse errors', () => {
  const bad = compileExpression('sin x');
  assert.ok('error' in bad);
});

test('compileExpression supports log and nested calls', () => {
  assert.equal(evalAt('log(100)', 0), 2);
  assert.ok(Math.abs(evalAt('sqrt(sin(x)^2 + cos(x)^2)', 2.5) - 1) < 1e-10);
});
