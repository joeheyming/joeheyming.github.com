import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { blockIndexOnPage } from '../read/place.js';
import {
  blocksFromFile,
  blocksFromHtml,
  blocksFromMarkdown,
  DocumentError,
  EMPTY,
  SCAN,
  speechChunks,
  TOO_BIG,
  UNSUPPORTED
} from '../read/prose.js';
import { textFromPdfItems } from '../read/pdf-text.js';
import { SpeechReader } from '../read/speech.js';
import { attachListen, sortVoices } from '../read/listen.js';

test('the book title starts past Menu and stays put when Menu is absent', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../read/style.css'),
    'utf8'
  );
  assert.match(css, /html:has\(\.heyming-nav-toggle\) #reader-title\s*\{[^}]*120px/);
  assert.match(
    css,
    /@media \(max-width: 640px\) \{[^}]*html:has\(\.heyming-nav-toggle\) #reader-title\s*\{[^}]*100px/s
  );
});

test('markdown keeps the words and drops the syntax', () => {
  const blocks = blocksFromMarkdown(`---
title: Notes
---

# The River

See [the guide](https://example.com/a_b) for **details**.

\`\`\`js
const skip = noisy(syntax);
\`\`\`

The \`lock\` holds.

- one item
- two items

![a heron](heron.png)
`);
  assert.deepEqual(
    blocks.map((block) => block.text),
    [
      'The River',
      'See the guide for details.',
      'The lock holds.',
      'one item',
      'two items',
      'a heron'
    ]
  );
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'paragraph');
  assert.equal(
    blocks
      .map((block) => block.text)
      .join('\n')
      .includes('noisy'),
    false
  );
});

test('html keeps headings and paragraphs and drops scripts, nav, and code', () => {
  const { window } = new JSDOM('');
  const blocks = blocksFromHtml(
    `<!doctype html><html><head><style>p{}</style></head><body>
      <nav>Skip me</nav>
      <h1>Title</h1>
      <p>See <a href="https://example.com/x">the guide</a>.</p>
      <pre>const x = 1;</pre>
      <script>alert(1)</script>
    </body></html>`,
    window.DOMParser
  );
  assert.deepEqual(
    blocks.map((block) => block.text),
    ['Title', 'See the guide.']
  );
});

test('plain text drops a paragraph that is only an address', async () => {
  const file = new File(['Read this.\n\nhttps://example.com/a\n\nDone.'], 'notes.txt', {
    type: 'text/plain'
  });
  const doc = await blocksFromFile(file);
  assert.deepEqual(
    doc.blocks.map((block) => block.text),
    ['Read this.', 'Done.']
  );
});

test('a word processor file is refused before it opens', async () => {
  const file = new File(['x'], 'Book.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  await assert.rejects(blocksFromFile(file), (err) => {
    assert.ok(err instanceof DocumentError);
    assert.equal(err.message, UNSUPPORTED);
    return true;
  });
});

test('an empty file and an oversized file are refused', async () => {
  const empty = new File(['# \n\n***\n'], 'blank.md', { type: 'text/markdown' });
  await assert.rejects(blocksFromFile(empty), (err) => err.message === EMPTY);

  const big = new File(['hello'], 'notes.txt', { type: 'text/plain' });
  await assert.rejects(blocksFromFile(big, { maxBytes: 4 }), (err) => err.message === TOO_BIG);
});

test('a pdf with no words is reported as a scan', async () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'scan.pdf', { type: 'application/pdf' });
  await assert.rejects(blocksFromFile(file, { readPdf: async () => '   \n\n' }), (err) => {
    assert.equal(err.message, SCAN);
    return true;
  });
});

test('pdf lines join words, drop page numbers, and heal a hyphen', () => {
  const text = textFromPdfItems([
    { str: 'listen-', transform: [1, 0, 0, 1, 0, 120], width: 40 },
    { str: 'ing', transform: [1, 0, 0, 1, 0, 100], width: 20 },
    { str: 'hello', transform: [1, 0, 0, 1, 0, 80], width: 20 },
    { str: 'world', transform: [1, 0, 0, 1, 28, 80], width: 20 },
    { str: '4', transform: [1, 0, 0, 1, 0, 40], width: 8 }
  ]);
  assert.equal(text.includes('listening'), true);
  assert.equal(text.includes('hello world'), true);
  assert.equal(text.includes('\n4'), false);
  assert.equal(text.trim().endsWith('4'), false);
});

test('speech stays on the sentence and keeps an abbreviation together', () => {
  const chunks = speechChunks('Mr. Smith went home. Then he left.', 25);
  assert.equal(chunks[0].includes('Mr. Smith'), true);
  assert.equal(chunks[0].includes('Then'), false);
  for (const chunk of speechChunks('A'.repeat(400), 160)) assert.ok(chunk.length <= 160);
});

test('the block on the page is the one whose top is in view', () => {
  assert.equal(blockIndexOnPage([0, 100, 200], 0, 150), 0);
  assert.equal(blockIndexOnPage([0, 100, 200], 100, 150), 1);
  assert.equal(blockIndexOnPage([], 0, 100), -1);
});

