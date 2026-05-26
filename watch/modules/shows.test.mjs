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

import { SHOWS, getShow } from './shows.js';

// Parsers and movieDetectors live inline on each SHOWS entry — pull
// them out here so the test cases read the same as before.
const parseSimpsons = getShow('simpsons').parser;
const parseSouthPark = getShow('southpark').parser;
const parseBeavis = getShow('beavis').parser;
const parseSmurfs = getShow('smurfs').parser;
const parseDnD = getShow('dnd').parser;
const parseDBZ = getShow('dbz').parser;
const parseInspectorGadget = getShow('inspector-gadget').parser;
const parseAquaTeen = getShow('aqua-teen').parser;
const parseCosmos = getShow('cosmos').parser;
const parseGiJoe = getShow('gi-joe').parser;
const parseJem = getShow('jem').parser;
const parseRealGhostbusters = getShow('real-ghostbusters').parser;
const parseRobotech = getShow('robotech').parser;
const parseRockyBullwinkle = getShow('rocky-bullwinkle').parser;
const parseTMNT = getShow('tmnt').parser;
const parseSpeedRacer = getShow('speed-racer').parser;
const parseTwilightZone = getShow('twilight-zone').parser;
const parseVoltron = getShow('voltron').parser;
const isSimpsonsMovie = getShow('simpsons').movieDetector;
const isGiJoeMovie = getShow('gi-joe').movieDetector;

