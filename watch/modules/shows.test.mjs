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

import { SHOWS, getShow, TAG_GROUPS, ALL_TAGS } from './shows.js';

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
const parseBoondocks = getShow('boondocks').parser;
const parseDextersLab = getShow('dexters-lab').parser;
const parseDisenchantment = getShow('disenchantment').parser;
const parseDoctorWho = getShow('doctor-who').parser;
const parseMST3K = getShow('mst3k').parser;
const parseRecess = getShow('recess').parser;
const parseCaptainPlanet = getShow('captain-planet').parser;
const parseDuckman = getShow('duckman').parser;
const parseDuckTales = getShow('ducktales').parser;
const parseFreakazoid = getShow('freakazoid').parser;
const parseHarveyBirdman = getShow('harvey-birdman').parser;
const parseMontyPython = getShow('monty-python').parser;
const parseAvengers = getShow('avengers').parser;
const parseFrankenhole = getShow('frankenhole').parser;
const parseHomeMovies = getShow('home-movies').parser;
const parseMaxx = getShow('maxx').parser;
const parseCritic = getShow('critic').parser;
const parseCrystalMaze = getShow('crystal-maze').parser;
const parseLiquidTV = getShow('liquid-television').parser;
const parseMutantLeague = getShow('mutant-league').parser;
const parseSpiderMan = getShow('spider-man').parser;
const parseTick = getShow('tick').parser;
const parseVoyagers = getShow('voyagers').parser;
const parsePiratesDarkWater = getShow('pirates-dark-water').parser;
const parseReboot = getShow('reboot').parser;
const parseAmazingStories = getShow('amazing-stories').parser;
const parseAstroBoy = getShow('astro-boy').parser;
const parseFawltyTowers = getShow('fawlty-towers').parser;
const parseJonnyQuest = getShow('jonny-quest').parser;
const parseSonicSatAM = getShow('sonic-satam').parser;
const isSimpsonsMovie = getShow('simpsons').movieDetector;
const isGiJoeMovie = getShow('gi-joe').movieDetector;
const isDextersLabMovie = getShow('dexters-lab').movieDetector;
const isRecessMovie = getShow('recess').movieDetector;

