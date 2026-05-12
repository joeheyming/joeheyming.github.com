/**
 * Register switch presets, modelled on a piano accordion's reed couplers.
 * Each entry has an `id`, a short text label (`L`/`M`/`H`/`MM` etc.),
 * a longer reed-name, and a `reeds` list — `{ semis, cents }` pairs
 * describing which physical reed banks engage:
 *
 *   - `semis: -12` = L (bassoon, octave below concert)
 *   - `semis:   0` = M (clarinet, concert pitch)
 *   - `semis: +12` = H (piccolo, octave above)
 *   - non-zero `cents` = a slightly-detuned reed, used for **musette**
 *     beating. A real "MM" stop has two physical M reeds, one at concert
 *     pitch and one a few cents sharp; we synthesize that by stacking
 *     `{semis:0,cents:0}` and `{semis:0,cents:+8}`. Any register with
 *     two-or-more M reeds is a tremolo / musette stop on a real
 *     instrument; everything else (L, M, H, LM, LH, MH, LMH) is *pure*.
 *
 * Real instruments have *two* register sections — one above the right
 * (treble) keyboard for the melody side, and a much smaller one for the
 * left (Stradella bass) side. The treble side typically offers the full
 * 11-stop matrix below (every L/M/H combination, with and without
 * musette); the bass side commonly offers just two settings, a single
 * "tenor" reed for tonal lines or a layered "master" couple of all reeds
 * for full dance-band volume. We model both.
 *
 * Caveat: the FreePats Button Accordion HN sample pack is itself
 * recorded from a real *MM* (musette) instrument — the source already
 * has the two-reed beating baked in. Stacking on top of that gives a
 * fuller chorus than a real single-reed M would; the soundfont tones
 * (accordion / tango_accordion / reed_organ / harmonica) have no such
 * baked-in tremolo and will produce clean single-reed sounds for the
 * pure stops below.
 */
export const MUSETTE_CENTS = 8;

export const RIGHT_REGISTERS = [
  // Pure (no tremolo): single reed per bank. Real instruments: L, M, H,
  // and every 2-/3-bank combination that doesn't double up on M.
  { id: 'L', label: 'L', name: 'Bassoon', reeds: [{ semis: -12, cents: 0 }] },
  { id: 'M', label: 'M', name: 'Clarinet', reeds: [{ semis: 0, cents: 0 }] },
  { id: 'H', label: 'H', name: 'Piccolo', reeds: [{ semis: 12, cents: 0 }] },
  {
    id: 'LM',
    label: 'LM',
    name: 'Bandoneon',
    reeds: [
      { semis: -12, cents: 0 },
      { semis: 0, cents: 0 }
    ]
  },
  {
    id: 'LH',
    label: 'LH',
    name: 'Organ',
    reeds: [
      { semis: -12, cents: 0 },
      { semis: 12, cents: 0 }
    ]
  },
  {
    id: 'MH',
    label: 'MH',
    name: 'Violin',
    reeds: [
      { semis: 0, cents: 0 },
      { semis: 12, cents: 0 }
    ]
  },
  {
    id: 'LMH',
    label: 'LMH',
    name: 'Master',
    reeds: [
      { semis: -12, cents: 0 },
      { semis: 0, cents: 0 },
      { semis: 12, cents: 0 }
    ]
  },
  // Musette (≥ 2 M reeds → tremolo). The detuned M reed is `+cents` so
  // the on-pitch fundamental still aligns with the player's mental
  // pitch; the second reed beats *above* it. Italian-style "wet" musette
  // typically sits in the +8…+15¢ range; we use 8¢ as a moderate default.
  {
    id: 'MM',
    label: 'MM',
    name: 'Musette',
    reeds: [
      { semis: 0, cents: 0 },
      { semis: 0, cents: MUSETTE_CENTS }
    ]
  },
  {
    id: 'LMM',
    label: 'LMM',
    name: 'Harmonium',
    reeds: [
      { semis: -12, cents: 0 },
      { semis: 0, cents: 0 },
      { semis: 0, cents: MUSETTE_CENTS }
    ]
  },
  {
    id: 'MMH',
    label: 'MMH',
    name: 'Musette+H',
    reeds: [
      { semis: 0, cents: 0 },
      { semis: 0, cents: MUSETTE_CENTS },
      { semis: 12, cents: 0 }
    ]
  },
  {
    id: 'LMMH',
    label: 'LMMH',
    name: 'Tutti',
    reeds: [
      { semis: -12, cents: 0 },
      { semis: 0, cents: 0 },
      { semis: 0, cents: MUSETTE_CENTS },
      { semis: 12, cents: 0 }
    ]
  }
];

export const LEFT_REGISTERS = [
  { id: 'tenor', label: 'M', name: 'Tenor (tonal)', reeds: [{ semis: 0, cents: 0 }] },
  {
    id: 'master',
    label: 'LMH',
    name: 'Master (full)',
    reeds: [
      { semis: -12, cents: 0 },
      { semis: 0, cents: 0 },
      { semis: 12, cents: 0 }
    ]
  }
];

export const handForView = (cfg) => (cfg && cfg.kind === 'stradella' ? 'left' : 'right');
export const registersForHand = (hand) => (hand === 'left' ? LEFT_REGISTERS : RIGHT_REGISTERS);
