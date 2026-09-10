const VERSION = 1;
const MAX_LOOP_MS = 120_000;
const MAX_EVENTS = 512;
const MAX_TOKEN_CHARS = 8_000;

export const LOOP_PARAM = 'loop';

export const DRUM_PAD_IDS = [
  'snare',
  'clap',
  'closed-hat',
  'open-hat',
  'kick',
  'stick',
  'ride',
  'crash',
  'low-tom',
  'mid-tom',
  'tambourine',
  'cowbell'
];

const PAD_INDEX = new Map(DRUM_PAD_IDS.map((id, index) => [id, index]));
const KITS = new Set(['linndrum', 'tr-808', 'acoustic', 'electronic']);

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/**
 * Encode a recorded drum loop into a compact, URL-safe token.
 * @param {{ loopLength: number, kit: string, events: Array<{ time: number, id: string }> }} loop
 */
export function encodeDrumLoop(loop) {
  const loopLength = Math.round(Number(loop.loopLength));
  if (!Number.isFinite(loopLength) || loopLength < 250 || loopLength > MAX_LOOP_MS) {
    throw new Error('This loop is too long to share.');
  }
  if (!Array.isArray(loop.events) || loop.events.length === 0) {
    throw new Error('Record a loop before making a post.');
  }
  if (loop.events.length > MAX_EVENTS) {
    throw new Error('This loop has too many hits to share.');
  }

  const events = loop.events.map((event) => {
    const pad = PAD_INDEX.get(event.id);
    const time = Math.round(Number(event.time));
    if (pad == null || !Number.isFinite(time) || time < 0 || time >= loopLength) {
      throw new Error('This loop contains an invalid drum hit.');
    }
    return [time, pad];
  });
  const kit = KITS.has(loop.kit) ? loop.kit : 'linndrum';
  const token = toBase64Url(JSON.stringify({ v: VERSION, l: loopLength, k: kit, e: events }));
  if (token.length > MAX_TOKEN_CHARS) {
    throw new Error('This loop is too complex to share.');
  }
  return token;
}

/**
 * Decode and validate a loop token from a shared Drums URL.
 * @param {string} token
 * @returns {{ loopLength: number, kit: string, events: Array<{ time: number, id: string }> } | null}
 */
export function decodeDrumLoop(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_CHARS)
    return null;
  try {
    const parsed = JSON.parse(fromBase64Url(token));
    if (
      parsed?.v !== VERSION ||
      !Number.isInteger(parsed.l) ||
      parsed.l < 250 ||
      parsed.l > MAX_LOOP_MS ||
      !KITS.has(parsed.k) ||
      !Array.isArray(parsed.e) ||
      parsed.e.length === 0 ||
      parsed.e.length > MAX_EVENTS
    ) {
      return null;
    }

    const events = parsed.e.map((event) => {
      if (
        !Array.isArray(event) ||
        event.length !== 2 ||
        !Number.isInteger(event[0]) ||
        event[0] < 0 ||
        event[0] >= parsed.l ||
        !Number.isInteger(event[1]) ||
        event[1] < 0 ||
        event[1] >= DRUM_PAD_IDS.length
      ) {
        throw new Error('Invalid drum hit');
      }
      return { time: event[0], id: DRUM_PAD_IDS[event[1]] };
    });

    return { loopLength: parsed.l, kit: parsed.k, events };
  } catch {
    return null;
  }
}

/**
 * Apply a loop token to a URL, or strip it when the token is null. Other
 * query params (share/UTM tags) are left alone.
 * @param {string} href
 * @param {string|null} token
 */
export function withLoopToken(href, token) {
  const url = new URL(href);
  if (token) url.searchParams.set(LOOP_PARAM, token);
  else url.searchParams.delete(LOOP_PARAM);
  return url.toString();
}