describe('SHOWS registry', () => {
  it('contains the expected shows, sorted by id', () => {
    assert.deepEqual(
      SHOWS.map((s) => s.id),
      [
        'amazing-stories',
        'aqua-teen',
        'astro-boy',
        'avengers',
        'beavis',
        'boondocks',
        'captain-planet',
        'cosmos',
        'critic',
        'crystal-maze',
        'dbz',
        'dexters-lab',
        'disenchantment',
        'dnd',
        'doctor-who',
        'duckman',
        'ducktales',
        'fawlty-towers',
        'frankenhole',
        'freakazoid',
        'gi-joe',
        'harvey-birdman',
        'home-movies',
        'inspector-gadget',
        'jem',
        'jonny-quest',
        'liquid-television',
        'maxx',
        'monty-python',
        'mst3k',
        'mutant-league',
        'pirates-dark-water',
        'real-ghostbusters',
        'reboot',
        'recess',
        'robotech',
        'rocky-bullwinkle',
        'simpsons',
        'smurfs',
        'sonic-satam',
        'southpark',
        'speed-racer',
        'spider-man',
        'tick',
        'tmnt',
        'twilight-zone',
        'voltron',
        'voyagers'
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

  it('every show carries valid tags from the canonical taxonomy', () => {
    for (const s of SHOWS) {
      assert.ok(Array.isArray(s.tags), `${s.id} should declare a tags array`);
      assert.ok(s.tags.length > 0, `${s.id} tags should not be empty`);
      // No freeform / typo tags slip in — every value must be in the
      // canonical set declared by TAG_GROUPS.
      for (const tag of s.tags) {
        assert.ok(ALL_TAGS.has(tag), `${s.id} has unknown tag "${tag}" (not in TAG_GROUPS)`);
      }
      // Exactly one format tag and exactly one era tag — these are
      // the two filter axes that should never be ambiguous on the
      // landing page.
      const formats = s.tags.filter((t) => TAG_GROUPS.format.includes(t));
      assert.equal(formats.length, 1, `${s.id} must have exactly one format tag`);
      const eras = s.tags.filter((t) => TAG_GROUPS.era.includes(t));
      assert.equal(eras.length, 1, `${s.id} must have exactly one era tag`);
    }
  });

  it('TAG_GROUPS values are all in ALL_TAGS', () => {
    const flat = Object.values(TAG_GROUPS).flat();
    assert.equal(flat.length, ALL_TAGS.size, 'no duplicate tags across groups');
    for (const t of flat) assert.ok(ALL_TAGS.has(t));
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

describe('parseBoondocks', () => {
  it('parses the canonical "S1 E1 The Boondocks Title" form', () => {
    assert.deepEqual(
      parseBoondocks('The Boondocks show/BOONDOCKS_S1_D1/S1 E1 The Boondocks The Garden Party.mp4'),
      { season: 1, episode: 1, title: 'The Garden Party' }
    );
  });

  it('handles two-digit episode numbers from the long S1 run', () => {
    assert.deepEqual(
      parseBoondocks(
        'The Boondocks show/BOONDOCKS_S1_D3/S1 E15 The Boondocks The Passion of Reverend Ruckus.mp4'
      ),
      { season: 1, episode: 15, title: 'The Passion of Reverend Ruckus' }
    );
  });

  it('keeps punctuation, apostrophes, and contractions in titles', () => {
    assert.deepEqual(
      parseBoondocks("The Boondocks show/BOONDOCKS_S3_D3/S3 E15 The Boondocks It's Goin' Down.mp4"),
      { season: 3, episode: 15, title: "It's Goin' Down" }
    );
  });

  it('rejects every /Extras/ file (pilot, featurettes, animatics, keynote)', () => {
    assert.equal(parseBoondocks('The Boondocks show/Extras/Pilot/The Boondocks Pilot.mp4'), null);
    assert.equal(
      parseBoondocks('The Boondocks show/Extras/Special Features/Behind the Boondocks.mp4'),
      null
    );
    assert.equal(
      parseBoondocks(
        'The Boondocks show/Extras/Random keynote/HOPE-4-Keynote_Aaron_McGruder/HOPE-4-Keynote_Aaron_McGruder.mp4'
      ),
      null
    );
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseBoondocks('cover.jpg'), null);
    assert.equal(parseBoondocks('S1 E1 Boondocks The Garden Party.mp4'), null); // missing "The"
  });
});

describe('parseDextersLab', () => {
  it('parses the canonical S01E01 form (no title in filename)', () => {
    assert.deepEqual(parseDextersLab('Dexter_s_Laboratory_S01E01.mp4'), {
      season: 1,
      episode: 1,
      title: 'Episode 1'
    });
  });

  it('parses two-digit episode numbers from the long S02 run', () => {
    assert.deepEqual(parseDextersLab('Dexter_s_Laboratory_S02E41.mp4'), {
      season: 2,
      episode: 41,
      title: 'Episode 41'
    });
  });

  it('parses every season cleanly (S01, S02, S03, S04)', () => {
    for (const [s, e] of [
      [1, 13],
      [2, 1],
      [3, 13],
      [4, 13]
    ]) {
      const file = `Dexter_s_Laboratory_S${String(s).padStart(2, '0')}E${String(e).padStart(
        2,
        '0'
      )}.mp4`;
      assert.deepEqual(parseDextersLab(file), { season: s, episode: e, title: `Episode ${e}` });
    }
  });

  it('movie file is caught by the movieDetector, not the parser', () => {
    assert.equal(isDextersLabMovie('Dexter’s_Laboratory_-_Ego_Trip.mp4'), true);
    // ASCII apostrophe variant also accepted in case the IA derives one
    // with a straightened glyph.
    assert.equal(isDextersLabMovie("Dexter's_Laboratory_-_Ego_Trip.mp4"), true);
    // The regular parser deliberately rejects it (different filename shape).
    assert.equal(parseDextersLab('Dexter’s_Laboratory_-_Ego_Trip.mp4'), null);
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseDextersLab('cover.jpg'), null);
    assert.equal(parseDextersLab('Dexter Season 1 Episode 1.mp4'), null);
    assert.equal(parseDextersLab('Dexters_Lab_S01E01.mp4'), null); // wrong show-name shape
  });
});

describe('parseDisenchantment', () => {
  it('parses the canonical S01E01 form', () => {
    assert.deepEqual(parseDisenchantment('S01E01.mp4'), {
      season: 1,
      episode: 1,
      title: 'Episode 1'
    });
  });

  it('parses every episode in the S1 dump (E01..E10)', () => {
    for (let e = 1; e <= 10; e += 1) {
      const file = `S01E${String(e).padStart(2, '0')}.mp4`;
      assert.deepEqual(parseDisenchantment(file), {
        season: 1,
        episode: e,
        title: `Episode ${e}`
      });
    }
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseDisenchantment('cover.jpg'), null);
    assert.equal(parseDisenchantment('Disenchantment S01E01.mp4'), null); // has show name
    assert.equal(parseDisenchantment('S01E01 - Title.mp4'), null); // has title
  });
});

describe('parseDoctorWho', () => {
  it('parses the canonical "S01E01 - Title" form (1963 Hartnell pilot)', () => {
    assert.deepEqual(parseDoctorWho('S01E01 - An Unearthly Child.mp4'), {
      season: 1,
      episode: 1,
      title: 'An Unearthly Child'
    });
  });

  it('parses serial parts as individual episodes (TVMaze numbering matches)', () => {
    // "The Daleks" was a 7-part serial in S1; each part is its own
    // numbered episode under both IA and TVMaze.
    assert.deepEqual(parseDoctorWho('S01E05 - The Dead Planet.mp4'), {
      season: 1,
      episode: 5,
      title: 'The Dead Planet'
    });
    assert.deepEqual(parseDoctorWho('S01E11 - The Rescue.mp4'), {
      season: 1,
      episode: 11,
      title: 'The Rescue'
    });
  });

  it('keeps comma + ", Part N" suffixes intact (S24+ uses them in titles)', () => {
    assert.deepEqual(parseDoctorWho('S24E05 - Paradise Towers, Part One.mp4'), {
      season: 24,
      episode: 5,
      title: 'Paradise Towers, Part One'
    });
    assert.deepEqual(parseDoctorWho('S25E14 - The Greatest Show in the Galaxy, Part Four.mp4'), {
      season: 25,
      episode: 14,
      title: 'The Greatest Show in the Galaxy, Part Four'
    });
  });

  it('handles two-digit episode numbers from the long classic seasons', () => {
    assert.deepEqual(parseDoctorWho('S01E42 - Prisoners of Conciergerie.mp4'), {
      season: 1,
      episode: 42,
      title: 'Prisoners of Conciergerie'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseDoctorWho('cover.jpg'), null);
    assert.equal(parseDoctorWho('Doctor Who 2005 S01E01 Rose.mp4'), null); // wrong shape
    assert.equal(parseDoctorWho('s1e1 - pilot.mp4'), null); // lowercase, not padded
  });
});

describe('parseMST3K', () => {
  it('parses the unaired pilot as S00E00', () => {
    assert.deepEqual(parseMST3K('S00E00 - The Green Slime (Pilot).mp4'), {
      season: 0,
      episode: 0,
      title: 'The Green Slime (Pilot)'
    });
  });

  it('parses the KTMA pre-cable run (S00E01..E21)', () => {
    assert.deepEqual(parseMST3K('S00E03 - Star Force \u2013 Fugitive Alien II.mp4'), {
      season: 0,
      episode: 3,
      title: 'Star Force \u2013 Fugitive Alien II'
    });
  });

  it('parses the canonical Comedy-Central / Sci-Fi / Netflix runs', () => {
    assert.deepEqual(parseMST3K('S01E01 - The Crawling Eye.mp4'), {
      season: 1,
      episode: 1,
      title: 'The Crawling Eye'
    });
    assert.deepEqual(parseMST3K('S12E06 - Ator, the Fighting Eagle.mp4'), {
      season: 12,
      episode: 6,
      title: 'Ator, the Fighting Eagle'
    });
  });

  it('keeps punctuation in titles (commas, apostrophes, periods)', () => {
    assert.deepEqual(parseMST3K('S02E05 - Rocket Attack U.S.A..mp4'), {
      season: 2,
      episode: 5,
      title: 'Rocket Attack U.S.A.'
    });
  });

  it('rejects the SPF specials, Shorts compilations, and bonus features', () => {
    // These have no episode slot — they ship as "SPF: Title.mp4",
    // "Shorts (Volume N).mp4", "The Making of MST3K.mp4", etc.
    // Dropping them keeps the catalog clean instead of polluting
    // season 0 with un-grafted descriptions.
    assert.equal(parseMST3K('SPF: Academy of Robots\u2019 Choice Awards Special.mp4'), null);
    assert.equal(parseMST3K('Shorts (Volume 1).mp4'), null);
    assert.equal(parseMST3K('The Making of MST3K.mp4'), null);
    assert.equal(parseMST3K('The Last Dance RAW.mp4'), null);
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseMST3K('cover.jpg'), null);
  });
});

describe('parseRecess', () => {
  it('parses the canonical s01e01 form, normalizing underscores to spaces', () => {
    assert.deepEqual(parseRecess('Recess/Season 1/recess_-_s01e01_-_the_break_in_[jpv711].mp4'), {
      season: 1,
      episode: 1,
      title: 'the break in'
    });
  });

  it('keeps apostrophes and punctuation embedded in title underscores', () => {
    assert.deepEqual(
      parseRecess("Recess/Season 1/recess_-_s01e18_-_randall's_reform_[jpv711].mp4"),
      { season: 1, episode: 18, title: "randall's reform" }
    );
    assert.deepEqual(
      parseRecess('Recess/Season 4/recess_-_s04e18_-_here_comes_mr._perfect_[jpv711].mp4'),
      { season: 4, episode: 18, title: 'here comes mr. perfect' }
    );
  });

  it('captures only the first episode number from paired-episode files', () => {
    // Paired files play both halves back-to-back; we map them onto the
    // lower-numbered slot (same pragmatic compromise as Real Ghostbusters
    // S05 pairs).
    assert.deepEqual(
      parseRecess(
        'Recess/Season 2/recess_-_s02e17_&_s02e18_-_yes,_mikey,_santa_does_shave,_part_1_&_2_[jpv711].mp4'
      ),
      { season: 2, episode: 17, title: 'yes, mikey, santa does shave, part 1 & 2' }
    );
  });

  it('strips the trailing "_(1)" duplicate-download marker (s04e31)', () => {
    assert.deepEqual(
      parseRecess("Recess/Season 4/recess_-_s04e31_-_don't_ask_me_[jpv711]_(1).mp4"),
      { season: 4, episode: 31, title: "don't ask me" }
    );
  });

  it('rejects everything under /Movies/ (theatrical is caught by movieDetector)', () => {
    assert.equal(parseRecess('Recess/Movies/All Growed Down.mp4'), null);
    assert.equal(parseRecess('Recess/Movies/Miracle On Third Street.mp4'), null);
    assert.equal(parseRecess('Recess/Movies/Recess Schools Out.mp4'), null);
    assert.equal(parseRecess('Recess/Movies/Taking The Fifth Grade.mp4'), null);
  });

  it('movieDetector picks the 2001 theatrical only, not the made-for-TV movies', () => {
    assert.equal(isRecessMovie('Recess/Movies/Recess Schools Out.mp4'), true);
    assert.equal(isRecessMovie('Recess/Movies/All Growed Down.mp4'), false);
    assert.equal(isRecessMovie('Recess/Movies/Miracle On Third Street.mp4'), false);
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseRecess('cover.jpg'), null);
    assert.equal(parseRecess('recess_-_s01e01_-_the_break_in.mp4'), null); // missing [jpv711] tag
  });
});

describe('parseCaptainPlanet', () => {
  it('parses the dotted S01 form, seeding "Episode N" titles', () => {
    assert.deepEqual(
      parseCaptainPlanet(
        'Captain.Planet.and.the.Planeteers.S01.480p/Captain.Planet.and.the.Planeteers.S01E01.480p.mp4'
      ),
      { season: 1, episode: 1, title: 'Episode 1' }
    );
  });

  it('survives the stray double-dot in S01E05 (.480p..mp4)', () => {
    // The dump has one file that ships as `...S01E05.480p..mp4` with
    // an extra dot. The regex's `\.*` between `480p` and `.mp4` lets
    // it through instead of silently dropping the episode.
    assert.deepEqual(
      parseCaptainPlanet(
        'Captain.Planet.and.the.Planeteers.S01.480p/Captain.Planet.and.the.Planeteers.S01E05.480p..mp4'
      ),
      { season: 1, episode: 5, title: 'Episode 5' }
    );
  });

  it('parses the S2+ bullet-operator form, keeping the real title', () => {
    assert.deepEqual(
      parseCaptainPlanet(
        'Captain.Planet.and.the.Planeteers.S02.480p/S2.E1 \u2219 Mind Pollution.mp4'
      ),
      { season: 2, episode: 1, title: 'Mind Pollution' }
    );
    assert.deepEqual(
      parseCaptainPlanet(
        'Captain.Planet.and.the.Planeteers.S04.480p/S4.E22 \u2219 \u0027Teers in the Hood.mp4'
      ),
      { season: 4, episode: 22, title: "'Teers in the Hood" }
    );
  });

  it('handles single- and double-digit episode numbers in S2+', () => {
    assert.deepEqual(
      parseCaptainPlanet(
        'Captain.Planet.and.the.Planeteers.S02.480p/S2.E10 \u2219 An Inside Job.mp4'
      ),
      { season: 2, episode: 10, title: 'An Inside Job' }
    );
    assert.deepEqual(
      parseCaptainPlanet(
        'Captain.Planet.and.the.Planeteers.S03.480p/S3.E12 \u2219 If It\u2019s Doomsday, This Must Be Belfast.mp4'
      ),
      { season: 3, episode: 12, title: 'If It\u2019s Doomsday, This Must Be Belfast' }
    );
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseCaptainPlanet('cover.jpg'), null);
    // Wrong separator (regular bullet instead of U+2219 BULLET OPERATOR)
    // would silently break the regex, so we lock the exact codepoint in:
    assert.equal(
      parseCaptainPlanet(
        'Captain.Planet.and.the.Planeteers.S02.480p/S2.E1 \u2022 Mind Pollution.mp4'
      ),
      null
    );
    assert.equal(parseCaptainPlanet('Captain.Planet.S01E01.mp4'), null); // missing ".and.the.Planeteers" prefix
  });
});

describe('parseDuckman', () => {
  it('parses the canonical "Duckman S01E01 Title.mp4" form', () => {
    assert.deepEqual(parseDuckman('Duckman/Season 1/Duckman S01E01 I, Duckman (Pilot).mp4'), {
      season: 1,
      episode: 1,
      title: 'I, Duckman (Pilot)'
    });
  });

  it('handles the missing-space variant ("DuckmanS01E11")', () => {
    // S1 E11–E13 and most of S2 lose the space between "Duckman" and
    // the SxxExx token. The `\s?` in the regex makes both forms valid.
    assert.deepEqual(parseDuckman('Duckman/Season 1/DuckmanS01E11 American Dicks.mp4'), {
      season: 1,
      episode: 11,
      title: 'American Dicks'
    });
    assert.deepEqual(
      parseDuckman('Duckman/Season 2/DuckmanS02E03 Days of Whining and Neurosis.mp4'),
      {
        season: 2,
        episode: 3,
        title: 'Days of Whining and Neurosis'
      }
    );
  });

  it('strips the trailing space before .mp4 on S02E01', () => {
    // Only one file in the dump has a stray trailing space before the
    // extension; the `\s*\.mp4$` tail eats it.
    assert.deepEqual(parseDuckman('Duckman/Season 2/DuckmanS02E01 Papa Oom M.O.W. M.O.W. .mp4'), {
      season: 2,
      episode: 1,
      title: 'Papa Oom M.O.W. M.O.W.'
    });
  });

  it('parses two-digit episode numbers in the long S04 run', () => {
    assert.deepEqual(
      parseDuckman('Duckman/Season 4/Duckman S04E28 Four Weddings Inconceivable.mp4'),
      {
        season: 4,
        episode: 28,
        title: 'Four Weddings Inconceivable'
      }
    );
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseDuckman('cover.jpg'), null);
    assert.equal(parseDuckman('Duckman S01E01.mp4'), null); // missing title
    assert.equal(parseDuckman('S01E01 Duckman Pilot.mp4'), null); // wrong shape
  });
});

describe('parseDuckTales', () => {
  it('parses the compact "DuckTales S01E01 Title.mp4" form', () => {
    assert.deepEqual(parseDuckTales('Season 1/DuckTales S01E01 Dont give up the ship.mp4'), {
      season: 1,
      episode: 1,
      title: 'Dont give up the ship'
    });
  });

  it('parses the verbose late-S1 "Season N Episode N ... - DuckTales 1987" form', () => {
    assert.deepEqual(
      parseDuckTales(
        'Season 1/DuckTales Season 1 Episode 63 All Ducks on Deck - DuckTales 1987.mp4'
      ),
      { season: 1, episode: 63, title: 'All Ducks on Deck' }
    );
    assert.deepEqual(
      parseDuckTales(
        'Season 1/DuckTales Season 1 Episode 65 Till Nephews Do Us Part - DuckTales 1987.mp4'
      ),
      { season: 1, episode: 65, title: 'Till Nephews Do Us Part' }
    );
  });

  it('parses S2 mini-arc subtitles (hyphen-no-space separator)', () => {
    // S2's "Time Is Money" and "Super DuckTales" arcs join the arc
    // name and the chapter title with a no-space hyphen; we keep that
    // exact glyph since it's the dump's own convention.
    assert.deepEqual(
      parseDuckTales(
        'Season 2/DuckTales Season 2 Episode 1 Time Is Money- Marking Time - DuckTales 1987.mp4'
      ),
      { season: 2, episode: 1, title: 'Time Is Money- Marking Time' }
    );
    assert.deepEqual(
      parseDuckTales(
        'Season 2/DuckTales Season 2 Episode 10 Super DuckTales- Money to Burn - DuckTales 1987.mp4'
      ),
      { season: 2, episode: 10, title: 'Super DuckTales- Money to Burn' }
    );
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseDuckTales('cover.jpg'), null);
    assert.equal(parseDuckTales('DuckTales 1987.mp4'), null);
  });
});

describe('parseFreakazoid', () => {
  it('parses the canonical "NxNN. Title.mp4" form', () => {
    assert.deepEqual(
      parseFreakazoid('Season 1/1x01. Five Day Forecast-Dance of Doom-Handman.mp4'),
      { season: 1, episode: 1, title: 'Five Day Forecast-Dance of Doom-Handman' }
    );
  });

  it('keeps long hyphen-joined multi-sketch titles intact', () => {
    // Each episode bundles 2–5 sketches. We surface the whole
    // concatenated title since TVMaze only stores the first one.
    assert.deepEqual(
      parseFreakazoid('Season 1/1x03. Mo-Ron-Sewer Rescue-Big Question-Legends Who Lunch.mp4'),
      { season: 1, episode: 3, title: 'Mo-Ron-Sewer Rescue-Big Question-Legends Who Lunch' }
    );
  });

  it('handles two-digit episode numbers in S1', () => {
    assert.deepEqual(parseFreakazoid('Season 1/1x13. Wrath of Guitierrez.mp4'), {
      season: 1,
      episode: 13,
      title: 'Wrath of Guitierrez'
    });
  });

  it('parses S2 (different file count, same shape)', () => {
    assert.deepEqual(parseFreakazoid('Season 2/2x02. Freakazoid, The.mp4'), {
      season: 2,
      episode: 2,
      title: 'Freakazoid, The'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseFreakazoid('cover.jpg'), null);
    assert.equal(parseFreakazoid('Freakazoid S01E01.mp4'), null); // wrong format
    assert.equal(parseFreakazoid('1x01 Five Day Forecast.mp4'), null); // missing period after id
  });
});

describe('parseHarveyBirdman', () => {
  it('parses S1 files (no season prefix in filename, season from path)', () => {
    // "Harvey Birdman Attorney at law/S 1/EP 1 BANNON CUSTODY BATTLE [PILOT].mp4"
    // S1 omits the SxN prefix from the filename; we read the season
    // from the `/S 1/` path component.
    assert.deepEqual(
      parseHarveyBirdman(
        'Harvey Birdman Attorney at law/S 1/EP 1 BANNON CUSTODY BATTLE [PILOT].mp4'
      ),
      { season: 1, episode: 1, title: 'BANNON CUSTODY BATTLE [PILOT]' }
    );
    assert.deepEqual(
      parseHarveyBirdman('Harvey Birdman Attorney at law/S 1/EP 9 X THE EXTERMINATOR.mp4'),
      { season: 1, episode: 9, title: 'X THE EXTERMINATOR' }
    );
  });

  it('parses S2+ files (season prefix in filename — also matches path)', () => {
    assert.deepEqual(
      parseHarveyBirdman('Harvey Birdman Attorney at law/S 2/S2 EP 1 BLACKWATCH PLAID.mp4'),
      { season: 2, episode: 1, title: 'BLACKWATCH PLAID' }
    );
    assert.deepEqual(
      parseHarveyBirdman('Harvey Birdman Attorney at law/S 4/S4 EP 7 THE DEATH OF HARVEY.mp4'),
      { season: 4, episode: 7, title: 'THE DEATH OF HARVEY' }
    );
  });

  it('handles weird title punctuation (commas, [brackets], stray glyphs)', () => {
    // "GONE EFFICIEN,,,T" is the actual S2 file name — three commas in
    // the title. Don't normalize them away; TVMaze graft can do that.
    assert.deepEqual(
      parseHarveyBirdman('Harvey Birdman Attorney at law/S 2/S2 EP 9 GONE EFFICIEN,,,T.mp4'),
      { season: 2, episode: 9, title: 'GONE EFFICIEN,,,T' }
    );
  });

  it('rejects the root-level "Attorney General information" promo file', () => {
    assert.equal(
      parseHarveyBirdman(
        'Harvey Birdman Attorney at law/Harvey Birdman, Attorney General information.mp4'
      ),
      null
    );
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseHarveyBirdman('cover.jpg'), null);
    // Missing the `/S N/` path component → no way to derive season.
    assert.equal(parseHarveyBirdman('EP 1 BANNON CUSTODY BATTLE.mp4'), null);
  });
});

describe('parseMontyPython', () => {
  it('parses the canonical "MPFC SxxExx Title.mp4" form', () => {
    assert.deepEqual(parseMontyPython('Series 1/MPFC S01E01 Whither Canada.mp4'), {
      season: 1,
      episode: 1,
      title: 'Whither Canada'
    });
  });

  it('keeps apostrophes and periods in titles', () => {
    assert.deepEqual(
      parseMontyPython("Series 3/MPFC S03E02 Mr. And Mrs. Brian Norris' Ford Popular.mp4"),
      { season: 3, episode: 2, title: "Mr. And Mrs. Brian Norris' Ford Popular" }
    );
    assert.deepEqual(parseMontyPython('Series 4/MPFC S04E05 Mr. Neutron.mp4'), {
      season: 4,
      episode: 5,
      title: 'Mr. Neutron'
    });
  });

  it('parses the truncated Series 4 (post-Cleese, 6 episodes only)', () => {
    assert.deepEqual(parseMontyPython('Series 4/MPFC S04E06 Party Political Broadcast.mp4'), {
      season: 4,
      episode: 6,
      title: 'Party Political Broadcast'
    });
  });

  it('parses every series cleanly (S01..S04)', () => {
    for (const [s, e, t] of [
      [1, 12, 'The Naked Ant'],
      [2, 12, 'Spam'],
      [3, 11, 'Dennis Moore'],
      [4, 1, 'The Golden Age of Ballooning']
    ]) {
      const file = `Series ${s}/MPFC S${String(s).padStart(2, '0')}E${String(e).padStart(
        2,
        '0'
      )} ${t}.mp4`;
      assert.deepEqual(parseMontyPython(file), { season: s, episode: e, title: t });
    }
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseMontyPython('cover.jpg'), null);
    assert.equal(parseMontyPython("Monty Python's Flying Circus S01E01.mp4"), null); // wrong prefix
    assert.equal(parseMontyPython('MPFC s01e01 lowercase.mp4'), null); // case-sensitive on purpose
  });
});

