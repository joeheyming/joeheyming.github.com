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
- **Unified surface movement.** `FLOOR`, `WALL`, and the three
  hazards (`WATER`/`LAVA`/`MUD`) are all walkable surfaces.
  `surfaceHeightAt()` returns the top of whatever block is at `(x,y)`;
  Pac-Man auto-steps when `|Δsurface| ≤ 1` and jumps when
  `|Δsurface| ≤ 1 + JUMP_HEIGHT`. Whether a tile is *safe* to step on
  is a separate concern handled by `pacman._reactToTileUnderFeet`
  (Pacman) and `world.isGhostPassable` (ghosts).
- **Asymmetric hazards.** Off the central cross corridor, chunks can
  spawn `WATER` (Pacman drowns after `BREATH_MAX_S`; ghosts float over),
  `LAVA` (Pacman dies instantly; ghosts can't enter — the only reliable
  ghost barrier), and `MUD` (slows both Pacman AND ghosts; no damage).
  Hazards never land on the cross, so traversal between chunks stays
  guaranteed-safe.
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
                          # foodPerDotMul, hazardDensityMul,
                          # crossDotKeepMul (cross corridor density —
                          # 1.0 on Easy/Normal, 0.5 on Hard).
                          # TILE.WATER/LAVA/MUD codes are re-exported
                          # from world-config.js HAZARDS so the registry
                          # is the single source of truth.
    world-config.js       # Data-driven registries: HAZARDS (tile codes
                          # + Pacman/ghost effects + materials), METERS
                          # (breath today; heat/cold/… via one entry),
                          # WALL_KINDS (house/mountain/obsidian/ice/glass
                          # + pickWallKindId selector), DEATH_MESSAGES
                          # (respawn-overlay copy keyed by death cause).
                          # Adding a new hazard / wall kind / meter is
                          # a one-file edit here.
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

- **Back button.** `<script src="/nav.js" data-nav-size="compact">`
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
   `effectiveGhostCountMul`, `effectiveHazardDensityMul`) fold farPct on
   top of the base mul so ghost AI / hunger / dot density / spawn cap /
   hazard biome odds all scale with how deep you've wandered.
   `world.scoreMultiplier()` returns the matching 1× → 5× score-side
   reward.

   Difficulty spread at `farPct=0.5` after the 2026-05 retune
   (see `DIFFICULTY_PRESETS` in `constants.js`):

   |                       | Easy  | Normal | Hard  |
   |-----------------------|-------|--------|-------|
   | dotKeepEff (× base)   | 1.30  | 0.65   | 0.12  |
   | crossDotKeepMul       | 1.00  | 1.00   | 0.35  |
   | fruitSpawnPeriodMul   | 0.45  | 1.00   | 1.70  |
   | foodPerDotMul         | 1.40  | 1.00   | 0.40  |
   | hazardDensityMulEff   | 0.44  | 1.25   | 2.00  |

   The dotKeep gap is now ~11× off-cross plus a ~3× cross-corridor
   thinning on Hard (so the iconic dot trail also reads as sparse
   stepping-stones, not a contiguous lane), fruit cadence ~3.8×,
   food-per-dot ~3.5×, hazard density ~4.5×. On Hard the off-cross
   density typically clamps to the 5% floor in `world._makeChunk`, so
   most chunks read as "open arena with a few stray dots" — combined
   with `foodPerDotMul: 0.4` the player can't graze their way to
   immortality. Easy plays generously; Hard is a genuine
   food-scarcity survival run.

   **Always go through `effective*()` for live tuning, never read
   `world.difficulty.X` directly** — otherwise the distance penalty
   silently doesn't apply.

3. **Streak (arcade overlay)** — `game._dotStreak` increments on every
   dot/pill/fruit pickup, resets on any death cause (ghost, starvation,
   void). `_addScore(base)` folds (distance multiplier × streak
   multiplier) onto every score event so streak and distance compound
   into the final per-pickup payout.

### Config-driven world (read before adding any new tile/wall/meter)

Hazards, drain meters, wall flavours, and death-overlay copy are
declared once in **`js/world-config.js`** and consumed by everything
else through small lookup loops. Adding a fourth hazard, a third drain
meter, or a sixth wall kind is a one-file edit. The four registries
are:

