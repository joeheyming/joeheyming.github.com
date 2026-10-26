# Ralph agent instructions — Paint, as close to PhotoCraft as a browser allows

You are an autonomous coding agent in `/Users/jheyming/git/joeheyming.github.com`.
One iteration. One user story. Then stop.

The goal is to make `paint/` do what PhotoCraft does, as far as a static browser
page can, and to present those commands where PhotoCraft presents them.

A feature counts only when using it changes the picture, the selection, the layer
stack, or the view, and a test asserts that result. A menu label, a tool icon, an
empty panel, or a matching color does not count on its own. Layout is how a person
reaches the command. It is not a substitute for the command.

Similarity means the tools, selections, adjustments, layers, and filters a person
can use and the pixels those actions produce. It does not mean embedding PhotoCraft.

When a current behavior is the MS Paint, JS Paint, or Google Drawings way and
PhotoCraft does it differently, remove the old behavior and implement the
PhotoCraft one. Do not keep both. The browser document format (`.paintproj`)
stays; it is the stand-in for a native file, not a tool to replace.

Tool and history icons are inline SVGs in the Lucide style PhotoCraft vendors
under `assets/icons` (ISC). Do not add a new emoji tool icon. Copy path data
from that folder into `paint/icons.js`. Do not fetch icons at runtime. The
site favicon and the title emoji stay; those are the site convention.

PhotoCraft (`/Users/jheyming/git/photocraft`) is a read-only reference for what a feature
should do. Do not edit it. Do not copy Rust, WASM, egui, or the web build into this
repo. Do not add a server or a bundler. Reimplement the behavior in the existing
canvas app at `paint/`.

## How similarity is measured

`scripts/ralph/parity.json` is the checklist. It is generated from PhotoCraft's menu
catalog (`crates/ui-egui/src/menu_catalog.rs`) and toolbox (`Tool` in
`crates/ui-egui/src/state.rs`) by `scripts/ralph/build-parity.py`. Each item has
`scope` (`in` or `out` of a static page), `impl` (the behavior exists in Paint), and
`done` (the command works and sits where PhotoCraft puts it: same menu path, same
tool group, same panel). The weighted score (menus 60%, tools 40%) is for a
person who asks for it. An iteration does not compute it.

The target is 90% of commands that work. A story's `parity` array names the items
it closes. After the story's test passes, set `done: true` and `impl: true` on
exactly those ids in `parity.json`. Do not run `parity-score.mjs`, `--gaps`, or
`build-parity.py`. A person runs the scorer when they want the number. Never flip
an item the story did not close. Never change `scope`. If an item truly cannot be
done in a browser, leave it, say why in `progress.txt`, and move on.

Breadth before depth. Do not add a story that only refines a tool or dialog that
already works (another crop readout, another ruler option) while any in-scope
parity item is not done. Finish the listed items first.

## Your task

1. Read only the Codebase Patterns section at the top of `scripts/ralph/progress.txt`. Do not read the rest of that file.
2. Load the one open story with the lowest `priority`. Do not read the rest of `scripts/ralph/prd.json`:

```bash
jq '[.userStories[] | select(.passes == false)] | sort_by(.priority) | .[0]' scripts/ralph/prd.json
```

3. Confirm the current git branch is the PRD `branchName`. If you are on `master` or `main`, stop and say so. Do not commit to master.
4. Implement only that story.
5. Run `node --test` on the test file the story names. If it fails, fix the feature and run that file once more. Then stop running commands. If it still fails, leave `passes: false`, append one line to `scripts/ralph/progress.txt`, and stop.
6. Set `passes: true` on that story, set `done` and `impl` on its `parity` ids, append the progress note, and commit the story's files plus `scripts/ralph/prd.json`, `scripts/ralph/parity.json`, and `scripts/ralph/progress.txt`.
7. Do not push. Do not start the next story.

Commit message:

```
feat: [Story ID] - [Story Title]
```

## Quality checks

The only command this iteration runs is the story's own test:

```bash
node --test tests/paint-<story>.test.mjs
```

Run it once at the end. If it fails, fix the feature and run that same file once more. Then no more commands except `git` to commit.

Do not run `npm test`, eslint, prettier, `parity-score.mjs`, or `build-parity.py`. Do not investigate failures outside this test. Match the style already in the file you are editing: single quotes, no trailing commas, semicolons, 100 columns.

Do not add Playwright, `@playwright/test`, `playwright.config.js`, or `tests/e2e/`.
Do not launch a browser. Do not add a browser test under another name.
Verify behavior with `node:test` in `tests/`. Use jsdom only when the story's
acceptance criteria ask for a DOM assertion. Pixel and mask logic must be pure
functions with direct assertions.

Paint is plain JavaScript. Do not add TypeScript. Do not use TypeScript `any`
if you touch a `.ts` file.

## Paint map

Stay inside `paint/` and `tests/` unless a story names another file.