describe('parseAvengers', () => {
  it('parses the S4 space-separated form ("the avengers s4e1.mp4")', () => {
    assert.deepEqual(parseAvengers('the avengers s4e1.mp4'), {
      season: 4,
      episode: 1,
      title: 'Episode 1'
    });
    assert.deepEqual(parseAvengers('the avengers s4e24.mp4'), {
      season: 4,
      episode: 24,
      title: 'Episode 24'
    });
  });

  it('parses the S5 dash-separated form with the restored-720p-hd suffix', () => {
    assert.deepEqual(parseAvengers('the avengers-s5e1-restored-720p-hd.mp4'), {
      season: 5,
      episode: 1,
      title: 'Episode 1'
    });
    assert.deepEqual(parseAvengers('the avengers-s5e25-restored-720p-hd.mp4'), {
      season: 5,
      episode: 25,
      title: 'Episode 25'
    });
  });

  it('handles the S5E12 missing-dash quirk ("s5e12restored-720p-hd")', () => {
    // The S5 dump's E12 file omits the dash between the episode id
    // and "restored"; the regex's optional `-?` lets it through
    // instead of silently dropping the episode.
    assert.deepEqual(parseAvengers('the avengers-s5e12restored-720p-hd.mp4'), {
      season: 5,
      episode: 12,
      title: 'Episode 12'
    });
  });

  it('drops the stray S6 preview that lives in the S5 dump', () => {
    // The S5 upload accidentally bundles one S6 preview ripped at
    // 576p-sd instead of 720p-hd. We don't have the rest of S6 here,
    // so the regex's exact "restored-720p-hd" suffix gate rejects
    // the loner rather than surfacing an isolated S06E01 in the catalog.
    assert.equal(parseAvengers('the avengers-s6e1-restored-576p-sd.mp4'), null);
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseAvengers('cover.jpg'), null);
    assert.equal(parseAvengers('Avengers Endgame.mp4'), null);
    // Newer Marvel "Avengers" shows would have a different prefix:
    assert.equal(parseAvengers("Marvel's Avengers Assemble S01E01.mp4"), null);
  });
});

