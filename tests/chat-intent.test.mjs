// Unit tests for detectActionIntent.
//
// Critical: every failing case here corresponds to a real production
// log where the user asked for code action and the assistant just
// wrote prose into chat because intent=false → tool_choice='auto'.
// If you're tempted to narrow these patterns, add a fixture from a
// new prod log first to prove you're not regressing a working case.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __internals } from '../chat/chat-client.js';

const { detectActionIntent } = __internals;

describe('detectActionIntent — explicit action verbs (all hosts)', () => {
  const cases = [
    'open paint',
    'launch terminal',
    'show me my files',
    'list ~/Documents',
    'create a hello.cpp',
    'make a shell script',
    "let's make a shell script that prints hello world",
    'add a null check to main.py',
    'fix the typo in line 32',
    'refactor this function',
    'write a function that returns 42'
  ];
  for (const text of cases) {
    it(`detects intent in "${text}"`, () => {
      assert.equal(detectActionIntent(text), true);
    });
  }
});

describe('detectActionIntent — soft requests', () => {
  // The 2026-05-19 prod-log smoking gun + its near-neighbors. These
  // ALL used to return false → tool_choice='auto' → model wrote
  // prose → no file created.
  const cases = [
    'ok so, I want a python scrip thtat syas hello world',
    'I want a python script that prints hello world',
    "I'd like a hello world program",
    'can you make a config file for me',
    'could you write a quick test',
    'please add a docstring',
    'gimme a stub for the auth module',
    'help me draft a CHANGELOG entry',
    'I need a build script'
  ];
  for (const text of cases) {
    it(`detects intent in "${text}"`, () => {
      assert.equal(detectActionIntent(text), true);
    });
  }
});

describe('detectActionIntent — artifact nouns alone', () => {
  // Even WITHOUT a clear verb, naming a code artifact in any host
  // is an action intent.
  const cases = [
    'a python script that says hello',
    'unit tests for the parser',
    'a small function in main.py',
    'config for the dev server',
    'a class hierarchy for shapes',
    'a snippet for the README'
  ];
  for (const text of cases) {
    it(`detects intent in "${text}"`, () => {
      assert.equal(detectActionIntent(text), true);
    });
  }
});

describe('detectActionIntent — Code IDE host bias', () => {
  it('treats vague non-question input as action intent', () => {
    // No verb, no noun, but clearly not a question. In code-ide the
    // ONLY way to help is to manipulate files, so default to action.
    assert.equal(detectActionIntent('something cool', { host: 'code-ide' }), true);
    assert.equal(detectActionIntent('do the thing', { host: 'code-ide' }), true);
  });

  it('does NOT force intent for clear questions in code-ide', () => {
    assert.equal(detectActionIntent('what is this file?', { host: 'code-ide' }), false);
    assert.equal(detectActionIntent('why does this break?', { host: 'code-ide' }), false);
    assert.equal(detectActionIntent('how does the parser work?', { host: 'code-ide' }), false);
    assert.equal(
      detectActionIntent('explain the diff to me', { host: 'code-ide' }),
      false
    );
  });

  it('does NOT force intent for greetings / thanks in code-ide', () => {
    assert.equal(detectActionIntent('hi', { host: 'code-ide' }), false);
    assert.equal(detectActionIntent('thanks!', { host: 'code-ide' }), false);
    assert.equal(detectActionIntent('cool', { host: 'code-ide' }), false);
  });

  it('still detects intent when artifact nouns appear, even on questions', () => {
    // "what test should I add" — the user wants a test added, even
    // though the sentence starts with "what". The artifact noun
    // "test" wins.
    assert.equal(
      detectActionIntent('what test should I add for parseLooseArgs?', { host: 'code-ide' }),
      true
    );
  });
});

describe('detectActionIntent — chat host stays conservative', () => {
  it('does NOT bias toward action for vague input in chat host', () => {
    assert.equal(detectActionIntent('something cool', { host: 'chat' }), false);
    assert.equal(detectActionIntent('do the thing', { host: 'chat' }), false);
  });

  it('default host (no opts) behaves like chat', () => {
    assert.equal(detectActionIntent('something cool'), false);
  });
});

describe('detectActionIntent — robustness', () => {
  it('returns false for non-strings / empties', () => {
    assert.equal(detectActionIntent(''), false);
    assert.equal(detectActionIntent(null), false);
    assert.equal(detectActionIntent(undefined), false);
    assert.equal(detectActionIntent(42), false);
  });
});
