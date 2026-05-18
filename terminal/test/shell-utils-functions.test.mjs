import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShellCore } from '../lib/shell-core.js';

test('parseFunctionDefinition: name() { body }', () => {
  const r = ShellCore.parseFunctionDefinition('greet() { echo hi }');
  assert.equal(r.ok, true);
  assert.equal(r.name, 'greet');
  assert.equal(r.body, 'echo hi');
});

test('parseFunctionDefinition: function NAME { body }', () => {
  const r = ShellCore.parseFunctionDefinition('function greet { echo hi }');
  assert.equal(r.ok, true);
  assert.equal(r.name, 'greet');
});

test('parseFunctionDefinition: function NAME() { body }', () => {
  const r = ShellCore.parseFunctionDefinition('function greet() { echo hi }');
  assert.equal(r.ok, true);
  assert.equal(r.name, 'greet');
});

test('parseFunctionDefinition: extra whitespace', () => {
  const r = ShellCore.parseFunctionDefinition('  foo  ( )  {   echo   hi   }  ');
  assert.equal(r.ok, true);
  assert.equal(r.name, 'foo');
  assert.equal(r.body, 'echo   hi');
});

test('parseFunctionDefinition: not a function', () => {
  assert.equal(ShellCore.parseFunctionDefinition('echo hi').ok, false);
  assert.equal(ShellCore.parseFunctionDefinition('greet()').ok, false);
  assert.equal(ShellCore.parseFunctionDefinition('greet() echo hi').ok, false);
});

test('parseFunctionDefinition: name rules', () => {
  assert.equal(ShellCore.parseFunctionDefinition('1foo() { x }').ok, false);
  assert.equal(ShellCore.parseFunctionDefinition('foo-bar() { x }').ok, false);
  assert.equal(ShellCore.parseFunctionDefinition('_underscore() { x }').ok, true);
});
