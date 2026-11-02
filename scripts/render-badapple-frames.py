#!/usr/bin/env python3
"""Rebuild badapple/frame/*.html from the Bad Apple!! PV.

The player shows white monospace glyphs on black, so this follows
ascii/index.js sampleAndRender: scale each frame with bilinear filtering
to one sample per character cell, map luminance through the classic ramp
(bright pixel -> dense glyph), and size the grid for Courier New.

Courier New and Monaco both advance 0.6em at line-height 1. A 480x360
frame therefore becomes 480 columns by 216 rows — one source pixel per
column, which is the real detail in https://www.youtube.com/watch?v=FtutLA63Cp8
(the upload only goes to 360p). Rows are run-length encoded so the larger
grid stays about the same size as the old 240x84 text.

Usage:
  yt-dlp -f 230 -o pv.mp4 'https://www.youtube.com/watch?v=FtutLA63Cp8'
  python3 scripts/render-badapple-frames.py pv.mp4
"""

import subprocess
import sys
from pathlib import Path

# ascii/index.js CHARSETS.classic, with the trailing space replaced by '_'
# so a dark cell survives HTML whitespace trimming and still reads as empty
# on the black page. Index 0 is the brightest sample.
CHARS = '@#S%?*+;:,._'
CHAR_ASPECT = 0.6
EXPECTED_FRAMES = 6572
EXPECTED_COLS = 480
EXPECTED_ROWS = 216


def probe(video):
    out = subprocess.check_output(
        [
            'ffprobe',
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=width,height,nb_frames',
            '-of',
            'csv=p=0',
            str(video),
        ],
        text=True,
    ).strip()
    width, height, frames = out.split(',')
    return int(width), int(height), int(frames)


def read_exact(stream, size):
    chunks = []
    got = 0
    while got < size:
        chunk = stream.read(size - got)
        if not chunk:
            return None
        chunks.append(chunk)
        got += len(chunk)
    return b''.join(chunks)


def glyph_index(lum):
    if lum < 0:
        lum = 0
    elif lum > 255:
        lum = 255
    # Math.floor(((255 - gray) / 255) * chars.length), clamped.
    index = int(((255 - lum) / 255) * len(CHARS))
    if index >= len(CHARS):
        index = len(CHARS) - 1
    return index


def encode_frame(buf, cols, rows):
    lines = []
    histogram = [0] * len(CHARS)
    for y in range(rows):
        base = y * cols * 3
        runs = []
        run_glyph = None
        run_len = 0
        for x in range(cols):
            i = base + x * 3
            lum = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2]
            index = glyph_index(lum)
            glyph = CHARS[index]
            histogram[index] += 1
            if glyph == run_glyph:
                run_len += 1
            else:
                if run_glyph is not None:
                    runs.append(f'{run_len}{run_glyph}')
                run_glyph = glyph
                run_len = 1
        runs.append(f'{run_len}{run_glyph}')
        lines.append(''.join(runs))
    return '\n'.join(lines), histogram


def main():
    if len(sys.argv) != 2:
        sys.exit('usage: render-badapple-frames.py <video>')
    video = Path(sys.argv[1])
    out_dir = Path(__file__).resolve().parents[1] / 'badapple' / 'frame'
    width, height, frames = probe(video)
    cols = width
    rows = round(cols * (height / width) * CHAR_ASPECT)
    if (cols, rows, frames) != (EXPECTED_COLS, EXPECTED_ROWS, EXPECTED_FRAMES):
        sys.exit(
            f'refused: {video} is {width}x{height}, {frames} frames '
            f'-> {cols}x{rows}. index.html expects '
            f'{EXPECTED_COLS}x{EXPECTED_ROWS}, {EXPECTED_FRAMES} frames.'
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [
            'ffmpeg',
            '-v',
            'error',
            '-i',
            str(video),
            '-vf',
            f'scale={cols}:{rows}:flags=bilinear',
            '-f',
            'rawvideo',
            '-pix_fmt',
            'rgb24',
            '-',
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    frame_bytes = cols * rows * 3
    total = 0
    written = 0
    try:
        while True:
            buf = read_exact(proc.stdout, frame_bytes)
            if buf is None:
                break
            packed, histogram = encode_frame(buf, cols, rows)
            written += 1
            path = out_dir / f'{written}.html'
            text = f'<pre>\n{packed}\n</pre>\n'
            path.write_text(text)
            total += len(text)
            if written in (1351, 3000) or written % 500 == 0:
                counts = ', '.join(
                    f'{CHARS[i]}:{histogram[i]}' for i in range(len(CHARS)) if histogram[i]
                )
                print(f'{written:4d}  {len(text):6d} B  {counts}', flush=True)
    finally:
        proc.stdout.close()
        err = proc.stderr.read().decode('utf-8', 'replace')
        code = proc.wait()
    if code != 0:
        sys.exit(f'ffmpeg failed ({code}): {err.strip()}')
    if written != EXPECTED_FRAMES:
        sys.exit(f'wrote {written} frames, expected {EXPECTED_FRAMES}')
    print(f'wrote {written} frames, {total / 1e6:.1f} MB packed', flush=True)


if __name__ == '__main__':
    main()
