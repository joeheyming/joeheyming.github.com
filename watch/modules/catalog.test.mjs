/**
 * Catalog-builder tests for the /watch/ player.
 *
 * Uses small synthetic Internet Archive metadata fixtures rather than
 * hitting `archive.org`, so the tests are deterministic and offline.
 * The shapes match what `https://archive.org/metadata/<item>` actually
 * returns (we keep just the fields the builder reads: `name` + `size`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCatalog,
  mergeCatalogs,
  mergeDescriptions,
  getNextEpisode
} from './catalog.js';
import { makeKey } from './descriptions.js';
import { getShow } from './shows.js';

/* ============================================================
 * buildCatalog
 * ============================================================ */

describe('buildCatalog — The Simpsons', () => {
  const show = getShow('simpsons');

  it('groups episodes by season and surfaces the movie separately', () => {
    const meta = {
      files: [
        { name: 'The Simpsons S01, E01 - Simpsons Roasting on an Open Fire.mp4' },
        { name: 'The Simpsons S01, E02 - Bart the Genius.mp4' },
        { name: 'The Simpsons S02, E01 - Bart Gets an F.mp4' },
        { name: 'Zhe Simpsons Movie.mp4' },
        { name: 'cover.jpg' }
      ]
    };
    const cat = buildCatalog(show, meta);
    // 3 episodes + 1 movie = 4 (total includes the movie).
    assert.equal(cat.total, 4);
    assert.equal(cat.seasons.length, 2);
    assert.equal(cat.seasons[0].number, 1);
    assert.equal(cat.seasons[0].episodes.length, 2);
    assert.equal(cat.seasons[1].number, 2);
    assert.equal(cat.movie?.title, show.movieTitle);
    assert.equal(cat.movie?.season, 0);
  });

  it('drops files the parser rejects', () => {
    const meta = {
      files: [
        { name: 'The Simpsons S01, E01 - x.mp4' },
        { name: 'Zhe Family Guy S13, E1 - The Simpsons Guy.mp4' },
        { name: '00-D\u2019ohtro.mp4' }
      ]
    };
    const cat = buildCatalog(show, meta);
    assert.equal(cat.total, 1);
  });

  it('episodes carry a stable archive.org URL', () => {
    const meta = {
      files: [{ name: 'The Simpsons S01, E01 - Title.mp4' }]
    };
    const cat = buildCatalog(show, meta);
    const ep = cat.seasons[0].episodes[0];
    assert.match(ep.url, /^https:\/\/archive\.org\/download\/doh_20240725\//);
    assert.match(ep.archiveUrl, /^https:\/\/archive\.org\/details\/doh_20240725/);
  });

  it('does not surface any archive.org thumbnail URL on episodes', () => {
    // Thumbnails come from TVMaze only — the IA `.thumbs/` directory
    // sometimes 403s and we'd rather show the emoji placeholder than
    // a broken image. Even when archive.org's metadata lists thumb
    // files, the builder must not stash them on the episode.
    const meta = {
      files: [
        { name: 'The Simpsons S01, E01 - x.mp4' },
        // A `.thumbs/` entry that previously would have populated
        // `ep.thumbUrl`. The builder should ignore it now.
        {
          name: 'doh_20240725.thumbs/The Simpsons S01, E01 - x_000001.jpg',
          format: 'Thumbnail'
        }
      ]
    };
    const cat = buildCatalog(show, meta);
    const ep = cat.seasons[0].episodes[0];
    assert.equal(ep.thumbUrl, undefined, 'thumbUrl should no longer exist on Episode');
  });
});

describe('buildCatalog — Beavis dedup', () => {
  const show = getShow('beavis');

  it('prefers plain .mp4 over the lower-bitrate .ia.mp4 derivative', () => {
    // Alphabetically `.ia.mp4` sorts before `.mp4`, so without the
    // explicit sort in buildCatalog the dedup would keep the worse file.
    const meta = {
      files: [
        { name: 'S4/S4 EP 01 Wall Of Youth.ia.mp4' },
        { name: 'S4/S4 EP 01 Wall Of Youth.mp4' }
      ]
    };
    const cat = buildCatalog(show, meta);
    assert.equal(cat.total, 1);
    const ep = cat.seasons[0].episodes[0];
    assert.ok(ep.url.endsWith('Wall%20Of%20Youth.mp4'), `expected plain mp4, got ${ep.url}`);
    assert.ok(!ep.url.includes('.ia.mp4'));
  });

  it('keeps .ia.mp4 when no plain .mp4 exists (S8)', () => {
    const meta = {
      files: [{ name: 'S8/S8 EP 01 Wherewovles of Highland .. Crying.ia.mp4' }]
    };
    const cat = buildCatalog(show, meta);
    assert.equal(cat.total, 1);
    assert.ok(cat.seasons[0].episodes[0].url.endsWith('.ia.mp4'));
  });
});

describe('buildCatalog — multi-item URL construction', () => {
  const show = getShow('tmnt');

  it('uses the explicit itemId arg over show.iaItem when given', () => {
    const meta = {
      files: [{ name: 'Teenage Mutant Ninja Turtles - 01x01 - Turtle Tracks.mp4' }]
    };
    const cat = buildCatalog(show, meta, 'tmnt-season-1-2');
    const ep = cat.seasons[0].episodes[0];
    assert.match(ep.url, /^https:\/\/archive\.org\/download\/tmnt-season-1-2\//);
    assert.match(ep.archiveUrl, /^https:\/\/archive\.org\/details\/tmnt-season-1-2\//);
  });

  it('falls back to the first iaItem when no itemId is passed', () => {
    const meta = {
      files: [{ name: 'Teenage Mutant Ninja Turtles - 01x01 - Turtle Tracks.mp4' }]
    };
    const cat = buildCatalog(show, meta);
    // show.iaItem is an array; first entry should win as the URL base.
    assert.match(cat.seasons[0].episodes[0].url, /\/tmnt-season-1-2\//);
  });
});

describe('mergeCatalogs', () => {
  const show = getShow('tmnt');

  it('merges per-item catalogs into one channel, sorted by (season, episode)', () => {
    const a = buildCatalog(
      show,
      {
        files: [
          { name: 'Teenage Mutant Ninja Turtles - 01x02 - Enter the Shredder.mp4' },
          { name: 'Teenage Mutant Ninja Turtles - 01x01 - Turtle Tracks.mp4' }
        ]
      },
      'tmnt-season-1-2'
    );
    const b = buildCatalog(
      show,
      { files: [{ name: '05x01 - Donatello`s Badd Time.mp4' }] },
      'tmnt-s05'
    );
    const merged = mergeCatalogs(show, [a, b]);
    assert.equal(merged.total, 3);
    assert.deepEqual(
      merged.seasons.map((s) => s.number),
      [1, 5]
    );
    assert.deepEqual(
      merged.seasons[0].episodes.map((e) => e.episode),
      [1, 2]
    );
    // Each episode keeps the URL of the item it came from.
    assert.match(merged.seasons[0].episodes[0].url, /\/tmnt-season-1-2\//);
    assert.match(merged.seasons[1].episodes[0].url, /\/tmnt-s05\//);
  });

  it('on a duplicate (season, episode) slot the first per-item catalog wins', () => {
    const a = buildCatalog(
      show,
      { files: [{ name: 'Teenage Mutant Ninja Turtles - 01x01 - Turtle Tracks.mp4' }] },
      'tmnt-season-1-2'
    );
    const b = buildCatalog(
      show,
      { files: [{ name: 'Teenage Mutant Ninja Turtles - 01x01 - Different Take.mp4' }] },
      'tmnt-other-pack'
    );
    const merged = mergeCatalogs(show, [a, b]);
    assert.equal(merged.total, 1);
    assert.equal(merged.seasons[0].episodes[0].title, 'Turtle Tracks');
    assert.match(merged.seasons[0].episodes[0].url, /\/tmnt-season-1-2\//);
  });

  it('keeps the first non-null movie across catalogs', () => {
    const simpsons = getShow('simpsons');
    const noMovie = buildCatalog(
      simpsons,
      { files: [{ name: 'The Simpsons S01, E01 - x.mp4' }] },
      'doh_20240725'
    );
    const withMovie = buildCatalog(
      simpsons,
      { files: [{ name: 'Zhe Simpsons Movie.mp4' }] },
      'doh_20240725'
    );
    const merged = mergeCatalogs(simpsons, [noMovie, withMovie]);
    assert.ok(merged.movie);
    assert.equal(merged.movie.season, 0);
  });

  it('ignores null entries (defensive)', () => {
    const a = buildCatalog(
      show,
      { files: [{ name: 'Teenage Mutant Ninja Turtles - 01x01 - Turtle Tracks.mp4' }] },
      'tmnt-season-1-2'
    );
    const merged = mergeCatalogs(show, [a, null, undefined]);
    assert.equal(merged.total, 1);
  });
});

describe('buildCatalog — South Park', () => {
  const show = getShow('southpark');

  it('places Spirit of Christmas shorts in a season-0 row', () => {
    const meta = {
      files: [
        {
          name: 'South Park S00 The Spirit of Christmas/The Spirit of Christmas E01 Jesus vs. Frosty.mp4'
        },
        { name: 'South Park S01E01 Cartman Gets an Anal Probe.mp4' }
      ]
    };
    const cat = buildCatalog(show, meta);
    const s0 = cat.seasons.find((s) => s.number === 0);
    assert.ok(s0, 'expected a season 0 row for the shorts');
    assert.equal(s0.episodes[0].title, 'Jesus vs. Frosty');
    assert.equal(cat.movie, null);
  });
});

/* ============================================================
 * mergeDescriptions
 * ============================================================ */

describe('mergeDescriptions', () => {
  const show = getShow('simpsons');

  it('grafts summary, image, airdate, and prefers TVMaze title', () => {
    const meta = {
      files: [{ name: 'The Simpsons S01, E01 - filesystem unsafe title.mp4' }]
    };
    const cat = buildCatalog(show, meta);
    const descMap = new Map([
      [
        makeKey(1, 1),
        {
          name: 'Simpsons Roasting on an Open Fire', // TVMaze preserves apostrophes
          summary: 'A holiday classic.',
          image: 'https://tvmaze.example/still.png',
          airdate: '1989-12-17'
        }
      ]
    ]);
    mergeDescriptions(cat, descMap);
    const ep = cat.seasons[0].episodes[0];
    assert.equal(ep.title, 'Simpsons Roasting on an Open Fire');
    assert.equal(ep.description, 'A holiday classic.');
    assert.equal(ep.image, 'https://tvmaze.example/still.png');
    assert.equal(ep.airdate, '1989-12-17');
  });

  it('is a no-op for an empty or missing map', () => {
    const meta = { files: [{ name: 'The Simpsons S01, E01 - Orig Title.mp4' }] };
    const cat = buildCatalog(show, meta);
    mergeDescriptions(cat, new Map());
    mergeDescriptions(cat, null);
    assert.equal(cat.seasons[0].episodes[0].title, 'Orig Title');
  });

  it('leaves episodes without a TVMaze match untouched', () => {
    const meta = { files: [{ name: 'The Simpsons S99, E99 - Phantom.mp4' }] };
    const cat = buildCatalog(show, meta);
    mergeDescriptions(cat, new Map([[makeKey(1, 1), { name: 'Wrong', summary: '' }]]));
    assert.equal(cat.seasons[0].episodes[0].title, 'Phantom');
    assert.equal(cat.seasons[0].episodes[0].description, undefined);
  });
});

/* ============================================================
 * getNextEpisode (cross-season)
 * ============================================================ */

describe('getNextEpisode', () => {
  const show = getShow('simpsons');
  const cat = buildCatalog(show, {
    files: [
      { name: 'The Simpsons S01, E01 - A.mp4' },
      { name: 'The Simpsons S01, E02 - B.mp4' },
      { name: 'The Simpsons S01, E03 - C.mp4' },
      { name: 'The Simpsons S02, E01 - D.mp4' },
      { name: 'The Simpsons S02, E02 - E.mp4' },
      { name: 'Zhe Simpsons Movie.mp4' }
    ]
  });

  it('returns the next episode inside the same season', () => {
    const cur = cat.seasons[0].episodes[0];
    const next = getNextEpisode(cat, cur);
    assert.equal(next?.season, 1);
    assert.equal(next?.episode, 2);
  });

  it('jumps to the first episode of the next season at end of season', () => {
    const cur = cat.seasons[0].episodes[2]; // S01E03 (last in S01)
    const next = getNextEpisode(cat, cur);
    assert.equal(next?.season, 2);
    assert.equal(next?.episode, 1);
  });

  it('returns null at the very end of the catalog (no wrap)', () => {
    const cur = cat.seasons[1].episodes[1]; // S02E02, last
    assert.equal(getNextEpisode(cat, cur), null);
  });

  it('returns null for the movie (season 0)', () => {
    assert.ok(cat.movie);
    assert.equal(getNextEpisode(cat, cat.movie), null);
  });

  it('returns null for unknown current episodes', () => {
    assert.equal(
      getNextEpisode(cat, { season: 99, episode: 1, title: '', file: '', url: '', archiveUrl: '' }),
      null
    );
    assert.equal(getNextEpisode(null, cat.seasons[0].episodes[0]), null);
    assert.equal(getNextEpisode(cat, null), null);
  });

  it('skips empty intermediate seasons', () => {
    const sparse = {
      seasons: [
        { number: 1, episodes: [{ season: 1, episode: 1, title: 'A' }] },
        { number: 2, episodes: [] }, // empty — skip
        { number: 3, episodes: [{ season: 3, episode: 1, title: 'B' }] }
      ],
      movie: null,
      total: 2
    };
    const next = getNextEpisode(sparse, sparse.seasons[0].episodes[0]);
    assert.equal(next?.season, 3);
    assert.equal(next?.episode, 1);
  });
});
