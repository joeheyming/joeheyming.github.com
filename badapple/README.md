# Bad Apple!! ASCII Art Animation

The legendary Bad Apple!! music video rendered entirely in ASCII art, synchronized with audio playback.

## Overview

This is an ASCII art recreation of the iconic Touhou Project shadow animation video. The player displays 6572 pre-rendered text frames at 30 FPS, synced to the original audio track using `requestAnimationFrame` for smooth playback.

## How It's Made

The frames were extracted from the original YouTube video using ffmpeg at 30 FPS, producing 6572 PNG images. Each image was then converted to ASCII art using jp2a, which maps pixel brightness to characters—dark pixels become `#` and light pixels become `_`, with `+` and `=` for mid-tones. The resulting text is wrapped in HTML and served as individual frame files.

## Technical Details

- **Frame Rate:** 30 FPS
- **Resolution:** 240×84 characters per frame
- **Character Set:** `_` `+` `=` `#` (light to dark)
- **Audio:** Ogg Vorbis
- **Sync Method:** `requestAnimationFrame` polling audio time

Frames are loaded on-demand and cached in memory. The player preloads upcoming frames in batches to ensure smooth playback without stuttering.

## Controls

- **Space** - Play/Pause
- **R** - Reset

## Credits

- Original video: [Bad Apple!! PV](https://www.youtube.com/watch?v=FtutLA63Cp8)
- Music: Alstroemeria Records - Bad Apple!! feat. nomico
- ASCII conversion: [jp2a](https://github.com/cslarsen/jp2a)