describe('parseFrankenhole', () => {
  it('parses the canonical "Mary Shelley\u2019s Frankenhole S01 E01 - Title.mp4" form', () => {
    assert.deepEqual(
      parseFrankenhole("Mary Shelley's Frankenhole S01 E01 - Yawn of the Dead.mp4"),
      { season: 1, episode: 1, title: 'Yawn of the Dead' }
    );
  });

  it('handles parenthesized title prefixes', () => {
    // "(John) Thomas Jefferson" — the parser shouldn't choke on the
    // open paren at the start of the title.
    assert.deepEqual(
      parseFrankenhole("Mary Shelley's Frankenhole S01 E02 - (John) Thomas Jefferson.mp4"),
      { season: 1, episode: 2, title: '(John) Thomas Jefferson' }
    );
  });

  it('accepts both straight and curly apostrophes in "Shelley\u2019s"', () => {
    // Some downstream re-derives normalize the curly glyph to ASCII;
    // accept both so a future re-rip doesn't suddenly break the parse.
    assert.deepEqual(parseFrankenhole('Mary Shelley\u2019s Frankenhole S01 E03 - Death.mp4'), {
      season: 1,
      episode: 3,
      title: 'Death'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseFrankenhole('cover.jpg'), null);
    assert.equal(parseFrankenhole('Frankenhole S01E01 - Title.mp4'), null); // missing "Mary Shelley's"
  });
});

describe('parseHomeMovies', () => {
  it('parses the canonical "Home.Movies-S01e01.Title.Words-N.mp4" form, replacing dots with spaces', () => {
    assert.deepEqual(parseHomeMovies('Home.Movies-S01e01.Get.Away.From.My.Mom-1.mp4'), {
      season: 1,
      episode: 1,
      title: 'Get Away From My Mom'
    });
  });

  it('keeps in-title hyphens intact (e.g. "Parent-Teacher")', () => {
    // The separator we strip is the dot, not the hyphen, so compound
    // words like "Parent-Teacher" survive the normalization. The
    // contraction "Don't" likewise stays intact since `.` only
    // replaces inter-word dots.
    assert.deepEqual(
      parseHomeMovies("Home.Movies-S01e02.I.Don't.Do.Well.In.Parent-Teacher.Conferences-2.mp4"),
      { season: 1, episode: 2, title: "I Don't Do Well In Parent-Teacher Conferences" }
    );
  });

  it('strips the trailing global episode counter ("-13", "-52")', () => {
    assert.deepEqual(parseHomeMovies('Home.Movies-S01e13.School.Nurse-13.mp4'), {
      season: 1,
      episode: 13,
      title: 'School Nurse'
    });
    assert.deepEqual(parseHomeMovies('Home.Movies-S04e13.Coffin.For.Two-52.mp4'), {
      season: 4,
      episode: 13,
      title: 'Coffin For Two'
    });
  });

  it('parses every season cleanly', () => {
    for (const [s, e, t] of [
      [2, 1, 'Politics'],
      [3, 1, 'Shore Leave'],
      [4, 1, 'Camp']
    ]) {
      const file = `Home.Movies-S0${s}e0${e}.${t.replace(/ /g, '.')}-X.mp4`.replace(
        '-X.mp4',
        `-${(s - 1) * 13 + e}.mp4`
      );
      assert.deepEqual(parseHomeMovies(file), { season: s, episode: e, title: t });
    }
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseHomeMovies('cover.jpg'), null);
    assert.equal(parseHomeMovies('Home.Movies-S01e01.mp4'), null); // missing title + counter
    assert.equal(parseHomeMovies('home.movies.s01e01.title-1.mp4'), null); // dotted, but wrong case-sensitive prefix
  });
});

