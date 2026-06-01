// yes + rev: prove the pipe story.
//
// The headline is "yes can be piped to feed multiple confirmations into a
// downstream consumer." We exercise that here by treating `yesHandler`'s
// stdout as the stdin of `revHandler` and asserting we get back exactly
// N reversed lines — i.e. the consumer sees N independent records.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import yesCmd from '../commands/system/yes.js';
import revCmd from '../commands/filesystem/rev.js';

const yes = yesCmd.handler;
const rev = revCmd.handler;

// rev's handler is async and reads from terminal.stdin; build a minimal stub.
function stdinTerminal(text) {
  return {
    stdinSupplied: true,
    hasStdin: true,
    stdin: text
  };
}

// ---------------------------------------------------------------------------
// yes — argument parsing
// ---------------------------------------------------------------------------

test('yes -n 0: empty stdout, exit 0', () => {
  const r = yes(null, ['-n', '0']);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('yes -n 5: exactly 5 lines of "y\\n"', () => {
  const r = yes(null, ['-n', '5']);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, 'y\ny\ny\ny\ny\n');
});

test('yes -n 3 hello: 3 lines of "hello\\n"', () => {
  const r = yes(null, ['-n', '3', 'hello']);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, 'hello\nhello\nhello\n');
});

test('yes joins multi-word operands with single space', () => {
  const r = yes(null, ['-n', '2', 'hello', 'world']);
  assert.equal(r.stdout, 'hello world\nhello world\n');
});

test('yes --count=4 hi: long-form with = syntax', () => {
  const r = yes(null, ['--count=4', 'hi']);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, 'hi\nhi\nhi\nhi\n');
});

test('yes -- -n 5: -- ends options, treats -n and 5 as literal operands', () => {
  const r = yes(null, ['--', '-n', '5']);
  assert.equal(r.exitCode, 0);
  // Default count, joined operands.
  assert.equal(r.stdout.split('\n')[0], '-n 5');
});

test('yes --help: prints help and exits 0', () => {
  const r = yes(null, ['--help']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /Usage: yes/);
});

test('yes -n abc: invalid count, exit 1', () => {
  const r = yes(null, ['-n', 'abc']);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /invalid count: abc/);
});

test('yes -n -1: negative count rejected', () => {
  const r = yes(null, ['-n', '-1']);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /invalid count/);
});

test('yes -n 99999999999: clamps to MAX_COUNT (1_000_000)', () => {
  const r = yes(null, ['-n', '99999999999']);
  assert.equal(r.exitCode, 0);
  // 1,000,000 lines × "y\n" = 2,000,000 chars.
  assert.equal(r.stdout.length, 2_000_000);
});

test('yes -n 7 produces exactly 7 newline-terminated lines', () => {
  const r = yes(null, ['-n', '7', 'ack']);
  // A correct N-line stream split on \n yields N+1 elements (the last empty).
  const parts = r.stdout.split('\n');
  assert.equal(parts.length, 8);
  assert.equal(parts.at(-1), '');
  assert.deepEqual(parts.slice(0, -1), Array(7).fill('ack'));
});

// ---------------------------------------------------------------------------
// rev — basics (handler-level, no VFS)
// ---------------------------------------------------------------------------

test('rev: empty stdin, no operand → error', async () => {
  const r = await rev({ stdinSupplied: false, hasStdin: false, stdin: null }, []);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /missing operand/);
});

test('rev: stdin "hello\\n" → "olleh\\n"', async () => {
  const r = await rev(stdinTerminal('hello\n'), []);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, 'olleh\n');
});

test('rev: multi-line stdin reverses each line independently', async () => {
  const r = await rev(stdinTerminal('abc\ndef\nghi\n'), []);
  assert.equal(r.stdout, 'cba\nfed\nihg\n');
});

test('rev: preserves missing trailing newline', async () => {
  const r = await rev(stdinTerminal('abc\ndef'), []);
  assert.equal(r.stdout, 'cba\nfed');
});

test('rev: empty stdin → empty stdout', async () => {
  const r = await rev(stdinTerminal(''), []);
  assert.equal(r.stdout, '');
});

test('rev --help', async () => {
  const r = await rev(stdinTerminal(''), ['--help']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /Usage: rev/);
});

test('rev: surrogate-pair-aware (emoji preserved as one glyph)', async () => {
  // "a😀b" reverses character-by-character but the emoji must stay intact.
  const r = await rev(stdinTerminal('a😀b\n'), []);
  assert.equal(r.stdout, 'b😀a\n');
});

// ---------------------------------------------------------------------------
// yes | rev — the headline pipe-semantics demo
// ---------------------------------------------------------------------------

test('yes -n 3 hello | rev → 3 reversed independent lines', async () => {
  // Stage 1: yes produces a multi-line stdout.
  const yesOut = yes(null, ['-n', '3', 'hello']);
  assert.equal(yesOut.exitCode, 0);
  assert.equal(yesOut.stdout, 'hello\nhello\nhello\n');

  // Stage 2: that stdout becomes rev's stdin — exactly the contract a real
  // shell pipeline implements. The downstream consumer sees three discrete
  // records and processes each independently.
  const revOut = await rev(stdinTerminal(yesOut.stdout), []);
  assert.equal(revOut.exitCode, 0);
  assert.equal(revOut.stdout, 'olleh\nolleh\nolleh\n');

  // Sanity-check: split on \n yields N+1 parts (last is empty after trailing nl).
  const parts = revOut.stdout.split('\n');
  assert.equal(parts.length, 4);
  assert.equal(parts.at(-1), '');
  assert.deepEqual(parts.slice(0, -1), ['olleh', 'olleh', 'olleh']);
});

test('yes | rev preserves count across the pipe (N=10)', async () => {
  const yesOut = yes(null, ['-n', '10', 'abc']);
  const revOut = await rev(stdinTerminal(yesOut.stdout), []);
  // Same number of lines on both sides of the pipe.
  const yesLines = yesOut.stdout.split('\n').filter((s) => s.length > 0);
  const revLines = revOut.stdout.split('\n').filter((s) => s.length > 0);
  assert.equal(yesLines.length, 10);
  assert.equal(revLines.length, 10);
  assert.ok(revLines.every((l) => l === 'cba'));
});

test('yes -n 0 | rev → no lines flow downstream', async () => {
  const yesOut = yes(null, ['-n', '0']);
  const revOut = await rev(stdinTerminal(yesOut.stdout), []);
  assert.equal(yesOut.stdout, '');
  assert.equal(revOut.stdout, '');
});

test('downstream consumer reading line-by-line gets exactly N "y" tokens', async () => {
  // Simulates the canonical use case: `yes | some-prompt-loop`. We split
  // yes' output the way a line-based consumer would and check it sees
  // exactly N affirmative responses, in order, with no merging or loss.
  const N = 25;
  const { stdout } = yes(null, ['-n', String(N)]);
  const tokens = stdout.split('\n').slice(0, -1); // drop trailing empty
  assert.equal(tokens.length, N);
  assert.ok(tokens.every((t) => t === 'y'));
});