describe('SHOWS registry', () => {
  it('contains the expected shows, sorted by id', () => {
    assert.deepEqual(
      SHOWS.map((s) => s.id),
      [
        'aqua-teen',
        'beavis',
        'cosmos',
        'dbz',
        'dnd',
        'gi-joe',
        'inspector-gadget',
        'jem',
        'real-ghostbusters',
        'robotech',
        'rocky-bullwinkle',
        'simpsons',
        'smurfs',
        'southpark',
        'speed-racer',
        'tmnt',
        'twilight-zone',
        'voltron'
      ]
    );
  });

  it('is exposed in alphabetical order by id (so dropping a new entry anywhere still lands in the right slot)', () => {
    const ids = SHOWS.map((s) => s.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(ids, sorted);
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

  it('multi-item shows declare an iaItem array with > 1 entry', () => {
    for (const id of ['tmnt', 'robotech', 'gi-joe']) {
      const show = getShow(id);
      assert.ok(Array.isArray(show?.iaItem), `${id} should declare iaItem as an array`);
      assert.ok(show.iaItem.length >= 2, `${id} should pull from multiple IA items`);
    }
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

describe('parseRobotech', () => {
  it('parses Macross Saga (1x… = season 1)', () => {
    assert.deepEqual(parseRobotech('Robotech - 1x01 - Boobytrap.mp4'), {
      season: 1,
      episode: 1,
      title: 'Boobytrap'
    });
    assert.deepEqual(parseRobotech('Robotech - 1x36 - To the Stars.mp4'), {
      season: 1,
      episode: 36,
      title: 'To the Stars'
    });
  });

  it('parses Masters (2x… = season 2)', () => {
    assert.deepEqual(parseRobotech("Robotech - 2x01 - Dana's Story.mp4"), {
      season: 2,
      episode: 1,
      title: "Dana's Story"
    });
    assert.deepEqual(parseRobotech('Robotech - 2x24 - Catastrophe.mp4'), {
      season: 2,
      episode: 24,
      title: 'Catastrophe'
    });
  });

  it('parses New Generation (3x… = season 3)', () => {
    assert.deepEqual(parseRobotech('Robotech - 3x25 - Symphony of Light.mp4'), {
      season: 3,
      episode: 25,
      title: 'Symphony of Light'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseRobotech('cover.jpg'), null);
    assert.equal(parseRobotech('Robotech The Movie 1986.mp4'), null);
    assert.equal(parseRobotech('Robotech - S01E01 - Boobytrap.mp4'), null);
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

describe('parseSpeedRacer', () => {
  it('strips the leftover Windows path prefix and parses S01E01', () => {
    assert.deepEqual(
      parseSpeedRacer(
        'G:/Videos/Downloads/Speed Racer/Speed Racer - S01E01 - The Great Plan (Pt. 1).mp4'
      ),
      { season: 1, episode: 1, title: 'The Great Plan (Pt. 1)' }
    );
  });

  it('parses the no-prefix form (the last two episodes ship that way)', () => {
    assert.deepEqual(
      parseSpeedRacer('Speed Racer - S01E51 - The Race Around the World (Pt. 1).mp4'),
      { season: 1, episode: 51, title: 'The Race Around the World (Pt. 1)' }
    );
  });

  it('preserves the fullwidth-colon glyph in S01E52 (Windows filename workaround)', () => {
    assert.deepEqual(
      parseSpeedRacer('Speed Racer - S01E52 - The Race Around the World： (Pt. 2).mp4'),
      { season: 1, episode: 52, title: 'The Race Around the World： (Pt. 2)' }
    );
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseSpeedRacer('cover.jpg'), null);
    assert.equal(parseSpeedRacer('Speed Racer 2008 Movie.mp4'), null);
    assert.equal(parseSpeedRacer('Mach Go Go Go S01E01.mp4'), null);
  });
});

describe('parseVoltron', () => {
  it('parses the canonical "NN - Title" form (no S/E prefix)', () => {
    assert.deepEqual(parseVoltron('Voltron Vehicle Force - 01 - In Search Of New Worlds.mp4'), {
      season: 1,
      episode: 1,
      title: 'In Search Of New Worlds'
    });
  });

  it('handles two-digit episode numbers', () => {
    assert.deepEqual(
      parseVoltron('Voltron Vehicle Force - 52 - The End Of Hazar\u2019s World.mp4'),
      { season: 1, episode: 52, title: 'The End Of Hazar\u2019s World' }
    );
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseVoltron('cover.jpg'), null);
    assert.equal(parseVoltron('Voltron - 01 - Space Explorers Captured.mp4'), null);
    assert.equal(parseVoltron('Voltron Lion Force - 01 - Pilot.mp4'), null);
  });
});

describe('parseCosmos', () => {
  it('parses the first episode', () => {
    assert.deepEqual(
      parseCosmos('1980 Cosmos (A Personal Voyage) - Ep 01 The Shores of the Cosmic Ocean.mp4'),
      { season: 1, episode: 1, title: 'The Shores of the Cosmic Ocean' }
    );
  });

  it('parses the finale (E13)', () => {
    assert.deepEqual(
      parseCosmos('1980 Cosmos (A Personal Voyage) - Ep 13 Who Speaks for Earth.mp4'),
      { season: 1, episode: 13, title: 'Who Speaks for Earth' }
    );
  });

  it('keeps apostrophes in titles', () => {
    assert.deepEqual(parseCosmos("1980 Cosmos (A Personal Voyage) - Ep 06 Travellers' Tales.mp4"), {
      season: 1,
      episode: 6,
      title: "Travellers' Tales"
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseCosmos('cover.jpg'), null);
    assert.equal(parseCosmos('Cosmos 2014 (Neil deGrasse Tyson) - Ep 01 Standing Up.mp4'), null);
    assert.equal(parseCosmos('1980 Cosmos - Bonus - Conversation with Carl Sagan.mp4'), null);
  });
});

describe('parseGiJoe', () => {
  it('maps the MASS Device mini-series (item gi-joe-1, mini 1) into S0E1..E5', () => {
    assert.deepEqual(parseGiJoe('1-1. The M.A.S.S. Device Part 1.mp4', 'gi-joe-1'), {
      season: 0,
      episode: 1,
      title: 'The M.A.S.S. Device Part 1'
    });
    assert.deepEqual(parseGiJoe('1-5. The M.A.S.S. Device Part 5.mp4', 'gi-joe-1'), {
      season: 0,
      episode: 5,
      title: 'The M.A.S.S. Device Part 5'
    });
  });

  it('maps the Revenge of Cobra mini-series (item gi-joe-1, mini 2) into S0E6..E10', () => {
    assert.deepEqual(parseGiJoe('2-1. The Revenge of Cobra Part 1.mp4', 'gi-joe-1'), {
      season: 0,
      episode: 6,
      title: 'The Revenge of Cobra Part 1'
    });
    assert.deepEqual(parseGiJoe('2-5. The Revenge Of Cobra Part 5.mp4', 'gi-joe-1'), {
      season: 0,
      episode: 10,
      title: 'The Revenge Of Cobra Part 5'
    });
  });

  it('parses gi-joe-2 (1985 regular series) as season 1', () => {
    assert.deepEqual(parseGiJoe('1. The Pyramid of Darkness Part 1.mp4', 'gi-joe-2'), {
      season: 1,
      episode: 1,
      title: 'The Pyramid of Darkness Part 1'
    });
    assert.deepEqual(parseGiJoe("55. There's No Place Like Springfield Part 2.mp4", 'gi-joe-2'), {
      season: 1,
      episode: 55,
      title: "There's No Place Like Springfield Part 2"
    });
  });

  it('parses gi-joe-3 (1986 second season) as season 2', () => {
    assert.deepEqual(parseGiJoe('1. Arise, Serpentor, Arise! Part 1.mp4', 'gi-joe-3'), {
      season: 2,
      episode: 1,
      title: 'Arise, Serpentor, Arise! Part 1'
    });
  });

  it('movie file is caught by the movieDetector, not the parser', () => {
    assert.equal(isGiJoeMovie('G.I. Joe The Movie.mp4'), true);
    // The parser would still return null for it because it does not
    // match either filename shape — confirms the movieDetector is
    // load-bearing here.
    assert.equal(parseGiJoe('G.I. Joe The Movie.mp4', 'gi-joe-3'), null);
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseGiJoe('cover.jpg', 'gi-joe-2'), null);
    assert.equal(parseGiJoe('G.I. Joe - Spy Troops.mp4', 'gi-joe-2'), null);
  });
});

describe('parseJem', () => {
  it('parses the hyphen-separated form used by episodes 1-8', () => {
    assert.deepEqual(parseJem('[HD] Jem Episode 01 - The Beginning.mp4'), {
      season: 1,
      episode: 1,
      title: 'The Beginning'
    });
    assert.deepEqual(parseJem('[HD] Jem Episode 08 - Starbright Part 3 - Rising Star.mp4'), {
      season: 1,
      episode: 8,
      title: 'Starbright Part 3 - Rising Star'
    });
  });

  it('parses the no-hyphen form used by episodes 9+', () => {
    assert.deepEqual(parseJem('[HD] Jem Episode 09 The World Hunger Shindig.mp4'), {
      season: 1,
      episode: 9,
      title: 'The World Hunger Shindig'
    });
    assert.deepEqual(parseJem('[HD] Jem Episode 65 A Father Should Be.mp4'), {
      season: 1,
      episode: 65,
      title: 'A Father Should Be'
    });
  });

  it('tolerates the doubled-extension outlier on episode 32', () => {
    assert.deepEqual(parseJem('[HD] Jem Episode 32 The Fan.mp4.mp4'), {
      season: 1,
      episode: 32,
      title: 'The Fan'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseJem('cover.jpg'), null);
    assert.equal(parseJem('Jem and the Holograms 2015 trailer.mp4'), null);
    assert.equal(parseJem('Jem Episode 01.mp4'), null); // missing the "[HD] " prefix
  });
});

describe('parseRealGhostbusters', () => {
  it('parses the season-folder + SDTV-suffix shape', () => {
    assert.deepEqual(
      parseRealGhostbusters(
        'The Real Ghostbusters/Season 01/The Real Ghostbusters - S01E01 - Ghosts \u042f Us SDTV.mp4'
      ),
      { season: 1, episode: 1, title: 'Ghosts \u042f Us' }
    );
  });

  it('strips the DVD suffix from season 2/3 titles', () => {
    assert.deepEqual(
      parseRealGhostbusters(
        'The Real Ghostbusters/Season 02/The Real Ghostbusters - S02E55 - The Old College Spirit DVD.mp4'
      ),
      { season: 2, episode: 55, title: 'The Old College Spirit' }
    );
  });

  it('keeps titles with commas, exclamation marks, and ampersands intact', () => {
    assert.deepEqual(
      parseRealGhostbusters(
        'The Real Ghostbusters/Season 05/The Real Ghostbusters - S05E08 - Live! from Al Capone\u2019s Tomb SDTV.mp4'
      ),
      { season: 5, episode: 8, title: 'Live! from Al Capone\u2019s Tomb' }
    );
  });

  it('captures only the first episode number from S05 paired files', () => {
    assert.deepEqual(
      parseRealGhostbusters(
        'The Real Ghostbusters/Season 05/The Real Ghostbusters - S05E11-E12 - Trading Faces + Transcendental Tourists SDTV.mp4'
      ),
      { season: 5, episode: 11, title: 'Trading Faces + Transcendental Tourists' }
    );
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseRealGhostbusters('cover.jpg'), null);
    assert.equal(
      parseRealGhostbusters('The Real Ghostbusters/Specials/RGB Christmas Special.mp4'),
      null
    );
  });
});

describe('parseTwilightZone', () => {
  it('parses the original 1959 pilot as S01E00', () => {
    assert.deepEqual(parseTwilightZone('The Twilight Zone 1959 S01E00 Original Pilot.mp4'), {
      season: 1,
      episode: 0,
      title: 'Original Pilot'
    });
  });

  it('parses regular S1 episodes', () => {
    assert.deepEqual(parseTwilightZone('The Twilight Zone 1959 S01E08 Time Enough at Last.mp4'), {
      season: 1,
      episode: 8,
      title: 'Time Enough at Last'
    });
    assert.deepEqual(parseTwilightZone('The Twilight Zone 1959 S01E18 The Last Flight.mp4'), {
      season: 1,
      episode: 18,
      title: 'The Last Flight'
    });
  });

  it('returns null for the colorized S2-S4 items (different uploader, different shape)', () => {
    // Sanity check — those alt-source files use lowercase "s2e1" and
    // a "-colorized-720p-hd" suffix that our parser deliberately does
    // not accept (they'd be a quality regression to mix in).
    assert.equal(parseTwilightZone('the twilight zone-S2E1-colorized-720p-hd.mp4'), null);
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseTwilightZone('cover.jpg'), null);
    assert.equal(parseTwilightZone('The Twilight Zone 2002 S01E01 Evergreen.mp4'), null);
  });
});
