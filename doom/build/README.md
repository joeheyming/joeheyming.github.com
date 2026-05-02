# doom/build

Local build pipeline for regenerating `doom/src/doom.js` and
`doom/src/doom.wasm` from upstream sources. This pipeline produces a
working, reproducible bundle that replaces the previously-shipped
unreproducible Farrelke snapshot.

**This directory is a dev-time tool. Nothing here is deployed to the
static site.** GitHub Pages only serves the artifacts that end up in
`doom/src/` (`doom.js`, `doom.wasm`, `audio-guard.js`, `index.js`).

## Upstream chain

```
joeheyming.github.com/doom/src/doom.js
    ^
    |  rebuilt from source here via `npm run build:doom`
    |
lazarv/wasm-doom       (https://github.com/lazarv/wasm-doom)
    |  single-commit SDL2 + Emscripten port of Chocolate Doom
    v
fraggle/chocolate-doom (the authoritative DOOM port)
```

The bundle that was shipped for years was a prebuilt artifact from
[`farrelke/console-doom`](https://github.com/farrelke/console-doom).
That repo only publishes the compiled `doom.js`/`doom.wasm` — not the
C source Farrelke built from. We now regenerate an equivalent bundle
from `lazarv/wasm-doom@master` (the single upstream commit) with the
three patches in `patches/` applied on top.

## Why emcc 1.39.20 specifically

The pipeline pins Emscripten **1.39.20** (via the `emscripten/emsdk:1.39.20`
Docker image). This matches the era when Farrelke originally compiled
and is the version that produces a gameplay-correct DOOM.

Newer emcc releases (tested with 4.0.23 and `-O2 -fno-strict-aliasing
-fwrapv`) miscompile wasm-doom in a subtle way: the game boots into a
state where the attract-loop demo plays back with `deathmatch=1`, the
HUD shows `FRAG` instead of `ARMS`, and the player has no starting
pistol. The root cause lives somewhere in the interaction between
modern LLVM, emcc's runtime, and wasm-doom's 1993-vintage C. Rather
than chase it, we pin the known-good toolchain.

If you want to retry with a newer emcc, set
`EMSDK_DOCKER_IMAGE=emscripten/emsdk:<version>` and rebuild. Any
version from **1.39.20** up through **2.0.15** should still work;
newer versions reintroduce the FRAG-HUD regression.

## Prerequisites

1. **Docker** (Desktop or Engine). The pipeline runs emsdk inside a
   container so you don't need local clang/lld of any specific
   version, and so builds are byte-reproducible.
2. **wasm-doom source** cloned locally:

   ```bash
   mkdir -p ~/git
   git clone https://github.com/lazarv/wasm-doom.git ~/git/wasm-doom
   ```

   Or point `WASM_DOOM_SRC` at a different path.

## Build

From the repo root:

```bash
npm run build:doom
```

That runs `doom/build/build.sh`, which:

1. Verifies Docker is available.
2. Copies `$WASM_DOOM_SRC` into `doom/build/work/` (fresh every run).
3. Applies every `.patch` in `doom/build/patches/` in alphabetical
   order.
4. Pulls `emscripten/emsdk:1.39.20` (cached after first run) and
   runs `emcmake cmake` + `emmake cmake --build` inside the
   container, against `/src` mounted from `doom/build/work/`.
5. Copies the resulting `doom.js` + `doom.wasm` into `doom/src/`,
   overwriting the checked-in artifacts.
6. Runs `npx prettier --write doom/src/doom.js` so the committed
   diff stays reviewable.

Total wall time on Apple Silicon: ~90 seconds clean (~70s of which
is the build; Rosetta adds a few seconds). Incremental rebuilds are
not supported — the work tree is reset every run.

> The build unconditionally overwrites `doom/src/doom.js` and
> `doom/src/doom.wasm`. Inspect the diff with `git diff doom/src/`
> before committing. To throw away the regen and go back to the
> last committed artifacts:
>
> ```bash
> git checkout -- doom/src/doom.js doom/src/doom.wasm
> ```

## Patches

Live in `doom/build/patches/`, applied in alphabetical order to a
fresh copy of `$WASM_DOOM_SRC` before each build.

- **`01-modernize-for-current-emcc.patch`** — portability fixes that
  stay compatible with emcc 1.39.20:
  - Add `UTF8ToString` to `EXTRA_EXPORTED_RUNTIME_METHODS` in
    `CMakeLists.txt` so the C-level `EM_ASM_` blocks can resolve
    `Module.UTF8ToString` at runtime.
  - `typedef enum { ... } cr_t;` in `src/v_trans.h` — upstream
    declared it as `enum { ... } cr_t;`, which under modern clang's
    `-fno-common` default links as duplicate globals. This trips
    wasm-ld even on 1.39.20.
  - Rename `Module.Pointer_stringify` → `Module.UTF8ToString` in
    every `EM_ASM_` body (`src/i_gif.c`, `src/i_system.c`,
    `src/i_webmusic.c`, `src/v_video.c`, `src/doom/g_game.c`,
    `src/doom/p_inter.c`). `Pointer_stringify` was deprecated in
    1.39 and eventually removed; `UTF8ToString` works everywhere.
- **`02-disable-demo-playback.patch`** — replaces the four
  `G_DeferedPlayDemo(...)` calls in `D_DoAdvanceDemo` with a
  `TITLEPIC` redisplay so the attract loop never plays DEMO1/DEMO2/
  DEMO3/DEMO4. This matches Farrelke's shipped behavior: the game
  sits on the title screen until the player interacts with it.
  Without this patch the game renders the attract-loop demos with
  `deathmatch` and weapon state derived from the demo header bytes,
  which in our WAD produces a disorienting FRAG-HUD + no-pistol view
  that users report as "DOOM is broken".
- **`03-music-url.patch`** — Farrelke's production music redirect,
  expressed as a patch on `src/i_webmusic.c` instead of a post-build
  JS edit. On `localhost` / `127.0.0.1` the music `fetch()` still
  goes to relative paths (so local dev 404s on `/music/*.ogg`); on
  any other host it's rewritten to `https://console-doom.netlify.app/music/*.ogg`
  where Farrelke hosts the OGG files.

See `doom/build/patches/README.md` for authoring notes.

## Runtime patches that live OUTSIDE this build pipeline

`doom/src/audio-guard.js` wraps `AudioContext.prototype.decodeAudioData`
so decode failures don't become unhandled promise rejections. Loaded
from `doom/index.html` before `doom/src/doom.js`. It's intentionally
not a source patch because:

1. It's easier to reason about and lint as plain JS.
2. It survives any upstream rebuild for free.
3. The underlying bug (the bundle calls `decodeAudioData` without an
   error callback) is upstream's problem; we just harden the platform.

## Verification checklist

After a rebuild, confirm in a real browser:

- `doom/` loads with no console errors (the two `/music/*.ogg` 404s
  on `localhost` are benign — see patch 03 above).
- Title screen appears and stays up indefinitely (no auto-demo).
- Pressing Enter opens the main menu (NEW GAME / OPTIONS / …).
- Starting a new game puts you on E1M1 with the pistol auto-equipped
  and the HUD shows `ARMS 2 3 4 5 6 7` (NOT `FRAG`).
- Player can fire the pistol.
- `npx prettier --check doom/src/doom.js` is clean (the build runs
  this automatically).

## Toolchain override

Everything is parameterized via env vars on `build.sh`:

| var                  | default                        | purpose                                  |
| -------------------- | ------------------------------ | ---------------------------------------- |
| `WASM_DOOM_SRC`      | `~/git/wasm-doom`              | clean upstream source tree               |
| `EMSDK_DOCKER_IMAGE` | `emscripten/emsdk:1.39.20`     | pinned Emscripten container              |