| File                    | Role                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paint/commands.js`     | Command table (id, label, menu path, shortcut, enabled, run) once its story lands. New menu items are commands here, using PhotoCraft's catalog id; do not hand-write menu HTML for them. |
| `paint/adjustments.js`  | Pixel ops and the `ADJUSTMENTS` registry. Filters and adjustments are listed in menus from this registry.                                                                                 |
| `paint/adjust-modal.js` | Dialog for an adjustment id.                                                                                                                                                              |
| `paint/tools.js`        | `TOOLS` and `TOOL_OPTION_SCHEMA`. Selection masks are `Uint8Array` of 0/1, length `W * H`, index `y * W + x`.                                                                             |
| `paint/selection.js`    | Selection state, `applySelectionWithMask`, `selectionToFullMask`, `maskBBox`.                                                                                                             |
| `paint/layers.js`       | Layer records and `BLEND_MODES`.                                                                                                                                                          |
| `paint/paint.js`        | App wiring, keyboard shortcuts, undo.                                                                                                                                                     |
| `paint/index.html`      | Toolbar DOM. The compact nav toggle sits at the top-left; do not cover it with a new control.                                                                                             |
| `paint/style.css`       | App CSS. Match what is already there.                                                                                                                                                     |

Adjustment functions take `(imgData, ...params, mask)` and skip pixels where `mask` is set and `mask[p]` is 0. `mask == null` means the whole image. Register new adjustments on `ADJUSTMENTS` with `label`, `fields`, and `apply`. New layer kinds (group, fill, type, shape, smart object) must load older `.paintproj` files that lack them. Do not start a story while a `passes: false` story has a lower priority number.

Selection tools already share a pattern in `rectSelect` and `lasso`: commit or move on pointer down, build a mask, then either replace `state.sel` or call `state.applySelectionWithMask` when `state.selectionModeFor` returns add/subtract/intersect. New marquees must keep that modifier behavior.

`scanlineFill(path, W, H)` is exported from `paint/tools.js` and passed in as `state.scanlineFill`.

Undo goes through `pushUndo(label)` in `paint.js`. A new command that changes pixels or layers must push undo before the change.

## Browser ceiling

Stay inside what a static page can do with canvas, DOM, and Pointer Events.

The window should look like the PhotoCraft Pro screenshot: charcoal panels
(`docs/ui-design.md`: #323232, accent #378ef0), a short tool column, a control
options bar, and a stack of panel groups down the right. Those colors are
overrides on `.paint-layout`. Do not edit `/brand.css`, and do not restyle the
site nav toggle.

1. A menu bar across the top: File, Edit, Image, Layer, Type, Select, Filter, View, Window, in PhotoCraft's catalog order and labels, with shortcuts shown. (Type and Window appear when their first story lands.) PhotoCraft puts this in the OS menu bar; a browser page has to draw it.
2. A document tab under it: `Untitled-1 @ 100% (RGB/8)`.
3. An options bar of controls (Size, Mode, Opacity, Flow, checkboxes). Never a sentence of instructions.
4. A vertical tool column on the left, one button per PhotoCraft tool group with a flyout for the rest, and foreground and background chips at its foot.
5. The canvas in the center, white, on a darker surround.
6. A right dock, top to bottom: Color | Swatches | Gradients | Patterns, Properties | Adjustments, Navigator | Histogram | Info, History, Layers | Channels | Paths, Brushes. A tab that is still empty is an unfinished command. Its story has to make the panel do the PhotoCraft behavior, not just sit in that slot.
7. A status bar under the canvas with coordinates, document size, and zoom.

The site's compact nav toggle is fixed at the top-left. The menu bar clears it
(padding-left at least 120px on desktop and 100px at 640px and below).

The menu catalog has been marked done. That is not the finish line. A `done`
flag does not mean the control is on screen. Open stories after US-247 are a
short, human-written wave that makes the window usable: Layers height, the
options bar, Properties, Adjustments, Navigator, History, and Brushes. One
story per iteration. New tools take their icon from `paint/icons.js`.

Leave these in PhotoCraft. Do not add stories for them:

- The PhotoCraft WASM or WebGPU build
- PSD and `.pcraft` byte-level round trip
- CMYK, Lab, ICC, and print
- Select Subject and other ML models
- Content-aware fill
- Tear-off floating panels and PhotoCraft's theme switcher. Dragging the borders of the stacked dock groups is in scope.
- Artboards, multi-window layouts, Filter Gallery as a new engine, and any other `scope: out` item unless a human reopens it in `prd.json`

If a story cannot be done with canvas and DOM, leave `passes: false`, say why in
`progress.txt`, and pick a different open story next time. Do not invent a new
story. Do not widen the app into a native port.

## Progress report

Append three lines to `scripts/ralph/progress.txt`. Do not rewrite the file and do not re-read it:

```
## [Date] - [Story ID]
- What the command now does
---
```

Add a Codebase Patterns line only when a later story would get this wrong without it. Do not edit `paint/AGENTS.md` or the repo-root `AGENTS.md`.

## Stop condition

If any story still has `passes: false`, end normally. The next iteration takes the next one.

If every story has `passes: true`, stop. Do not append a story. Do not read
`parity.json` to invent work. Do not emit COMPLETE because the catalog is full.
A person looks at the window and writes the next wave in `prd.json`. Emit:

<promise>COMPLETE</promise>
