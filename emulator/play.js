// Play path for the /emulator/ shell, loaded by launch.js once a game is
// chosen. `window.emulatorPlay.play(romSource, cfg, opts)` swaps the boot
// card for the game container, mounts the play chrome, and hands the ROM to
// Ruffle or emulatorEjsMount. Nothing here runs on the first screen.
(function () {
  'use strict';

  function isTv() {
    const lb = window.emulatorLeanback;
    return !!(lb && lb.isTv);
  }

  async function unlockGameAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      try {
        const ctx = new Ctx();
        if (ctx.state === 'suspended') await ctx.resume();
      } catch {
        /* ignore */
      }
    }
    document.querySelectorAll('audio, video').forEach((el) => {
      el.muted = false;
      const play = el.play && el.play();
      if (play && typeof play.catch === 'function') play.catch(() => {});
    });
    const btn = document.getElementById('emu-sound-btn');
    if (btn) btn.textContent = 'Sound on — click the game if still silent';
  }

  function placeGameListButton() {
    const btn = document.getElementById('emu-game-list-btn');
    const bar = document.getElementById('emu-play-chrome');
    const overlay = document.querySelector('.share-overlay');
    if (!btn || !bar) return;
    // TV hides the share cluster, so the exit stays on the play bar there.
    if (!isTv() && overlay) {
      if (btn.parentElement !== overlay) overlay.insertBefore(btn, overlay.firstChild);
    } else if (btn.parentElement !== bar) {
      bar.appendChild(btn);
    }
  }

  /**
   * @param {{ showSaveStates?: boolean, audioUnlock?: boolean, audioNote?: string }} cfg
   * @param {() => void} onExit
   */
  function mountPlayChrome(cfg, onExit) {
    let bar = document.getElementById('emu-play-chrome');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'emu-play-chrome';
      document.body.appendChild(bar);
    }
    const bits = [];
    if (cfg.showSaveStates) {
      bits.push(
        '<button type="button" class="emu-chrome-btn" id="emu-save-btn">Save (F5)</button>'
      );
      bits.push(
        '<button type="button" class="emu-chrome-btn" id="emu-load-btn">Load (F9)</button>'
      );
      bits.push(
        '<span class="emu-chrome-note">Quick save — not the in-game memory card menu.</span>'
      );
    }
    if (cfg.audioUnlock || cfg.audioNote) {
      bits.push(
        '<button type="button" class="emu-chrome-btn" id="emu-sound-btn">Sound off — click to enable</button>'
      );
    }
    // Kept out of the save row so a missed Save click can't quit the game.
    // placeGameListButton parks it in the top-right share cluster.
    bits.push(
      '<button type="button" class="emu-chrome-btn emu-chrome-exit" id="emu-game-list-btn" aria-label="Back to game list">' +
        '<span class="emu-exit-full">Back to game list</span>' +
        '<span class="emu-exit-short">← Games</span>' +
        '</button>'
    );
    bar.innerHTML = bits.join('');

    document.getElementById('emu-game-list-btn')?.addEventListener('click', onExit);
    placeGameListButton();
    document.getElementById('emu-sound-btn')?.addEventListener('click', unlockGameAudio);
    document.getElementById('emu-save-btn')?.addEventListener('click', () => {
      window.emulatorEjsMount?.saveQuickState();
    });
    document.getElementById('emu-load-btn')?.addEventListener('click', () => {
      window.emulatorEjsMount?.loadQuickState();
    });
    document.getElementById('game-container')?.addEventListener(
      'pointerdown',
      () => {
        if (cfg.audioUnlock || cfg.audioNote) unlockGameAudio();
      },
      { once: true }
    );
  }

  /** @param {Blob} romSource */
  async function mountRuffle(romSource) {
    const game = document.getElementById('game');
    const RufflePlayer = window.RufflePlayer;
    if (!game || !RufflePlayer || typeof RufflePlayer.newest !== 'function') {
      if (game) game.textContent = 'Flash player failed to load. Reload and try again.';
      return;
    }
    game.replaceChildren();
    const player = RufflePlayer.newest().createPlayer();
    player.style.width = '100%';
    player.style.height = '100%';
    game.appendChild(player);
    const url = URL.createObjectURL(romSource);
    try {
      await player.ruffle().load(url);
    } catch (err) {
      URL.revokeObjectURL(url);
      game.textContent = 'Could not start this Flash game.';
      console.error(err);
    }
  }

  /**
   * @param {Blob} romSource
   * @param {{ id: string, player?: string }} cfg
   * @param {{ romName: string, title: string, biosFile: File | null, onExit: () => void }} opts
   */
  async function play(romSource, cfg, opts) {
    if (typeof window.prependBaseTitle === 'function') window.prependBaseTitle(opts.title);

    const bootEl = document.getElementById('boot');
    const gameContainer = document.getElementById('game-container');
    const emuHeader = document.getElementById('emu-header');
    if (bootEl) bootEl.classList.add('hidden');
    if (gameContainer) gameContainer.classList.add('visible');
    if (emuHeader) emuHeader.classList.add('is-playing');
    document.documentElement.dataset.gamepadNav = 'game';

    // Unlock once per console lander app id (derived from the registry).
    if (Object.keys(window.EMULATOR_CONSOLES || {}).includes(cfg.id)) {
      window.heymingAchievements?.unlockForCurrentApp('first-action');
    }

    mountPlayChrome(cfg, opts.onExit);

    if (cfg.player === 'ruffle') {
      await mountRuffle(romSource);
      return;
    }

    const mountApi = window.emulatorEjsMount;
    if (!mountApi || typeof mountApi.mount !== 'function') {
      console.error('emulatorPlay: emulatorEjsMount missing after loading the play scripts.');
      return;
    }
    mountApi.mount({
      cfg,
      romSource,
      romName: opts.romName,
      biosFile: opts.biosFile,
      onExit: opts.onExit
    });
  }

  window.emulatorPlay = { play };
})();
