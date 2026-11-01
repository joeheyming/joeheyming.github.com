import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SimfileParser, danceSingleCharts } from '../stepmania/js/simfileParser.js';
import { dwiToSm } from '../stepmania/js/dwi.js';
import {
  fetchZeniusSimfile,
  inspectZeniusPage,
  parseZeniusSimfile
} from '../stepmania/js/songLoader.js';

const SINGLE = `#TITLE:Tap;
#ARTIST:A;
#BPMS:0.000=120;
#NOTES:
     dance-single:
     :
     Easy:
     3:
     :
0000
0000
0000
0001
;`;

function page(body) {
  return `<html><head><title>${body.title}</title></head><body><h1>${body.heading || ''}</h1>${
    body.links || ''
  }</body></html>`;
}

describe('zenius pages that cannot be played', () => {
  it('recognizes a removed simfile that bounced to the homepage', () => {
    const html = page({ title: 'Home - ZIv', heading: 'Welcome' });
    const info = inspectZeniusPage(html, '70726');
    assert.equal(info.gone, true);
    assert.equal(info.simfileUrl, null);
    assert.deepEqual(info.packUrls, []);
  });

  it('keeps a real song page that merely has no files', () => {
    const html = page({
      title: 'Beethoven Virus - Oni-91 - Simfiles - ZIv',
      heading: 'Beethoven Virus',
      links: '<a href="simfiles.php">Simfiles</a>'
    });
    const info = inspectZeniusPage(html, '1746');
    assert.equal(info.gone, false);
    assert.equal(info.simfileUrl, null);
    assert.equal(info.mp3Url, null);
    assert.deepEqual(info.packUrls, []);
  });

  it('tries the plain pack before the custom pack', () => {
    const html = page({
      title: 'Insane - Ukiarrow - Simfiles - ZIv',
      heading: 'Insane',
      links:
        '<a href="download.php?type=ddrsimfile&amp;simfileid=60989">ZIP</a>' +
        '<a href="download.php?type=ddrsimfilecustom&amp;simfileid=60989">ZIP</a>'
    });
    const info = inspectZeniusPage(html, '60989');
    assert.equal(info.packUrls.length, 2);
    assert.match(info.packUrls[0], /type=ddrsimfile&simfileid=60989$/);
    assert.match(info.packUrls[1], /type=ddrsimfilecustom&simfileid=60989$/);
  });

  it('says when the chart is not a 4-arrow single', () => {
    const sm = `#TITLE:Doubles;
#ARTIST:A;
#BPMS:0.000=120;
#NOTES:
     dance-double:
     :
     Hard:
     8:
     :
00000000
00000000
00000000
10000000
;`;
    assert.throws(
      () => parseZeniusSimfile({ title: 'Doubles', artist: 'A', simfileText: sm }, '70622'),
      /no 4-arrow singles \(found dance-double\)/
    );
  });

  it('does not read an 8-arrow custom step type as a single', () => {
    const sm = `#TITLE:Beat;
#ARTIST:A;
#BPMS:0.000=120;
#NOTES:
     ds3ddx-single:
     :
     Hard:
     4:
     :
00000000
00000100
00000000
00000000
;`;
    const parsed = new SimfileParser().parse(sm);
    assert.equal(parsed.charts[0].columns, 8);
    assert.equal(
      parsed.charts[0].noteData.some((note) => note[1] === 5),
      true
    );
    assert.equal(danceSingleCharts(parsed.charts).length, 0);
  });

  it('plays a custom step type whose rows are actually 4 arrows', () => {
    const sm = `#TITLE:Weird;
#ARTIST:A;
#BPMS:0.000=120;
#NOTES:
     weird-single:
     :
     Hard:
     1:
     :
0001
0000
0000
0000
;`;
    const parsed = parseZeniusSimfile({ title: 'Weird', artist: 'A', simfileText: sm }, '1');
    assert.equal(parsed.parsedData.charts.length, 1);
    assert.equal(parsed.parsedData.charts[0].noteData[0][1], 3);
  });
});

