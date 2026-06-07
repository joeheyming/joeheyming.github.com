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
  buildMovieCatalog,
  mergeCatalogs,
  mergeDescriptions,
  getNextEpisode
} from './catalog.js';
import { makeKey } from './descriptions.js';
import { getShow } from './shows.js';

/**
 * Synthetic ShowConfig with a `movieDetector` for testing the
 * buildCatalog bundled-movie code path.
 *
 * No production show currently uses `movieDetector` — the four
 * shows that historically did (Simpsons, G.I. Joe, Dexter's Lab,
 * Recess) all had their bundled movies migrated to the standalone
 * MOVIES registry. The field stays on ShowConfig for any future
 * show that genuinely ships a feature alongside its episodes in a
 * single IA upload, and this fixture pins the contract under test
 * so the code path can't bit-rot.
 *
 * @type {import('./shows.js').ShowConfig}
 */
const bundledMovieShowFixture = {
  id: 'fixture-bundled-movie',
  name: 'Fixture Show With Bundled Movie',
  shortName: 'Fixture',
  emoji: '🧪',
  accent: '#000000',
  tags: ['animation', '90s'],
  tagline: 'synthetic fixture — not a real registered show',
  iaItem: 'fixture-item',
  tvmazeId: 0,
  parser: (file) => {
    const m = /^E(\d+)\.mp4$/i.exec(file);
    if (!m) return null;
    return { season: 1, episode: Number(m[1]), title: `Episode ${m[1]}` };
  },
  movieDetector: (name) => /^Bundled Movie\.mp4$/i.test(name),
  movieTitle: 'Bundled Movie (2000)'
};

/* ============================================================
 * buildCatalog
 * ============================================================ */

