# pacman-infinite — agent context

Living overview of the `/pacman-infinite/` app and the parallel
mobile-parity work in `/pacman/`. Keep this updated when you make
architectural changes so the next agent doesn't have to rediscover
context from chat history.

## What the app is

`/pacman-infinite/` is an endless 3D Pac-Man variant built on three.js
that has evolved into a **survival-runner score-chase**: the farther
you wander from the spawn point, the deadlier the world becomes — but
also the higher the score multiplier on every pickup. The world streams
as procedurally-generated chunks (Minecraft-style), the player can walk
up steps and jump (at a hunger cost), and four ghost personalities
patrol on top of bounded BFS pathing.

Key design pillars:

- **Static-site only.** No backend; everything is HTML/CSS/JS in the
  browser. Persistence is `localStorage`. (See `.cursor/rules/static-site.mdc`.)
- **Chunk-streamed infinite world.** No global level; `Chunk`s load
  and unload around the player within `RENDER_RADIUS`.
- **Unified surface movement.** `FLOOR` and `WALL` tiles are both
  walkable surfaces. `surfaceHeightAt()` returns the top of whatever
  block is at `(x,y)`; Pac-Man auto-steps when `|Δsurface| ≤ 1` and
  jumps when `|Δsurface| ≤ 1 + JUMP_HEIGHT`.
- **Survival = the meta-clock.** Hunger drain + dot scarcity push you
  to keep moving; jumping costs food; power pills cost food on
  activation. There's no idle-immortality.
