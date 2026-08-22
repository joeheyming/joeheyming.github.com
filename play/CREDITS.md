# Credits

The `/play/*` instruments use a small catalog of public-domain and
permissively-licensed audio samples, fetched at runtime through the
shared CORS proxy in [`/proxy.js`](../proxy.js) and decoded once into
`AudioBuffer`s. Decoded buffers are cached in memory; the raw audio bytes
are also kept in `IndexedDB` so a returning visitor doesn't pay the
download cost again.

If any sample fails to load (offline, proxy down, decode error), the
instrument transparently falls back to its built-in synth voice — so
none of the pages depend on the network at runtime.

## Drums

[`play/drums`](./drums/) — sample-based kits.

| Kit | Source | License |
| --- | --- | --- |
| LinnDrum (LM-2) | [smpldsnds/drum-machines](https://github.com/smpldsnds/drum-machines) | Public domain |
| TR-808 | [smpldsnds/drum-machines](https://github.com/smpldsnds/drum-machines) | Public domain |

The synth-only "Acoustic" and "Electronic" kits remain available as a
zero-network fallback, generated entirely with Web Audio oscillators and
filtered noise.

## Metronome

[`play/metronome`](./metronome/) — three sampled click voices in
addition to the four synth voices.

| Voice | Source | License |
| --- | --- | --- |
| Clave (sample) | [smpldsnds/drum-machines/TR-808/clave](https://github.com/smpldsnds/drum-machines/tree/main/TR-808/clave) | Public domain |
| Cowbell (sample) | [smpldsnds/drum-machines/TR-808/cowbell](https://github.com/smpldsnds/drum-machines/tree/main/TR-808/cowbell) | Public domain |
| Rimshot (sample) | [smpldsnds/drum-machines/TR-808/rimshot](https://github.com/smpldsnds/drum-machines/tree/main/TR-808/rimshot) | Public domain |

## Piano

[`play/piano`](./piano/) — the new default "Grand piano (samples)" tone
loads multi-sample anchors through the same loader; soundfont-based
acoustic / electric pianos remain available as alternative tones.

| Tone | Source | License |
| --- | --- | --- |
| Grand piano (samples) | [nbrosowsky/tonejs-instruments — piano](https://github.com/nbrosowsky/tonejs-instruments/tree/master/samples/piano) | CC-BY 3.0 |
| Acoustic piano (soundfont) | [MusyngKite via gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) | MIT |
| Electric piano (soundfont) | MusyngKite (as above) | MIT |

## Guitar

[`play/strings`](./strings/) — the default "Acoustic (samples)" tone uses
real plucks, and "Electric clean (samples)" gives a true single-coil
tone with natural decay (the soundfont overdriven voice has a much
longer sustain by comparison). Soundfont tones remain for the steel /
nylon / electric jazz / overdriven options.

| Tone | Source | License |
| --- | --- | --- |
| Acoustic (samples) | [nbrosowsky/tonejs-instruments — guitar-acoustic](https://github.com/nbrosowsky/tonejs-instruments/tree/master/samples/guitar-acoustic) | CC-BY 3.0 |
| Electric clean (samples) | [nbrosowsky/tonejs-instruments — guitar-electric](https://github.com/nbrosowsky/tonejs-instruments/tree/master/samples/guitar-electric) | CC-BY 3.0 |
| Acoustic steel / nylon, Electric clean / jazz, Overdriven | MusyngKite (as above) | MIT |

## Accordion

[`play/accordion`](./accordion/) defaults to the new "Button accordion
(samples)" tone — single-reed Hohner samples processed into a
public-domain pack — and keeps the MusyngKite reed soundfonts as
alternate tones.

| Tone | Source | License |
| --- | --- | --- |
| Button accordion (samples) | [freepats/button-accordion-HN](https://github.com/freepats/button-accordion-HN) (Hohner samples by Jeff Stauffer, 2023; sound-bank by michael02022 via the [FreePats project](https://freepats.zenvoid.org/Organ/accordion.html)) | CC0 1.0 (public domain) |
| Accordion / Tango accordion / Reed organ / Harmonica (soundfont) | MusyngKite (as above) | MIT |

The 17 anchor samples (B3–G6) are looped in their sustained middle so
held keys ring as long as the bellows have air, and the same MultiSampler
detune-by-`playbackRate` trick used by the piano and guitar fills in
notes outside the recorded range.

## Synth

[`play/synth`](./synth/) is intentionally a subtractive synthesiser; it
uses no samples at all.

## Sampler

[`play/sampler`](./sampler/) is a DirectWave-style keyboard sampler. Its
built-in sounds are original and generated in the browser; no third-party
sample packs are included.

## Chiptune

[`play/chiptune`](./chiptune/) is an original browser chip tracker (Web
Audio oscillators + noise). Inspired by [BeepBox](https://www.beepbox.co/)
and [JummBox](https://jummb.us/) — no vendored tracker code or iframes.

## Loader

The shared loader lives in [`play/shared/samples.js`](./shared/samples.js)
and provides:

- `loadSample(url)` — proxy-backed fetch + decode with a process-wide
  memory cache and an `IndexedDB` byte cache.
- `SampleKit` — named one-shot collection (used by drums + metronome).
- `MultiSampler` — sparse multi-sample with `playbackRate` detune (used
  by the piano, guitar, and accordion sample tones). Pass `{ loop: true }`
  for sustained-tone instruments like accordion so held notes loop the
  sustained middle of each recording instead of decaying.