describe('parseMaxx', () => {
  it('parses the canonical "The Maxx - 1x01.mp4" form', () => {
    assert.deepEqual(parseMaxx('The Maxx - 1x01.mp4'), {
      season: 1,
      episode: 1,
      title: 'Episode 1'
    });
  });

  it('parses every episode in the S1 dump (E01..E13)', () => {
    for (let e = 1; e <= 13; e += 1) {
      const file = `The Maxx - 1x${String(e).padStart(2, '0')}.mp4`;
      assert.deepEqual(parseMaxx(file), { season: 1, episode: e, title: `Episode ${e}` });
    }
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseMaxx('cover.jpg'), null);
    assert.equal(parseMaxx('The Maxx 1x01.mp4'), null); // missing " - "
    assert.equal(parseMaxx('The Maxx - S01E01.mp4'), null); // wrong episode-id shape
    assert.equal(parseMaxx('the maxx - 1x01.mp4'), null); // case-sensitive prefix
  });
});

describe('parseCritic', () => {
  it('parses the canonical "The Critic - 1x01 - Title.mp4" form', () => {
    assert.deepEqual(parseCritic('The Critic - 1x01 - Pilot.mp4'), {
      season: 1,
      episode: 1,
      title: 'Pilot'
    });
  });

  it('parses both ABC season 1 and Fox season 2', () => {
    assert.deepEqual(parseCritic('The Critic - 1x13 - A Pig-Boy and His Dog.mp4'), {
      season: 1,
      episode: 13,
      title: 'A Pig-Boy and His Dog'
    });
    assert.deepEqual(parseCritic('The Critic - 2x01 - Sherman, Woman and Child.mp4'), {
      season: 2,
      episode: 1,
      title: 'Sherman, Woman and Child'
    });
    assert.deepEqual(parseCritic("The Critic - 2x10 - I Can't Believe It's a Clip Show.mp4"), {
      season: 2,
      episode: 10,
      title: "I Can't Believe It's a Clip Show"
    });
  });

  it('keeps single-quoted titles with embedded special chars', () => {
    // Titles like "Dial 'M' For Mother" carry single-quote pairs
    // that the greedy `.+` should leave alone.
    assert.deepEqual(parseCritic("The Critic - 1x03 - Dial 'M' For Mother.mp4"), {
      season: 1,
      episode: 3,
      title: "Dial 'M' For Mother"
    });
  });

  it('rejects the bonus / promo files in the dump', () => {
    // "Creating The Critic", "Promos 1", "The Critic Webseries",
    // "Top Ten List", "Trailer Parodies" — all bundled in the same
    // upload, none of them have an episode number, so the regex
    // anchor drops them silently.
    assert.equal(parseCritic('Creating The Critic.mp4'), null);
    assert.equal(parseCritic('Promos 1.mp4'), null);
    assert.equal(parseCritic('The Critic Webseries.mp4'), null);
    assert.equal(parseCritic('Top Ten List.mp4'), null);
    assert.equal(parseCritic('Trailer Parodies.mp4'), null);
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseCritic('cover.jpg'), null);
    assert.equal(parseCritic('The Critic S01E01 Pilot.mp4'), null); // SxxExx shape, not NxNN
  });
});

