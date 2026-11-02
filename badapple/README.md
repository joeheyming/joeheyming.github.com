# Bad Apple!! ASCII Art Animation

The legendary Bad Apple!! music video rendered entirely in ASCII art, synchronized with audio playback.

## Overview

This is an ASCII art recreation of the iconic Touhou Project shadow animation video. The player displays 6572 pre-rendered text frames at 30 FPS, synced to the original audio track using `requestAnimationFrame` for smooth playback.

## How It's Made

The source is the 480×360, 30 FPS upload of the original PV ([FtutLA63Cp8](https://www.youtube.com/watch?v=FtutLA63Cp8)), the highest resolution that video is published at. Each frame is resampled the same way `/ascii/` samples a still: bilinear-scale to one pixel per character cell, then map luminance through the classic ramp `@#S%?*+;:,._` (bright pixels become dense glyphs, so the white silhouette reads on the black page). Courier New's cell is 0.6em wide, so a 480×360 frame becomes **480×216 characters** and still looks 4:3.

Rows are run-length encoded (`470_3@`) inside `frame/N.html`. `scripts/render-badapple-frames.py` rebuilds them from a local copy of the video.

## Technical Details

- **Frame Rate:** 30 FPS
- **Resolution:** 480×216 characters per frame
- **Character Set:** `@ # S % ? * + ; : , . _` (bright to dark)
- **Audio:** Ogg Vorbis
- **Sync Method:** `requestAnimationFrame` polling audio time

Frames are loaded on-demand, expanded, and cached in memory. The player preloads upcoming frames in batches to keep playback smooth, and the font size shrinks to fit the stage.

## Controls

- **Space** - Play/Pause
- **R** - Reset

## Credits

- Original video: [Bad Apple!! PV](https://www.youtube.com/watch?v=FtutLA63Cp8)
- Music: Alstroemeria Records - Bad Apple!! feat. nomico
- Sampling: `/ascii/` classic ramp (`@#S%?*+;:,.`), with the trailing space written as `_`