- **Distance = the difficulty knob.** `world.farPct` (driven by
  Pacman's distance from origin) is folded into ghost speed/count,
  hunger drain, dot density, and the score multiplier via the
  `effective*` helpers on World. Walk far → harder game, richer rewards.
- **Streak = the arcade hook.** Consecutive pickups without taking a
  hit add up to a +2× multiplier on top of the distance multiplier.
  Dying resets it. Encourages clean play.
- **Ghost personalities mirror the original.** Red = direct chaser
  with cruise-elroy speed boost when close; pink = aims 4 tiles
  ahead; cyan = pivots around red for flank; orange = scatters when
  close. Closest 3 ghosts use bounded BFS pathing so cliffs don't
  trap them.
- **`/pacman/` parity.** Any UX or controls fix made here is ported
  to `/pacman/` (sans jump, distance scaling, and ghost personalities,
  which only the open world has).

## File map

```
pacman-infinite/
  index.html              # canvas + start screen + HUD overlay
  style.css               # HUD/start-screen styling + mobile media queries
  js/
    game.js               # main loop, state machine, HUD wiring
    world.js              # chunk loader/unloader, shared materials,
                          # ghost spawning + active rebalancing,
                          # `effective*` helpers (base difficulty mul ×
                          # distance-from-origin penalty), `farPct` and
                          # `scoreMultiplier()`. Maintains a Set of
                          # ghosts and runs BFS-tag + Inky-reference
                          # plumbing per frame.
    chunk.js              # chunk geometry; buildWalls() splits walls
                          # into wallMesh (≤2 high = houses, windowed
                          # texture) and mountainMesh (≥3 high = plain
                          # rock). Top/bottom UVs forced to (0,0) so
                          # window texture never lands on roofs.
    pacman.js             # player movement; update(dt, dir, moveVec?)
                          # — moveVec wins over keyMode (used by
                          # Birds-Eye Follow for any-angle drag).
                          # `invulnerable` is now driven from the live
                          # jump-arc height (>0.5 tiles airborne), not
                          # a flat duration → no more spam-jump i-frames.
    ghost.js              # ghost AI; PERSONALITY constants + per-color
                          # target dispatch (Blinky/Pinky/Inky/Clyde),
                          # cruise-elroy speed boost for Blinky,
                          # bounded BFS pathing (`_bfsNextStepToward`)
                          # cached for ~0.4 s per goal.
    fruit.js              # FRUIT_TYPES (cherry/strawberry/orange/apple/
                          # lemon/skull-fruit) each with scoreValue,
                          # foodValue, weight, minFarTiles. Distance-
                          # weighted pickFruitTypeForDistance().
    constants.js          # MAP / WORLD / DIFFICULTY tunables. Per-
                          # difficulty: ghostSpeedMul, ghostCountMul,
                          # ghostChaseRadiusMul, hungerDrainMul,
                          # dotKeepMul, fruitSpawnPeriodMul,
                          # powerModeDurationS, fleeSpeedMul,
                          # jumpCooldownMul, ghostMinSpawnDistMul,
                          # foodPerDotMul.
    controls.js           # keyboard + unified touch joystick + FPPOV
                          # twin-stick + double-tap-to-jump
    camera.js
    audio.js
    save.js               # localStorage persistence
    prng.js               # seeded Mulberry32 for chunk reproducibility
    templates.js          # chunk template catalog
    game-state.js         # difficulty sync (_syncWorldDifficulty),
                          # _addScore (folds distance × streak),
                          # _bumpStreak / _resetStreak.
    game-spawn.js         # dot/pill/ghost/fruit pickup handlers; uses
                          # pickFruitTypeForDistance for spawn variety.
    game-input.js         # tryJump deducts FOOD_PER_JUMP food after
                          # the underlying pacman.tryJump() succeeds.
    game-hud.js           # FAR / MULT / STREAK readouts + on-screen
                          # ghost-proximity arrow markers (pooled in
                          # #ghost-indicators overlay) in addition to
                          # score / lives / hunger / power timer.
```

`/pacman/` mirrors the same structure minus chunks/jump.

## Controls scheme (read before touching `controls.js`)

### Camera modes

`KEY_MODE` determines how arrow/WASD input maps to world motion:

| Camera mode             | `KEY_MODE` | Notes                                |
|-------------------------|------------|--------------------------------------|
| 0 — Top-Down            | `PERP`     | World-aligned (W=north etc.)         |
| 1 — Birds-Eye Follow    | `PERP`     | Same; prefer `getMoveVector()` for   |
|                         |            | continuous angle in this mode        |
| 2 — First Person (FPS)  | `STRAFE`   | Relative to facing                   |

Birds-Eye Follow uses `KEY_MODE.PERP` (NOT `STRAFE`). It used to use
`STRAFE` plus a hidden auto-walk that forced `direction = 'up'` when
no input was detected; that combination made every direction except
up read as "reversed". Both were removed — do not re-introduce.

### Mobile touch

The canvas itself is the input surface (no D-pad). In `controls.js`:

- `setupCanvasJoystick()` handles all pointer events.
- For Top-Down / Birds-Eye Follow: a single pointer becomes a free
  joystick. Its delta updates both `_touchKeys` (4-way snap, fed
  through `updateDirection()` for tile-aligned modes) and
  `_joystickVec` (continuous angle, returned by `getMoveVector()`).
- For FPPOV on `pointerType === 'touch'`: twin-stick split. Left half
  of the canvas owns `_fpsWalkPointer` (drives W/A/S/D); right half
  owns `_fpsLookPointer` (drag deltas → `addYaw` / `addPitch`).
  Desktop mouse-look (`onMouseMove`) is preserved because the
  twin-stick branch is gated to `touch` only.
- Double-tap-to-jump: two non-dragging pointer-ups within 320 ms and
  22 px trigger `game.tryJump()`. Excluded in FPPOV.

The `getMoveVector()` method returns `_joystickVec` if active, else
an 8-way normalized vector derived from keyboard `keys`. `game.js`
passes it through to `pacman.update(dt, direction, moveVec)` in
Birds-Eye Follow so drags can hit any angle.

### Mobile scroll-prevention

Pages explicitly set:

- `overscroll-behavior: none` on `html`/`body` (style.css).
- `touch-action: none` on `#game-container` and its `canvas` (CSS +
  JS sets `renderer.domElement.style.touchAction = 'none'`).
- `ev.preventDefault()` in `pointerdown` / `pointermove`.

Without all three, mobile browsers add scrollbars during Birds-Eye
drag.

## Mobile layout invariants

Tested in playwright at portrait 390×844 and landscape 667×375 (and
844×390 for layout math). Do not regress these:

- **Back button.** `<script src="/back.js" data-back-size="compact">`
  renders at `top/left ≈ 8–12px`, ~90 px wide once "← Back" text is
  visible. The mobile `#hud { padding-left: 108px }` rule in both
  apps' `style.css` is what keeps SCORE from sliding under it. The
  earlier `padding-left: 8px` collapsed that clearance — do not
  re-introduce a small value.
- **`/pacman/` bottom-right is congested.** `share.js` (driven by
  `apps-registry.json`) renders the 🎯 related-projects toggle at
  bottom-right whenever the current path's `app.related` is set. To
  avoid overlap with VIEW/PAUSE, `controls.js` positions
  `#touch-controls` at `bottom: 144px; right: 12px`. `/pacman-infinite/`
  has the same widget now too, so this matters for both apps.
- **Start-screen difficulty row.** Use `flex-wrap` + smaller text on
  narrow viewports (Press Start 2P is wide; the three pills + label
  overflow a 390-wide portrait without wrapping).

## Difficulty + survival systems (read before retuning)

Two layers of multipliers stack to produce the live game tuning:

1. **Base preset** — chosen by the player on the start screen
   (`DIFFICULTY_PRESETS` in `constants.js`). Exposes per-system
   multipliers + a few absolute overrides (e.g. `powerModeDurationS`,
   `jumpCooldownMul`). `gameState._syncWorldDifficulty()` mirrors
   every relevant field onto `world.difficulty.*` so consumers don't
   have to re-import the preset.

2. **Distance penalty** — `world.farPct` (0..1) is updated each frame
   from Pacman's distance from origin via `world.updateFarProgress()`
   in `game.js`. The `world.effective*` helpers (`effectiveGhostSpeedMul`,
   `effectiveHungerDrainMul`, `effectiveDotKeepMul`,
   `effectiveGhostCountMul`) fold farPct on top of the base mul so
   ghost AI / hunger / dot density / spawn cap all scale with how
   deep you've wandered. `world.scoreMultiplier()` returns the matching
   1× → 5× score-side reward.

   **Always go through `effective*()` for live tuning, never read
   `world.difficulty.X` directly** — otherwise the distance penalty
   silently doesn't apply.

3. **Streak (arcade overlay)** — `game._dotStreak` increments on every
   dot/pill/fruit pickup, resets on any death cause (ghost, starvation,
   void). `_addScore(base)` folds (distance multiplier × streak
   multiplier) onto every score event so streak and distance compound
   into the final per-pickup payout.

### Ghost personalities + pathing (Tier 2 architecture)

`ghost.js` exports `PERSONALITY = { BLINKY, PINKY, INKY, CLYDE }` and
maps colour index → personality via `PERSONALITY_BY_COLOR_IDX`. Each
ghost's `_personalityTarget(pacmanPos, ctx)` returns the *target tile*
its CHASE state aims for:

- BLINKY → Pacman's tile (direct chase) + cruise-elroy speed boost in
  `_stepTowardTarget` when within `CRUISE_ELROY_RADIUS_TILES`.
- PINKY → 4 tiles ahead of Pacman's facing.
- INKY  → pivots `(2 tiles ahead of Pacman)` around Blinky for a flank
  target; degrades to Pinky-lite when no Blinky exists.
- CLYDE → Pacman's tile when far, `null` (random scatter) when close.

`world.update()` builds the per-frame ctx exactly once: Pacman's tile +
facing + the closest live Blinky's tile. It also tags the
`BFS_NEAREST_GHOST_COUNT` (3) closest ghosts with `useBfs: true` —
those run a bounded BFS (`_bfsNextStepToward`) up to
`BFS_MAX_RADIUS_TILES` and `BFS_MAX_NODES`, cached for
`BFS_CACHE_TTL_S` so consecutive tile-arrivals don't repeat the work.
Far ghosts fall back to greedy nearest-neighbour selection.

### Active spawn rebalancing

`world._tickGhostSpawning` counts ghosts within chase radius before
each spawn attempt. If fewer than `NEAR_GHOST_TARGET_FRACTION × cap`
ghosts are nearby, the spawn passes `tighten: true` to
`_pickGhostSpawnTile` which halves the minimum spawn distance for
that one attempt. Keeps pressure constant if the previous chasers
just despawned out of range.

### Fruit family + distance gating

`fruit.js#FRUIT_TYPES` carries six entries (cherry, strawberry, orange,
apple, lemon, skull-fruit). Each has `scoreValue`, `foodValue` (negative
for skull-fruit — eating it BURNS food), `weight`, and `minFarTiles`.
`pickFruitTypeForDistance(farTiles, farCap)` filters by `minFarTiles`
and tilts weights so rarer fruits become MORE common at high farPct.
Skull-fruit is gated to 300+ tiles and is the highest-payout item in
the game.

### On-screen ghost proximity arrows

`game-hud.js#_refreshGhostIndicators()` runs every frame from
`game.js` and maintains a pool of arrow markers inside the
`#ghost-indicators` full-viewport overlay. One marker per non-FLEE/
non-EATEN ghost within `GHOST_WARN_WATCH_TILES` (12 tiles); markers
are placed by projecting each ghost's world position through
`game.camera`, clamping off-screen projections to a screen-edge
ellipse at `MARKER_EDGE_INSET` (0.92 of viewport half-extent), and
rotating the `➤` glyph so it points AT the threat from screen centre.

Three tiers (per-ghost world-tile distance to Pacman):

- `warn-watch`    — ≤ 12 tiles → yellow, no pulse
- `warn-danger`   — ≤  8 tiles → orange, slow pulse
- `warn-imminent` — ≤  5 tiles (`GAMEPLAY.DANGER_WARNING_RADIUS`) →
  red, fast pulse + larger glyph

Watch radius (12 tiles) is local to `game-hud.js` as
`GHOST_WARN_WATCH_TILES`; the imminent threshold deliberately reuses
the long-defined `DANGER_WARNING_RADIUS` so both stay coupled.

Marker positioning uses CSS custom properties (`--marker-x`,
`--marker-y`, `--marker-rot`) set on each marker every frame. The
keyframe pulse animation sits on the marker's `transform` and
re-emits the full `translate(...) rotate(...) scale(...)` chain so
the JS-driven position survives the animation — ALL marker geometry
flows through one composite transform, never `left`/`top`/separate
transforms, so the GPU can flip them in one pass.

Behind-camera projection (Three.js NDC `z > 1`) inverts x/y due to
the perspective divide; we flip them back AND bias `ny` negative so
behind-camera ghosts land in the lower half of the screen. Without
the bias, an axially-behind ghost projects to (0,0) and the marker
would sit dead-centre — useless as a "look behind you" cue.

Markers are pooled (`game._ghostMarkerPool`) and grown on demand.
Per-frame work: claim N markers (one per active threat), set their
custom-property triple, hide any unused pool slots. No DOM creation
in steady state, no per-frame allocations beyond a single shared
`Vector3` for projection.

The entire layer is forced hidden during non-PLAYING states, while
Pacman is dead, and during power mode (he's the predator there —
flashing arrows at fleeing ghosts would read backwards).

## Past issues + fixes (avoid repeating)

| Symptom                                                         | Root cause                                                          | Fix                                                                                       |
|-----------------------------------------------------------------|---------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| Window texture appeared on tops of wall blocks.                 | Default UVs sampled the windowed face on all sides.                 | `chunk.js: buildWalls()` forces top/bottom UVs to `(0,0)` for the windowed house meshes.  |
| House vs mountain texture swapped.                              | Wall-height threshold inverted.                                     | `HOUSE_MAX_STACK = 2`; ≤2 high → `wallMaterial` (windows), ≥3 → `mountainMaterial`.       |
| Ghost spawned mid-power-pill wasn't blue.                       | `_tickGhostSpawning` didn't know Pac-Man was powered.               | `world.update(dt, pacmanPos, powerInfo)` plumbed; new ghost calls `enterFlee(remaining)`. |
| Birds-Eye Follow only worked when pressing "up".                | `KEY_MODE.STRAFE` + hidden auto-walk forcing `direction='up'`.      | Use `KEY_MODE.PERP` and remove the auto-walk branch in `game.js`.                          |
| Birds-Eye Follow scrolled the mobile page instead of moving.    | Default touch handling.                                             | `touch-action: none`, `overscroll-behavior: none`, `ev.preventDefault()` in handlers.     |
| Birds-Eye Follow only moved at 90° increments.                  | Movement was derived from 4-way `_touchKeys` only.                  | Added `_joystickVec` + `getMoveVector()`; `pacman.handleMovement` honors `moveVec`.       |
| FPPOV unusable on phones.                                       | `cycleCamera()` used to skip mode 2 on `isMobile`.                  | Removed the skip; added twin-stick (`_fpsWalkPointer` / `_fpsLookPointer`).                |
| `Unexpected identifier 'bottom'` after editing controls.js.     | CSS comment containing back-ticks inside a JS template literal.     | Don't put `` ` `` inside the inline `<style>` template literal in `setupCanvasJoystick()`. |
| Playwright `eval` raised "execution context destroyed".         | Page redirected to `/play/accordion/` between calls.                | Re-navigate explicitly with `playwright-cli goto <url>` before any subsequent `eval`.     |
| `apps-registry.json` edits didn't show in an open tab.          | `app.js` / `share.js` load it via sync XHR with no cache-buster.    | Hard-reload the tab (or open a fresh one) after editing the registry.                     |
| `effectiveHungerDrainMul()` returned NaN.                       | `_syncWorldDifficulty` didn't copy `hungerDrainMul` onto `world.difficulty` (it used to be read off the preset directly). | When adding a new `effective*()` helper that reads `world.difficulty.X`, also add `world.difficulty.X = preset.X` to `_syncWorldDifficulty` in `game-state.js`. |
| Eating a power pill stacked free combos with no downside.       | Pill activation only ADDED food, never spent any.                   | `FOOD_POWER_PILL_COST = -10` in `constants.js`; `game-spawn.js` adds `FOOD_PER_POWER_PILL + FOOD_POWER_PILL_COST` so the net is +15, not +25. |
| Hard mode wasn't actually hard — ghost speed 39 vs Pacman 40.   | `ghostSpeedMul: 1.15` left ghosts strictly slower in straight lines. | Bumped Hard's `ghostSpeedMul` to 1.25 so chase speed (~42.5) exceeds Pacman's 40 and a clean line of sight will catch him. Distance penalty stacks on top via `effectiveGhostSpeedMul()`. |
| Spam-jumping was a free 0.4 s panic-evade with i-frames.        | `tryJump()` set `invulnerable=true` for the entire arc.             | `pacman.js#update` now derives `invulnerable` per frame from `sin(πt) × JUMP_HEIGHT > 0.5` so only the apex of the arc grants pass-through; takeoff/landing are vulnerable. Plus `FOOD_PER_JUMP=2` ties jumps to the hunger budget. |

## Registry integration

`/pacman-infinite/` is registered in `/apps-registry.json` as
`pacman-infinite` with `category: "game"` and a `related` list of
`[pacman, doom, nes, minesweeper]`. `/pacman/`'s `related` reciprocates
with `pacman-infinite` first. This is what makes:

- the home page (`/index.html` via `app.js → AppModule.getAllApps()`)
  list Pac-Infinite in the Games gallery, and
- `share.js` show the 🎯 related-projects toggle on both pages.

If you add another companion app, register it the same way and
update both `related` lists so the cross-link is symmetric.

## Testing recipe (playwright-cli)

```bash
# Portrait phone
playwright-cli resize 390 844
playwright-cli goto "http://127.0.0.1:8765/pacman-infinite/index.html"

# Landscape phone (≤768 wide so the mobile @media triggers)
playwright-cli resize 667 375

# Force-start a run from the page (skips menu + intro)
playwright-cli eval "() => { window.game.startGame(); return window.game.state; }"
```

Playwright's pointer is `pointer: fine`, so the `(pointer: coarse)`
half of `@media (max-width: 768px), (pointer: coarse)` never fires.
Test mobile CSS at viewports ≤768 wide; for real-phone landscape
(844×390) verify with a manual device check or force
`#touch-controls.style.display='flex'` via `eval` and read rects.
