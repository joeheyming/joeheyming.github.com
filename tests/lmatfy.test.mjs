import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  NARRATION,
  autoRedirects,
  buildShareUrl,
  destinationUrl,
  destinationUrls,
  openingCopy,
  parseRequest,
  parseTo,
  playerHeading,
  promptPlaceholder,
  radioValue,
  serializeTo,
  shouldSkipAnimation,
  typingDelayMs
} from '../lmatfy/lmatfy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readDocument(relativePath) {
  return new JSDOM(readFileSync(path.join(ROOT, relativePath), 'utf8')).window.document;
}

test('parseTo accepts each engine, its aliases, and the group values', () => {
  assert.deepEqual(parseTo(undefined), ['chatgpt']);
  assert.deepEqual(parseTo('gemini'), ['gemini']);
  assert.deepEqual(parseTo('bard'), ['gemini']);
  assert.deepEqual(parseTo('gpt'), ['chatgpt']);
  assert.deepEqual(parseTo('brave'), ['brave']);
  assert.deepEqual(parseTo('ask-brave'), ['brave']);
  assert.deepEqual(parseTo('all'), ['chatgpt', 'gemini', 'brave']);
  assert.deepEqual(parseTo('gemini,chatgpt'), ['gemini', 'chatgpt']);
  assert.deepEqual(parseTo('nonsense'), ['chatgpt']);
});

test('to=both still works for links shared before Brave existed', () => {
  assert.deepEqual(parseTo('both'), ['chatgpt', 'gemini']);
});

test('share URLs encode the question and destination', () => {
  assert.equal(
    buildShareUrl({ query: 'how do I boil an egg', engines: ['chatgpt', 'gemini', 'brave'] }),
    'https://joeheyming.github.io/lmatfy/?q=how+do+I+boil+an+egg&to=all'
  );
  assert.equal(serializeTo(['gemini']), 'gemini');
  assert.equal(serializeTo(['chatgpt', 'gemini']), 'chatgpt,gemini');
});

test('destination URLs prefill ChatGPT, Gemini, and Ask Brave', () => {
  assert.equal(
    destinationUrl('chatgpt', 'why is the sky blue'),
    'https://chatgpt.com/?q=why%20is%20the%20sky%20blue'
  );
  assert.equal(
    destinationUrl('gemini', 'why is the sky blue'),
    'https://gemini.google.com/app?q=why%20is%20the%20sky%20blue'
  );
  assert.equal(
    destinationUrl('brave', 'why is the sky blue'),
    'https://search.brave.com/ask?q=why%20is%20the%20sky%20blue'
  );
  assert.deepEqual(destinationUrls(['chatgpt', 'brave'], 'hi'), [
    'https://chatgpt.com/?q=hi',
    'https://search.brave.com/ask?q=hi'
  ]);
});

test('only a single destination auto-redirects', () => {
  assert.equal(autoRedirects(['brave']), true);
  assert.equal(autoRedirects(['chatgpt', 'gemini']), false);
  assert.equal(openingCopy(['brave']), 'Opening Ask Brave…');
  assert.equal(openingCopy(['chatgpt', 'gemini', 'brave']), 'Pick one.');
});

test('visible copy stays in character and keeps the trademark notice', () => {
  const document = readDocument('lmatfy/index.html');
  const body = (document.body.textContent || '').replace(/\s+/g, ' ');

  assert.match(body, /Not associated with OpenAI, Google, or Brave/);
  assert.match(body, /Made with sarcasm/);
  assert.equal(document.querySelector('#copy')?.textContent?.trim(), 'Copy URL');
  assert.equal(document.querySelector('#preview')?.textContent?.trim(), 'Preview');

  // Query-string plumbing and popup-blocker mechanics are for the developer,
  // not the person reading the page.
  assert.doesNotMatch(body, /\?q=/);
  assert.doesNotMatch(body, /popup|redirect|upload/i);
});

test('mock chrome copy follows the chosen engine', () => {
  assert.equal(playerHeading(['chatgpt']), 'Let me ChatGPT that for you');
  assert.equal(playerHeading(['gemini']), 'Let me Gemini that for you');
  assert.equal(playerHeading(['brave']), 'Let me Brave that for you');
  assert.equal(playerHeading(['chatgpt', 'gemini', 'brave']), 'Let me ask that for you');
  assert.equal(promptPlaceholder(['gemini']), 'Ask Gemini');
  assert.equal(promptPlaceholder(['chatgpt', 'brave']), 'Ask anything');
});

test('multi-engine links fall back to the "all" radio', () => {
  assert.equal(radioValue(['brave']), 'brave');
  assert.equal(radioValue(['chatgpt', 'gemini']), 'all');
});

test('parseRequest reads q, to, and instant from the query string', () => {
  const parsed = parseRequest('?q=hello%20world&to=gemini&instant=1');
  assert.equal(parsed.query, 'hello world');
  assert.deepEqual(parsed.engines, ['gemini']);
  assert.equal(parsed.instant, true);
  assert.equal(parseRequest('').query, '');
});

test('animation is skipped for instant links and reduced motion', () => {
  assert.equal(shouldSkipAnimation(true, false), true);
  assert.equal(shouldSkipAnimation(false, true), true);
  assert.equal(shouldSkipAnimation(false, false), false);
});

test('typing pace speeds up for long questions but stays visible', () => {
  assert.ok(typingDelayMs(8) > typingDelayMs(200));
  assert.ok(typingDelayMs(1) <= 72);
  assert.ok(typingDelayMs(5000) >= 16);
});

test('author and recipient share one prompt box', () => {
  const document = readDocument('lmatfy/index.html');
  const prompt = document.querySelector('#prompt');
  assert.ok(prompt, 'the prompt box should exist in static HTML');
  assert.equal(prompt.closest('#compose')?.id, 'compose', 'typing and playback use one form');
  assert.ok(document.querySelector('#send'), 'the mock send button should exist');
  assert.ok(document.querySelector('#cursor'), 'the fake cursor should exist');

  for (const value of ['chatgpt', 'gemini', 'brave', 'all']) {
    assert.ok(
      document.querySelector(`input[name="engine"][value="${value}"]`),
      `missing engine option: ${value}`
    );
  }
});

test('narrator ships the punchline in static HTML', () => {
  const document = readDocument('lmatfy/index.html');
  assert.equal(document.querySelector('#narrator')?.textContent?.trim(), NARRATION.authorIdle);
  assert.match(NARRATION.playPunchline, /was that really so hard/i);
});

test('page is indexable and names every destination', () => {
  const document = readDocument('lmatfy/index.html');
  assert.equal(document.title, 'Let Me Ask That For You — ChatGPT, Gemini & Brave 🤷');
  assert.equal(document.querySelector('meta[name="robots"]')?.content, 'index, follow');
  assert.equal(
    document.querySelector('link[rel="canonical"]')?.href,
    'https://joeheyming.github.io/lmatfy/'
  );
  assert.ok((document.querySelector('meta[name="description"]')?.content || '').length >= 150);
  assert.match(document.querySelector('h1')?.textContent || '', /Let me ChatGPT that for you/);

  const body = document.body.textContent || '';
  assert.match(body, /ChatGPT/);
  assert.match(body, /Gemini/);
  assert.match(body, /Ask Brave/);
});
