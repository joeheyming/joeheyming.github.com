# Ralph loop — Paint, as close to PhotoCraft as a browser allows

PhotoCraft (`/Users/jheyming/git/photocraft`) is a Rust Photoshop reimplementation: 67 tools,
16 adjustment layers, masks, type, vectors, and real PSD files. Paint is a canvas app in
`paint/`. The loop's goal is to make Paint as similar as a static browser page can be:
the tools, selections, adjustments, layers, and filters, the pixels they produce, and the window layout: menu bar, options bar, tool column, canvas, right dock.

It does not embed the PhotoCraft web build (about 24 MB of WASM, WebGPU or WebGL2, a
different UI). PSD byte-fidelity, CMYK, ML select-subject, content-aware fill, and
PhotoCraft's panel shell stay in PhotoCraft.

Each iteration launches a fresh deCLAWd session (sandboxed Claude Code). It implements
one story, tests it, commits on `ralph/paint-photocraft-wave1`, and exits. The next
process reads `prd.json` and `progress.txt`.

## Run wave 1

From the site repo, on `master` with a clean tree besides `scripts/ralph/`:

```bash
chmod +x scripts/ralph/ralph.sh
./scripts/ralph/ralph.sh 12
```

Twelve stories, so pass `12` (the default cap is 10). The script creates
`ralph/paint-photocraft-wave1` from the current branch when you are on `master`.
It will not check out a different branch if you are already on some other feature branch.

Needs `jq` and `declawd` on `PATH`. The loop passes `--yolo`, so Claude can edit, test,
and commit without asking. `--yolo` stays on only while the secure VPN is up; if deCLAWd
voids it, the script exits instead of sitting on permission prompts. PhotoCraft is mounted
with `--additional-workspace` so the agent can read it. The prompt tells it to leave that
repo untouched. The loop does not push.

deCLAWd attaches Claude to a pty, so a stdin redirect never shows up as the prompt.
The loop passes a short `--print` argument that points at `scripts/ralph/prompt.md`.

Other runners:

```bash
./scripts/ralph/ralph.sh --tool claude 12
./scripts/ralph/ralph.sh --tool cursor 12
```

`cursor` is the `agent` CLI. That CLI has its own login (`agent login`); the IDE session
does not count.

Watch progress:

```bash
jq '.userStories[] | {id, title, passes}' scripts/ralph/prd.json
```

## What the open stories are

The first backlog. US-001 through US-004 are done. The rest are still the next edits.

| Story  | PhotoCraft idea    | Where it lands                   |
| ------ | ------------------ | -------------------------------- |
| US-001 | Gaussian Blur      | `ADJUSTMENTS`                    |
| US-002 | Sharpen / unsharp  | `ADJUSTMENTS`, reuses the blur   |
| US-003 | Levels             | `ADJUSTMENTS`                    |
| US-004 | Vibrance           | `ADJUSTMENTS`                    |
| US-005 | Elliptical marquee | `selection.js` + a tool          |
| US-006 | Polygonal lasso    | a tool, existing `scanlineFill`  |
| US-007 | Linear gradient    | a tool                           |
| US-008 | Feather            | hard mask via blur-and-threshold |
| US-009 | Expand / Contract  | dilation / erosion               |
| US-010 | Select menu        | wires 008 and 009                |
| US-011 | Duplicate layer    | layer stack                      |
| US-012 | Merge down         | layer stack                      |

Paint already has pencil, brush, eraser, spray, fill, eyedropper, text, line, rect, ellipse,
rect select, freehand lasso, magic wand, layers with the canvas blend modes, brightness,
hue/saturation, threshold, pixelate, invert, grayscale, sepia, crop, flip, undo, and
PNG/JPEG/project export. Do not rebuild those.

## Measuring similarity

`parity.json` is a checklist of PhotoCraft's 631 menu items and 67 tools, each marked
in or out of scope for a static page, with Paint's status. Seed or refresh it from
the PhotoCraft repo (keeping statuses) and print the score:

```bash
python3 scripts/ralph/build-parity.py --keep
node scripts/ralph/parity-score.mjs          # weighted: menus 60%, tools 40%
node scripts/ralph/parity-score.mjs --gaps   # what is left
```

`done` means the command works and is on screen. The catalog was marked 100%
while the Layers panel was still a short list with its buttons scrolled away, so
a full score is not the finish line. The loop only runs stories that are already
in `prd.json` with `passes: false`. When the queue is empty it stops. A person
looks at the window and writes the next wave; the agent does not invent stories.

## Quality gate

Each iteration runs `node --test` on the story's own test file and nothing else. It does not run `npm test`, eslint, prettier, or `parity-score.mjs`. The scorer is for a person checking the number (`node scripts/ralph/parity-score.mjs`). Two iterations that pass no story stop the script. The loop is forbidden from adding Playwright. See `.cursor/rules/ui-verification.mdc`.