class FakeUtterance {
  /**
   * @param {string} text
   */
  constructor(text) {
    this.text = text;
    this.rate = 1;
    /** @type {SpeechSynthesisVoice | null} */
    this.voice = null;
    this.lang = '';
    /** @type {(() => void) | null} */
    this.onend = null;
    /** @type {((event: { error: string }) => void) | null} */
    this.onerror = null;
  }
}

class FakeSynth {
  constructor() {
    this.speaking = false;
    /** @type {FakeUtterance | null} */
    this.current = null;
    /** @type {string[]} */
    this.spoken = [];
  }

  getVoices() {
    return [];
  }

  cancel() {
    this.speaking = false;
    const current = this.current;
    this.current = null;
    current?.onerror?.({ error: 'canceled' });
  }

  /**
   * @param {FakeUtterance} utterance
   */
  speak(utterance) {
    this.current = utterance;
    this.speaking = true;
    this.spoken.push(utterance.text);
  }

  finish() {
    const current = this.current;
    this.current = null;
    this.speaking = false;
    current?.onend?.();
  }
}

test('a chosen voice is used and switching restarts the same words', () => {
  const synth = new FakeSynth();
  const speech = new SpeechReader(synth, { gapMs: 0, Utterance: FakeUtterance });
  speech.load(['Hello there.']);
  speech.play(0, true);
  const voice = /** @type {SpeechSynthesisVoice} */ ({ name: 'Samantha', lang: 'en-US' });
  speech.setVoice(voice);
  assert.deepEqual(synth.spoken, ['Hello there.', 'Hello there.']);
  assert.equal(synth.current?.voice, voice);
  assert.equal(synth.current?.lang, 'en-US');
});

test('voices in the reader language come first', () => {
  const voices = /** @type {SpeechSynthesisVoice[]} */ ([
    { name: 'Thomas', lang: 'fr-FR', voiceURI: 'fr' },
    { name: 'Zoe', lang: 'en-US', voiceURI: 'z' },
    { name: 'Alex', lang: 'en-GB', voiceURI: 'a' }
  ]);
  assert.deepEqual(
    sortVoices(voices, 'en-US').map((voice) => voice.name),
    ['Alex', 'Zoe', 'Thomas']
  );
});

test('a paragraph click jumps only once listening started, and the button shows the state', async () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
  const dom = new JSDOM('<button id="b"></button><select id="v"></select>');
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = dom.window.document;
  globalThis.window = /** @type {Window & typeof globalThis} */ (dom.window);
  try {
    const synth = new FakeSynth();
    globalThis.SpeechSynthesisUtterance = FakeUtterance;
    /** @type {number[]} */
    const spokenBlocks = [];
    const reader = {
      onBlockClick: null,
      onUserPageTurn: null,
      speakableTexts: () => ['First.', 'Second.', 'Third.'],
      firstBlockOnPage: () => 0,
      blockTops: () => [0, 100, 200],
      pageViewHeight: () => 300,
      isBlockOnPage: () => true,
      scrollBlockToTop: () => {},
      setSpeakingBlock: (/** @type {number} */ index) => spokenBlocks.push(index),
      clearSpeaking: () => {},
      setListening: () => {}
    };
    const button = dom.window.document.getElementById('b');
    attachListen({
      reader: /** @type {never} */ (reader),
      button: /** @type {HTMLButtonElement} */ (button),
      voiceSelect: /** @type {HTMLSelectElement} */ (dom.window.document.getElementById('v')),
      synth: /** @type {never} */ (synth),
      onUnavailable: () => {},
      onEmpty: () => {}
    });
    assert.equal(button.querySelectorAll('polygon').length, 1, 'play triangle');
    assert.equal(reader.onBlockClick(2), false, 'no jump before Listen');

    button.click();
    assert.equal(button.getAttribute('aria-label'), 'Pause');
    assert.equal(button.querySelectorAll('rect').length, 2, 'pause bars');

    assert.equal(reader.onBlockClick(2), true);
    await settle();
    assert.equal(synth.spoken.at(-1), 'Third.');
    assert.equal(spokenBlocks.at(-1), 2);

    button.click();
    assert.equal(button.getAttribute('aria-label'), 'Listen');
    assert.equal(reader.onBlockClick(1), true, 'a paused session still jumps');
    await settle();
    assert.equal(synth.spoken.at(-1), 'Second.');
  } finally {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    delete globalThis.SpeechSynthesisUtterance;
  }
});

test('speech walks blocks and a pause stays on the same words', () => {
  const synth = new FakeSynth();
  const speech = new SpeechReader(synth, { gapMs: 0, Utterance: FakeUtterance });
  /** @type {number[]} */
  const blocks = [];
  speech.onBlock = (index) => blocks.push(index);
  speech.load(['Hello there.', 'Second sentence here.']);
  speech.play(0, true);
  assert.deepEqual(synth.spoken, ['Hello there.']);
  assert.deepEqual(blocks, [0]);

  speech.pause();
  synth.finish();
  assert.deepEqual(synth.spoken, ['Hello there.']);

  speech.resume();
  assert.deepEqual(synth.spoken, ['Hello there.', 'Hello there.']);

  synth.finish();
  assert.deepEqual(blocks, [0, 0, 1]);
  assert.equal(synth.spoken.at(-1), 'Second sentence here.');

  let ended = false;
  speech.onEnd = () => {
    ended = true;
  };
  synth.finish();
  assert.equal(ended, true);
  assert.equal(speech.playing, false);
});
