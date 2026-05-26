/**
 * Filename-parser tests for the /watch/ show registry.
 *
 * Each show's parser is a regex over Internet Archive filenames; this
 * suite locks in real-world examples from each archive item so a future
 * tweak doesn't silently start dropping episodes. New fixtures should
 * come from `https://archive.org/metadata/<item>` not from the
 * imagination — IA filenames are full of typos and one-off variants.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SHOWS, getShow, __testing } from '../watch/modules/shows.js';

const {
  parseSimpsons,
  parseSouthPark,
  parseBeavis,
  parseSmurfs,
  parseDnD,
  parseDBZ,
  parseInspectorGadget,
  parseAquaTeen,
  parseRockyBullwinkle,
  parseTMNT,
  isSimpsonsMovie
} = __testing;

describe('SHOWS registry', () => {
  it('contains the expected shows', () => {
    assert.deepEqual(
      SHOWS.map((s) => s.id),
      [
        'simpsons',
        'southpark',
        'beavis',
        'smurfs',
        'dnd',
        'dbz',
        'inspector-gadget',
        'aqua-teen',
        'rocky-bullwinkle',
        'tmnt'
      ]
    );
  });

  it('every show declares the required fields', () => {
    for (const s of SHOWS) {
      assert.equal(typeof s.id, 'string');
      assert.equal(typeof s.name, 'string');
      // iaItem is either a single archive.org id (most shows) or an
      // array of ids (multi-item shows like TMNT). Both shapes are
      // accepted by loadCatalog.
      const items = Array.isArray(s.iaItem) ? s.iaItem : [s.iaItem];
      assert.ok(items.length > 0, `${s.id} declares at least one iaItem`);
      for (const id of items) assert.equal(typeof id, 'string');
      assert.equal(typeof s.tvmazeId, 'number');
      assert.equal(typeof s.parser, 'function');
      assert.match(s.accent, /^#[0-9a-f]{6}$/i);
    }
  });

  it('TMNT is the (currently sole) multi-item show', () => {
    const tmnt = getShow('tmnt');
    assert.ok(Array.isArray(tmnt?.iaItem));
    assert.ok(tmnt.iaItem.length >= 2, 'TMNT should pull from multiple IA items');
  });

  it('getShow returns the entry or null', () => {
    assert.equal(getShow('simpsons')?.id, 'simpsons');
    assert.equal(getShow('nonexistent'), null);
  });
});

describe('parseSimpsons', () => {
  it('parses the canonical "S01, E01" form', () => {
    assert.deepEqual(
      parseSimpsons('The Simpsons S01, E01 - Simpsons Roasting on an Open Fire.mp4'),
      {
        season: 1,
        episode: 1,
        title: 'Simpsons Roasting on an Open Fire'
      }
    );
  });

  it('tolerates a missing space after the comma', () => {
    assert.deepEqual(parseSimpsons('The Simpsons S03,E15 - Homer Alone.mp4'), {
      season: 3,
      episode: 15,
      title: 'Homer Alone'
    });
  });

  it('tolerates "S01 E01" (no comma)', () => {
    assert.deepEqual(parseSimpsons('The Simpsons S07 E25 - Summer of 4 Ft. 2.mp4'), {
      season: 7,
      episode: 25,
      title: 'Summer of 4 Ft. 2'
    });
  });

  it('tolerates a missing dash before the title', () => {
    assert.deepEqual(parseSimpsons('The Simpsons S01, E02 Bart the Genius.mp4'), {
      season: 1,
      episode: 2,
      title: 'Bart the Genius'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseSimpsons('Zhe Simpsons Movie.mp4'), null);
    assert.equal(parseSimpsons('Zhe Family Guy S13, E1 - The Simpsons Guy.mp4'), null);
    assert.equal(parseSimpsons('random.mp4'), null);
  });

  it('isSimpsonsMovie matches the takedown-safe filename only', () => {
    assert.equal(isSimpsonsMovie('Zhe Simpsons Movie.mp4'), true);
    assert.equal(isSimpsonsMovie('The Simpsons Movie.mp4'), false);
    assert.equal(isSimpsonsMovie('The Simpsons S01, E01 - x.mp4'), false);
  });
});

describe('parseSouthPark', () => {
  it('parses the main S01E03 form', () => {
    assert.deepEqual(parseSouthPark('South Park S01E03 Volcano.mp4'), {
      season: 1,
      episode: 3,
      title: 'Volcano'
    });
  });

  it('strips the "[R]" remaster suffix from the title', () => {
    assert.deepEqual(parseSouthPark('South Park S03E14 The Succubus [R].mp4'), {
      season: 3,
      episode: 14,
      title: 'The Succubus'
    });
  });

  it('classifies the Spirit of Christmas shorts as season 0', () => {
    assert.deepEqual(parseSouthPark('The Spirit of Christmas E01 Jesus vs. Frosty.mp4'), {
      season: 0,
      episode: 1,
      title: 'Jesus vs. Frosty'
    });
    assert.deepEqual(parseSouthPark('The Spirit of Christmas E02 Jesus vs. Santa.mp4'), {
      season: 0,
      episode: 2,
      title: 'Jesus vs. Santa'
    });
  });

  it('returns null for non-South-Park files', () => {
    assert.equal(parseSouthPark('Some random file.mp4'), null);
    assert.equal(parseSouthPark('South Park S03M01 Bigger, Longer & Uncut.mp4'), null);
  });

  it('strips the leading subdirectory before matching', () => {
    // Catalog builder passes the full path; the parser must basename it.
    assert.deepEqual(
      parseSouthPark(
        'South Park S07 [Remastered] (360p re-webrip)/South Park S07E11 Casa Bonita [R].mp4'
      ),
      { season: 7, episode: 11, title: 'Casa Bonita' }
    );
  });
});

describe('parseBeavis', () => {
  it('parses the canonical "S4 EP 01" form', () => {
    assert.deepEqual(parseBeavis('S4/S4 EP 01 Wall Of Youth.mp4'), {
      season: 4,
      episode: 1,
      title: 'Wall Of Youth'
    });
  });

  it('parses the .ia.mp4 derivative when no plain .mp4 exists (S8)', () => {
    assert.deepEqual(parseBeavis('S8/S8 EP 01 Wherewovles of Highland .. Crying.ia.mp4'), {
      season: 8,
      episode: 1,
      title: 'Wherewovles of Highland .. Crying'
    });
  });

  it('handles two-digit episode numbers', () => {
    assert.deepEqual(parseBeavis('S5/S5 EP 50 Steamroller.mp4'), {
      season: 5,
      episode: 50,
      title: 'Steamroller'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseBeavis('Beavis And Butt-Head Do America.mp4'), null);
    assert.equal(parseBeavis('cover.jpg'), null);
  });
});

describe('parseSmurfs', () => {
  it('parses the canonical "S01 E01 - Title" form, stripping the leading directory', () => {
    assert.deepEqual(parseSmurfs('The Smurfs/S01/S01 E01 - The Astrosmurf.mp4'), {
      season: 1,
      episode: 1,
      title: 'The Astrosmurf'
    });
  });

  it('preserves apostrophes and punctuation in titles', () => {
    assert.deepEqual(parseSmurfs("The Smurfs/S01/S01 E02 - Jokey's Medicine.mp4"), {
      season: 1,
      episode: 2,
      title: "Jokey's Medicine"
    });
  });

  it('strips trailing "[Supercut]" / bracket annotations', () => {
    assert.deepEqual(
      parseSmurfs('The Smurfs/S07/S07 E01 - A Smurf on The Wild Side Part 1 [Supercut].mp4'),
      {
        season: 7,
        episode: 1,
        title: 'A Smurf on The Wild Side Part 1'
      }
    );
  });

  it('handles a missing dash before the title (the S07 "E01b" variant ships that way)', () => {
    // We do NOT want this to land on E01 (collides with the supercut)
    // or E02 (collides with "The Smurflings Unsmurfy Friend"); the
    // parser is expected to reject the lone "Eb" suffix variant.
    assert.equal(parseSmurfs('The Smurfs/S07/S07 E01b A Smurf on The Wild Side Part 2.mp4'), null);
  });

  it('handles two-digit episode numbers from the long S06/S07 runs', () => {
    assert.deepEqual(parseSmurfs('The Smurfs/S06/S06 E63 - The Smurfic Games.mp4'), {
      season: 6,
      episode: 63,
      title: 'The Smurfic Games'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseSmurfs('cover.jpg'), null);
    assert.equal(parseSmurfs('The Smurfs 2017 Lost Village.mp4'), null);
  });
});

describe('parseDnD', () => {
  it('parses the canonical "S01E01 (Title)" form', () => {
    assert.deepEqual(parseDnD('Dungeons and Dragons - S01E01 (The Night of No Tomorrow).mp4'), {
      season: 1,
      episode: 1,
      title: 'The Night of No Tomorrow'
    });
  });

  it('parses two-digit episode numbers and parens with punctuation', () => {
    assert.deepEqual(parseDnD('Dungeons and Dragons - S01E13 (P-R-E-S-T-O Spells Disaster).mp4'), {
      season: 1,
      episode: 13,
      title: 'P-R-E-S-T-O Spells Disaster'
    });
  });

  it('maps the reconstructed "Requiem" two-parter (E07a + E07b) onto E07 and E08', () => {
    assert.deepEqual(parseDnD('Dungeons and Dragons - S03E07a (Requiem).mp4'), {
      season: 3,
      episode: 7,
      title: 'Requiem (Part 1)'
    });
    assert.deepEqual(parseDnD('Dungeons and Dragons - S03E07b (Requiem).mp4'), {
      season: 3,
      episode: 8,
      title: 'Requiem (Part 2)'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseDnD('cover.jpg'), null);
    assert.equal(parseDnD('Dungeons and Dragons (2023).mp4'), null);
    assert.equal(parseDnD('Dungeons and Dragons - extras.mp4'), null);
  });
});

describe('parseDBZ', () => {
  it('parses the canonical "001 - Title" absolute-numbering form', () => {
    assert.deepEqual(parseDBZ('001 - The Arrival of Raditz.mp4'), {
      season: 1,
      episode: 1,
      title: 'The Arrival of Raditz'
    });
  });

  it('preserves apostrophes and trailing parenthetical annotations like (Uncut)', () => {
    assert.deepEqual(parseDBZ("003 - Gohan's Hidden Powers (Uncut).mp4"), {
      season: 1,
      episode: 3,
      title: "Gohan's Hidden Powers (Uncut)"
    });
  });

  it('parses three-digit absolute numbers up into the Buu saga range', () => {
    assert.deepEqual(parseDBZ('254 - Meet Vegito.mp4'), {
      season: 1,
      episode: 254,
      title: 'Meet Vegito'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseDBZ('cover.jpg'), null);
    assert.equal(parseDBZ('Dragon Ball Z - Bardock The Father of Goku.mp4'), null);
    assert.equal(parseDBZ('S01E01 something.mp4'), null);
  });
});

describe('parseInspectorGadget', () => {
  it('parses the canonical "S01E01 Title" form', () => {
    assert.deepEqual(parseInspectorGadget('Inspector Gadget S01E01 Winter Olympics.mp4'), {
      season: 1,
      episode: 1,
      title: 'Winter Olympics'
    });
  });

  it('parses two-digit episode numbers from the long S01 run', () => {
    assert.deepEqual(parseInspectorGadget('Inspector Gadget S01E65 Quiz Master.mp4'), {
      season: 1,
      episode: 65,
      title: 'Quiz Master'
    });
  });

  it('preserves apostrophes in titles', () => {
    assert.deepEqual(parseInspectorGadget("Inspector Gadget S02E17 Gadget's Roma.mp4"), {
      season: 2,
      episode: 17,
      title: "Gadget's Roma"
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseInspectorGadget('cover.jpg'), null);
    assert.equal(parseInspectorGadget('Inspector Gadget 2 (2003).mp4'), null);
  });
});

describe('parseAquaTeen', () => {
  it('parses the canonical S06E02 form, stripping the trailing quality tag', () => {
    assert.deepEqual(
      parseAquaTeen(
        'Aqua Teen Hunger Force (2000) - S06E02 - Shake Like Me (1080p WEB-DL x265 r00t).mp4'
      ),
      { season: 6, episode: 2, title: 'Shake Like Me' }
    );
  });

  it('tolerates lowercase s00e167 (Aquadonk Side Pieces specials)', () => {
    assert.deepEqual(
      parseAquaTeen(
        'Aqua Teen Hunger Force (2000) - s00e167 - Aquadonk Side Pieces The Return of Handbanana.mp4'
      ),
      {
        season: 0,
        episode: 167,
        title: 'Aquadonk Side Pieces The Return of Handbanana'
      }
    );
  });

  it('accepts an episode without a trailing quality tag', () => {
    assert.deepEqual(parseAquaTeen('Aqua Teen Hunger Force (2000) - S06e02 - Shake Like Me.mp4'), {
      season: 6,
      episode: 2,
      title: 'Shake Like Me'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseAquaTeen('cover.jpg'), null);
    assert.equal(parseAquaTeen('Aqua Teen Forever Plantasm.mp4'), null);
  });
});

describe('parseRockyBullwinkle', () => {
  it('parses the long-prefix form under Season-01/', () => {
    assert.deepEqual(
      parseRockyBullwinkle(
        'RockyAndBullwinkleAndFriends/Season-01/Rocky & Bullwinkle & Friends - S01E01.mp4'
      ),
      { season: 1, episode: 1, title: 'Episode 1' }
    );
  });

  it('parses the no-space prefix variant under Season-02/', () => {
    assert.deepEqual(
      parseRockyBullwinkle(
        'RockyAndBullwinkleAndFriends/Season-02/RockyAndBullwinkleAndFriends-S02E15.mp4'
      ),
      { season: 2, episode: 15, title: 'Episode 15' }
    );
  });

  it('parses the short-prefix root-level form with lowercase e', () => {
    assert.deepEqual(parseRockyBullwinkle('RockyBullwinkleFriends-S03e04.mp4'), {
      season: 3,
      episode: 4,
      title: 'Episode 4'
    });
  });

  it('rejects /Extras/ files (puppet shorts, outtakes, commercials)', () => {
    assert.equal(
      parseRockyBullwinkle(
        'RockyAndBullwinkleAndFriends/Extras/Rocky & Bullwinkle & Friends - Extra 1 - Dear Bullwinkle.mp4'
      ),
      null
    );
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseRockyBullwinkle('cover.jpg'), null);
    assert.equal(parseRockyBullwinkle('TheBullwinkleShow.mp4'), null);
  });
});

describe('parseTMNT', () => {
  it('parses the long-prefix form (S1–S3 packs)', () => {
    assert.deepEqual(parseTMNT('Teenage Mutant Ninja Turtles - 01x01 - Turtle Tracks.mp4'), {
      season: 1,
      episode: 1,
      title: 'Turtle Tracks'
    });
  });

  it('parses the short-prefix form (S5, S9–S10 packs)', () => {
    assert.deepEqual(parseTMNT('05x01 - Donatello`s Badd Time.mp4'), {
      season: 5,
      episode: 1,
      title: 'Donatello`s Badd Time'
    });
  });

  it('handles two-digit episode numbers (S3 Part 2 starts at 03x26)', () => {
    assert.deepEqual(parseTMNT('Teenage Mutant Ninja Turtles - 03x26 - Pizza by the Shred.mp4'), {
      season: 3,
      episode: 26,
      title: 'Pizza by the Shred'
    });
  });

  it('parses S10 cleanly (the final Dregg-era season)', () => {
    assert.deepEqual(parseTMNT('10x01 - The Day The Earth Disappeared.mp4'), {
      season: 10,
      episode: 1,
      title: 'The Day The Earth Disappeared'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseTMNT('cover.jpg'), null);
    assert.equal(parseTMNT('TMNT 2007 Movie.mp4'), null);
    assert.equal(parseTMNT('Teenage Mutant Ninja Turtles - bonus.mp4'), null);
  });
});