describe('parseCrystalMaze', () => {
  it('parses the canonical "The.Crystal.Maze.S01E01.mp4" form', () => {
    assert.deepEqual(
      parseCrystalMaze('The Crystal Maze - Season 1 [1990]/The.Crystal.Maze.S01E01.mp4'),
      { season: 1, episode: 1, title: 'Episode 1' }
    );
  });

  it('parses every episode in the S1 dump (E01..E13)', () => {
    for (let e = 1; e <= 13; e += 1) {
      const file = `The Crystal Maze - Season 1 [1990]/The.Crystal.Maze.S01E${String(e).padStart(
        2,
        '0'
      )}.mp4`;
      assert.deepEqual(parseCrystalMaze(file), {
        season: 1,
        episode: e,
        title: `Episode ${e}`
      });
    }
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseCrystalMaze('cover.jpg'), null);
    assert.equal(parseCrystalMaze('The Crystal Maze S01E01.mp4'), null); // space-separated, not dotted
    assert.equal(parseCrystalMaze('The.Crystal.Maze.S01E01.Aztec.Zone.mp4'), null); // unexpected title
  });
});

describe('parseLiquidTV', () => {
  it('parses the canonical "Liquid Television NNN.mp4" form', () => {
    assert.deepEqual(parseLiquidTV('Liquid Television 101.mp4'), {
      season: 1,
      episode: 1,
      title: 'Episode 1'
    });
  });

  it('parses every season (S1, S2, S3) cleanly', () => {
    assert.deepEqual(parseLiquidTV('Liquid Television 107.mp4'), {
      season: 1,
      episode: 7,
      title: 'Episode 7'
    });
    assert.deepEqual(parseLiquidTV('Liquid Television 206.mp4'), {
      season: 2,
      episode: 6,
      title: 'Episode 6'
    });
    assert.deepEqual(parseLiquidTV('Liquid Television 309.mp4'), {
      season: 3,
      episode: 9,
      title: 'Episode 9'
    });
  });

  it('accepts the "Liqiud" typo variant (one S3 file in the dump)', () => {
    // The dump has exactly one file under the "Liqiud" spelling
    // (i/u transposed). The regex's character class lets it through
    // instead of silently dropping the episode.
    assert.deepEqual(parseLiquidTV('Liqiud Television 304.mp4'), {
      season: 3,
      episode: 4,
      title: 'Episode 4'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseLiquidTV('cover.jpg'), null);
    assert.equal(parseLiquidTV('Liquid Television.mp4'), null); // no number
    assert.equal(parseLiquidTV('Liquid TV 101.mp4'), null); // abbreviated name
  });
});

describe('parseMutantLeague', () => {
  it('parses the canonical "Mutant.League.SxxExx.Title.720p..." form, normalizing dots to spaces', () => {
    assert.deepEqual(
      parseMutantLeague(
        'Mutant.League.S01E01.Good.To.The.Bone.720p.CTV.WEB-DL.AAC2.0.H.264-STARBUCKS.mp4'
      ),
      { season: 1, episode: 1, title: 'Good To The Bone' }
    );
  });

  it('keeps apostrophes and parens in titles intact', () => {
    // "In.My.Father's.Name.(Part.2)" exercises both an embedded
    // apostrophe and parenthesized suffix; the dot→space pass on
    // the captured group preserves both.
    assert.deepEqual(
      parseMutantLeague(
        "Mutant.League.S02E25.In.My.Father's.Name.(Part.2).720p.CTV.WEB-DL.AAC2.0.H.264-STARBUCKS.mp4"
      ),
      { season: 2, episode: 25, title: "In My Father's Name (Part 2)" }
    );
  });

  it('parses two-digit episode numbers in the long S2', () => {
    assert.deepEqual(
      parseMutantLeague(
        'Mutant.League.S02E27.Hall.Of.Pain.720p.CTV.WEB-DL.AAC2.0.H.264-STARBUCKS.mp4'
      ),
      { season: 2, episode: 27, title: 'Hall Of Pain' }
    );
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseMutantLeague('cover.jpg'), null);
    // Right show, wrong quality tag — the regex anchors on the exact
    // STARBUCKS-group suffix on purpose so other re-rips don't
    // accidentally come through with stale codec assumptions.
    assert.equal(
      parseMutantLeague('Mutant.League.S01E01.Good.To.The.Bone.480p.x265-OTHER.mp4'),
      null
    );
  });
});

describe('parseSpiderMan', () => {
  it('parses S1 A/B segments into doubled episode slots (slot*2-1, slot*2)', () => {
    assert.deepEqual(parseSpiderMan('Season 1 (1967-1968)/1A - The Power Of Dr. Octopus.mp4'), {
      season: 1,
      episode: 1,
      title: 'The Power Of Dr. Octopus'
    });
    assert.deepEqual(parseSpiderMan('Season 1 (1967-1968)/1B - Sub-Zero For Spidey.mp4'), {
      season: 1,
      episode: 2,
      title: 'Sub-Zero For Spidey'
    });
    assert.deepEqual(parseSpiderMan('Season 1 (1967-1968)/10A - The Revenge Of Dr. Magneto.mp4'), {
      season: 1,
      episode: 19,
      title: 'The Revenge Of Dr. Magneto'
    });
    assert.deepEqual(parseSpiderMan('Season 1 (1967-1968)/10B - The Sinister Prime Minister.mp4'), {
      season: 1,
      episode: 20,
      title: 'The Sinister Prime Minister'
    });
  });

  it('parses S1 solo segments (no letter) into the A position, leaving a B gap', () => {
    // Slot 3 ("The Menace Of Mysterio") aired without a B half;
    // we map it to ep 5 (= 3*2-1), the corresponding ep 6 stays
    // empty in the catalog — that gap signals the broadcast's
    // own single-segment status.
    assert.deepEqual(parseSpiderMan('Season 1 (1967-1968)/3 - The Menace Of Mysterio.mp4'), {
      season: 1,
      episode: 5,
      title: 'The Menace Of Mysterio'
    });
    assert.deepEqual(parseSpiderMan('Season 1 (1967-1968)/8 - Horn Of The Rhino.mp4'), {
      season: 1,
      episode: 15,
      title: 'Horn Of The Rhino'
    });
  });

  it('parses S2 (full 22-min episodes) using the slot number directly', () => {
    // S2 aired 22-minute episodes with no segmentation, so we don't
    // double the slot number — slot 1 = ep 1, slot 19 = ep 19.
    assert.deepEqual(parseSpiderMan('Season 2 (1968-1969)/1 - The Origin Of Spiderman.mp4'), {
      season: 2,
      episode: 1,
      title: 'The Origin Of Spiderman'
    });
    assert.deepEqual(parseSpiderMan('Season 2 (1968-1969)/19 - To Cage A Spider.mp4'), {
      season: 2,
      episode: 19,
      title: 'To Cage A Spider'
    });
  });

  it('parses S3 mixed A/B + solo files, matching the S1 doubling formula', () => {
    assert.deepEqual(parseSpiderMan('Season 3 (1970)/1A - The Winged Thing.mp4'), {
      season: 3,
      episode: 1,
      title: 'The Winged Thing'
    });
    assert.deepEqual(parseSpiderMan('Season 3 (1970)/9B - The Madness Of Mysterio.mp4'), {
      season: 3,
      episode: 18,
      title: 'The Madness Of Mysterio'
    });
    assert.deepEqual(parseSpiderMan('Season 3 (1970)/13 - Trip To Tomorrow.mp4'), {
      season: 3,
      episode: 25,
      title: 'Trip To Tomorrow'
    });
  });

  it('returns null for unrelated files', () => {
    // No "/Season N " path component → no way to derive season.
    assert.equal(parseSpiderMan('1A - Pilot.mp4'), null);
    assert.equal(parseSpiderMan('cover.jpg'), null);
    // Title-less filenames don't parse (no separator hyphen).
    assert.equal(parseSpiderMan('Season 1 (1967-1968)/1A.mp4'), null);
  });
});

