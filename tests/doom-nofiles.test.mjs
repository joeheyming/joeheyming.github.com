// The Load Game list says only "No files" when this browser has no saves.
// Players asked how to get past it. The how-to-play card is that answer.
// Do not patch uzdoom.pk3 to change the line: rewriting that archive made
// the engine exit with a memory fault on launch.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Read one stored or deflated member. The engine pk3 writes sizes in the local header. */
function readZipEntry(buf, name) {
  const target = Buffer.from(name);
  let off = 0;
  while (off + 30 < buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const flags = buf.readUInt16LE(off + 6);
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const nameStart = off + 30;
    const dataStart = nameStart + nameLen + extraLen;
    if (flags & 0x8) throw new Error('data descriptor on ' + name);
    const entryName = buf.subarray(nameStart, nameStart + nameLen);
    if (entryName.equals(target)) {
      const data = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return data.toString('utf8');
      if (method === 8) return inflateRawSync(data).toString('utf8');
      throw new Error('unexpected method ' + method);
    }
    off = dataStart + compSize;
  }
  throw new Error('missing ' + name);
}

const pk3 = readFileSync(path.join(ROOT, 'doom/uzdoom.pk3'));
const html = readFileSync(path.join(ROOT, 'doom/index.html'), 'utf8');

describe('doom empty load-game screen', () => {
  it('keeps the stock engine string and does not add a hint row', () => {
    const lang = readZipEntry(pk3, 'language.0');
    assert.match(lang, /^No files,MNU_NOFILES,/m);
    assert.doesNotMatch(lang, /MNU_NOFILES_HINT/);
    assert.doesNotMatch(lang, /^No saves yet,MNU_NOFILES,/m);
  });

  it('does not patch the load menu', () => {
    const menu = readZipEntry(pk3, 'zscript/engine/ui/menu/loadsavemenu.zs');
    assert.match(menu, /Stringtable\.Localize\("\$MNU_NOFILES"\)/);
    assert.doesNotMatch(menu, /MNU_NOFILES_HINT/);
    assert.doesNotMatch(menu, /if \(mkey == MKEY_Enter\) Close\(\);/);
  });

  it('mentions the same way out on the how-to-play card', () => {
    assert.match(html, /No saves yet/);
    assert.match(html, /Esc or MENU goes back/);
  });
});
