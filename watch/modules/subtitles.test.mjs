/**
 * Subtitles module — pure-function tests.
 *
 * The network/blob side of the module (`searchSubtitles`, `loadVttUrl`)
 * is deliberately not exercised here: it depends on `fetch` /
 * `localStorage` / `URL.createObjectURL`, all of which are browser
 * globals. Instead we test the bits that have to be right for those
 * runtime paths to work:
 *
 *   - `srtToVtt` (lossless-ish format conversion)
 *   - `parseSearchResponse` (input validation against malformed addon JSON)
 *   - `groupByLanguage` / `sortLanguageGroups` (menu rendering inputs)
 *   - `languageLabel` (UI strings)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  srtToVtt,
  parseSearchResponse,
  groupByLanguage,
  sortLanguageGroups,
  languageLabel,
  applyCueOffset
} from './subtitles.js';

/* ============================================================
 * srtToVtt
 * ============================================================ */

describe('srtToVtt', () => {
  it('prepends the WEBVTT header', () => {
    assert.match(srtToVtt('1\n00:00:01,000 --> 00:00:02,000\nHi\n'), /^WEBVTT\n\n/);
  });

  it('rewrites comma timecodes to periods', () => {
    const srt = '1\n00:00:01,500 --> 00:00:04,250\nHello world\n';
    const out = srtToVtt(srt);
    assert.match(out, /00:00:01\.500 --> 00:00:04\.250/);
    assert.doesNotMatch(out, /00:00:01,500/);
  });

  it('normalizes CRLF line endings', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n';
    const out = srtToVtt(srt);
    assert.doesNotMatch(out, /\r/);
  });

  it('strips a leading BOM', () => {
    const out = srtToVtt('\uFEFF1\n00:00:01,000 --> 00:00:02,000\nHi\n');
    assert.match(out, /^WEBVTT\n\n1\n/);
    assert.doesNotMatch(out, /\uFEFF/);
  });

  it('preserves cue text and structure across multiple cues', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      'First line',
      '',
      '2',
      '00:00:03,500 --> 00:00:05,000',
      'Second line',
      'with two rows',
      ''
    ].join('\n');
    const out = srtToVtt(srt);
    assert.match(out, /First line/);
    assert.match(out, /Second line\nwith two rows/);
    assert.match(out, /00:00:03\.500 --> 00:00:05\.000/);
  });

  it('returns a bare WEBVTT header for non-string input', () => {
    // @ts-expect-error testing the runtime guard
    assert.equal(srtToVtt(undefined), 'WEBVTT\n\n');
    // @ts-expect-error testing the runtime guard
    assert.equal(srtToVtt(null), 'WEBVTT\n\n');
  });

  it('leaves cues without milliseconds alone', () => {
    // SRT spec requires `,xyz` milliseconds; if a file is missing them
    // we shouldn't accidentally munge unrelated commas in dialogue.
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nWell, hello, friend.\n';
    assert.match(srtToVtt(srt), /Well, hello, friend\./);
  });
});

/* ============================================================
 * parseSearchResponse
 * ============================================================ */

describe('parseSearchResponse', () => {
  it('normalizes the Stremio addon response into candidate objects', () => {
    const data = {
      subtitles: [
        {
          id: '4328592',
          url: 'https://subs5.strem.io/en/download/.../file/1',
          lang: 'eng',
          SubEncoding: 'ASCII'
        },
        {
          id: 177148,
          url: 'https://subs5.strem.io/en/download/.../file/2',
          lang: 'ENG',
          SubEncoding: 'UTF-8'
        }
      ]
    };
    const out = parseSearchResponse(data);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
      id: '4328592',
      url: 'https://subs5.strem.io/en/download/.../file/1',
      lang: 'eng',
      encoding: 'ASCII'
    });
    // String-coerces numeric ids, lowercases lang, fills in encoding.
    assert.equal(out[1].id, '177148');
    assert.equal(out[1].lang, 'eng');
  });

  it('drops entries with missing or non-string url/lang', () => {
    const data = {
      subtitles: [
        { id: '1', url: 'https://x', lang: 'eng' },
        { id: '2', url: 12345, lang: 'eng' },
        { id: '3', url: 'https://x', lang: null },
        { id: '4' }
      ]
    };
    const out = parseSearchResponse(data);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, '1');
  });

  it('returns [] for malformed inputs', () => {
    assert.deepEqual(parseSearchResponse(null), []);
    assert.deepEqual(parseSearchResponse({}), []);
    assert.deepEqual(parseSearchResponse({ subtitles: 'oops' }), []);
    assert.deepEqual(parseSearchResponse({ subtitles: [null, 'oops', 42] }), []);
  });
});

/* ============================================================
 * groupByLanguage / sortLanguageGroups
 * ============================================================ */

describe('groupByLanguage', () => {
  it('groups candidates by lang while preserving incoming order', () => {
    const groups = groupByLanguage([
      mkc('a', 'eng'),
      mkc('b', 'spa'),
      mkc('c', 'eng'),
      mkc('d', 'fre')
    ]);
    const map = new Map(groups.map((g) => [g.lang, g.candidates.length]));
    assert.equal(map.get('eng'), 2);
    assert.equal(map.get('spa'), 1);
    assert.equal(map.get('fre'), 1);
  });

  it('returns [] for empty input', () => {
    assert.deepEqual(groupByLanguage([]), []);
  });
});