describe('dwi charts', () => {
  it('places numpad arrows, jumps, and holds on 4-arrow rows', () => {
    const sm = dwiToSm(`#TITLE:Healing;
#ARTIST:2MB;
#BPM:120;
#GAP:1000;
#CHANGEBPM:384=98;
#SINGLE:BASIC:5:
0004
<46>
4!40004
;`);
    assert.ok(sm);
    const parsed = new SimfileParser().parse(sm);
    assert.equal(parsed.offset, -1);
    assert.equal(parsed.bpmChanges[1].beat, 96);
    assert.equal(parsed.bpmChanges[1].bpm, 98);
    const chart = danceSingleCharts(parsed.charts)[0];
    assert.equal(chart.difficulty, 'Easy');
    const beats = chart.noteData.map((note) => [note[0], note[1], note[2].Type, note[2].Duration]);
    assert.deepEqual(beats[0], [1.5, 0, undefined, undefined]);
    assert.ok(beats.some((note) => note[0] === 2 && note[1] === 0));
    assert.ok(beats.some((note) => note[0] === 2 && note[1] === 3));
    const hold = chart.noteData.find((note) => note[2].Type === 2);
    assert.ok(hold);
    assert.equal(hold[1], 0);
    assert.equal(hold[2].Duration, 96);
  });
});

describe('fetching a chart that only exists in the pack', () => {
  it('skips a pack that is not a zip and reads the chart from the next one', async () => {
    const html = page({
      title: 'Insane - Simfiles - ZIv',
      heading: 'Insane',
      links:
        '<a href="download.php?type=ddrsimfile&amp;simfileid=60989">ZIP</a>' +
        '<a href="download.php?type=ddrsimfilecustom&amp;simfileid=60989">ZIP</a>'
    });
    /** @type {string[]} */
    const fetched = [];
    const transport = {
      async fetchText() {
        return html;
      },
      async fetchBinary(url) {
        fetched.push(url);
        return url.includes('custom') ? 'custom' : 'plain';
      }
    };
    const previous = globalThis.JSZip;
    globalThis.JSZip = {
      async loadAsync(data) {
        if (data === 'plain') throw new Error('not a zip');
        return {
          files: {
            'Insane/Insane.sm': {
              dir: false,
              async() {
                return SINGLE;
              }
            },
            'Insane/Insane.mp3': {
              dir: false,
              async() {
                return new Blob(['mp3'], { type: 'audio/mpeg' });
              }
            }
          }
        };
      }
    };
    try {
      const loaded = await fetchZeniusSimfile('60989', transport);
      assert.equal(fetched.length, 2);
      assert.match(fetched[0], /type=ddrsimfile&/);
      assert.match(fetched[1], /type=ddrsimfilecustom&/);
      assert.match(loaded.simfileText, /dance-single/);
      assert.ok(loaded.audioBlob);
      const parsed = parseZeniusSimfile(loaded, '60989');
      assert.equal(parsed.parsedData.charts.length, 1);
      assert.ok(parsed.songData.audioBlob);
    } finally {
      globalThis.JSZip = previous;
    }
  });

  it('fails a removed song without downloading a pack', async () => {
    let binaries = 0;
    const transport = {
      async fetchText() {
        return page({ title: 'Home - ZIv' });
      },
      async fetchBinary() {
        binaries += 1;
        return new ArrayBuffer(0);
      }
    };
    await assert.rejects(() => fetchZeniusSimfile('70726', transport), /no longer on Zenius/);
    assert.equal(binaries, 0);
  });

  it('fails a listed song with no files without downloading a pack', async () => {
    let binaries = 0;
    const transport = {
      async fetchText() {
        return page({ title: 'Beethoven Virus - Simfiles - ZIv', heading: 'Beethoven Virus' });
      },
      async fetchBinary() {
        binaries += 1;
        return new ArrayBuffer(0);
      }
    };
    await assert.rejects(() => fetchZeniusSimfile('1746', transport), /no chart or audio/);
    assert.equal(binaries, 0);
  });
});
