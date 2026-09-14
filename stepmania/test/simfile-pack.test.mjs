import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SimfileParser } from '../js/simfileParser.js';
import { writeSsc, writeSm, createEmptySimfile } from '../js/simfileWriter.js';
import { parseNoteField, encodeNoteField, quantizeBeat } from '../js/noteGrid.js';
import {
  packFromFiles,
  filesFromPack,
  packFromSimfileText,
  createEmptyPack
} from '../js/packIo.js';
import { getURLParams } from '../js/urlUtils.js';

const TAP_SM = `#TITLE:Taps;
#ARTIST:Unit;
#OFFSET:0.000;
#BPMS:0.000=120.000;
#MUSIC:song.ogg;
#BANNER:song-bn.png;
#BACKGROUND:song-bg.png;
#NOTES:
     dance-single:
     :
     Beginner:
     1:
     :
1000
0100
0010
0001
;
`;

describe('noteGrid', () => {
  it('round-trips taps through encode/parse', () => {
    const notes = parseNoteField(`1000
0100
0010
0001`);
    const encoded = encodeNoteField(notes);
    const again = parseNoteField(encoded);
    assert.equal(again.length, 4);
    assert.deepEqual(
      again.map((n) => n.slice(0, 2)),
      [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3]
      ]
    );
  });

  it('pairs hold tails', () => {
    const notes = parseNoteField(`2000
0000
0000
3000`);
    assert.equal(notes[0][2].Duration, 144);
    const encoded = encodeNoteField(notes);
    const again = parseNoteField(encoded);
    assert.equal(again[0][2].Type, 2);
    assert.equal(again[0][2].Duration, 144);
  });

  it('quantizes to 16ths', () => {
    assert.equal(quantizeBeat(0.51, 16), 0.5);
  });
});

describe('simfile writer round-trip', () => {
  const parser = new SimfileParser();

  it('round-trips a .sm fixture through writeSm', () => {
    const parsed = parser.parse(TAP_SM);
    const sm = writeSm(parsed);
    const again = parser.parse(sm);
    assert.equal(again.title, 'Taps');
    assert.equal(again.artist, 'Unit');
    assert.equal(again.charts[0].noteData.length, 4);
    assert.equal(again.metadata.MUSIC, 'song.ogg');
  });

  it('round-trips SSC with split timing', () => {
    const parsed = parser.parse(`#VERSION:0.83;
#TITLE:Split;
#ARTIST:A;
#OFFSET:0.000;
#BPMS:0.000=120.000;
#NOTEDATA:;
#CHARTNAME:Harder;
#STEPSTYPE:dance-single;
#DESCRIPTION:;
#DIFFICULTY:Challenge;
#METER:10;
#RADARVALUES:0,0,0,0,0;
#OFFSET:-0.050;
#BPMS:0.000=180.000;
#NOTES:
1000
0000
0000
0000
;
`);
    assert.equal(parsed.charts[0].hasSplitTiming, true);
    assert.equal(parsed.charts[0].offset, -0.05);
    const ssc = writeSsc(parsed);
    const again = parser.parse(ssc);
    assert.equal(again.charts[0].hasSplitTiming, true);
    assert.equal(again.charts[0].offset, -0.05);
    assert.equal(again.charts[0].timingTags.bpms[0].value, 180);
    assert.equal(again.charts[0].noteData.length, 1);
  });

  it('createEmptySimfile writes a playable SSC', () => {
    const empty = createEmptySimfile({ title: 'Blank', bpm: 140 });
    const ssc = writeSsc(empty);
    const parsed = parser.parse(ssc);
    assert.equal(parsed.title, 'Blank');
    assert.equal(parsed.bpm, 140);
    assert.equal(parsed.charts[0].type, 'dance-single');
  });
});

describe('packIo file map', () => {
  it('builds a zip-shaped folder with music, banner, and background', () => {
    const parsed = new SimfileParser().parse(TAP_SM);
    const files = new Map();
    files.set('Unsorted/Taps/Taps.sm', { kind: 'text', text: TAP_SM });
    files.set('Unsorted/Taps/song.ogg', {
      kind: 'binary',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/ogg' }),
      mime: 'audio/ogg'
    });
    files.set('Unsorted/Taps/song-bn.png', {
      kind: 'binary',
      blob: new Blob([new Uint8Array([4])], { type: 'image/png' }),
      mime: 'image/png'
    });
    files.set('Unsorted/Taps/song-bg.png', {
      kind: 'binary',
      blob: new Blob([new Uint8Array([5])], { type: 'image/png' }),
      mime: 'image/png'
    });
    const pack = packFromFiles(files);
    assert.equal(pack.parsed.title, 'Taps');
    assert.ok(pack.musicPath);
    assert.ok(pack.bannerPath);
    assert.ok(pack.backgroundPath);

    const built = filesFromPack(pack);
    const paths = [...built.keys()];
    assert.ok(paths.some((p) => p.endsWith('.ssc')));
    assert.ok(paths.some((p) => p.endsWith('.ogg')));
    assert.ok(paths.some((p) => p.includes('-bn.')));
    assert.ok(paths.some((p) => p.includes('-bg.')));
    const sscPath = paths.find((p) => p.endsWith('.ssc'));
    const ssc = built.get(sscPath);
    assert.match(String(ssc), /#TITLE:Taps;/);
    assert.match(String(ssc), /#MUSIC:.+\.ogg;/);
  });

  it('loads a lone simfile', () => {
    const pack = packFromSimfileText('song.sm', TAP_SM);
    assert.equal(pack.parsed.charts[0].noteData.length, 4);
  });

  it('createEmptyPack has a simfile', () => {
    const pack = createEmptyPack({ title: 'Fresh' });
    assert.equal(pack.parsed.title, 'Fresh');
    assert.ok([...pack.files.keys()].some((p) => p.endsWith('.ssc')));
  });
});

describe('url local param', () => {
  it('reads local without dropping zenius', () => {
    const url = new URL('https://example.com/stepmania/?zenius=https://z.example/a&local=abc');
    const params = new URLSearchParams(url.search);
    assert.equal(params.get('zenius'), 'https://z.example/a');
    assert.equal(params.get('local'), 'abc');
  });

  it('getURLParams exposes local', () => {
    const prev = globalThis.window;
    globalThis.window = {
      location: { search: '?local=draft-1&difficulty=2' }
    };
    try {
      const got = getURLParams();
      assert.equal(got.local, 'draft-1');
      assert.equal(got.difficulty, '2');
      assert.equal(got.zenius, null);
    } finally {
      if (prev === undefined) delete globalThis.window;
      else globalThis.window = prev;
    }
  });
});