describe('parseTick', () => {
  it('parses the canonical "SxEx - Title.mp4" form (no path prefix)', () => {
    assert.deepEqual(parseTick('S1E01 - The Tick vs. The Idea Men.mp4'), {
      season: 1,
      episode: 1,
      title: 'The Tick vs. The Idea Men'
    });
  });

  it('parses every season cleanly (S1..S3)', () => {
    assert.deepEqual(parseTick('S1E13 - The Tick vs. Pineapple Pokopo.mp4'), {
      season: 1,
      episode: 13,
      title: 'The Tick vs. Pineapple Pokopo'
    });
    assert.deepEqual(parseTick('S2E01 - The Tick vs. The Mole-Men.mp4'), {
      season: 2,
      episode: 1,
      title: 'The Tick vs. The Mole-Men'
    });
    assert.deepEqual(parseTick('S3E10 - Tick vs. Education.mp4'), {
      season: 3,
      episode: 10,
      title: 'Tick vs. Education'
    });
  });

  it('keeps periods inside titles ("The Tick vs.")', () => {
    // Almost every title has "vs." in it. The greedy `.+` capture
    // takes the period without confusing it with the .mp4 extension.
    assert.deepEqual(parseTick('S1E03 - The Tick vs. Dinosaur Neil.mp4'), {
      season: 1,
      episode: 3,
      title: 'The Tick vs. Dinosaur Neil'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseTick('cover.jpg'), null);
    assert.equal(parseTick('The Tick S01E01.mp4'), null); // SxxExx, not SxEx
    assert.equal(parseTick('S01E01 - The Tick vs. The Idea Men.mp4'), null); // 2-digit season; this dump uses 1-digit
  });
});

describe('parseVoyagers', () => {
  it('parses the canonical "Voyagers! - S01E01 (Title).mp4" form', () => {
    assert.deepEqual(parseVoyagers('Voyagers! - S01E01 (Pilot).mp4'), {
      season: 1,
      episode: 1,
      title: 'Pilot'
    });
  });

  it('parses titles with embedded spaces and capitalization', () => {
    assert.deepEqual(parseVoyagers('Voyagers! - S01E04 (Agents of Satan).mp4'), {
      season: 1,
      episode: 4,
      title: 'Agents of Satan'
    });
    assert.deepEqual(parseVoyagers('Voyagers! - S01E20 (Jack\u2019s Back).mp4'), {
      season: 1,
      episode: 20,
      title: 'Jack\u2019s Back'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseVoyagers('cover.jpg'), null);
    assert.equal(parseVoyagers('Voyagers S01E01 Pilot.mp4'), null); // missing ! and parens
    assert.equal(parseVoyagers('Voyagers! - S01E01.mp4'), null); // missing title parens
  });
});

describe('parsePiratesDarkWater', () => {
  it('parses the canonical "Season SS/Sx.ENN \u2219 Title.mp4" form', () => {
    assert.deepEqual(parsePiratesDarkWater('Season 01/S1.E01 \u2219 The Quest.mp4'), {
      season: 1,
      episode: 1,
      title: 'The Quest'
    });
  });

  it('parses every season (S1..S3) and two-digit episode numbers', () => {
    assert.deepEqual(parsePiratesDarkWater('Season 01/S1.E05 \u2219 Victory.mp4'), {
      season: 1,
      episode: 5,
      title: 'Victory'
    });
    assert.deepEqual(parsePiratesDarkWater('Season 02/S2.E08 \u2219 The Dark Dweller.mp4'), {
      season: 2,
      episode: 8,
      title: 'The Dark Dweller'
    });
    assert.deepEqual(parsePiratesDarkWater('Season 03/S3.E08 \u2219 The Living Treasure.mp4'), {
      season: 3,
      episode: 8,
      title: 'The Living Treasure'
    });
  });

  it('returns null when the separator is a regular middle dot (U+00B7) instead of U+2219', () => {
    // The dump uses U+2219 (BULLET OPERATOR) consistently; a stray
    // U+00B7 (\u00b7) variant would indicate a different upload and
    // should not silently match.
    assert.equal(parsePiratesDarkWater('Season 01/S1.E01 \u00b7 The Quest.mp4'), null);
  });

  it('returns null for unrelated files', () => {
    assert.equal(parsePiratesDarkWater('cover.jpg'), null);
    assert.equal(parsePiratesDarkWater('S1.E01 The Quest.mp4'), null); // missing separator
    assert.equal(parsePiratesDarkWater('Season 01/S1E01 - The Quest.mp4'), null); // wrong separator shape
  });
});

describe('parseReboot', () => {
  it('parses the canonical 1080p variant', () => {
    assert.deepEqual(
      parseReboot(
        'Reboot HD/ReBoot - Season 1 Episode 1 - The Tearing (4K Upscale) (1080p_24fps_H264-128kbit_AAC).mp4'
      ),
      { season: 1, episode: 1, title: 'The Tearing' }
    );
  });

  it('parses two-digit episode numbers', () => {
    assert.deepEqual(
      parseReboot(
        'Reboot HD/ReBoot - Season 1 Episode 13 - Identity Crisis Part 2 (4K Upscale) (1080p_24fps_H264-128kbit_AAC).mp4'
      ),
      { season: 1, episode: 13, title: 'Identity Crisis Part 2' }
    );
  });

  it('parses across all four seasons', () => {
    assert.deepEqual(
      parseReboot(
        'Reboot HD/ReBoot - Season 4 Episode 8 - Daemon Rising Part 8 (4K Upscale) (1080p_24fps_H264-128kbit_AAC).mp4'
      ),
      { season: 4, episode: 8, title: 'Daemon Rising Part 8' }
    );
  });

  it('rejects 720p variants — the dump ships dupes for S1E2/E11/E13', () => {
    // Anchoring on `1080p_24fps_H264` keeps the catalog at exactly
    // one file per (season, episode). All 47 episodes have a 1080p
    // version, so this drops only the 3 redundant 720p files.
    assert.equal(
      parseReboot(
        'Reboot HD/ReBoot - Season 1 Episode 2 - Racing The Clock (4K Upscale) (720p_24fps_H264-128kbit_AAC).mp4'
      ),
      null
    );
    assert.equal(
      parseReboot(
        'Reboot HD/ReBoot - Season 1 Episode 13 - Identity Crisis Part 2 (4K Upscale) (720p_24fps_H264-128kbit_AAC).mp4'
      ),
      null
    );
  });

  it('tolerates the dump\u2019s whitespace + hyphen glitches on a handful of files', () => {
    // Missing space after the title-separator hyphen.
    assert.deepEqual(
      parseReboot(
        'Reboot HD/ReBoot - Season 1 Episode 7 -The Crimson Binome (4K Upscale) (1080p_24fps_H264-128kbit_AAC).mp4'
      ),
      { season: 1, episode: 7, title: 'The Crimson Binome' }
    );
    // Doubled space before the title-separator hyphen.
    assert.deepEqual(
      parseReboot(
        'Reboot HD/ReBoot - Season 2 Episode 8  - Gigabyte (4K Upscale) (1080p_24fps_H264-128kbit_AAC).mp4'
      ),
      { season: 2, episode: 8, title: 'Gigabyte' }
    );
    // Doubled space inside "(4K Upscale)".
    assert.deepEqual(
      parseReboot(
        'Reboot HD/ReBoot - Season 3 Episode 7 - Number 7 (4K  Upscale) (1080p_24fps_H264-128kbit_AAC).mp4'
      ),
      { season: 3, episode: 7, title: 'Number 7' }
    );
    // Missing the leading "- " between "ReBoot" and "Season".
    assert.deepEqual(
      parseReboot(
        'Reboot HD/ReBoot Season 1 Episode 12 - Identity Crisis Part 1 (4K Upscale) (1080p_24fps_H264-128kbit_AAC).mp4'
      ),
      { season: 1, episode: 12, title: 'Identity Crisis Part 1' }
    );
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseReboot('cover.jpg'), null);
    assert.equal(parseReboot('ReBoot - S01E01 - The Tearing.mp4'), null); // missing the long quality tag
  });
});

describe('parseAmazingStories', () => {
  it('parses the canonical "Amazing Stories (1985) - S01E01 - Title.mp4" form', () => {
    assert.deepEqual(parseAmazingStories('Amazing Stories (1985) - S01E01 - Ghost Train.mp4'), {
      season: 1,
      episode: 1,
      title: 'Ghost Train'
    });
  });

  it('parses across both seasons (S1 has 24 eps, S2 has 22)', () => {
    assert.deepEqual(parseAmazingStories('Amazing Stories (1985) - S01E24 - Hell Toupee.mp4'), {
      season: 1,
      episode: 24,
      title: 'Hell Toupee'
    });
    assert.deepEqual(parseAmazingStories('Amazing Stories (1985) - S02E21 - Miss Stardust.mp4'), {
      season: 2,
      episode: 21,
      title: 'Miss Stardust'
    });
  });

  it('rejects the lone "0 Amazing Stories.mp4" promo file', () => {
    // Series-promo without an SxxExx number; the anchored regex drops
    // it without needing a special case.
    assert.equal(parseAmazingStories('0 Amazing Stories.mp4'), null);
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseAmazingStories('cover.jpg'), null);
    assert.equal(parseAmazingStories('Amazing Stories - S01E01 - Ghost Train.mp4'), null); // missing (1985)
  });
});

