import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readZipFiles,
  packFromFiles,
  packFromFilesPlayable,
  listPackSongs,
  filesFromPack,
  guessMime
} from '../js/packIo.js';
import { songFromPack, revokePackObjectUrls } from '../js/songFromPack.js';

/**
 * Stand-in for JSZip. The real library handles the archive container; these
 * tests cover our own path handling, which is where imports went wrong.
 */
class FakeZip {
  constructor() {
    this.files = {};
  }
  file(path, data) {
    this.files[path] = {
      dir: false,
      async: async (type) => (type === 'string' ? String(data) : new Blob([data]))
    };
  }
  async generateAsync() {
    return this;
  }
  static async loadAsync(zip) {
    return zip;
  }
}

function simfile(title, music, extra = '') {
  return `#TITLE:${title};
#MUSIC:${music};
#OFFSET:0.000;
#BPMS:0.000=150.000;
${extra}#NOTES:
     dance-single:
     :
     Hard:
     9:
     0,0,0,0,0:
1000
0100
0010
0001
;
`;
}

function withObjectUrls(fn) {
  const created = [];
  globalThis.URL.createObjectURL = (blob) => {
    created.push(blob);
    return `blob:test/${created.length}`;
  };
  globalThis.URL.revokeObjectURL = () => {};
  try {
    return fn();
  } finally {
    revokePackObjectUrls();
    delete globalThis.URL.createObjectURL;
    delete globalThis.URL.revokeObjectURL;
  }
}

test('multi-song pack resolves assets inside the chosen song folder', async () => {
  const zip = new FakeZip();
  zip.file('Cool Pack/Aardvark/Aardvark.sm', simfile('Aardvark', 'audio.ogg'));
  zip.file('Cool Pack/Aardvark/audio.ogg', new Uint8Array(10));
  zip.file('Cool Pack/Zebra/Zebra.ssc', simfile('Zebra', 'audio.ogg'));
  zip.file('Cool Pack/Zebra/audio.ogg', new Uint8Array(20));
  zip.file('Cool Pack/Zebra/bg.avi', new Uint8Array(30));

  const files = await readZipFiles(zip, FakeZip);
  const pack = packFromFiles(files, { simfilePath: 'Cool Pack/Zebra/Zebra.ssc' });

  assert.equal(pack.parsed.title, 'Zebra');
  assert.equal(pack.musicPath, 'Cool Pack/Zebra/audio.ogg');
  assert.equal(pack.videoPath, 'Cool Pack/Zebra/bg.avi');
});

test('a missing asset stays unresolved rather than borrowing another song', async () => {
  const zip = new FakeZip();
  zip.file('Cool Pack/Aardvark/Aardvark.ssc', '#TITLE:Aardvark;\n#BPMS:0.000=150.000;\n');
  zip.file('Cool Pack/Zebra/other.ogg', new Uint8Array(99));

  const pack = packFromFiles(await readZipFiles(zip, FakeZip), {
    simfilePath: 'Cool Pack/Aardvark/Aardvark.ssc'
  });
  assert.equal(pack.musicPath, null);
});

test('listPackSongs treats an .sm/.ssc pair in one folder as one song', async () => {
  const zip = new FakeZip();
  zip.file('Pack/Song/Song.sm', simfile('Song', 'a.ogg'));
  zip.file('Pack/Song/Song.ssc', simfile('Song', 'a.ogg'));
  zip.file('Pack/Other/Other.sm', simfile('Other', 'b.ogg'));

  const songs = listPackSongs(await readZipFiles(zip, FakeZip));
  assert.equal(songs.length, 2);
  assert.deepEqual(songs.map((s) => s.title).sort(), ['Other', 'Song']);
  // .ssc wins for the folder that has both.
  assert.ok(songs.some((s) => s.simfilePath === 'Pack/Song/Song.ssc'));
});

test('packFromFilesPlayable skips a song with no charts', async () => {
  const zip = new FakeZip();
  zip.file('Pack/Aardvark/Aardvark.ssc', '#TITLE:Aardvark;\n#BPMS:0.000=150.000;\n');
  zip.file('Pack/Zebra/Zebra.ssc', simfile('Zebra', 'audio.ogg'));
  zip.file('Pack/Zebra/audio.ogg', new Uint8Array(20));

  const pack = packFromFilesPlayable(await readZipFiles(zip, FakeZip));
  assert.equal(pack.parsed.title, 'Zebra');
  assert.equal(pack.musicPath, 'Pack/Zebra/audio.ogg');
});