| Registry         | What it controls                                          | Consumers                                                            |
|------------------|-----------------------------------------------------------|----------------------------------------------------------------------|
| `HAZARDS`        | Tile codes 7+ with side-effects; Pacman + ghost behaviour | `world.hazardAt`/`isGhostPassable`, `pacman._reactToTileUnderFeet`, `ghost._stepTowardTarget`, `chunk.buildHazards`, `world-assets.js` |
| `METERS`         | Drain/refill timers with optional kill-on-zero (breath today) | `game-state._tickMeters`, `game-hud._refreshMetersHud`, `pacman._activeMeters` |
| `WALL_KINDS`     | Pluggable wall flavours; height-fallback + biome override | `chunk.buildWalls`, `world-assets.js`, `pickWallKindId()` helper     |
| `DEATH_MESSAGES` | Respawn-overlay copy keyed by death cause                 | `game-hud._deathMessage`/`_applyDeathMessage`                        |

#### HAZARDS

Each entry: `{ id, tileCode, pacman: { speedMul, lethal, deathCause, drainMeter }, ghost: { speedMul, blocked }, material, slabThickness?, pacmanSink? }`.

Today's three entries:

| id    | Code | Pacman effect                                          | Ghost effect                                    | Visual           | Wall kind override (biome-tagged) |
|-------|------|--------------------------------------------------------|-------------------------------------------------|------------------|-----------------------------------|
| water | 7    | wade at 0.55× speed; drains `breath` meter → drown     | freely passable (float over)                    | half-tile pit    | `ice` (in `biomeLake`)            |
| lava  | 8    | instant death (`die('lava')`)                          | **blocked** (lava is the one reliable ghost barrier) | half-tile pit | `obsidian` (in `biomeLavaFlow` + `biomeVolcano`) |
| mud   | 9    | 0.6× speed; no damage                                  | 0.6× speed via `spec.ghost.speedMul`            | flat surface     | —                                 |

##### Sunken-hazard model — Pacman literally drops in

Water and lava are **real pits** — Pacman's `tileHeight` actually
goes negative when he steps into one, and he physically falls in.
The auto-step (|Δh| ≤ 1) handles the descent **and** the climb-out:
a 0.5-deep pool is a 0.5-tile step in either direction, so wading
back to adjacent floor is automatic. Climbing **out** of a pit onto
a tall wall (Δh = 1.5) requires a jump — wading slows your escape.

Two fields on the HAZARDS spec drive the look + feel:

