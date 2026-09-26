/**
 * Convert a Standard MIDI file into a chiptune example payload.
 *
 *   node scripts/midi-to-chiptune.mjs song.mid --out play/chiptune/examples/song.json
 *   node scripts/midi-to-chiptune.mjs song.mid --wave 38=triangle
 *
 * --wave is optional. Programs 80 and 81 already map to square and saw.
 * Any other program stays square unless you name a wave here.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { midiToPayload, MidiImportError } from '../play/chiptune/midi-import.js';

const args = process.argv.slice(2);
/** @type {Record<number, string>} */
const waves = {};
let input = '';
let out = '';

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--out') {
    out = args[++i] || '';
  } else if (arg === '--wave') {
    const spec = args[++i] || '';
    const match = /^(\d+)=([a-z0-9]+)$/.exec(spec);
    if (!match) {
      fail(`Expected --wave <program>=<wave>, got "${spec}"`);
    }
    waves[Number(match[1])] = match[2];
  } else if (!arg.startsWith('--') && !input) {
    input = arg;
  } else {
    fail(`Unknown argument ${arg}`);
  }
}

if (!input) {
  fail(
    'Usage: node scripts/midi-to-chiptune.mjs <file.mid> [--out file.json] [--wave 38=triangle]'
  );
}

try {
  const bytes = readFileSync(input);
  const result = midiToPayload(bytes, { waves });
  const json = `${JSON.stringify(result.payload, null, 2)}\n`;
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
  for (const voice of result.voices) {
    const program = voice.program == null ? 'none' : String(voice.program);
    console.error(
      `${voice.name || 'track ' + voice.track} ch ${voice.channel} program ${program} → ${
        voice.wave
      } (${voice.waveSource}), ${voice.notes} notes`
    );
  }
  for (const warning of result.warnings) console.error(`warning: ${warning}`);
} catch (err) {
  if (err instanceof MidiImportError) fail(`${err.code}: ${err.message}`);
  throw err;
}

/** @param {string} message */
function fail(message) {
  console.error(message);
  process.exit(1);
}
