import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShellCore } from '../lib/shell-core.js';
import { EnvLib } from '../commands/system/env-lib.js';

const { parseHelpArgs } = ShellCore;

const { ENV_HELP, parseEnvArgv } = EnvLib;

test('parseEnvArgv: -i, -u, --unset, -iu, rest, errors', () => {
  assert.match(ENV_HELP, /ignore-environment/);
  assert.match(ENV_HELP, /--unset/);

  assert.deepEqual(parseEnvArgv([]), {
    ok: true,
    ignore: false,
    unset: [],
    rest: []
  });
  assert.deepEqual(parseEnvArgv(['-i']), {
    ok: true,
    ignore: true,
    unset: [],
    rest: []
  });
  assert.deepEqual(parseEnvArgv(['-u', 'FOO']), {
    ok: true,
    ignore: false,
    unset: ['FOO'],
    rest: []
  });
  assert.deepEqual(parseEnvArgv(['-iu', 'FOO']), {
    ok: true,
    ignore: true,
    unset: ['FOO'],
    rest: []
  });
  assert.deepEqual(parseEnvArgv(['--unset=FOO']), {
    ok: true,
    ignore: false,
    unset: ['FOO'],
    rest: []
  });
  assert.deepEqual(parseEnvArgv(['--unset', 'BAR']), {
    ok: true,
    ignore: false,
    unset: ['BAR'],
    rest: []
  });
  assert.deepEqual(parseEnvArgv(['FOO=1']), {
    ok: true,
    ignore: false,
    unset: [],
    rest: ['FOO=1']
  });
  assert.deepEqual(parseEnvArgv(['-i', 'X=2']), {
    ok: true,
    ignore: true,
    unset: [],
    rest: ['X=2']
  });
  assert.deepEqual(parseEnvArgv(['-u', 'A', 'B=3']), {
    ok: true,
    ignore: false,
    unset: ['A'],
    rest: ['B=3']
  });

  assert.equal(parseEnvArgv(['--help']).help, true);

  const missU = parseEnvArgv(['-u']);
  assert.equal(missU.ok, false);
  assert.match(String(missU.stderr), /requires an argument/);

  const badUi = parseEnvArgv(['-ui']);
  assert.equal(badUi.ok, false);
  assert.match(String(badUi.stderr), /invalid option/);

  const badLong = parseEnvArgv(['--foo']);
  assert.equal(badLong.ok, false);
  assert.match(String(badLong.stderr), /unrecognized option/);
});

test('parseHelpArgs: topic', () => {
  const r = parseHelpArgs(['cat']);
  assert.equal(r.ok, true);
  assert.equal(r.sawHelpFlag, false);
  assert.deepEqual(r.rest, ['cat']);
});

test('parseHelpArgs: -- topic', () => {
  const r = parseHelpArgs(['--', '-v']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rest, ['-v']);
});

test('parseHelpArgs: too many topics', () => {
  const r = parseHelpArgs(['a', 'b']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
});

test('parseHelpArgs: -h with extra operand', () => {
  const r = parseHelpArgs(['-h', 'cat']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
});

test('parseHelpArgs: invalid option', () => {
  const r = parseHelpArgs(['-x']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 2);
  assert.ok(String(r.stderr).includes('invalid option'));
});
