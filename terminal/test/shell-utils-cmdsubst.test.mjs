import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShellCore } from '../lib/shell-core.js';

test('extractCommandSubstitutions: no substitution', () => {
  const parts = ShellCore.extractCommandSubstitutions('echo hi');
  assert.deepEqual(parts, [{ type: 'text', value: 'echo hi' }]);
});

test('extractCommandSubstitutions: $(...)', () => {
  const parts = ShellCore.extractCommandSubstitutions('echo $(date)');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].type, 'text');
  assert.equal(parts[0].value, 'echo ');
  assert.equal(parts[1].type, 'subst');
  assert.equal(parts[1].inner, 'date');
  assert.equal(parts[1].kind, 'dollar');
});

test('extractCommandSubstitutions: nested $(...)', () => {
  const parts = ShellCore.extractCommandSubstitutions('echo $(echo $(date))');
  assert.equal(parts.length, 2);
  assert.equal(parts[1].inner, 'echo $(date)');
});

test('extractCommandSubstitutions: backticks', () => {
  const parts = ShellCore.extractCommandSubstitutions('echo `date`');
  assert.equal(parts[1].type, 'subst');
  assert.equal(parts[1].inner, 'date');
  assert.equal(parts[1].kind, 'backtick');
});

test('extractCommandSubstitutions: single quotes suppress', () => {
  const parts = ShellCore.extractCommandSubstitutions("echo '$(date)'");
  assert.equal(parts.length, 1);
  assert.equal(parts[0].value, "echo '$(date)'");
});

test('extractCommandSubstitutions: double quotes do not suppress', () => {
  const parts = ShellCore.extractCommandSubstitutions('echo "$(date)"');
  assert.equal(parts.length, 3);
  assert.equal(parts[1].type, 'subst');
  assert.equal(parts[1].inner, 'date');
});

test('extractCommandSubstitutions: $( inside string with unmatched paren stays literal', () => {
  const parts = ShellCore.extractCommandSubstitutions('echo $(unclosed');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].value, 'echo $(unclosed');
});

test('spliceCommandSubstitutions: joins text + results', () => {
  const parts = ShellCore.extractCommandSubstitutions('a$(x)b$(y)c');
  const out = ShellCore.spliceCommandSubstitutions(parts, ['XX', 'YY']);
  assert.equal(out, 'aXXbYYc');
});

test('extractCommandSubstitutions: multiple substitutions in one arg', () => {
  const parts = ShellCore.extractCommandSubstitutions('echo $(a) and $(b)');
  const substs = parts.filter((p) => p.type === 'subst');
  assert.equal(substs.length, 2);
  assert.equal(substs[0].inner, 'a');
  assert.equal(substs[1].inner, 'b');
});
