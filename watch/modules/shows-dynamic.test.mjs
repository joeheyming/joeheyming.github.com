/**
 * Tests for the pure pieces of dynamic show discovery.
 *
 * The live fetchers (TVMaze / IA HTTP calls) aren't tested here — we
 * inject fake fetchers in the orchestrator tests instead. That keeps
 * the suite hermetic and lets us script all the failure modes.
 *
 * Fixtures are hand-crafted to mirror the filename conventions we
 * actually see in the sheet-backed show registry, so a passing test
 * here is a real signal that the matcher could have rediscovered
 * those shows without bespoke parsers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildParser,
  makeGenericParser,
  scoreCandidate,
  synthesizeShowConfig,
  discoverShow,
  TITLE_STRATEGY
} from './shows-dynamic.js';

const episode = (season, number, name, airdate) => ({ season, number, name, airdate });
const file = (name) => ({ name, format: 'h.264' });

const SIMPSONS_S1 = [
  episode(1, 1, 'Simpsons Roasting on an Open Fire', '1989-12-17'),
  episode(1, 2, 'Bart the Genius', '1990-01-14'),
  episode(1, 3, "Homer's Odyssey", '1990-01-21'),
  episode(1, 4, "There's No Disgrace Like Home", '1990-01-28')
];

describe('buildParser — strategy: SxxExx', () => {
  it('maps standard "Show.S01E02.Title.mp4" filenames', () => {
    const files = [
      file('Simpsons.S01E01.Roasting.mp4'),
      file('Simpsons.S01E02.Bart.Genius.mp4'),
      file('Simpsons.S01E03.Homer.Odyssey.mp4'),
      file('Simpsons.S01E04.No.Disgrace.mp4')
    ];
    const parser = buildParser(SIMPSONS_S1, files);
    assert.ok(parser, 'parser should not be null');
    assert.equal(parser.strategy, 'sxxexx');
    assert.equal(parser.coverage, 1);
    assert.deepEqual(parser.parse('Simpsons.S01E02.Bart.Genius.mp4'), {
      season: 1,
      episode: 2,
      title: 'Bart the Genius'
    });
  });

  it('accepts lowercase s01e01 variants', () => {
    const files = [
      file('show.s01e01.episode.mp4'),
      file('show.s01e02.episode.mp4'),
      file('show.s01e03.episode.mp4'),
      file('show.s01e04.episode.mp4')
    ];
    const parser = buildParser(SIMPSONS_S1, files);
    assert.equal(parser.strategy, 'sxxexx');
    assert.equal(parser.coverage, 1);
  });

  it('drops `.ia.mp4` derivatives even if their SxxExx parses', () => {
    const files = [
      file('Simpsons.S01E01.mp4'),
      file('Simpsons.S01E02.mp4'),
      file('Simpsons.S01E01.ia.mp4'),
      file('Simpsons.S01E02.ia.mp4'),
      file('Simpsons.S01E03.mp4'),
      file('Simpsons.S01E04.mp4')
    ];
    const parser = buildParser(SIMPSONS_S1, files);
    assert.equal(parser.coverage, 1);
    assert.equal(parser.byFilename.size, 4);
  });

  it('returns null when no SxxExx files match real episodes', () => {
    const files = [file('show.S99E01.mp4'), file('show.S99E02.mp4')];
    const parser = buildParser(SIMPSONS_S1, files);
    assert.equal(parser, null);
  });

  it('handles paths with directory prefixes', () => {
    const files = [
      file('season1/Simpsons.S01E01.mp4'),
      file('season1/Simpsons.S01E02.mp4'),
      file('season1/Simpsons.S01E03.mp4'),
      file('season1/Simpsons.S01E04.mp4')
    ];
    const parser = buildParser(SIMPSONS_S1, files);
    assert.equal(parser.coverage, 1);
  });
});

describe('buildParser — strategy: NxNN', () => {
  it('maps "1x02 - Title" style filenames', () => {
    const files = [
      file('Simpsons - 1x01 - Roasting.mp4'),
      file('Simpsons - 1x02 - Bart Genius.mp4'),
      file('Simpsons - 1x03 - Homer Odyssey.mp4'),
      file('Simpsons - 1x04 - No Disgrace.mp4')
    ];
    const parser = buildParser(SIMPSONS_S1, files);
    assert.equal(parser.strategy, 'nxnn');
    assert.equal(parser.coverage, 1);
    assert.deepEqual(parser.parse('Simpsons - 1x03 - Homer Odyssey.mp4'), {
      season: 1,
      episode: 3,
      title: "Homer's Odyssey"
    });
  });
});

describe('buildParser — strategy: Season N Episode NN', () => {
  // Star Trek: The Next Generation (Billy Shultz IA dump) uses the
  // verbose form: "Star Trek The Next Generation Season 1 Episode
  // 03 - The Naked Now.mp4". No SxxExx token appears anywhere; the
  // matcher needs this third pattern to land the show at all.
  it('maps "Season N Episode NN" style filenames', () => {
    const files = [
      file('Star Trek TNG Season 1 Episode 01 - Roasting.mp4'),
      file('Star Trek TNG Season 1 Episode 02 - Bart Genius.mp4'),
      file('Star Trek TNG Season 1 Episode 03 - Homer Odyssey.mp4'),
      file('Star Trek TNG Season 1 Episode 04 - No Disgrace.mp4')
    ];
    const parser = buildParser(SIMPSONS_S1, files);
    assert.equal(parser.strategy, 'season_episode');
    assert.equal(parser.coverage, 1);
    assert.deepEqual(parser.parse('Star Trek TNG Season 1 Episode 03 - Homer Odyssey.mp4'), {
      season: 1,
      episode: 3,
      title: "Homer's Odyssey"
    });
  });

  it('is case-insensitive on "Season" / "Episode"', () => {
    const files = [file('show season 1 episode 01.mp4'), file('SHOW SEASON 1 EPISODE 02.mp4')];
    const parser = buildParser(SIMPSONS_S1, files);
    assert.equal(parser.strategy, 'season_episode');
    assert.equal(parser.coverage, 1);
  });

  it('loses to SxxExx on the same files when both could match', () => {
    // If a filename embeds both forms (unlikely but possible), the
    // compact SxxExx takes precedence — same intent, but it's the
    // canonical token the rest of the registry uses.
    const files = [
      file('Show S01E01 Season 1 Episode 01.mp4'),
      file('Show S01E02 Season 1 Episode 02.mp4'),
      file('Show S01E03 Season 1 Episode 03.mp4')
    ];
    const parser = buildParser(SIMPSONS_S1, files);
    assert.equal(parser.strategy, 'sxxexx');
  });
});

describe('buildParser — title strategy is not in the default menu', () => {
  // The parser-only calibration (scripts/calibrate-matcher.mjs) showed
  // title-substring confidently mismaps episodes when IA filename
  // ordering disagrees with TVMaze's (DBZ: 100% wrong, Smurfs: 50%
  // wrong). The default menu is sxxexx + nxnn only; title remains
  // available via TITLE_STRATEGY for callers that opt in.

  it('returns null for files that only title-match (no SxxExx / NxNN)', () => {
    const files = [
      file('001 - Simpsons Roasting on an Open Fire.mp4'),
      file('002 - Bart the Genius.mp4'),
      file('003 - Homers Odyssey.mp4'),
      file('004 - Theres No Disgrace Like Home.mp4')
    ];
    assert.equal(buildParser(SIMPSONS_S1, files), null);
  });
});

describe('TITLE_STRATEGY (opt-in for discovery)', () => {
  it('matches each filename to the episode whose title is a substring', () => {
    const files = [
      file('001 - Simpsons Roasting on an Open Fire.mp4'),
      file('002 - Bart the Genius.mp4'),
      file('003 - Homers Odyssey.mp4'),
      file('004 - Theres No Disgrace Like Home.mp4')
    ];
    const result = TITLE_STRATEGY.match(SIMPSONS_S1, files);
    assert.equal(result.coverage, 1);
    assert.equal(result.byFilename.size, 4);
  });

  it('prefers longer titles over shorter when both could fit', () => {
    const episodes = [episode(1, 1, 'Pilot'), episode(1, 2, 'Pilot Part Two: The Beginning')];
    const files = [
      file('S01 - 01 - Pilot.mp4'),
      file('S01 - 02 - Pilot Part Two The Beginning.mp4')
    ];
    const result = TITLE_STRATEGY.match(episodes, files);
    const longer = result.byFilename.get('S01 - 02 - Pilot Part Two The Beginning.mp4');
    assert.deepEqual(longer, {
      filename: 'S01 - 02 - Pilot Part Two The Beginning.mp4',
      season: 1,
      episode: 2,
      title: 'Pilot Part Two: The Beginning'
    });
  });

  it('ignores titles shorter than four chars to avoid false hits', () => {
    const episodes = [
      episode(1, 1, 'Go'),
      episode(1, 2, 'The Long-Form Title'),
      episode(1, 3, 'Another Distinct Title')
    ];
    const files = [
      file('001 - Go.mp4'),
      file('002 - The Long-Form Title.mp4'),
      file('003 - Another Distinct Title.mp4')
    ];
    const result = TITLE_STRATEGY.match(episodes, files);
    assert.equal(result.byFilename.size, 2, 'only the long-titled episodes should match');
    assert.equal(result.byFilename.has('001 - Go.mp4'), false);
  });
});

describe('buildParser — selection between strategies', () => {
  it('picks the strategy with higher coverage when both have hits', () => {
    const files = [
      file('Simpsons.S01E01.Roasting.mp4'),
      file('Simpsons.S01E02.Bart.Genius.mp4'),
      file('001 - Homers Odyssey.mp4')
    ];
    const parser = buildParser(SIMPSONS_S1, files);
    assert.equal(parser.strategy, 'sxxexx');
  });

  it('prefers SxxExx over title even when title has broader coverage', () => {
    // The Recess/Smurfs regression case: TVMaze uses airing order, the
    // IA uploader used DVD/production order, both filename SxxExx
    // tokens AND episode titles parse — but the IA filename SxxExx is
    // the uploader's intent and the title match against TVMaze is the
    // wrong order. SxxExx must win.
    const tvmazeAiringOrder = [
      episode(1, 1, 'Pilot Aired First'),
      episode(1, 2, 'Aired Second'),
      episode(1, 3, 'Aired Third')
    ];
    const filesDvdOrder = [
      // Uploader put pilot at S1E03 (DVD order); title is what TVMaze
      // calls S1E1. If `title` wins, the player would treat this file
      // as TVMaze's episode 1 — wrong.
      file('Show.S01E03.Pilot Aired First.mp4'),
      file('Show.S01E01.Aired Third.mp4'),
      file('Show.S01E02.Aired Second.mp4')
    ];
    const parser = buildParser(tvmazeAiringOrder, filesDvdOrder);
    assert.equal(parser.strategy, 'sxxexx');
    const result = parser.parse('Show.S01E03.Pilot Aired First.mp4');
    assert.equal(result.season, 1);
    assert.equal(result.episode, 3);
  });

  it('returns null when SxxExx is below floor and title is no longer a fallback', () => {
    // Same fixture that previously fell through to title; with title
    // removed from the default menu and SxxExx below floor (1 of 3),
    // there's no usable strategy left. Caller (catalog.js) keeps the
    // bespoke parser.
    const files = [
      file('001 - Simpsons Roasting on an Open Fire.mp4'),
      file('002 - Bart the Genius.mp4'),
      file('Simpsons.S01E03.mp4')
    ];
    assert.equal(buildParser(SIMPSONS_S1, files), null);
  });
});

describe('buildParser — rejection cases', () => {
  it('returns null with no episodes', () => {
    assert.equal(buildParser([], [file('x.S01E01.mp4')]), null);
  });

  it('returns null with no playable files', () => {
    assert.equal(buildParser(SIMPSONS_S1, []), null);
    assert.equal(buildParser(SIMPSONS_S1, [file('show.mkv'), file('show.S01E01.ia.mp4')]), null);
  });

  it('returns null below the coverage floor', () => {
    const files = [
      file('Simpsons.S01E01.mp4'),
      file('completely unrelated random file.mp4'),
      file('another unrelated file.mp4'),
      file('yet another unrelated file.mp4')
    ];
    const parser = buildParser(SIMPSONS_S1, files);
    assert.equal(parser, null);
  });
});

describe('scoreCandidate', () => {
  it('accepts a well-shaped item', () => {
    const meta = {
      metadata: {},
      files: Array.from({ length: 22 }, (_, i) => file(`show.s01e${i + 1}.mp4`))
    };
    const tvmazeS1 = Array.from({ length: 22 }, (_, i) => episode(1, i + 1, `Ep ${i + 1}`));
    const score = scoreCandidate(meta, tvmazeS1);
    assert.equal(score.usable, true);
    assert.equal(score.mp4Count, 22);
    assert.equal(score.accessRestricted, false);
  });

  it('rejects access-restricted items', () => {
    const meta = {
      metadata: { 'access-restricted-item': 'true' },
      files: [file('x.S01E01.mp4')]
    };
    const score = scoreCandidate(meta, SIMPSONS_S1);
    assert.equal(score.usable, false);
    assert.equal(score.accessRestricted, true);
    assert.equal(score.reason, 'access_restricted');
  });

  it('also rejects when access-restricted-item is the boolean true', () => {
    const meta = {
      metadata: { 'access-restricted-item': true },
      files: [file('x.S01E01.mp4')]
    };
    assert.equal(scoreCandidate(meta, SIMPSONS_S1).usable, false);
  });

  it('rejects items with no MP4s', () => {
    const score = scoreCandidate({ metadata: {}, files: [file('show.mkv')] }, SIMPSONS_S1);
    assert.equal(score.usable, false);
    assert.equal(score.reason, 'no_mp4s');
  });

  it('rejects compilation rips with too few files relative to episode count', () => {
    const meta = { metadata: {}, files: [file('all-episodes-compilation.mp4')] };
    const tvmazeBig = Array.from({ length: 100 }, (_, i) => episode(1, i + 1, `Ep ${i + 1}`));
    const score = scoreCandidate(meta, tvmazeBig);
    assert.equal(score.usable, false);
    assert.equal(score.reason, 'episode_count_mismatch');
  });

  it('rejects junk dumps with too many files', () => {
    const meta = {
      metadata: {},
      files: Array.from({ length: 500 }, (_, i) => file(`clip${i}.mp4`))
    };
    const tvmazeBig = Array.from({ length: 22 }, (_, i) => episode(1, i + 1, `Ep ${i + 1}`));
    const score = scoreCandidate(meta, tvmazeBig);
    assert.equal(score.usable, false);
    assert.equal(score.reason, 'episode_count_mismatch');
  });

  it('skips the file-count ratio check when episode count is small', () => {
    const meta = { metadata: {}, files: [file('movie.mp4')] };
    const tinyShow = [episode(1, 1, 'Only Episode')];
    const score = scoreCandidate(meta, tinyShow);
    assert.equal(score.usable, true);
  });
});

describe('makeGenericParser', () => {
  // The catalog builder uses this — per-file parser keyed off
  // descriptions.js's map shape (`S01E02` -> { name }). Same SxxExx /
  // NxNN strategies as buildParser, but works one file at a time
  // (catalog.js doesn't scan all files first to pick a strategy).
  const descriptions = new Map([
    ['S01E01', { name: 'Pilot' }],
    ['S01E02', { name: 'Second Episode' }],
    ['S02E10', { name: 'Tenth of Second Season' }]
  ]);

  it('extracts SxxExx and looks up the title from descriptions', () => {
    const parse = makeGenericParser(descriptions);
    assert.deepEqual(parse('show.s01e01.mp4'), { season: 1, episode: 1, title: 'Pilot' });
    assert.deepEqual(parse('Show.S02E10.mp4'), {
      season: 2,
      episode: 10,
      title: 'Tenth of Second Season'
    });
  });

  it('extracts NxNN and looks up the title from descriptions', () => {
    const parse = makeGenericParser(descriptions);
    assert.deepEqual(parse('show - 1x02 - whatever.mp4'), {
      season: 1,
      episode: 2,
      title: 'Second Episode'
    });
  });

  it('extracts "Season N Episode NN" and looks up the title from descriptions', () => {
    // The Billy Shultz Star Trek: TNG dump uses this verbose form
    // ("Star Trek The Next Generation Season 1 Episode 03 - The
    // Naked Now.mp4"). No compact SxxExx token appears.
    const parse = makeGenericParser(descriptions);
    assert.deepEqual(parse('Star Trek TNG Season 1 Episode 01 - Pilot.mp4'), {
      season: 1,
      episode: 1,
      title: 'Pilot'
    });
    assert.deepEqual(parse('Star Trek TNG Season 2 Episode 10 - Title.mp4'), {
      season: 2,
      episode: 10,
      title: 'Tenth of Second Season'
    });
  });

  it('returns null when the extracted episode is not in descriptions', () => {
    const parse = makeGenericParser(descriptions);
    assert.equal(parse('show.S99E99.mp4'), null);
  });

  it('returns null when no extractor matches the filename', () => {
    const parse = makeGenericParser(descriptions);
    assert.equal(parse('cover.jpg'), null);
    assert.equal(parse('random_file.mp4'), null);
  });

  it('strips directory prefixes from paths', () => {
    const parse = makeGenericParser(descriptions);
    assert.deepEqual(parse('season1/show.S01E02.mp4'), {
      season: 1,
      episode: 2,
      title: 'Second Episode'
    });
  });

  it('degrades to unvalidated SxxExx when descriptions is empty (TVMaze offline)', () => {
    // If TVMaze is unreachable and the localStorage cache is cold, the
    // catalog should still build — titles will be filled by
    // mergeDescriptions on the next visit. Without this fallback the
    // generic-parser path becomes a hard dependency on TVMaze.
    const parse = makeGenericParser(new Map());
    assert.deepEqual(parse('show.s01e03.mp4'), { season: 1, episode: 3, title: '' });
  });

  it('returns null for non-S/E filenames even in degraded mode', () => {
    const parse = makeGenericParser(null);
    assert.equal(parse('random.mp4'), null);
  });
});

describe('synthesizeShowConfig', () => {
  const tvmaze = {
    id: 6315,
    name: 'The Simpsons',
    premiered: '1989-12-17',
    image: { medium: '...', original: '...' },
    externals: { imdb: 'tt0096697' },
    genres: ['Animation', 'Comedy'],
    summary: '<p>Family of five in <b>Springfield</b>.</p>',
    episodes: SIMPSONS_S1
  };

  const fakeParser = {
    strategy: 'sxxexx',
    coverage: 0.95,
    byFilename: new Map(),
    parse: () => null
  };

  it('produces a slug from the show name', () => {
    const cfg = synthesizeShowConfig({ tvmaze, iaItem: 'simpsons-archive', parser: fakeParser });
    assert.equal(cfg.id, 'the-simpsons');
  });

  it('derives era and animation/comedy tags from genres + premiered', () => {
    const cfg = synthesizeShowConfig({ tvmaze, iaItem: 'simpsons-archive', parser: fakeParser });
    assert.ok(cfg.tags.includes('80s'));
    assert.ok(cfg.tags.includes('animation'));
    assert.ok(cfg.tags.includes('comedy'));
  });

  it('falls back to live-action when Animation is not listed', () => {
    const liveAction = { ...tvmaze, genres: ['Drama', 'Comedy'] };
    const cfg = synthesizeShowConfig({
      tvmaze: liveAction,
      iaItem: 'x',
      parser: fakeParser
    });
    assert.ok(cfg.tags.includes('live-action'));
  });

  it('strips HTML from the tagline and caps at 200 chars', () => {
    const cfg = synthesizeShowConfig({ tvmaze, iaItem: 'x', parser: fakeParser });
    assert.equal(cfg.tagline, 'Family of five in Springfield.');
  });

  it('uses the parser function from buildParser', () => {
    const parser = buildParser(SIMPSONS_S1, [
      file('Simpsons.S01E01.mp4'),
      file('Simpsons.S01E02.mp4'),
      file('Simpsons.S01E03.mp4'),
      file('Simpsons.S01E04.mp4')
    ]);
    const cfg = synthesizeShowConfig({ tvmaze, iaItem: 'x', parser });
    assert.deepEqual(cfg.parser('Simpsons.S01E02.mp4'), {
      season: 1,
      episode: 2,
      title: 'Bart the Genius'
    });
  });

  it('marks the result with _dynamic so consumers can distinguish it', () => {
    const cfg = synthesizeShowConfig({ tvmaze, iaItem: 'x', parser: fakeParser });
    assert.equal(cfg._dynamic.strategy, 'sxxexx');
    assert.equal(cfg._dynamic.coverage, 0.95);
  });
});

describe('discoverShow — orchestration', () => {
  const goodMetadata = {
    metadata: {},
    files: [
      { name: 'Simpsons.S01E01.mp4' },
      { name: 'Simpsons.S01E02.mp4' },
      { name: 'Simpsons.S01E03.mp4' },
      { name: 'Simpsons.S01E04.mp4' }
    ]
  };

  const goodTvmaze = {
    id: 6315,
    name: 'The Simpsons',
    premiered: '1989-12-17',
    genres: ['Animation', 'Comedy'],
    externals: { imdb: 'tt0096697' },
    episodes: SIMPSONS_S1
  };

  it('returns tvmaze_not_found when TVMaze has nothing for the query', async () => {
    const result = await discoverShow('zzz nothing zzz', {
      tvmazeSearch: async () => null,
      iaSearch: async () => [],
      iaMetadata: async () => null
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'tvmaze_not_found');
  });

  it('returns no_ia_candidates when IA search is empty', async () => {
    const result = await discoverShow('simpsons', {
      tvmazeSearch: async () => goodTvmaze,
      iaSearch: async () => [],
      iaMetadata: async () => null
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_ia_candidates');
    assert.equal(result.tvmaze?.id, 6315);
  });

  it('returns no_playable_upload when every candidate scores unusable', async () => {
    const result = await discoverShow('simpsons', {
      tvmazeSearch: async () => goodTvmaze,
      iaSearch: async () => [{ identifier: 'bad', title: 'bad', downloads: 1 }],
      iaMetadata: async () => ({
        metadata: { 'access-restricted-item': 'true' },
        files: [{ name: 'x.mp4' }]
      })
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_playable_upload');
  });

  it('returns ok with a synthesized show on the happy path', async () => {
    const result = await discoverShow('simpsons', {
      tvmazeSearch: async () => goodTvmaze,
      iaSearch: async () => [{ identifier: 'simpsons-s1', title: 'Simpsons Season 1' }],
      iaMetadata: async () => goodMetadata
    });
    assert.equal(result.ok, true);
    assert.equal(result.iaCandidate?.identifier, 'simpsons-s1');
    assert.equal(result.parser?.strategy, 'sxxexx');
    assert.equal(result.show?.tvmazeId, 6315);
    assert.equal(result.show?._dynamic.strategy, 'sxxexx');
    assert.equal(result.iaFiles?.length, goodMetadata.files.length);
    assert.deepEqual(result.show?.parser('Simpsons.S01E03.mp4'), {
      season: 1,
      episode: 3,
      title: "Homer's Odyssey"
    });
  });

  it('skips unusable candidates and keeps trying the next one', async () => {
    const calls = { iaMetadata: 0 };
    const result = await discoverShow('simpsons', {
      tvmazeSearch: async () => goodTvmaze,
      iaSearch: async () => [
        { identifier: 'restricted', title: 'restricted' },
        { identifier: 'simpsons-s1', title: 'good one' }
      ],
      iaMetadata: async (id) => {
        calls.iaMetadata += 1;
        if (id === 'restricted') {
          return { metadata: { 'access-restricted-item': 'true' }, files: [] };
        }
        return goodMetadata;
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.iaCandidate?.identifier, 'simpsons-s1');
    assert.equal(calls.iaMetadata, 2);
  });

  it('only walks the first five candidates', async () => {
    const tried = [];
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      identifier: `cand-${i}`,
      title: `cand ${i}`
    }));
    const result = await discoverShow('simpsons', {
      tvmazeSearch: async () => goodTvmaze,
      iaSearch: async () => candidates,
      iaMetadata: async (id) => {
        tried.push(id);
        return { metadata: {}, files: [{ name: 'nope.mkv' }] };
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_playable_upload');
    assert.equal(tried.length, 5, 'should only check the first 5 candidates');
  });
});
