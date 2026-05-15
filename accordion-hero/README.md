# Accordion Hero

A Stepmania-style rhythm game where the lanes are Stradella bass and chord buttons. Notes fall onto a mini accordion keyboard — hit them on the strike line and earn points. Any voicing that fits the chord counts: substitutions, extensions, and relative-minor swaps all score.

Play it at: [joeheyming.github.io/accordion-hero/](https://joeheyming.github.io/accordion-hero/)

This build ships a single song: **That's Amore** (Harry Warren / Jack Brooks, 1953). No video, no song picker — just the rhythm-game core.

---

## How to play

Notes fall from the top of the screen toward the **strike line**, which sits just above the keyboard. Each note belongs to a column (the pitch root) and a row (bass, major, minor, dom7, or dim7). Hit the correct lane when the note reaches the line.

**Controls**

| Device | Action |
|--------|--------|
| Desktop | Per-column QWERTY columns (e.g. <kbd>1</kbd> <kbd>Q</kbd> <kbd>A</kbd> <kbd>Z</kbd> = column 1) |
| Phone / tablet | Multi-touch — tap and hold multiple lanes simultaneously |

**Scoring**

The chart suggests one voicing per beat, shown as falling notes. You're free to play any other voicing that fits:

| Tier | Condition | Multiplier |
|------|-----------|------------|
| Perfect | Any voicing of the target chord (C, C6, Cmaj7, C9 all count for a C beat) | 1.0× |
| Smooth sub | Extension sharing ≥ 3 pitch classes with target (Am7 for C) | 0.85× |
| Close | Relative-minor / mediant sub sharing ≥ 2 pitch classes | 0.7× |
| Miss | < 2 shared notes, or nothing pressed | 0× |

Score = timing points × voicing multiplier × combo multiplier (capped at 4×).

**Timing windows**: Perfect 25 ms, Great 60 ms, Good 120 ms.

---

## Keyboard layout

The lane bar at the bottom is a trimmed Stradella keyboard — only the columns and rows the song uses are shown. Columns run around the **circle of fifths** (each step right is a perfect fifth up). Rows stack top-to-bottom in real-accordion order:

| Row | Color | What it plays |
|-----|-------|---------------|
| Bass | Light / white | Single bass note for the root |
| Major | Deep green | Major triad (root, 3, 5) |
| Minor | Deep teal | Minor triad (root, ♭3, 5) |
| Dom7 | Deep amber | Dominant 7th (root, 3, ♭7) |
| Dim7 | Deep red | Diminished 7th (root, ♭3, ♭5, ♭♭7) |

**C**, **F**, and **G** bass buttons are highlighted in red — the same home-button convention used on real accordions for tactile reference.

---

## Options

| Option | Description |
|--------|-------------|
| Tone | Reed sound: button accordion samples (FreePats), accordion, tango accordion, reed organ, harmonica |
| Tempo | 0.4× – 1.6× playback rate relative to the chart's base BPM |

The same `AccordionSynth` engine and sample library is shared with [/play/accordion/](/play/accordion/).

---

## File architecture

```
accordion-hero/
├── index.html           — Page shell (three screens: Start → Game → Results)
├── style.css            — Dark theme, lane bar styling, responsive layout
├── accordion-hero.js    — Page wiring, canvas render loop, audio, game loop
├── lane-engine.js       — Time-driven game engine (note model, timing windows, scoring)
├── chord-judge.js       — Voicing evaluator: judgeVoicing(pressed, target) → tier
├── chart-loader.js      — Converts song JSON + pattern into timed note events
├── input.js             — Keyboard (per-column QWERTY) and multi-touch pointer routing
└── songs/
    └── thats-amore.json — The chord chart played by this build
```

### Data flow

```
songs/thats-amore.json
  └─ chart-loader.js → { events[] }
       └─ lane-engine.js → LaneEngine
            ├─ tick(t)          → onJudgment callbacks (scoring)
            ├─ getActiveNotes() → canvas draw loop (falling notes)
            └─ pressLane(i, t)  ← input.js (keyboard / touch)
                  └─ chord-judge.js → { tier, multiplier, label }
```

### Shared dependencies

Both Accordion Hero and `/play/accordion/` import from the same modules:

| Module | Provides |
|--------|----------|
| `play/accordion/accordion-instruments.js` | `AccordionSynth` — Web Audio polyphony + register support |
| `play/accordion/accordion-registers.js` | Register presets (L, M, H, LMH, musette, …) |
| `play/accordion/stradella-chords.js` | Chord math: MIDI voicings, pitch-class sets, chord name parser |
| `play/shared/audio.js` | `getCtx()`, `resumeIfSuspended()`, `setMasterVolume()` |

---

## Song format

`songs/thats-amore.json` is a chord chart — purely factual harmony data, not copyrightable. The schema:

```json
{
  "title": "Song Title",
  "artist": "Composer",
  "bpm": 120,
  "timeSig": [3, 4],
  "key": "C",
  "pattern": "oom-pah-pah",
  "progression": [
    { "bars": 2, "chord": "C" },
    { "bars": 2, "chord": "G7" }
  ]
}
```

- `key`: root pitch name for centering the circle-of-fifths grid
- `pattern`: `"oom-pah-pah"` (3/4), `"boom-chick"` (4/4), `"waltz-march"` (3/4 every-beat), `"ballad-3"` (3/4 sparse), or `"march"`
- `progression`: array of `{ bars, chord, voicing? }` entries. `voicing: "built"` decomposes the chord into bass + chord-button parts to match how a real player would voice it.

Chord names: `"C"` (major), `"Am"` (minor), `"G7"` (dominant 7th), `"Bdim"` / `"B°"` (diminished), `"Cmaj7"`, `"C9"`, `"Csus4"`, etc. — see `parseChordName` in `play/accordion/stradella-chords.js`.