describe('buildCatalog — The Simpsons', () => {
  const show = getShow('simpsons');

  it('groups episodes by season and drops the (now-orphaned) movie file', () => {
    // The same `doh_20240725` IA item ships the movie at the top
    // level alongside the per-episode MP4s. Pre-migration, the
    // show carried a movieDetector that surfaced `Zhe Simpsons
    // Movie (2007).mp4` as `catalog.movie`. Post-migration, the
    // detector is gone — the movie is exposed through the MOVIES
    // registry instead (`?movie=simpsons-movie`), and the show's
    // parser must drop the orphaned file rather than re-surface it.
    const meta = {
      files: [
        { name: 'The Simpsons S01, E01 - Simpsons Roasting on an Open Fire.mp4' },
        { name: 'The Simpsons S01, E02 - Bart the Genius.mp4' },
        { name: 'The Simpsons S02, E01 - Bart Gets an F.mp4' },
        { name: 'Zhe Simpsons Movie (2007).mp4' },
        { name: 'cover.jpg' }
      ]
    };
    const cat = buildCatalog(show, meta);
    assert.equal(cat.total, 3, 'movie file must not be counted in the show catalog');
    assert.equal(cat.seasons.length, 2);
    assert.equal(cat.seasons[0].number, 1);
    assert.equal(cat.seasons[0].episodes.length, 2);
    assert.equal(cat.seasons[1].number, 2);
    assert.equal(cat.movie, null, 'simpsons must no longer carry a bundled movie');
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

describe('buildCatalog — bundled-movie code path (synthetic fixture)', () => {
  // No production show carries `movieDetector` anymore — the four
  // historical bundled movies (Simpsons, G.I. Joe, Dexter's Lab,
  // Recess) all migrated to the standalone MOVIES registry. The
  // field stays on ShowConfig for any future show that might ship a
  // feature alongside its episodes in a single IA upload, and this
  // synthetic fixture pins the contract under test so the code path
  // can't bit-rot.

  it('surfaces matched files as catalog.movie with season=0', () => {
    const meta = {
      files: [
        { name: 'E01.mp4' },
        { name: 'E02.mp4' },
        { name: 'Bundled Movie.mp4' },
        { name: 'cover.jpg' }
      ]
    };
    const cat = buildCatalog(bundledMovieShowFixture, meta);
    assert.equal(cat.total, 3, '2 episodes + 1 movie');
    assert.equal(cat.seasons.length, 1);
    assert.equal(cat.seasons[0].episodes.length, 2);
    assert.equal(cat.movie?.title, bundledMovieShowFixture.movieTitle);
    assert.equal(cat.movie?.season, 0);
  });

  it('falls back to show.name when movieTitle is undefined', () => {
    const fixtureNoTitle = { ...bundledMovieShowFixture, movieTitle: undefined };
    const cat = buildCatalog(fixtureNoTitle, {
      files: [{ name: 'Bundled Movie.mp4' }]
    });
    assert.equal(cat.movie?.title, fixtureNoTitle.name);
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
    // Uses the synthetic bundled-movie fixture rather than a real
    // show — no production show currently carries `movieDetector`,
    // so we'd otherwise be unable to exercise mergeCatalogs's
    // movie-preservation branch with a registered show.
    const noMovie = buildCatalog(bundledMovieShowFixture, { files: [{ name: 'E01.mp4' }] });
    const withMovie = buildCatalog(bundledMovieShowFixture, {
      files: [{ name: 'Bundled Movie.mp4' }]
    });
    const merged = mergeCatalogs(bundledMovieShowFixture, [noMovie, withMovie]);
    assert.ok(merged.movie);
    assert.equal(merged.movie.season, 0);
    assert.equal(merged.movie.title, bundledMovieShowFixture.movieTitle);
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
  // Uses the synthetic bundled-movie fixture so we can exercise the
  // "next-after-movie" path. The fixture's parser puts everything
  // matched into season 1, so we extend it locally to also accept a
  // season 2 shape for the cross-season-jump assertions.
  const show = /** @type {import('./shows.js').ShowConfig} */ ({
    ...bundledMovieShowFixture,
    parser: (/** @type {string} */ file) => {
      const m = /^S(\d+)E(\d+)\.mp4$/i.exec(file);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: `Episode ${m[2]}` };
    }
  });
  const cat = buildCatalog(show, {
    files: [
      { name: 'S1E01.mp4' },
      { name: 'S1E02.mp4' },
      { name: 'S1E03.mp4' },
      { name: 'S2E01.mp4' },
      { name: 'S2E02.mp4' },
      { name: 'Bundled Movie.mp4' }
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

/* ============================================================
 * buildMovieCatalog
 * ============================================================ */

describe('buildMovieCatalog', () => {
  // Synthetic MovieConfig — we don't import from movies.js because
  // the registry ships empty by design; the builder is generic over
  // any object with the expected shape and these tests pin that
  // contract.
  const baseMovie = {
    id: 'test-movie',
    name: 'Test Movie (2020)',
    shortName: 'Test',
    emoji: '🎬',
    accent: '#888888',
    tags: ['live-action', '2020s'],
    tagline: 'A fixture used by the catalog tests.',
    iaItem: 'test-movie-item'
  };

  it('picks the file matching `iaFile` exactly and surfaces it as catalog.movie', () => {
    const meta = {
      files: [
        { name: 'trailer.mp4', size: '12345' },
        { name: 'Test Movie (2020).mp4', size: '987654321', length: '5400' },
        { name: 'behind-the-scenes.mp4', size: '111111' }
      ]
    };
    const cat = buildMovieCatalog({ ...baseMovie, iaFile: 'Test Movie (2020).mp4' }, meta);
    assert.equal(cat.total, 1);
    assert.deepEqual(cat.seasons, []);
    assert.ok(cat.movie);
    assert.equal(cat.movie.title, baseMovie.name);
    assert.equal(cat.movie.season, 0);
    assert.equal(cat.movie.episode, 0);
    assert.equal(cat.movie.sizeBytes, 987654321);
    assert.equal(cat.movie.durationSec, 5400);
    assert.match(cat.movie.url, /^https:\/\/archive\.org\/download\/test-movie-item\//);
  });

  it('falls back to the first plain mp4 when iaFile is omitted', () => {
    // No iaFile means "first acceptable file wins". `cover.jpg`
    // fails the default acceptor; the mp4 below it is picked.
    const meta = {
      files: [
        { name: 'cover.jpg' },
        { name: 'movie.mp4', size: '50000' },
        { name: 'also-movie.mp4', size: '99999' }
      ]
    };
    const cat = buildMovieCatalog(baseMovie, meta);
    assert.equal(cat.total, 1);
    assert.equal(cat.movie?.file, 'movie.mp4');
  });

  it('prefers plain .mp4 over .ia.mp4 when iaFile is omitted', () => {
    // Same dedup story as the show path: an item that ships both
    // flavours should pick the higher-bitrate plain one.
    const meta = {
      files: [
        { name: 'movie.ia.mp4', size: '100' },
        { name: 'movie.mp4', size: '200' }
      ]
    };
    const cat = buildMovieCatalog(baseMovie, meta);
    assert.equal(cat.movie?.file, 'movie.mp4');
  });

  it('returns total=0 when no file matches iaFile', () => {
    const meta = { files: [{ name: 'something-else.mp4' }] };
    const movie = { ...baseMovie, iaFile: 'expected.mp4' };
    const cat = buildMovieCatalog(movie, meta);
    assert.equal(cat.total, 0);
    assert.equal(cat.movie, null);
    assert.deepEqual(cat.seasons, []);
    // Subject is still set so the watch view's `show` reference
    // works (the "channel off the air" fallback reads `.iaItem`
    // off it to populate the archive.org error link).
    assert.equal(cat.show, movie);
  });

  it('returns total=0 when the item has no acceptable files', () => {
    const meta = {
      files: [{ name: 'cover.jpg' }, { name: 'metadata.xml' }, { name: 'movie.mkv' }]
    };
    const cat = buildMovieCatalog(baseMovie, meta);
    assert.equal(cat.total, 0);
    assert.equal(cat.movie, null);
  });

  it('iaFile matches on basename, not full path', () => {
    // An item that nests the movie under a subdirectory still
    // matches when iaFile is just the filename. This keeps the
    // registry entries terse — no need to know how the uploader
    // structured their item.
    const meta = {
      files: [{ name: 'Extras/trailer.mp4' }, { name: 'Feature/movie.mp4', size: '7777' }]
    };
    const cat = buildMovieCatalog({ ...baseMovie, iaFile: 'movie.mp4' }, meta);
    assert.equal(cat.total, 1);
    assert.equal(cat.movie?.file, 'Feature/movie.mp4');
    assert.equal(cat.movie?.sizeBytes, 7777);
  });

  it('uses the IA file description when present, else the registry tagline', () => {
    const metaWithDesc = {
      files: [{ name: 'movie.mp4', description: 'A synopsis the uploader wrote.' }]
    };
    const catWithDesc = buildMovieCatalog(baseMovie, metaWithDesc);
    assert.equal(catWithDesc.movie?.description, 'A synopsis the uploader wrote.');

    const metaNoDesc = { files: [{ name: 'movie.mp4' }] };
    const catNoDesc = buildMovieCatalog(baseMovie, metaNoDesc);
    assert.equal(catNoDesc.movie?.description, baseMovie.tagline);
  });

  it('honours a custom acceptFile predicate', () => {
    // A movie whose only available file is the auto-generated
    // `.ia.mp4` derivative would override the default acceptor (same
    // pattern as the Robotech show entry). The custom acceptor wins
    // when iaFile isn't set.
    const meta = {
      files: [{ name: 'movie.ia.mp4', size: '12345' }]
    };
    const movie = {
      ...baseMovie,
      acceptFile: (raw) => /\.ia\.mp4$/i.test(raw.name)
    };
    const cat = buildMovieCatalog(movie, meta);
    assert.equal(cat.total, 1);
    assert.equal(cat.movie?.file, 'movie.ia.mp4');
  });

  it('itemId arg overrides movie.iaItem in URL construction', () => {
    const meta = { files: [{ name: 'movie.mp4' }] };
    const cat = buildMovieCatalog(baseMovie, meta, 'different-item-id');
    assert.match(cat.movie?.url, /\/different-item-id\//);
    assert.match(cat.movie?.archiveUrl, /\/different-item-id\//);
  });
});
