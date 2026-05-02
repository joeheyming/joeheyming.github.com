# Patches

Each `*.patch` in this directory is a unified diff applied against a
freshly cloned `lazarv/wasm-doom` tree during `npm run build:doom`. They
run in alphabetical order, so prefix with a zero-padded number (`01-`,
`02-`, ...).

## Current set

### `01-modernize-for-current-emcc.patch`

Portability fixes tested on `emsdk 1.39.20` (the pinned toolchain) and
still compatible if you swap up to roughly 2.0.15.

1. Add `UTF8ToString` to the existing
   `-sEXTRA_EXPORTED_RUNTIME_METHODS=['FS', ...]` list in `CMakeLists.txt`
   so that `Module.UTF8ToString(...)` is reachable from the `EM_ASM`
   blocks that rely on it. Without this, the JS throws
   `Module.UTF8ToString is not a function` as soon as music starts.
2. `Module.Pointer_stringify(...)` → `Module.UTF8ToString(...)` across
   `src/i_gif.c`, `src/i_system.c`, `src/i_webmusic.c`, `src/v_video.c`,
   `src/doom/p_inter.c`, and `src/doom/g_game.c`. `Pointer_stringify`
   was deprecated in the 1.39 series and removed in 2.x.
3. In `src/v_trans.h`, the declaration `} cr_t;` (after an anonymous
   enum) was creating a global variable named `cr_t` in every
   translation unit that included the header. The linker refuses it
   under `-fno-common` (which was already the wasm-ld default in
   1.39.20). The fix is the one-word correction to
   `typedef enum { ... } cr_t;` — clearly what was intended.

### `02-disable-demo-playback.patch`

Replaces the four `G_DeferedPlayDemo(...)` calls in
`D_DoAdvanceDemo` (`src/doom/d_main.c`) with a TITLEPIC redisplay so
the attract loop never plays DEMO1/DEMO2/DEMO3/DEMO4. The game sits
on the title screen until the player opens the main menu.

Why this exists: when the attract-loop demos _do_ play, they're
rendered with `deathmatch`, `respawnparm`, `fastparm`, `nomonsters`
and `consoleplayer` all read out of the demo lump header. In our
shipped `doom.wad` those bytes are 0, so in principle it should work —
but somewhere in the demo-playback state machine the HUD ends up in
deathmatch mode (FRAG panel, no starting weapon). Farrelke's original
bundle was quiet on the title screen, never played a demo, so users
only ever saw correct gameplay after they _chose_ New Game. Matching
that behavior here fixes the FRAG-HUD report.

### `03-music-url.patch`

Farrelke's production music redirect, expressed as a proper C patch
against `src/i_webmusic.c`. On non-localhost hosts, the music-file
`fetch()` issued by the substitute-music code path is rewritten to
`https://console-doom.netlify.app<filename>`. Without this, DOOM music
breaks on `joeheyming.github.io` because the `.ogg` files aren't
packed into the WAD — they're served by Farrelke's existing Netlify
instance.

The patch layers on top of `01`, so the context lines match the
post-`01` state (`Module.UTF8ToString`, not `Module.Pointer_stringify`).

### `04-web-key-defaults.patch`

Rebinds the vanilla chocolate-doom key defaults so they match the keys
our `doom/src/index.js` UI actually dispatches:

| action       | vanilla default   | web default |
| ------------ | ----------------- | ----------- |
| forward      | `KEY_UPARROW`     | `'w'`       |
| back         | `KEY_DOWNARROW`   | `'s'`       |
| strafe left  | `','`             | `'a'`       |
| strafe right | `'.'`             | `'d'`       |
| fire         | `KEY_RCTRL`       | `'q'`       |
| use          | `' '` (space)     | `'e'`       |

Without this, pressing `w` did nothing and mouse-click-to-fire (which
dispatches a synthetic `q` keydown on the canvas) never triggered
`key_fire`. Turning with the mouse kept working because `index.js`
emits `ArrowLeft` / `ArrowRight` which already match the unchanged
`key_left` / `key_right` defaults.

## Creating a new patch

```bash
cd ~/git/wasm-doom       # your clean upstream clone

# Reset to upstream, then apply everything we've got so you start from
# "current build state" before layering your change.
git checkout .
for p in /path/to/joeheyming.github.com/doom/build/patches/*.patch; do
  patch -p1 < "$p"
done

# Make your edits.
# ...

# Diff against the state after previous patches and save as a new patch.
git diff > \
  /path/to/joeheyming.github.com/doom/build/patches/NN-your-change.patch

# Reset your working copy so the next build starts clean.
git checkout .
```

Keep patches small and single-purpose.