describe('parseAstroBoy', () => {
  it('parses the canonical "Astro Boy S1E001.mp4" three-digit form', () => {
    assert.deepEqual(parseAstroBoy('Astro Boy (1963) R1/Astro Boy S1E001.mp4'), {
      season: 1,
      episode: 1,
      title: 'Episode 1'
    });
  });

  it('parses every episode in the 104-episode dub run', () => {
    // Spot-check the boundary cases: E001 (start), E050 (mid), E104 (end).
    assert.deepEqual(parseAstroBoy('Astro Boy (1963) R3/Astro Boy S1E050.mp4'), {
      season: 1,
      episode: 50,
      title: 'Episode 50'
    });
    assert.deepEqual(parseAstroBoy('Astro Boy (1963) R6/Astro Boy S1E104.mp4'), {
      season: 1,
      episode: 104,
      title: 'Episode 104'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseAstroBoy('cover.jpg'), null);
    // Two-digit episode numbers would indicate a different dump; we
    // anchor on exactly three digits.
    assert.equal(parseAstroBoy('Astro Boy S1E01.mp4'), null);
  });
});

describe('parseFawltyTowers', () => {
  it('parses the canonical "Fawlty Towers S01E01 - Title.mp4" form', () => {
    assert.deepEqual(parseFawltyTowers('Fawlty Towers S01E01 - A touch of class.mp4'), {
      season: 1,
      episode: 1,
      title: 'A touch of class'
    });
  });

  it('parses across both seasons (6 episodes each)', () => {
    assert.deepEqual(parseFawltyTowers('Fawlty Towers S01E06 - The Germans.mp4'), {
      season: 1,
      episode: 6,
      title: 'The Germans'
    });
    assert.deepEqual(parseFawltyTowers('Fawlty Towers S02E06 - Basil the rat.mp4'), {
      season: 2,
      episode: 6,
      title: 'Basil the rat'
    });
  });

  it('keeps the uploader\u2019s inconsistent title capitalization intact', () => {
    // "The wedding party" mixes Title- and sentence-case; TVMaze can
    // graft the canonical version later, the parser doesn't normalize.
    assert.deepEqual(parseFawltyTowers('Fawlty Towers S01E03 - The wedding party.mp4'), {
      season: 1,
      episode: 3,
      title: 'The wedding party'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseFawltyTowers('cover.jpg'), null);
    assert.equal(parseFawltyTowers('Fawlty Towers - S01E01.mp4'), null); // missing title separator
  });
});

describe('parseJonnyQuest', () => {
  it('parses the canonical "S01 E01" (space-separated tokens) form', () => {
    assert.deepEqual(
      parseJonnyQuest(
        'The Real Adventures of Jonny Quest - S01 E01 - The Darkest Fathoms (480p - DVDRip).mp4'
      ),
      { season: 1, episode: 1, title: 'The Darkest Fathoms' }
    );
  });

  it('strips the "(480p - DVDRip)" quality tag from titles', () => {
    assert.deepEqual(
      parseJonnyQuest(
        'The Real Adventures of Jonny Quest - S02 E26 - More Than Zero (480p - DVDRip).mp4'
      ),
      { season: 2, episode: 26, title: 'More Than Zero' }
    );
  });

  it('keeps possessive apostrophes (e.g. "Rage\'s Burning Wheel")', () => {
    assert.deepEqual(
      parseJonnyQuest(
        "The Real Adventures of Jonny Quest - S01 E04 - Rage's Burning Wheel (480p - DVDRip).mp4"
      ),
      { season: 1, episode: 4, title: "Rage's Burning Wheel" }
    );
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseJonnyQuest('cover.jpg'), null);
    // Unspaced "S01E01" instead of "S01 E01" — a different dump
    // convention; we don't want to silently accept it.
    assert.equal(
      parseJonnyQuest(
        'The Real Adventures of Jonny Quest - S01E01 - The Darkest Fathoms (480p - DVDRip).mp4'
      ),
      null
    );
  });
});

describe('parseSonicSatAM', () => {
  it('parses the canonical "NN. SxEx Title.mp4" form, ignoring the playback-order prefix', () => {
    // The pilot ("Heads or Tails") is broadcast S1E13 but ships first
    // (NN=01) so it plays in chronological order. The parser keeps
    // the SxEx as the authoritative slot.
    assert.deepEqual(parseSonicSatAM('01. S1E13 Heads or Tails.mp4'), {
      season: 1,
      episode: 13,
      title: 'Heads or Tails'
    });
    assert.deepEqual(parseSonicSatAM('02. S1E1 Sonic Boom.mp4'), {
      season: 1,
      episode: 1,
      title: 'Sonic Boom'
    });
  });

  it('parses two-digit episode numbers (S2 runs E1..E13)', () => {
    assert.deepEqual(parseSonicSatAM('11. S1E10 Warp Sonic.mp4'), {
      season: 1,
      episode: 10,
      title: 'Warp Sonic'
    });
    assert.deepEqual(parseSonicSatAM('26. S2E13 The Doomsday Project.mp4'), {
      season: 2,
      episode: 13,
      title: 'The Doomsday Project'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseSonicSatAM('cover.jpg'), null);
    // Missing the leading "NN." playback-order prefix.
    assert.equal(parseSonicSatAM('S1E1 Sonic Boom.mp4'), null);
    // Three-digit prefix — this dump uses exactly two.
    assert.equal(parseSonicSatAM('001. S1E1 Sonic Boom.mp4'), null);
  });
});