describe('sortLanguageGroups', () => {
  it('floats English to the top regardless of input order', () => {
    const sorted = sortLanguageGroups([
      { lang: 'spa', candidates: [] },
      { lang: 'fre', candidates: [] },
      { lang: 'eng', candidates: [] }
    ]);
    assert.equal(sorted[0].lang, 'eng');
  });

  it('sorts the remainder alphabetically by display label', () => {
    const sorted = sortLanguageGroups([
      { lang: 'spa', candidates: [] }, // "Spanish"
      { lang: 'fre', candidates: [] }, // "French"
      { lang: 'ger', candidates: [] }, // "German"
      { lang: 'eng', candidates: [] } // "English" — pinned to top
    ]);
    assert.deepEqual(
      sorted.map((g) => g.lang),
      ['eng', 'fre', 'ger', 'spa']
    );
  });

  it('does not mutate the input array', () => {
    const input = [
      { lang: 'spa', candidates: [] },
      { lang: 'eng', candidates: [] }
    ];
    const copy = [...input];
    sortLanguageGroups(input);
    assert.deepEqual(input, copy);
  });
});

/* ============================================================
 * languageLabel
 * ============================================================ */

describe('languageLabel', () => {
  it('maps known ISO 639-2/B codes to human labels', () => {
    assert.equal(languageLabel('eng'), 'English');
    assert.equal(languageLabel('fre'), 'French');
    assert.equal(languageLabel('por'), 'Portuguese');
    assert.equal(languageLabel('pob'), 'Portuguese (BR)');
  });

  it('case-insensitively normalizes the code', () => {
    assert.equal(languageLabel('ENG'), 'English');
    assert.equal(languageLabel('Eng'), 'English');
  });

  it('uppercases unknown codes as a fallback', () => {
    assert.equal(languageLabel('zzz'), 'ZZZ');
    assert.equal(languageLabel('xyz'), 'XYZ');
  });

  it('handles empty / falsy input safely', () => {
    assert.equal(languageLabel(''), '');
    // @ts-expect-error testing the runtime guard
    assert.equal(languageLabel(undefined), '');
  });
});

function mkc(id, lang) {
  return { id, url: `https://subs.example/${id}`, lang, encoding: 'UTF-8' };
}

/* ============================================================
 * applyCueOffset
 * ============================================================ */

describe('applyCueOffset', () => {
  it('shifts every cue forward by the offset', () => {
    const cues = [
      { startTime: 1, endTime: 2 },
      { startTime: 5, endTime: 7 },
      { startTime: 10, endTime: 11 }
    ];
    const n = applyCueOffset(cues, 1.5);
    assert.equal(n, 3);
    assert.deepEqual(cues[0], { startTime: 2.5, endTime: 3.5, _baseStart: 1, _baseEnd: 2 });
    assert.equal(cues[1].startTime, 6.5);
    assert.equal(cues[1].endTime, 8.5);
    assert.equal(cues[2].startTime, 11.5);
  });

  it('shifts cues backward and clamps at zero', () => {
    const cues = [
      { startTime: 0.5, endTime: 2 },
      { startTime: 4, endTime: 6 }
    ];
    applyCueOffset(cues, -2);
    // First cue's adjusted start would be -1.5 → clamped to 0.
    assert.equal(cues[0].startTime, 0);
    assert.equal(cues[0].endTime, 0);
    // Second cue stays positive.
    assert.equal(cues[1].startTime, 2);
    assert.equal(cues[1].endTime, 4);
  });

  it('is idempotent — applying the same offset twice does not double-shift', () => {
    const cues = [{ startTime: 10, endTime: 12 }];
    applyCueOffset(cues, 2);
    applyCueOffset(cues, 2);
    assert.equal(cues[0].startTime, 12);
    assert.equal(cues[0].endTime, 14);
  });

  it('re-deriving from baseline lets the user step toward and back from an offset', () => {
    const cues = [{ startTime: 10, endTime: 12 }];
    applyCueOffset(cues, 2);
    assert.equal(cues[0].startTime, 12);
    applyCueOffset(cues, -3); // overshoot the original
    assert.equal(cues[0].startTime, 7);
    applyCueOffset(cues, 0); // back to neutral
    assert.equal(cues[0].startTime, 10);
    assert.equal(cues[0].endTime, 12);
  });

  it('handles TextTrackCueList-shaped (array-like) input', () => {
    const cueListLike = {
      length: 2,
      0: { startTime: 1, endTime: 2 },
      1: { startTime: 3, endTime: 4 }
    };
    const n = applyCueOffset(cueListLike, 1);
    assert.equal(n, 2);
    assert.equal(cueListLike[0].startTime, 2);
    assert.equal(cueListLike[1].startTime, 4);
  });

  it('returns 0 for empty / missing inputs', () => {
    assert.equal(applyCueOffset(null, 1), 0);
    assert.equal(applyCueOffset(undefined, 1), 0);
    assert.equal(applyCueOffset([], 1), 0);
    assert.equal(applyCueOffset({}, 1), 0);
  });

  it('skips holes in the cue list without crashing', () => {
    const cues = [{ startTime: 1, endTime: 2 }, null, { startTime: 5, endTime: 6 }];
    const n = applyCueOffset(cues, 1);
    assert.equal(n, 2);
    assert.equal(cues[0].startTime, 2);
    assert.equal(cues[2].startTime, 6);
  });
});