- `slabThickness` — fraction of `scale` for the slab's vertical
  extent. The top sits at `h * scale + 0.02` (flush with the
  surrounding floor's top edge); bigger values just extend the slab
  _downward_ to fill a pit. Water/lava use `0.5` (half-tile-deep
  pool); mud uses `0.18` (thin puddle on the surface).
- `pacmanSink` — how far Pacman's surface drops below the floor edge
  when standing on this hazard, in tile units. **This is a real
  height drop**, not a render offset. Water/lava use `0.5` so Pacman
  wades half a tile below the floor edge (reads as chest-deep);
  mud uses `0` (he stands on top, no dip). The drop flows through
  `world.pacmanSurfaceHeightAt → pacman.tileHeight → smoothHeight →
  position.z` so the standard step-lerp eases the descent.

Ghosts deliberately read `surfaceHeightAt` (floor-edge) instead of
`pacmanSurfaceHeightAt`, which is what keeps them "floating over"
water at floor level even though Pacman drops in — that asymmetry
is what makes water a Pacman-specific hazard.

Both fields are entirely registry-driven: adding "tar pit —
knee-deep slow plus damage" is `slabThickness: 0.7, pacmanSink: 0.7`
plus the usual `pacman.speedMul`/`drainMeter` fields. No renderer or
Pacman code changes.

#### METERS

Each entry: `{ id, max, drainPerS, refillPerS, deathCause, hudId, hudBarId, label, lowFrac }`.

`pacman._activeMeters: Set<meterId>` is populated by
`_reactToTileUnderFeet` based on `HAZARDS[…].pacman.drainMeter`.
`game-state._tickMeters(dt)` iterates `METERS` once per frame, drains
active ones, refills inactive ones, and routes meter-empty through
`_loseLife(meter.deathCause)`. `game-hud._refreshMetersHud()` drives
every bar from the same loop — show while active OR `< max`, with the
`.low` class when below `lowFrac`. Adding a "heat" meter near lava is
a new METERS entry + a new HAZARD entry pointing `drainMeter: 'heat'`
plus a `<div id="heat-meter">` in `index.html`. No JS changes.

#### WALL_KINDS

Each entry: `{ id, stackRange: [min,max], material: {...}, textureId?, repeatVerticalUV?, default? }`.

Selection per WALL tile (`chunk.buildWalls`):

1. **Per-chunk override** wins — biomes set `template.wallKind` and the
   chunk constructor reads it. `biomeVolcano` and `biomeLavaFlow` set
   `'obsidian'`; `biomeLake` sets `'ice'`.
2. **Height fallback** — first FALLBACK-eligible kind whose
   `stackRange` contains the tile's stackUnits. `FALLBACK_WALL_KIND_IDS
   = ['house','mountain']` so override-only kinds (obsidian, ice, glass)
   never get picked accidentally by a non-volcanic biome.
3. **Default-of-last-resort** — the entry with `default: true`
   (`'mountain'`).

| id        | stackRange | Look                                                 | Notes                                           |
|-----------|------------|------------------------------------------------------|-------------------------------------------------|
| house     | [1, 2]     | Windowed buildings (procedural canvas texture)       | repeatVerticalUV: one storey per stackUnit      |
| mountain  | [3, 99]    | Rocky grey                                           | `default: true` — last-resort fallback          |
| obsidian  | override   | Black with red emissive cracks                       | Auto-picked by lava biomes via biome `.wallKind` |
| ice       | override   | Translucent cyan with soft blue glow                 | Auto-picked by `biomeLake`                       |
| glass     | override   | Transparent see-through                              | Free for future puzzles; no biome uses it yet   |

#### DEATH_MESSAGES

`{ title, flavour, final }` per cause. Built-ins: `'ghost'`,
`'starvation'`, `'void'`. Hazard tiles supply their own causes via
`HAZARDS[…].pacman.deathCause` (`'lava'`). Meter exhaustion uses
`METERS[…].deathCause` (`'drown'`). When adding a new cause, just add
the registry entry — `getDeathMessage(cause)` falls back to `'ghost'`
copy if you forget.

### Hazard biomes + invariants

Hazard biomes live in `templates.js`, tagged with `.isHazard = true`
and `.minFarTiles` (distance gate), and optionally `.wallKind` (set on
the template returned by `buildTemplate`):

- `biomeLake` (≥ 20 tiles) — WATER pool in a quadrant; `wallKind: 'ice'`
- `biomeRiver` (≥ 40) — 3-wide WATER ribbon + 1 stepping stone
- `biomeLavaFlow` (≥ 80) — two LAVA stripes in a corner; `wallKind: 'obsidian'`
- `biomeVolcano` (≥ 150) — central elevated cone + LAVA pools in 4 corners; `wallKind: 'obsidian'`
- `biomeSwamp` (≥ 0) — speckled MUD across the interior
- `biomeMixedHazard` (≥ 200) — WATER + LAVA in opposite quadrants

`buildTemplate({ hazards: { water: [...], lava: [...], mud: [...] }, wallKind, ... })`
takes a generic hazard-rects map keyed by registry id. Unknown ids are
silently skipped (defensive against typos) — the hazard tile codes are
looked up via `HAZARD_CODE_BY_ID`.

`generateChunk(rng, { farTiles, hazardMul })` runs a two-stage gate:
distance filter, then a single rng() draw for "hazard vs safe biome"
scaled by `effectiveHazardDensityMul()` (base preset ×
`(1 + 0.5 × farPct)`). At normal/origin ~40% of hazard-eligible chunks
are hazardous; on easy ~14%, on hard far up to a 0.9 cap.

**Cross-corridor invariant.** `stampHazard()` in `buildTemplate()`
skips any cell on `row === CENTER` or `col === CENTER`, so a chunk
can be 60% lava and the cross-corridor is still a safe traversal
route between adjacent chunks. This loop is generic — every hazard
in `HAZARDS`, including future additions, inherits the invariant
automatically.

### How to add a new hazard / wall kind / meter (one edit each)

**New hazard** (e.g. "ice patch — slippery 1.5× momentum, kills
ghosts on contact"):

1. Add a `HAZARDS.icePatch` entry to `world-config.js` with the
   tileCode, pacman/ghost effects, and material spec. Optionally set
   `slabThickness` + `pacmanSink` if you want it to render as a
   sunken pit (water/lava use `0.5` for both); omit for a flat
   surface puddle like mud.
2. Add a biome to `templates.js` that emits `hazards: { icePatch: [...] }`
   in its `buildTemplate` call (optionally set `wallKind`).
3. Add the biome to the `BIOMES` array with `.isHazard = true` and a
   `.minFarTiles` gate.

No other files need to change. `chunk.buildHazards`,
`world.hazardAt`, `pacman._reactToTileUnderFeet`,
`ghost._stepTowardTarget`, and `world-assets.js` all iterate the
registry and pick up the new entry.

**New wall kind** (e.g. "crystal — purple emissive, picked by a new
biome"):

1. Add a `WALL_KINDS.crystal` entry to `world-config.js` (material
   spec + optional `textureId`/`repeatVerticalUV`). Don't add it to
   `FALLBACK_WALL_KIND_IDS` unless you want it eligible for the
   height-based pick.
2. Tag a biome's template with `wallKind: 'crystal'` to use it.
3. (Optional) If you want it to participate in the procedural canvas
   texture system, add a factory entry to `TEXTURE_FACTORIES` in
   `world-assets.js`.

`chunk.buildWalls` and `world-assets.js` iterate `WALL_KINDS` so the
new kind renders without any further changes.

**New meter** (e.g. "heat — drains near lava, kills via heatstroke"):

1. Add a `METERS.heat` entry to `world-config.js` with drain/refill,
   `deathCause: 'heatstroke'`, and `hudId`/`hudBarId`.
2. Add a `DEATH_MESSAGES.heatstroke` entry for the overlay copy.
3. Add a `<div id="heat-meter">…<div id="heat-bar">` to `index.html`.
4. Wire a hazard's `pacman.drainMeter: 'heat'` (e.g. a future "near
   lava" radius effect, or directly on the lava tile spec).

`game.js` registers the HUD elements automatically from `METERS`.
`game-state._tickMeters` and `game-hud._refreshMetersHud` iterate the
registry and handle the new meter without code changes.

### Hazard runtime plumbing (registry consumers)

- `world.surfaceHeightAt(gx, gy)` treats hazards as walkable (returns
  finite height). Pacman + ghost movement use this for the |Δh| ≤ 1
  auto-step check.
- `world.hazardAt(gx, gy)` returns the **HAZARDS spec** (full object)
  or `null`. Use `.id` for the kind name or `.tileCode` for the raw
  number; consumers don't need a second lookup to read effects.
- `world.isGhostPassable(gx, gy)` packs the finite-surface check AND
  the `spec.ghost.blocked` rejection so `ghost._reachableNeighbors()`
  and the bounded BFS in `_bfsNextStepToward()` agree on what counts
  as ghost territory.
- `pacman._reactToTileUnderFeet(gx, gy)` looks up the HAZARDS spec
  and applies `pacman.lethal` (→ `die(spec.deathCause)`),
  `pacman.drainMeter` (→ `_activeMeters.add(id)`), and
  `pacman.speedMul` (→ `_hazardSpeedMul`). Adding a new hazard never
  requires touching this function.
- `ghost._stepTowardTarget` reads `world.hazardAt(…)?.ghost?.speedMul`
  for tile-level slowdown so any future "slows ghosts" hazard is one
  registry edit.
- `game-state._tickMeters(dt)` iterates `METERS` every PLAYING
  frame after `_tickHunger`. Drain when `pacman._activeMeters.has(id)`,
  refill otherwise. Hitting 0 routes through `_loseLife(deathCause)`.
- `game-hud._refreshMetersHud()` iterates `METERS` and shows each bar
  while active OR while `value < max` (so the player sees recovery
  progress). Cached DOM lookups via `game.meterElements: Map<id, {wrap, bar}>`.
- `world.randomLoadedFloor()` filters to `TILE.FLOOR` only — keeps
  respawns and fruit spawns hazard-safe by construction.

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
| Hazard biome disconnected a chunk's cross corridor.             | Generator stamped a hazard over the cross during the elevation pass. | `stampHazard()` in `templates.js#buildTemplate` skips any cell on `row === CENTER` or `col === CENTER`. The stamp loop now iterates the generic `hazards` map so every HAZARDS entry — current or future — inherits the invariant automatically. Always go through `buildTemplate({ hazards: {...} })` rather than writing into the map directly. |
| Ghosts walked into lava and stood there forever.                | `_reachableNeighbors` and `_bfsNextStepToward` used the same `surfaceHeightAt` finite check Pacman uses, which lets lava through. | `world.isGhostPassable(gx, gy)` combines the finite-surface check AND `HAZARDS[…].ghost.blocked` rejection; both ghost pathing call sites use it. Marking a new hazard as ghost-impassable is one `blocked: true` flag in `world-config.js` — no pathing code edits needed. |
| Drown / lava death showed the "FELL INTO THE VOID" overlay.     | `_enterDeath()` always hardcoded `cause = 'void'`.                  | `Pacman.die(cause)` stores `_deathCause`; `_enterDeath` reads it directly so any HAZARDS entry's `deathCause` (or any future cause) flows through. Drown / heat / freeze deaths route through `_loseLife(meter.deathCause)` so they get the spin/shrink animation + correct overlay via `DEATH_MESSAGES`. |
| Adding a fourth hazard touched 7 files (TILE enum, GAMEPLAY consts, world-assets, chunk meshes, world predicates, pacman reaction, game-state ticker). | No central registry — every consumer hardcoded WATER/LAVA/MUD branches. | Introduced `js/world-config.js` with `HAZARDS`/`METERS`/`WALL_KINDS`/`DEATH_MESSAGES` registries. Consumers iterate the registry by id and read effects from the spec. A new hazard is one entry; a new wall kind is one entry; a new meter is one entry + one HTML `<div>`. |
| Ghosts going in circles (most visible in WANDER on small floor patches; also in CHASE when the personality target was unreachable). | Two stacked bugs: (1) the reverse-bias filter doesn't catch 4-step loops because each step is a different cardinal, and (2) `_pickGreedy*` used a strict `<` against scores ordered by the fixed `dirs` iteration in `_reachableNeighbors`, so ties always handed the win to "up", producing systematic loops. | Three coordinated changes in `ghost.js`: (a) `RECENT_TILE_HISTORY` ring buffer of the last 4 tiles the ghost stood on, with `_pickNextTarget` filtering candidates whose destination is in the ring (falls back to all candidates when truly cornered). (b) Greedy tiebreak unified into `_pickWithTiebreak` — collects all tied-best candidates, prefers the one matching `lastDir` so the ghost commits to a heading, randomises among remaining ties. (c) WANDER prefers continuing straight 70% of the time so wandering reads as readable lines of motion instead of jitter. Ghosts that are still legitimately stuck (single-tile dead-ends) still fall back to U-turning since the reverse-bias gate also has a fallback when filtered candidates is empty. |
| Hard mode dot count was nominally `0.3 × baseKeep` but the cross corridor was always 100% dotted regardless of difficulty, so a Hard player walking the corridor between chunks still grazed a guaranteed-full dot lane and the food-scarcity loop never bit. | `chunk.buildDots` short-circuited the decimation hash for cross tiles. | Added `crossDotKeepMul` to `DIFFICULTY_PRESETS` (1.0 on Easy/Normal, 0.35 on Hard), threaded through `_syncWorldDifficulty → world.difficulty.crossDotKeepMul → world._makeChunk → Chunk.crossDotKeepPercent`. `chunk.buildDots` runs the same hash-decimation on cross tiles when the percent is < 100, salted with a different seed (`0x77`) so cross/off-cross hash patterns don't accidentally align. |

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

## Testing notes

See `.cursor/rules/ui-verification.mdc`: do not add Playwright tests. Read the
source, trust the user, and use `node:test` for logic. Browser automation requires
an explicit user request in the current task.

If the user explicitly requests a browser session, two things specific to this
app are worth knowing:

- Force-start a run from the console / `eval`:
  `window.game.startGame()` — skips menu + intro.
- Playwright's pointer is `pointer: fine`, so the `(pointer: coarse)`
  half of `@media (max-width: 768px), (pointer: coarse)` never fires.
  Test mobile CSS at viewports ≤768 wide; for real-phone landscape
  (844×390) verify with a manual device check or force
  `#touch-controls.style.display='flex'` and read rects.