test('a background hint never picks a non-image file', async () => {
  const zip = new FakeZip();
  zip.file('Song/Song.sm', simfile('Song', 'song.ogg'));
  zip.file('Song/song.ogg', new Uint8Array(4));
  zip.file('Song/bg.avi', new Uint8Array(4));
  zip.file('Song/scenery-bg.png', new Uint8Array(4));

  const pack = packFromFiles(await readZipFiles(zip, FakeZip));
  assert.equal(pack.backgroundPath, 'Song/scenery-bg.png');
  assert.equal(pack.videoPath, 'Song/bg.avi');
});

test('exporting twice does not mutate the pack or compound bgchanges', async () => {
  const zip = new FakeZip();
  zip.file(
    'Song/Song.sm',
    simfile('Song', 'song.ogg', '#BGCHANGES:0.000=clip.avi=1.000=0=0=0\n;\n')
  );
  zip.file('Song/song.ogg', new Uint8Array(4));
  zip.file('Song/clip.avi', new Uint8Array(4));

  const pack = packFromFiles(await readZipFiles(zip, FakeZip));
  const before = JSON.stringify(pack.parsed.bgChanges);
  const metaBefore = JSON.stringify(pack.parsed.metadata);

  const first = filesFromPack(pack);
  const second = filesFromPack(pack);

  assert.equal(JSON.stringify(pack.parsed.bgChanges), before);
  assert.equal(JSON.stringify(pack.parsed.metadata), metaBefore);
  assert.deepEqual([...first.keys()].sort(), [...second.keys()].sort());
});

test('mid-song bgchange assets are carried into the export', async () => {
  const zip = new FakeZip();
  zip.file(
    'Song/Song.sm',
    simfile('Song', 'song.ogg', '#BGCHANGES:0.000=intro.png=1.000=0=0=0\n;\n')
  );
  zip.file('Song/song.ogg', new Uint8Array(4));
  zip.file('Song/intro.png', new Uint8Array(4));

  const out = filesFromPack(packFromFiles(await readZipFiles(zip, FakeZip)));
  assert.ok([...out.keys()].some((p) => p.endsWith('/intro.png')));
});

test('songFromPack hands the player blob URLs for every bgchange', async () => {
  const zip = new FakeZip();
  zip.file(
    'Song/Song.sm',
    simfile('Song', 'song.ogg', '#BGCHANGES:0.000=intro.png=1.000=0=0=0\n;\n')
  );
  zip.file('Song/song.ogg', new Uint8Array(4));
  zip.file('Song/intro.png', new Uint8Array(4));

  const pack = packFromFiles(await readZipFiles(zip, FakeZip));
  withObjectUrls(() => {
    const { songData, parsedData } = songFromPack(pack, 'k');
    assert.ok(songData.url.startsWith('blob:'));
    assert.equal(songData.audioType, 'audio/ogg');
    assert.equal(parsedData.charts.length, 1);
    for (const bg of parsedData.bgChanges) {
      assert.ok(bg.file.startsWith('blob:'), `bgchange not a blob url: ${bg.file}`);
    }
  });
});

test('songFromPack reuses media URLs while replaying the same pack', async () => {
  const zip = new FakeZip();
  zip.file('Song/Song.sm', simfile('Song', 'song.ogg'));
  zip.file('Song/song.ogg', new Uint8Array(4));

  const pack = packFromFiles(await readZipFiles(zip, FakeZip));
  withObjectUrls(() => {
    const first = songFromPack(pack, 'first');
    const second = songFromPack(pack, 'second');
    assert.equal(second.songData.url, first.songData.url);
  });
});

test('songFromPack drops bgchanges the pack cannot supply', async () => {
  const zip = new FakeZip();
  zip.file(
    'Song/Song.sm',
    simfile('Song', 'song.ogg', '#BGCHANGES:0.000=missing.png=1.000=0=0=0\n;\n')
  );
  zip.file('Song/song.ogg', new Uint8Array(4));

  const pack = packFromFiles(await readZipFiles(zip, FakeZip));
  withObjectUrls(() => {
    const { parsedData } = songFromPack(pack, 'k');
    assert.deepEqual(parsedData.bgChanges, []);
  });
});

test('guessMime covers the audio formats packs actually ship', () => {
  assert.equal(guessMime('a.ogg'), 'audio/ogg');
  assert.equal(guessMime('a.m4a'), 'audio/mp4');
  assert.equal(guessMime('a.oga'), 'audio/ogg');
  assert.equal(guessMime('a.flac'), 'audio/flac');
  assert.equal(guessMime('CAPS.MP3'), 'audio/mpeg');
  assert.equal(guessMime('a.mov'), 'video/quicktime');
  assert.equal(guessMime('a.unknown'), 'application/octet-stream');
});
