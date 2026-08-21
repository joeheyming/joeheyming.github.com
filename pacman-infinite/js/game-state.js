import { GAME_STATES, GAMEPLAY, DIFFICULTY, DIFFICULTY_PRESETS } from './constants.js';
import { CHUNK_SIZE } from './templates.js';
import { loadSave, saveState, clearSave } from './save.js';
import { METERS } from './world-config.js';

const RESPAWN_DELAY = GAMEPLAY.PACMAN_RESPAWN_DELAY;
const POST_RESPAWN_GRACE_S = 1.5;
const DIFFICULTY_STORAGE_KEY = 'pacman-infinite-difficulty';

export const gameState = {
  startGame() {
    if (this.startScreen) this.startScreen.classList.add('hidden');
    const wasContinue = this.state !== GAME_STATES.PLAYING && this._savedState != null;
    this.state = GAME_STATES.PLAYING;
    this._staticFrameDirty = true;
    window.heymingAchievements?.unlockForCurrentApp('first-action');
    // From here on we can persist progress (and pagehide will flush).
    this._canSave = true;
    if (typeof window !== 'undefined' && window.trackEvent) {
      // Label = difficulty so we can see retention/score-by-difficulty.
      // Value = 1 for new game, 2 for continue (so we can sum to count
      // sessions and split-by-value to see continue vs. fresh-start).
      window.trackEvent(
        'pacinfinite_game_start',
        'PacInfinite',
        this.difficulty || 'unknown',
        wasContinue ? 2 : 1
      );
    }
  },

  /**
   * Player chose "NEW GAME".
   *
   * Two cases:
   *   - No save loaded: the current world is already fresh, so just start
   *     playing. No reload, no flicker.
   *   - Save loaded: discard it, drop any ?seed= URL param, and reload so
   *     boot rolls a new random seed (and all of Three.js's lifecycle —
   *     chunks, meshes, audio — gets a clean slate).
   *
   * Disable saves *before* clearing so the pagehide handler triggered by
   * the navigation can't race us and rewrite the save we just removed.
   */
  startNewGame() {
    if (this._savedState === null) {
      this.startGame();
      return;
    }
    this._canSave = false;
    clearSave();
    const url = new URL(window.location.href);
    url.searchParams.delete('seed');
    // Sentinel telling the post-reload boot to skip the menu and drop
    // straight into gameplay. Without this, the player has to click
    // NEW GAME a second time on the freshly-empty start screen.
    url.searchParams.set('newgame', '1');
    window.location.replace(url.toString());
  },

  /**
   * Build the JSON-friendly snapshot of Pacman's pose for the save.
   * Returns null if pacman isn't ready yet (boot race). Recomputes grid
   * coords from world coords so they round to whole tiles deterministically.
   */
  _snapshotPacman() {
    if (!this.world || !this.pacman) return null;
    return {
      gx: this.world.worldToGrid(this.pacman.position.x),
      gy: this.world.worldToGrid(this.pacman.position.y),
      h: this.pacman.tileHeight,
      yaw: this.pacman.yaw
    };
  },

  /** Synchronously persist the current world state. Cheap; called on a timer. */
  _flushSave() {
    if (!this.world || !this._canSave) return;
    saveState({
      seed: this.seed,
      pacman: this._snapshotPacman(),
      eatenDots: this._eatenDots,
      score: this.score,
      highScore: this.highScore,
      food: this.food,
      difficulty: this.difficulty
    });
    this._saveTimer = 0;
  },

  /**
   * Starvation death. Same animation + scoring as a ghost kill, but
   * we surface it as its own method so future tweaks (sound, overlay,
   * HUD flash) can land in one place. Re-uses _loseLife so all
   * downstream state machines (lives, game-over, save) flow correctly.
   */
  _starve() {
    if (this.pacman.dying || this.pacman.dead) return;
    this._loseLife('starvation');
  },

  /**
   * Apply per-frame hunger drain and trigger starvation when food
   * reaches zero. Only called during active PLAYING frames.
   */
  _tickHunger(deltaTime) {
    if (this.food <= 0) return; // already starving — wait for the death state to clear
    // Effective drain folds the distance-from-origin penalty on top of
    // the difficulty preset so far-from-spawn play actually starves
    // faster (Tier 3 survival pressure). Falls back to the base preset
    // mul if the world helper isn't available.
    const drainMul = this.world?.effectiveHungerDrainMul
      ? this.world.effectiveHungerDrainMul()
      : this._diff().hungerDrainMul;
    const drain = GAMEPLAY.FOOD_DRAIN_RATE * drainMul;
    this.food = Math.max(0, this.food - drain * deltaTime);
    if (this.food <= 0) {
      this._starve();
    }
  },

  /**
   * Tick every registered meter (breath today; heat / cold / radiation
   * tomorrow). For each METERS entry:
   *   - If Pacman has it in `_activeMeters` → drain at `drainPerS` and
   *     trigger `_loseLife(meter.deathCause)` on zero.
   *   - Otherwise → refill at `refillPerS` toward `max`.
   *
   * Initialised lazily (`this._meters` is a Map keyed by meter id) so
   * callers don't have to remember a constructor-side setup step. The
   * HUD reads `gameState._meters.get(id)` to draw bars; game-hud
   * iterates METERS identically.
   *
   * Refill rate higher than drain → quick dips are forgiving, sustained
   * exposure is fatal.
   */
  _tickMeters(deltaTime) {
    if (!this._meters) this._meters = new Map();
    const active = this.pacman?._activeMeters;
    for (const meter of Object.values(METERS)) {
      let value = this._meters.has(meter.id) ? this._meters.get(meter.id) : meter.max;
      if (active && active.has(meter.id)) {
        value = Math.max(0, value - meter.drainPerS * deltaTime);
        if (value <= 0 && !this.pacman.dead && !this.pacman.dying) {
          // Route through _loseLife so animation, lives counter,
          // streak reset, and overlay copy flow the same as a ghost
          // kill. Pacman.dieByGhost handles the visual.
          this._loseLife(meter.deathCause);
        }
      } else if (value < meter.max) {
        value = Math.min(meter.max, value + meter.refillPerS * deltaTime);
      }
      this._meters.set(meter.id, value);
    }
  },

  /**
   * Add `amount` (can be negative) to the food meter, clamped to
   * [0, FOOD_MAX]. If a negative amount drops food to zero we still
   * route through the death pipeline so the player gets the same
   * visual cue as drain-starvation.
   */
  _addFood(amount) {
    if (amount === 0) return;
    this.food = Math.max(0, Math.min(GAMEPLAY.FOOD_MAX, this.food + amount));
    if (amount < 0 && this.food <= 0 && this.state === GAME_STATES.PLAYING) {
      this._starve();
    }
  },

  /**
   * Read the difficulty preset for the current run. Always returns a
   * valid preset (falls back to normal) so callers can read multipliers
   * unconditionally.
   */
  _diff() {
    return DIFFICULTY_PRESETS[this.difficulty] || DIFFICULTY_PRESETS[DIFFICULTY.NORMAL];
  },

  /**
   * Tier 3 — central score-credit helper. Folds the distance-from-origin
   * multiplier (1× → 5×) and the streak bonus (+0.1× per 10 dots, capped
   * at +2×) onto every base point award before adding it to the run
   * score. All score-bearing events (dot, power pill, fruit, ghost
   * eaten) route through here so the bonuses apply uniformly.
   *
   *   final = base × distance_mul × streak_mul
   *
   * Returns the rounded amount actually credited so callers can show
   * a floater / log it / etc.
   */
  _addScore(base) {
    const distMul = this.world?.scoreMultiplier ? this.world.scoreMultiplier() : 1;
    const streakMul = 1 + Math.min(2, Math.floor(this._dotStreak / 10) * 0.1);
    const credited = Math.round(base * distMul * streakMul);
    this.score += credited;
    return credited;
  },

  /** Increment the dot-streak counter and update the per-run best. */
  _bumpStreak() {
    this._dotStreak++;
    if (this._dotStreak > this._streakBest) this._streakBest = this._dotStreak;
  },

  /** Streak resets on any damage (ghost / starvation / void). */
  _resetStreak() {
    this._dotStreak = 0;
  },

  /**
   * Pick the difficulty for this constructor: prefer the saved run's
   * difficulty (so Continue feels consistent), then the user's last
   * menu choice, then NORMAL.
   */
  _initialDifficulty() {
    if (this._savedState && typeof this._savedState.difficulty === 'string') {
      const d = this._savedState.difficulty;
      if (DIFFICULTY_PRESETS[d]) return d;
    }
    try {
      const stored = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
      if (stored && DIFFICULTY_PRESETS[stored]) return stored;
    } catch (_e) {
      /* ignore */
    }
    return DIFFICULTY.NORMAL;
  },

  /** Switch the active difficulty (menu selection); persists to localStorage. */
  setDifficulty(diff) {
    if (!DIFFICULTY_PRESETS[diff]) return;
    this.difficulty = diff;
    try {
      localStorage.setItem(DIFFICULTY_STORAGE_KEY, diff);
    } catch (_e) {
      /* ignore */
    }
    this._refreshDifficultyButtons();
    // If the world already exists (mid-run difficulty change is rare,
    // but technically allowed by setDifficulty being public), push the
    // new multipliers down so AI reacts instantly.
    this._syncWorldDifficulty();
  },

  /**
   * Copy the multipliers off the active preset onto the World instance
   * so ghost code can read them without importing constants. Called
   * from loadWorld() and setDifficulty().
   */
  _syncWorldDifficulty() {
    if (!this.world) return;
    const preset = this._diff();
    this.world.difficulty.ghostSpeedMul = preset.ghostSpeedMul;
    this.world.difficulty.ghostCountMul = preset.ghostCountMul;
    this.world.difficulty.ghostChaseRadiusMul = preset.ghostChaseRadiusMul;
    this.world.difficulty.dotKeepMul = preset.dotKeepMul;
    // Cross-corridor dot decimation. Defaults to 1.0 (classic full
    // trail) when an older preset object doesn't carry the field, so
    // legacy fixtures keep the original look.
    this.world.difficulty.crossDotKeepMul = preset.crossDotKeepMul ?? 1.0;
    // hungerDrainMul + fruitSpawnPeriodMul used to be read off the preset
    // directly by the consumers; now mirrored onto world.difficulty so
    // World.effectiveHungerDrainMul() can fold the distance penalty over
    // the same source of truth.
    this.world.difficulty.hungerDrainMul = preset.hungerDrainMul ?? 1.0;
    this.world.difficulty.fruitSpawnPeriodMul = preset.fruitSpawnPeriodMul ?? 1.0;
    // Tier 4 — per-dot food multiplier (Hard makes dots half as filling).
    this.world.difficulty.foodPerDotMul = preset.foodPerDotMul ?? 1.0;
    // Tier 1 additions — fall back to the existing constant defaults if
    // an older preset object is missing the new keys (covers test fixtures
    // and any future custom presets that haven't been upgraded yet).
    this.world.difficulty.fleeSpeedMul =
      preset.fleeSpeedMul ?? GAMEPLAY.GHOST_FLEE_SPEED_MULTIPLIER;
    this.world.difficulty.jumpCooldownMul = preset.jumpCooldownMul ?? 1.0;
    this.world.difficulty.ghostMinSpawnDistMul = preset.ghostMinSpawnDistMul ?? 1.0;
    this.world.difficulty.powerModeDurationS =
      preset.powerModeDurationS ?? GAMEPLAY.POWER_MODE_DURATION;
    // Hazard-biome density. Per the AGENTS.md "past issues" entry on
    // NaN `effective*()` results, every new world.difficulty.X must be
    // mirrored here or world.effectiveHazardDensityMul() throws / NaNs.
    this.world.difficulty.hazardDensityMul = preset.hazardDensityMul ?? 1.0;
  },

  /** Sync the menu pill highlights with the current `this.difficulty`. */
  _refreshDifficultyButtons() {
    const buttons = document.querySelectorAll('.difficulty-btn');
    for (const btn of buttons) {
      const active = btn.getAttribute('data-difficulty') === this.difficulty;
      btn.classList.toggle('difficulty-active', active);
    }
  },

  /**
   * Pacman walked off a cliff (VOID) or onto a lethal hazard tile this
   * frame. The shared `Pacman.die(cause)` path sets `pacman._deathCause`
   * to whatever cause was supplied — typically 'void' for falls or
   * `HAZARDS[id].pacman.deathCause` for tile-lethal hazards (today only
   * 'lava'; future hazards can choose any DEATH_MESSAGES key). Falling
   * counts as losing a life — the player feels the cost the same way
   * as a ghost touch. If lives run out the death animation runs and
   * THEN we transition to GAME_OVER (after the fall completes), so
   * the player still gets the visual moment.
   */
  _enterDeath() {
    const cause = this.pacman?._deathCause || 'void';
    this.state = GAME_STATES.DEATH;
    this._staticFrameDirty = true;
    this._respawnTimer = RESPAWN_DELAY;
    this._deathCause = cause;
    this._applyDeathMessage(cause);
    if (this.respawnOverlay) this.respawnOverlay.classList.remove('hidden');
    this.audioManager.playDeath?.();

    // Cost a life, mirroring the ghost-touch path. Power mode ends.
    this.lives = Math.max(0, this.lives - 1);
    this.pacman.clearPowerMode();
    // Same streak-reset as _loseLife — falling into the void / stepping
    // in lava counts as damage too, otherwise edge-walking around streak
    // loss would be strictly free.
    this._resetStreak();
    this.audioManager.playLifeLost?.();
    // Refresh the HUD now so the heart count visibly updates as Pacman
    // is mid-fall — feels punchier than waiting until respawn.
    this.refreshHud();
  },

  _respawn() {
    if (!this.world || !this.pacman) return;
    const spawn = this.world.randomLoadedFloor();
    if (!spawn) {
      // Should be impossible (cross center is always FLOOR) but be defensive.
      this.pacman.respawnAt(CHUNK_SIZE / 2, CHUNK_SIZE / 2, 0);
    } else {
      this.pacman.respawnAt(spawn.gridX, spawn.gridY, spawn.height);
    }
    if (this.respawnOverlay) this.respawnOverlay.classList.add('hidden');
    // Restock food on respawn so a starvation death doesn't immediately
    // re-trigger. Use FOOD_RESPAWN (60) instead of full so the player
    // still has to engage with hunger after coming back.
    this.food = GAMEPLAY.FOOD_RESPAWN;
    // Refill every meter to full on respawn — otherwise a drown (or
    // future heat-stroke / freeze) death would immediately retrigger
    // if the player respawns near a hazard. randomLoadedFloor already
    // guarantees the spawn tile is FLOOR, so a full refill is the
    // right baseline.
    if (!this._meters) this._meters = new Map();
    for (const meter of Object.values(METERS)) this._meters.set(meter.id, meter.max);

    // If the void death used the player's last life, the fall animation
    // has finished — now it's safe to flip to GAME_OVER without losing
    // the dramatic moment.
    if (this.lives <= 0) {
      this._enterGameOver();
      return;
    }
    this.state = GAME_STATES.PLAYING;
    this._staticFrameDirty = true;
    this._postRespawnGrace = POST_RESPAWN_GRACE_S;
    // Force-stream new chunks around the respawn point in case it's far
    // from the death site.
    this.world.streamAround(this.pacman.position);
  },

  /**
   * Pacman caught by a ghost. Plays the iconic "pew pew pew :-(" death
   * cue + the classic spin/shrink animation, *then* respawns (or rolls
   * into game over if it was the last life). We re-use the DEATH state
   * machine so the timer-driven _respawn() path handles either outcome.
   */
  _loseLife(cause = 'ghost') {
    this.lives--;
    this._deathCause = cause;
    // Iconic death cue from the original game (assets/sounds/death.wav).
    this.audioManager.playDeath?.();
    this.pacman.clearPowerMode();
    // Tier 3 — any damage breaks the dot streak. Big sting, intentional:
    // the streak is supposed to be the headline scoring lever for clean
    // runs, so dying makes you start over.
    this._resetStreak();
    this.refreshHud();
    // Show the cause overlay for ALL deaths so the player always knows
    // why they died. The overlay's bg/60 + flex layout sits on top of
    // the canvas; the spin/shrink animation still plays underneath
    // and is partially visible through the dim overlay.
    this._applyDeathMessage(cause);
    if (this.respawnOverlay) this.respawnOverlay.classList.remove('hidden');
    // Hand the next ~1.5s over to the death state machine so the spin
    // animation has time to play. _respawn() runs at the end and will
    // detect lives<=0 and roll into GAME_OVER for us.
    this.state = GAME_STATES.DEATH;
    this._staticFrameDirty = true;
    this._respawnTimer = GAMEPLAY.PACMAN_DEATH_ANIM_DURATION;
    this.pacman.dieByGhost();
  },

  _enterGameOver() {
    this.state = GAME_STATES.GAME_OVER;
    this._staticFrameDirty = true;
    this.audioManager.playGameOver?.();
    // Final-screen flavour line reflects whatever killed Pacman last.
    this._applyDeathMessage(this._deathCause ?? 'ghost');
    if (this.score > this.highScore) {
      this.highScore = this.score;
    }
    if (this.gameOverScreen) {
      this.gameOverScreen.classList.remove('hidden');
    }
    if (this.finalScoreElement) {
      this.finalScoreElement.textContent = String(this.score);
    }
    if (this.finalHighScoreElement) {
      this.finalHighScoreElement.textContent = String(this.highScore);
    }
    // Tier 3 — surface the per-run best streak so the player sees the
    // number their streak scoring was chasing. Hide the row entirely
    // when zero so an instant-death (never picked anything up) doesn't
    // display a confusing 0.
    if (this.finalStreakRow && this.finalStreakElement) {
      if (this._streakBest > 0) {
        this.finalStreakElement.textContent = String(this._streakBest);
        this.finalStreakRow.classList.remove('hidden');
      } else {
        this.finalStreakRow.classList.add('hidden');
      }
    }
    // Fire game-over BEFORE we zero out score / streak below so the GA
    // event carries the actual run totals, not the cleared state.
    if (typeof window !== 'undefined' && window.trackEvent) {
      // Label encodes both difficulty and best-streak bucket so we can
      // slice "how far did people get on hard?" without exploding label
      // cardinality. Score → value (numeric metric for GA4 averages).
      const streak = this._streakBest || 0;
      let streakBucket = '0';
      if (streak >= 50) streakBucket = '50+';
      else if (streak >= 20) streakBucket = '20-49';
      else if (streak >= 10) streakBucket = '10-19';
      else if (streak >= 5) streakBucket = '5-9';
      else if (streak > 0) streakBucket = '1-4';
      const diff = this.difficulty || 'unknown';
      window.trackEvent(
        'pacinfinite_game_over',
        'PacInfinite',
        `${diff}|${streakBucket}`,
        this.score
      );
    }

    // Persist the high-score and zero out the run's score. Eaten dots and
    // pacman pose are preserved so Continue picks up where the player
    // fell — only the run-specific stats reset.
    this.score = 0;
    this._powerChainCount = 0;
    // Streak best is a per-run stat — reset alongside score so the next
    // run starts fresh. Current streak (`_dotStreak`) is already zero
    // here because _loseLife → _resetStreak ran on the final hit.
    this._streakBest = 0;
    this._flushSave();
  },

  /**
   * Player tapped "BACK TO MENU" on the game-over screen. Hide the
   * overlay, restore the start menu, and require an explicit start
   * action to resume gameplay. Lives are restored to the starting count
   * here too so Continue from the menu plays correctly.
   *
   * We also clear the live ghost pool and any active fruit — their
   * positions are stale (from the last run's chase point) and on
   * Continue the world will spawn fresh ghosts around the new spawn
   * tile. Same justification as Minecraft despawning hostile mobs on
   * a difficulty change.
   */
  _backToMenuFromGameOver() {
    if (this.gameOverScreen) this.gameOverScreen.classList.add('hidden');
    this.lives = GAMEPLAY.STARTING_LIVES;
    this.food = GAMEPLAY.FOOD_START;
    this.state = GAME_STATES.START;
    this._staticFrameDirty = true;
    if (this.world?.clearGhosts) this.world.clearGhosts();
    this._despawnFruit();
    // Re-derive the saved-state view of the world so the menu's CONTINUE
    // button picks up the just-flushed save.
    this._savedState = loadSave();
    this._refreshStartMenu();
    if (this.startScreen) this.startScreen.classList.remove('hidden');
    this._canSave = false;
  }
};
