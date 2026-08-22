#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = 'http://localhost:8000';
const VIEWPORT = { width: 1200, height: 630 };

// Command line arguments
const FORCE_REGENERATE = process.argv.includes('--force') || process.argv.includes('-f');

// Pages to screenshot with their output paths
const PAGES = [
  {
    url: `${BASE_URL}/`,
    output: 'assets/joe-heyming-og-image.png',
    title: 'Joe Heyming Portfolio'
  },
  {
    url: `${BASE_URL}/achievements/`,
    output: 'achievements/achievements-preview.png',
    title: 'Site Achievements'
  },
  {
    url: `${BASE_URL}/emulator/`,
    output: 'emulator/emulator-preview.png',
    title: 'Retro Emulator (NES / Sega / SNES / GB / Neo Geo / N64)'
  },
  {
    url: `${BASE_URL}/emulator/nes/`,
    output: 'emulator/nes/nes-preview.png',
    title: 'NES Emulator'
  },
  {
    url: `${BASE_URL}/emulator/sega/`,
    output: 'emulator/sega/sega-preview.png',
    title: 'Sega Genesis Emulator'
  },
  {
    url: `${BASE_URL}/emulator/gg/`,
    output: 'emulator/gg/gg-preview.png',
    title: 'Game Gear Emulator'
  },
  {
    url: `${BASE_URL}/emulator/sega32x/`,
    output: 'emulator/sega32x/sega32x-preview.png',
    title: 'Sega 32X Emulator'
  },
  {
    url: `${BASE_URL}/emulator/gb/`,
    output: 'emulator/gb/gb-preview.png',
    title: 'Game Boy Emulator'
  },
  {
    url: `${BASE_URL}/emulator/snes/`,
    output: 'emulator/snes/snes-preview.png',
    title: 'SNES Emulator'
  },
  {
    url: `${BASE_URL}/emulator/neogeo/`,
    output: 'emulator/neogeo/neogeo-preview.png',
    title: 'Neo Geo Emulator'
  },
  {
    url: `${BASE_URL}/emulator/ngp/`,
    output: 'emulator/ngp/ngp-preview.png',
    title: 'Neo Geo Pocket Emulator'
  },
  {
    url: `${BASE_URL}/emulator/n64/`,
    output: 'emulator/n64/n64-preview.png',
    title: 'N64 Emulator'
  },
  {
    url: `${BASE_URL}/emulator/gba/`,
    output: 'emulator/gba/gba-preview.png',
    title: 'GBA Emulator'
  },
  {
    url: `${BASE_URL}/emulator/segacd/`,
    output: 'emulator/segacd/segacd-preview.png',
    title: 'Sega CD Emulator'
  },
  {
    url: `${BASE_URL}/emulator/ps1/`,
    output: 'emulator/ps1/ps1-preview.png',
    title: 'PS1 Emulator'
  },
  {
    url: `${BASE_URL}/flash/`,
    output: 'flash/flash-preview.png',
    title: 'Flash Player'
  },
  {
    url: `${BASE_URL}/calculator/`,
    output: 'calculator/calculator-preview.png',
    title: 'Calculator',
    // Standard mode at "0" is indistinguishable from every other web
    // calculator. Graph mode is the differentiator — auto-fills
    // sin(x)/cos(x) so the preview shows a real plotted curve.
    setup: async (page) => {
      await page.click('button.calc-mode-tab[data-mode="graph"]');
      await page.waitForSelector('#calc-panel-graph:not([hidden])');
      await page.waitForSelector('#graph-canvas');
      await page.waitForTimeout(500);
    }
  },
  {
    url: `${BASE_URL}/doom/`,
    output: 'doom/doom-preview.png',
    title: 'Browser DOOM'
  },
  {
    url: `${BASE_URL}/dos/`,
    output: 'dos/dos-preview.png',
    title: 'DOS Player'
  },
  {
    url: `${BASE_URL}/stepmania/`,
    output: 'stepmania/stepmania-preview.png',
    title: 'StepMania',
    // The "Welcome to StepMania" prompt is injected ~500ms after load
    // and completely blocks the actual game UI. Dismiss it so the
    // preview shows the idle game (Lost background + step buttons).
    setup: async (page) => {
      const dismiss = page.locator('#dismiss-prompt');
      if (await dismiss.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dismiss.click();
      }
      await page.waitForSelector('#sm-micro');
      await page.waitForTimeout(500);
    }
  },
  {
    url: `${BASE_URL}/piano-hero/`,
    output: 'piano-hero/piano-hero-preview.png',
    title: 'Piano Hero',
    // The empty stage is mostly blank. Wait for the keyboard to render
    // so the preview shows the piano + falling-notes canvas + toolbar.
    setup: async (page) => {
      await page.waitForSelector('.piano-keyboard .piano-key', { timeout: 5000 });
      await page.waitForTimeout(300);
    }
  },
  {
    url: `${BASE_URL}/accordion-hero/`,
    output: 'accordion-hero/accordion-hero-preview.png',
    title: 'Accordion Hero'
  },
  {
    url: `${BASE_URL}/terminal/`,
    output: 'terminal/terminal-preview.png',
    title: 'Web Terminal'
  },
  {
    url: `${BASE_URL}/notepad/`,
    output: 'notepad/notepad-preview.png',
    title: 'Notepad',
    // Empty Quill editor looks like a blank textarea with chrome
    // around it. Inject sample formatted content (heading + para +
    // bullet list) so the preview demonstrates the rich-text
    // capabilities visible in the toolbar.
    setup: async (page) => {
      await page.waitForSelector('.ql-editor', { timeout: 5000 });
      // Use Quill's clipboard.dangerouslyPasteHTML so the editor's
      // Delta model stays in sync with the DOM — setting innerHTML
      // directly bypasses Quill's parser and the bullet list silently
      // gets dropped on the next internal repaint.
      await page.evaluate(() => {
        const editor = /** @type {HTMLElement | null} */ (document.querySelector('.ql-editor'));
        if (!editor) return;
        const Q = /** @type {any} */ (window).Quill;
        const html =
          '<h2>Saturday notes</h2>' +
          '<p>Ideas for the weekend project — keep it small, ship it Sunday.</p>' +
          '<ul>' +
          '<li>Sketch the home page layout</li>' +
          '<li>Pick a color palette (warm, two accents)</li>' +
          '<li>Export the hero image as PNG</li>' +
          '<li>Wire up the share button</li>' +
          '</ul>' +
          '<p><strong>Open question:</strong> dark mode toggle now or later?</p>';
        const quill = Q && typeof Q.find === 'function' ? Q.find(editor) : null;
        if (quill && quill.clipboard) {
          quill.setContents([]);
          quill.clipboard.dangerouslyPasteHTML(0, html);
        } else {
          editor.innerHTML = html;
        }
        editor.classList.remove('ql-blank');
      });
      await page.waitForTimeout(400);
    }
  },
  {
    url: `${BASE_URL}/todo/`,
    output: 'todo/todo-preview.png',
    title: 'Todo',
    // Default load shows the "You're signed out — Sign in with Google"
    // gate, which is the worst possible OG image (looks like a paywall).
    // Hide the gate, reveal the panel, and inject mock rows that match
    // the real renderer's DOM shape so the preview shows an actual list.
    setup: async (page) => {
      await page.evaluate(() => {
        const gate = document.getElementById('signed-out-empty');
        if (gate) gate.hidden = true;
        const loading = document.getElementById('app-loading');
        if (loading) loading.hidden = true;
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = '';

        const panel = document.getElementById('todo-panel');
        if (panel) panel.hidden = false;

        const tabSelect = /** @type {HTMLSelectElement | null} */ (
          document.getElementById('sheet-tab-select')
        );
        if (tabSelect) {
          tabSelect.innerHTML = '';
          const opt = document.createElement('option');
          opt.value = 'Tasks';
          opt.textContent = 'Tasks';
          opt.selected = true;
          tabSelect.appendChild(opt);
        }

        const list = document.getElementById('todo-list');
        const empty = document.getElementById('todo-empty');
        if (empty) empty.hidden = true;
        if (!list) return;
        list.replaceChildren();

        const rows = [
          { title: 'Buy groceries', done: false, date: '2026-05-30 09:14:00' },
          { title: 'Renew passport', done: false, date: '2026-05-29 18:02:00' },
          { title: 'Ship the design doc', done: true, date: '2026-05-28 14:30:00' },
          { title: 'Call mom', done: false, date: '2026-05-28 11:15:00' },
          { title: 'Pay rent', done: true, date: '2026-05-27 08:00:00' }
        ];

        for (const todo of rows) {
          const li = document.createElement('li');
          li.className = 'flex flex-nowrap items-center gap-3 py-2.5';

          const chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.checked = todo.done;
          chk.className = 'h-4 w-4 shrink-0 accent-brand cursor-pointer';

          const line = document.createElement('div');
          line.className =
            'min-w-0 flex-1 cursor-pointer touch-manipulation break-words pr-1 text-[0.95rem] [-webkit-tap-highlight-color:transparent]';
          if (todo.done) line.classList.add('line-through', 'opacity-65');

          const dateEl = document.createElement('span');
          dateEl.className = 'mr-1.5 text-[0.82em] text-text-3';
          dateEl.textContent = todo.date;

          const contentEl = document.createElement('span');
          contentEl.className = 'text-text-1';
          contentEl.textContent = todo.title;

          line.append(dateEl, contentEl);
          li.append(chk, line);
          list.appendChild(li);
        }
      });
      await page.waitForTimeout(300);
    }
  },
  {
    url: `${BASE_URL}/sadtrombone/`,
    output: 'sadtrombone/sadtrombone-preview.png',
    title: 'Sad Trombone'
  },
  {
    url: `${BASE_URL}/wordle-finder/`,
    output: 'wordle-finder/thumbnail.png',
    title: 'Wordle Finder'
  },
  {
    url: `${BASE_URL}/awesome/`,
    output: 'awesome/awesome-preview.png',
    title: 'Everything is Awesome'
  },
  {
    url: `${BASE_URL}/analytics/`,
    output: 'analytics/analytics-preview.png',
    title: 'Presence'
  },
  {
    url: `${BASE_URL}/youtube/`,
    output: 'youtube/joetube-preview.png',
    title: 'JoeTube'
  },
  {
    // Netflix-style preview home (hero + genre rails) from
    // watch/modules/views/preview-home.js — same shell crawlers see.
    url: `${BASE_URL}/watch/?preview=1`,
    output: 'watch/watch-preview.png',
    title: 'Watch',
    setup: async (page) => {
      await page.waitForSelector('.tv-stream-home .tv-stream-hero', {
        timeout: 15000
      });
      await page.waitForSelector('.tv-stream-tile[data-tile="genre-animation"]');
      await page.waitForTimeout(400);
    }
  },
  {
    url: `${BASE_URL}/blockbuster/`,
    output: 'blockbuster/blockbuster-preview.png',
    title: 'Blockbuster',
    // Wait until shelves are stocked so OG shows face-out cases, not empty aisles.
    setup: async (page) => {
      await page.waitForSelector('#load-status[hidden]', { timeout: 25000 });
      // Posters resolve async after stock; give a couple frames to land.
      await page.waitForTimeout(2500);
    }
  },
  {
    url: `${BASE_URL}/badapple/`,
    output: 'badapple/badapple-preview.png',
    title: 'Bad Apple ASCII',
    // Default capture shows the player chrome with no animation
    // frame rendered. Seek paused to ~45s where the silhouette is
    // clear and recognizable so the preview shows the actual art.
    setup: async (page) => {
      await page.evaluate(async () => {
        const SEC = 45;
        const FRAME_RATE = 30;
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audio'));
        if (audio) {
          audio.pause();
          audio.currentTime = SEC;
        }
        const frameNum = Math.floor(SEC * FRAME_RATE) + 1;
        try {
          const res = await fetch(`frame/${frameNum}.html`);
          const html = await res.text();
          const m = html.match(/<pre>\s*([\s\S]*?)\s*<\/pre>/);
          const target = document.getElementById('frame-display');
          if (m && target) target.textContent = m[1];
        } catch {
          // network blip — leave the frame blank rather than crash
        }
        const duration = (audio && audio.duration) || 6572 / FRAME_RATE;
        const pct = (SEC / duration) * 100;
        const fill = /** @type {HTMLElement | null} */ (document.getElementById('progress-fill'));
        if (fill) fill.style.width = pct + '%';
        const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
        const tdisp = document.getElementById('time-display');
        if (tdisp) tdisp.textContent = `${fmt(SEC)} / ${fmt(duration)}`;
      });
      await page.waitForTimeout(500);
    }
  },
  {
    url: `${BASE_URL}/sayit/`,
    output: 'sayit/sayit-preview.png',
    title: 'Say It OCR'
  },
  {
    url: `${BASE_URL}/farm/`,
    output: 'farm/farm-preview.png',
    title: 'AMP Farm'
  },
  {
    url: `${BASE_URL}/pbs/`,
    output: 'pbs/pbs-preview.png',
    title: 'Pirate Button Soundboard'
  },
  {
    url: `${BASE_URL}/sayhello/`,
    output: 'sayhello/sayhello-preview.png',
    title: 'Say Hello TTS',
    // Empty textarea reads as "broken form." Pre-fill with a friendly
    // sample sentence so the preview shows the app's purpose.
    setup: async (page) => {
      await page.fill(
        '#utterance',
        'Hello from Joe Heyming dot io — pick a voice and hit Submit to hear it.'
      );
      await page.waitForTimeout(300);
    }
  },
  {
    url: `${BASE_URL}/shadowbox/`,
    output: 'shadowbox/shadowbox-preview.png',
    title: 'Operation SHADOWBOX'
  },
  {
    url: `${BASE_URL}/periodic-speller/`,
    output: 'periodic-speller/periodic-speller-preview.png',
    title: 'Periodic Table Speller'
  },
  {
    url: `${BASE_URL}/os/`,
    output: 'os/os-preview.png',
    title: 'Heyming OS',
    // First boot shows the setup wizard ("Welcome to Heyming OS").
    // Skip it by writing the username localStorage key the wizard
    // would set, reload to land on the actual desktop, scaffold the
    // FS so file icons appear, and open a couple of windows so the
    // preview shows the OS in use rather than an empty wallpaper.
    setup: async (page) => {
      await page.evaluate(() => {
        localStorage.setItem('heymingOS_username', 'joe');
        localStorage.setItem('heymingOS_hostname', 'heyming-os');
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#os-desktop', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);

      await page.evaluate(async () => {
        const os = /** @type {any} */ (window).heymingOS;
        if (!os) return;
        try {
          if (os.fileSystemDB?.initializeWithScaffolding) {
            await os.fileSystemDB.initializeWithScaffolding('joe');
          }
          if (os.desktop?.refresh) {
            await os.desktop.refresh();
          }
        } catch {
          // scaffolding/refresh failures shouldn't block the screenshot
        }
        try {
          os.launchApp?.('notepad', 'preview');
          os.launchApp?.('filemanager', 'preview');
        } catch {
          // best-effort
        }
      });

      // Hide the boot toast that fires ~500ms after _showDesktop
      await page.addStyleTag({
        content: '#os-notification-region { display: none !important; }'
      });
      await page.waitForTimeout(2000);
    }
  },
  {
    url: `${BASE_URL}/model-viewer/`,
    output: 'model-viewer/model-viewer-preview.png',
    title: '3D Viewer',
    // Empty drop zone + ice-cube emoji is indistinguishable from
    // every other file-drop viewer in the gallery. Loading the
    // Damaged Helmet glTF demo gives an immediate PBR-rendered 3D
    // object that signals "yes, this actually does 3D."
    setup: async (page) => {
      await page.click('#btn-demo');
      await page.waitForSelector('#demo-menu.open');
      await page.locator('#demo-menu button', { hasText: 'Damaged Helmet' }).click();
      await page.waitForSelector('#model-wrapper:not(.hidden)', { timeout: 5000 }).catch(() => {});
      await page
        .locator('model-viewer#model')
        .evaluate(
          (el) =>
            new Promise((resolve) => {
              if (/** @type {any} */ (el).loaded) return resolve(undefined);
              el.addEventListener('load', () => resolve(undefined), { once: true });
              setTimeout(() => resolve(undefined), 15000);
            })
        )
        .catch(() => {});
      await page.waitForTimeout(1500);
    }
  },
  {
    url: `${BASE_URL}/play/`,
    output: 'play/play-preview.png',
    title: 'Play - Browser Music Studio'
  },
  {
    url: `${BASE_URL}/play/piano/`,
    output: 'play/piano/piano-preview.png',
    title: 'Browser Piano'
  },
  {
    url: `${BASE_URL}/play/accordion/`,
    output: 'play/accordion/accordion-preview.png',
    title: 'Browser Accordion'
  },
  {
    url: `${BASE_URL}/play/drums/`,
    output: 'play/drums/drums-preview.png',
    title: 'Browser Drums'
  },
  {
    url: `${BASE_URL}/play/strings/`,
    output: 'play/strings/strings-preview.png',
    title: 'Browser Strings'
  },
  {
    url: `${BASE_URL}/play/synth/`,
    output: 'play/synth/synth-preview.png',
    title: 'Browser Synth'
  },
  {
    url: `${BASE_URL}/play/sampler/`,
    output: 'play/sampler/sampler-preview.png',
    title: 'DirectWave Sampler'
  },
  {
    url: `${BASE_URL}/play/metronome/`,
    output: 'play/metronome/metronome-preview.png',
    title: 'Browser Metronome'
  },
  {
    url: `${BASE_URL}/play/composer/`,
    output: 'play/composer/composer-preview.png',
    title: 'Composer',
    // Blank default score reads as an empty staff. Seed Twinkle via the
    // share-hash path (examples are compact v1 payloads, not prefs v2).
    setup: async (page) => {
      await page.evaluate(async () => {
        const res = await fetch('examples/twinkle.json');
        const data = await res.json();
        const json = JSON.stringify(data);
        const b64 = btoa(unescape(encodeURIComponent(json)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        location.hash = `m1.${b64}`;
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#score .note', { timeout: 10000 });
      await page.waitForTimeout(600);
    }
  },
  {
    url: `${BASE_URL}/play/chiptune/`,
    output: 'play/chiptune/chiptune-preview.png',
    title: 'Chiptune'
  },
  {
    url: `${BASE_URL}/play/harp/`,
    output: 'play/harp/harp-preview.png',
    title: 'Browser Harp'
  },
  {
    url: `${BASE_URL}/play/steeldrum/`,
    output: 'play/steeldrum/steeldrum-preview.png',
    title: 'Browser Steel Drum'
  },
  {
    url: `${BASE_URL}/play/mallets/`,
    output: 'play/mallets/mallets-preview.png',
    title: 'Browser Mallet Keyboard'
  },
  {
    url: `${BASE_URL}/play/theremin/`,
    output: 'play/theremin/theremin-preview.png',
    title: 'Browser Theremin'
  },
  {
    url: `${BASE_URL}/play/tuner/`,
    output: 'play/tuner/tuner-preview.png',
    title: 'Browser Tuner'
  },
  {
    url: `${BASE_URL}/paint/`,
    output: 'paint/paint-preview.png',
    title: 'Paint',
    // Empty white canvas is indistinguishable from any paint chrome.
    // Draw a simple landscape directly onto the first layer canvas
    // (the overlay canvas is transient and would get cleared on the
    // next tool interaction) so the preview shows actual artwork.
    setup: async (page) => {
      await page.waitForSelector('#canvas-stack .layer-canvas', { timeout: 5000 });
      await page.evaluate(() => {
        const canvas = /** @type {HTMLCanvasElement | null} */ (
          document.querySelector('#canvas-stack canvas.layer-canvas')
        );
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const W = canvas.width;
        const H = canvas.height;

        // Sky gradient
        const sky = ctx.createLinearGradient(0, 0, 0, H * 0.65);
        sky.addColorStop(0, '#bce4ff');
        sky.addColorStop(1, '#ffd6a8');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H * 0.7);

        // Ground
        ctx.fillStyle = '#86c06b';
        ctx.fillRect(0, H * 0.7, W, H * 0.3);

        // Sun
        ctx.fillStyle = '#ffd84d';
        ctx.beginPath();
        ctx.arc(W * 0.78, H * 0.22, Math.min(W, H) * 0.07, 0, Math.PI * 2);
        ctx.fill();

        // Distant hills
        ctx.fillStyle = '#5a8f4f';
        ctx.beginPath();
        ctx.moveTo(0, H * 0.7);
        ctx.lineTo(W * 0.22, H * 0.45);
        ctx.lineTo(W * 0.42, H * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(W * 0.35, H * 0.7);
        ctx.lineTo(W * 0.6, H * 0.4);
        ctx.lineTo(W * 0.85, H * 0.7);
        ctx.closePath();
        ctx.fill();

        // A little tree
        ctx.fillStyle = '#6b4423';
        ctx.fillRect(W * 0.18 - 6, H * 0.74, 12, H * 0.1);
        ctx.fillStyle = '#3f7d3a';
        ctx.beginPath();
        ctx.arc(W * 0.18, H * 0.72, Math.min(W, H) * 0.05, 0, Math.PI * 2);
        ctx.fill();

        // Freehand "signature" pencil stroke
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const baseX = W * 0.04;
        const baseY = H * 0.92;
        ctx.moveTo(baseX, baseY);
        ctx.bezierCurveTo(baseX + 18, baseY - 14, baseX + 36, baseY + 4, baseX + 54, baseY - 10);
        ctx.bezierCurveTo(baseX + 72, baseY - 6, baseX + 90, baseY - 18, baseX + 110, baseY - 4);
        ctx.stroke();
      });
      await page.waitForTimeout(300);
    }
  },
  {
    url: `${BASE_URL}/stock/`,
    output: 'stock/stock-preview.png',
    title: 'Stock Ticker'
  },
  {
    url: `${BASE_URL}/code-ide/`,
    output: 'code-ide/code-ide-preview.png',
    title: 'Code IDE',
    // Empty welcome screen renders the "Code IDE" title in faint grey
    // that's nearly invisible at OG dimensions. Loading the sample
    // project opens /sample/index.js automatically and sells the
    // whole point of the app — a real Monaco editor in the browser.
    setup: async (page) => {
      await page.click('button[data-welcome="sample"]');
      await page.waitForSelector('#welcome.hidden', { timeout: 5000 }).catch(() => {});
      await page.waitForSelector('.monaco-editor', { timeout: 10000 });
      // loadSampleProject creates 3 files in quick succession; each
      // fs change fires a concurrent tree.render() so the sidebar
      // ends up with 3x duplicated rows. Wait for the storm to
      // settle, then dedupe identical .tree-node[data-path] rows.
      await page.waitForTimeout(2000);
      await page.evaluate(() => {
        const tree = document.getElementById('tree');
        if (!tree) return;
        const seen = new Set();
        for (const node of Array.from(tree.querySelectorAll('.tree-node'))) {
          const p = node.getAttribute('data-path') || '';
          if (seen.has(p)) {
            node.remove();
          } else {
            seen.add(p);
          }
        }
      });
      await page.waitForTimeout(300);
    }
  },
  {
    url: `${BASE_URL}/clock/`,
    output: 'clock/clock-preview.png',
    title: 'Clock',
    // Digital face looks like every other clock site. Flip face
    // (split-flap digits) is the visual differentiator and shows
    // off the most interesting render mode the app supports.
    setup: async (page) => {
      await page.click('button.face-btn[data-face="flip"]');
      await page.waitForTimeout(800);
    }
  },
  {
    url: `${BASE_URL}/starwars/`,
    output: 'starwars/starwars-preview.png',
    title: 'Star Wars ASCII'
  },
  {
    url: `${BASE_URL}/ascii/`,
    output: 'ascii/ascii-preview.png',
    title: 'ASCII Art',
    // Empty drop zone with monochrome controls doesn't sell the app.
    // Set the hidden file input directly with the Ghostscript tiger
    // so the converter runs its real pipeline and the preview shows
    // an actual ASCII rendering rather than the upload prompt.
    setup: async (page) => {
      try {
        await page.setInputFiles('#file-input', 'assets/ghostscript_tiger.svg');
        await page.waitForFunction(
          () => {
            const overlay = /** @type {HTMLElement | null} */ (
              document.getElementById('overlay-msg')
            );
            return !overlay || overlay.style.display === 'none' || !overlay.offsetHeight;
          },
          { timeout: 5000 }
        );
      } catch {
        // best-effort — leave default capture if the input flow rejects
      }
      await page.waitForTimeout(800);
    }
  },
  {
    url: `${BASE_URL}/countdown/`,
    output: 'countdown/countdown-preview.png',
    title: 'Countdown'
  },
  {
    url: `${BASE_URL}/pacman-infinite/`,
    output: 'pacman-infinite/pacman-infinite-preview.png',
    title: 'Pacman Infinite'
  },
  {
    url: `${BASE_URL}/listen/`,
    output: 'listen/listen-preview.png',
    title: 'Listen'
  },
  {
    url: `${BASE_URL}/read/`,
    output: 'read/read-preview.png',
    title: 'Read'
  },
  {
    url: `${BASE_URL}/chat/`,
    output: 'chat/chat-preview.png',
    title: 'Chat',
    // The chat app gates the UI on WebGPU. Headless Chromium does not
    // expose WebGPU, so the page renders a "browser unsupported" error
    // banner — useless for an OG/preview image. Hide the banner and
    // restore the composer so the preview shows the actual empty-chat
    // experience users see when WebGPU is available.
    setup: async (page) => {
      await page.addStyleTag({
        content: '#chat-unsupported { display: none !important; }'
      });
      await page.evaluate(() => {
        const input = document.getElementById('chat-input');
        if (input instanceof HTMLTextAreaElement) {
          input.disabled = false;
          input.placeholder = 'Ask anything… (Enter to send, Shift+Enter for newline)';
        }
        const send = document.getElementById('chat-send');
        if (send instanceof HTMLButtonElement) send.disabled = false;
        const attach = document.getElementById('chat-attach-btn');
        if (attach instanceof HTMLButtonElement) attach.disabled = false;
        const modeLine = document.getElementById('chat-mode-line');
        if (modeLine) modeLine.textContent = 'Local model';
      });
    }
  },
  {
    url: `${BASE_URL}/about/`,
    output: 'about/about-preview.png',
    title: 'About Joe Heyming'
  },
  {
    url: `${BASE_URL}/imagine/`,
    output: 'imagine/imagine-preview.png',
    title: 'Imagine',
    // Same WebGPU-gate workaround as /chat/: headless Chromium does
    // not expose WebGPU, so the page renders the "browser unsupported"
    // banner. Hide it and reveal the install card so the preview
    // shows the actual landing experience.
    setup: async (page) => {
      await page.addStyleTag({
        content:
          '#imagine-unsupported { display: none !important; } ' +
          '#imagine-install { display: flex !important; } ' +
          '#imagine-prompt:disabled, #imagine-generate-btn:disabled, #imagine-install-btn:disabled { opacity: 1 !important; cursor: text !important; }'
      });
      await page.evaluate(() => {
        const install = document.getElementById('imagine-install');
        if (install) install.removeAttribute('hidden');
        const prompt = document.getElementById('imagine-prompt');
        if (prompt instanceof HTMLTextAreaElement) {
          prompt.disabled = false;
          prompt.value = 'a cozy cabin in a snowy forest, watercolor';
        }
        const gen = document.getElementById('imagine-generate-btn');
        if (gen instanceof HTMLButtonElement) gen.disabled = false;
        const installBtn = document.getElementById('imagine-install-btn');
        if (installBtn instanceof HTMLButtonElement) installBtn.disabled = false;
        const modeLine = document.getElementById('imagine-mode-line');
        if (modeLine) modeLine.textContent = 'Local · sd-turbo · ~2.3 GB install required';
      });
    }
  },
  {
    url: `${BASE_URL}/surf/`,
    output: 'surf/surf-preview.png',
    title: 'Surf HTML Viewer',
    // The default landing is one wave emoji on a blank page — gives
    // a search visitor zero context. Inject a sample HTML doc into
    // the sandboxed iframe via srcdoc and flip the empty-state toggles
    // so the preview shows the app actually rendering a page.
    setup: async (page) => {
      await page.evaluate(() => {
        const html = [
          '<!doctype html>',
          '<html lang="en">',
          '<head>',
          '<meta charset="utf-8">',
          '<title>Preview</title>',
          '<style>',
          'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#111;padding:32px 40px;line-height:1.55;max-width:640px;margin:0 auto;}',
          'h1{font-size:28px;margin:0 0 8px;}',
          '.byline{color:#666;font-size:13px;margin-bottom:18px;}',
          'p{margin:0 0 12px;}',
          'code{background:#f3f3f3;padding:2px 6px;border-radius:4px;font-size:13px;}',
          '</style>',
          '</head>',
          '<body>',
          '<h1>Surf renders local HTML in a sandboxed iframe</h1>',
          '<p class="byline">preview.html · sandbox: <code>allow-scripts allow-same-origin</code></p>',
          '<p>Drop any <code>.html</code> file from disk and Surf shows it inline, with a Source toggle and a New Tab button.</p>',
          '<p>Useful for previewing static pages, debugging exported HTML, or peeking at a saved web archive without launching the full browser.</p>',
          '</body>',
          '</html>'
        ].join('\n');
        const landing = document.getElementById('landing');
        const source = document.getElementById('source-view');
        const frame = /** @type {HTMLIFrameElement | null} */ (
          document.getElementById('html-frame')
        );
        const info = document.getElementById('file-info');
        const newTab = /** @type {HTMLButtonElement | null} */ (
          document.getElementById('btn-new-tab')
        );
        if (landing) landing.classList.remove('active');
        if (source) source.classList.add('hidden');
        if (frame) {
          frame.classList.remove('hidden');
          frame.srcdoc = html;
        }
        if (info) info.textContent = 'preview.html';
        if (newTab) newTab.disabled = false;
      });
      await page.waitForTimeout(800);
    }
  },
  {
    url: `${BASE_URL}/filemanager/`,
    output: 'filemanager/filemanager-preview.png',
    title: 'File Manager',
    // Default landing is the empty ~/user home (all 📁 folders, no
    // distinguishing content). Seed a /tmp/preview folder with mixed
    // file types and navigate into it so the preview shows variety:
    // documents, images, audio, video, code, archives.
    setup: async (page) => {
      await page.waitForFunction(
        () =>
          /** @type {any} */ (window).fileManager?.fs?.isInitialized ||
          /** @type {any} */ (window).fileManager?.fs,
        { timeout: 5000 }
      );
      await page.evaluate(async () => {
        const fm = /** @type {any} */ (window).fileManager;
        if (!fm?.fs) return;
        const fs = fm.fs;
        const path = '/tmp/preview';
        try {
          await fs.createDirectory(path).catch(() => {});
          const seeds = [
            ['notes.txt', 'Some notes.'],
            ['photo.png', ''],
            ['vacation.jpg', ''],
            ['demo.mp4', ''],
            ['song.mp3', ''],
            ['album.flac', ''],
            ['index.html', '<!doctype html><title>hi</title>'],
            ['app.js', 'console.log("hi");'],
            ['style.css', 'body{margin:0}'],
            ['data.json', '{"ok":true}'],
            ['readme.md', '# Readme'],
            ['archive.zip', ''],
            ['contract.pdf', '']
          ];
          for (const [name, body] of seeds) {
            await fs.createFile(`${path}/${name}`, body, true).catch(() => {});
          }
          await fm.navigateTo(path);
        } catch {
          // best-effort — leave default view if anything throws
        }
      });
      await page.waitForTimeout(800);
    }
  },
  {
    url: `${BASE_URL}/image-viewer/`,
    output: 'image-viewer/image-viewer-preview.png',
    title: 'Image Viewer',
    // Empty drop zone with a picture-frame emoji looks identical to
    // every other file-drop viewer. Load the classic Ghostscript
    // tiger SVG so the preview shows a real, colorful image being
    // viewed (the viewer is also a real SVG renderer).
    setup: async (page) => {
      // #image lives inside #image-wrapper.hidden so the element is
      // attached but not visible until we flip the empty state — use
      // state:'attached' instead of the default visibility check.
      await page.waitForSelector('#image', { state: 'attached', timeout: 5000 });
      await page.evaluate(async () => {
        const drop = document.getElementById('drop-zone');
        const wrap = document.getElementById('image-wrapper');
        const img = /** @type {HTMLImageElement | null} */ (document.getElementById('image'));
        const container = document.getElementById('image-container');
        const info = document.getElementById('image-info');
        const zoom = document.getElementById('zoom-level');
        if (!drop || !wrap || !img || !container) return;

        drop.classList.remove('active');
        wrap.classList.remove('hidden');

        document.querySelectorAll('button[disabled]').forEach((b) => b.removeAttribute('disabled'));

        // The Ghostscript tiger SVG ships without width/height
        // attributes, so Chromium reports naturalSize as 150×150
        // and the image renders as a small dot. Fetch it, inject
        // explicit dimensions matching the viewBox, and load via
        // a blob URL so the viewer gets proper natural dimensions.
        let url = '/assets/ghostscript_tiger.svg';
        let natW = 900;
        let natH = 900;
        try {
          const r = await fetch(url);
          const txt = await r.text();
          const fixed = txt.replace(/<svg([^>]*?)>/, '<svg$1 width="900" height="900">');
          const blob = new Blob([fixed], { type: 'image/svg+xml' });
          url = URL.createObjectURL(blob);
        } catch {
          // fall through with original URL
        }

        await new Promise((resolve) => {
          img.onload = () => resolve(undefined);
          img.onerror = () => resolve(undefined);
          img.src = url;
        });

        natW = img.naturalWidth || natW;
        natH = img.naturalHeight || natH;
        const wrapperRect = wrap.getBoundingClientRect();
        const scaleX = wrapperRect.width / natW;
        const scaleY = wrapperRect.height / natH;
        const scale = Math.min(scaleX, scaleY, 1) * 0.95;
        container.style.transform = `translate(0px, 0px) scale(${scale}) rotate(0deg)`;
        if (zoom) zoom.textContent = `${Math.round(scale * 100)}%`;
        if (info) info.textContent = `tiger.svg • ${natW}×${natH}`;
      });
      await page.waitForTimeout(600);
    }
  },
  {
    url: `${BASE_URL}/programming-advice/`,
    output: 'programming-advice/programming-advice-preview.png',
    title: 'Programming Wisdom'
  },
  {
    url: `${BASE_URL}/pacman/`,
    output: 'pacman/pacman-preview.png',
    title: 'Pac-Man'
  },
  {
    url: `${BASE_URL}/minesweeper/`,
    output: 'minesweeper/minesweeper-preview.png',
    title: 'Minesweeper'
  },
  {
    url: `${BASE_URL}/sudoku/`,
    output: 'sudoku/sudoku-preview.png',
    title: 'Sudoku'
  },
  {
    url: `${BASE_URL}/untangle/`,
    output: 'untangle/untangle-preview.png',
    title: 'Untangle',
    // Seed a mid-size tangled layout so the OG card shows crossings,
    // not a tiny level-1 hex.
    setup: async (page) => {
      await page.waitForFunction(() => window.untangleGame, { timeout: 5000 }).catch(() => {});
      await page.evaluate(() => {
        if (window.untangleGame) window.untangleGame.startLevel(3);
      });
      await page.waitForTimeout(400);
    }
  },
  {
    url: `${BASE_URL}/2048/`,
    output: '2048/2048-preview.png',
    title: '2048',
    // Default capture is two random low-value tiles on a near-empty
    // board, which doesn't read as "2048" at OG dimensions. Seed a
    // mid-game position with a 1024 + 512 + 256 ladder so the preview
    // shows the iconic warm-color tile cascade the game is known for.
    setup: async (page) => {
      await page.evaluate(() => {
        const tiles = document.getElementById('tiles');
        const score = document.getElementById('score');
        const best = document.getElementById('best');
        if (!tiles) return;
        tiles.replaceChildren();
        // Hand-placed snapshot — picks values across the warm palette
        // tier (8/16/32/64) plus a 128/256/512/1024 ladder so the
        // preview reads as a real, satisfying mid-game state.
        const layout = [
          [2, 4, 8, 16],
          [4, 16, 32, 64],
          [8, 32, 128, 256],
          [64, 512, 1024, 2048]
        ];
        let id = 1;
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            const v = layout[r][c];
            const el = document.createElement('div');
            el.className = 'tile';
            el.dataset.id = String(id++);
            el.dataset.value = String(v);
            el.textContent = String(v);
            const x = `calc((var(--cell-size) + var(--gap)) * ${c})`;
            const y = `calc((var(--cell-size) + var(--gap)) * ${r})`;
            el.style.transform = `translate(${x}, ${y})`;
            tiles.appendChild(el);
          }
        }
        if (score) score.textContent = '11380';
        if (best) best.textContent = '24576';
      });
      await page.waitForTimeout(300);
    }
  },
  {
    url: `${BASE_URL}/trivia/`,
    output: 'trivia/trivia-preview.png',
    title: 'Trivia'
  },
  {
    url: `${BASE_URL}/triplog/`,
    output: 'triplog/triplog-preview.png',
    title: 'Trip Log',
    // Default capture shows a world-view Leaflet map with every stat
    // at 0. The triplog state object isn't exposed on window, so we
    // can't cleanly inject a real trip — but we can populate the
    // stats rows (which IS visible in the OG card) so the preview
    // reads as "an active recording" rather than "no data."
    setup: async (page) => {
      await page.waitForSelector('#app-main:not([hidden])', { timeout: 5000 }).catch(() => {});
      await page.evaluate(() => {
        const set = (id, text) => {
          const el = document.getElementById(id);
          if (el) el.textContent = text;
        };
        set('stat-distance', '5.20 km');
        set('stat-duration', '32:15');
        set('stat-elapsed', '35:42');
        set('stat-speed', '6:12 /km');
        set('stat-avg-speed', '6:45 /km');
        set('stat-elevation', '42 m');
        set('stat-accuracy', '±8 m');
      });
      await page.waitForTimeout(400);
    }
  },
  {
    url: `${BASE_URL}/media-player/`,
    output: 'media-player/media-player-preview.png',
    title: 'Media Player',
    // Empty drop zone with a music-note emoji is the same generic
    // empty state as image-viewer and model-viewer. There are no
    // bundled media files to point at, so fake an "audio is loaded"
    // state in the DOM (the audio-visual cover-art panel plus
    // populated track / time text) — looks like a real player.
    setup: async (page) => {
      // Paint fake spectrum-analyzer bars onto the viz canvas so the
      // mock-loaded state doesn't show an empty white rectangle where
      // the visualizer would normally render.
      await page.addStyleTag({
        content:
          '#audio-visual .album-art { font-size: 96px !important; line-height: 1; margin-bottom: 18px !important; }'
      });
      await page.evaluate(() => {
        const drop = document.getElementById('drop-zone');
        const wrap = document.getElementById('media-wrapper');
        const visual = document.getElementById('audio-visual');
        const title = document.getElementById('audio-title');
        const artist = document.getElementById('audio-artist');
        const name = document.getElementById('media-name');
        const time = document.getElementById('time-display');
        if (drop) drop.classList.remove('active');
        if (wrap) {
          wrap.classList.remove('hidden');
          wrap.classList.add('audio-mode');
        }
        if (visual) visual.classList.add('visible');
        if (title) title.textContent = 'Clair de Lune';
        if (artist) artist.textContent = 'Claude Debussy';
        if (name) name.textContent = 'clair-de-lune.mp3';
        if (time) time.textContent = '1:42 / 4:58';
        document.querySelectorAll('button[disabled]').forEach((b) => b.removeAttribute('disabled'));

        const viz = /** @type {HTMLCanvasElement | null} */ (document.getElementById('viz-canvas'));
        if (viz) {
          const rect = viz.getBoundingClientRect();
          viz.width = Math.max(Math.floor(rect.width), 600);
          viz.height = Math.max(Math.floor(rect.height), 100);
          const ctx = viz.getContext('2d');
          if (ctx) {
            const W = viz.width;
            const H = viz.height;
            ctx.clearRect(0, 0, W, H);
            const bars = 48;
            const gap = 4;
            const barW = (W - gap * (bars + 1)) / bars;
            for (let i = 0; i < bars; i++) {
              const t = i / (bars - 1);
              const envelope = Math.sin(t * Math.PI) ** 1.3;
              const wobble = 0.55 + 0.45 * Math.sin(i * 1.7) * Math.cos(i * 0.6);
              const h = H * (0.18 + envelope * wobble * 0.78);
              const grad = ctx.createLinearGradient(0, H - h, 0, H);
              grad.addColorStop(0, '#7dd3fc');
              grad.addColorStop(1, '#0369a1');
              ctx.fillStyle = grad;
              const x = gap + i * (barW + gap);
              ctx.fillRect(x, H - h, barW, h);
            }
          }
        }
      });
      await page.waitForTimeout(400);
    }
  },
  {
    url: `${BASE_URL}/checkboxes/`,
    output: 'checkboxes/checkboxes-preview.png',
    title: 'Checkboxes',
    // 1M-cell version renders to canvas tiles, not DOM. The grid's
    // column count depends on viewport width (auto-fill at runtime),
    // so we read it back from the inline width on #cb-grid before
    // computing where to stamp the heart pattern. Then:
    //   1. Sparse random scatter across the visible top rows so the
    //      OG card reads as "lots of people clicking."
    //   2. A centered heart shape stamped on top — recognizable at
    //      thumbnail size, ties back to the original 32×32 preview.
    // The app exposes window.cbState (the packed bitmap) and
    // window.cbPaintAll (full repaint) for exactly this purpose.
    setup: async (page) => {
      await page.waitForSelector('#cb-grid .cb-tile', { timeout: 8000 });
      // Let the IntersectionObserver mount the visible tiles before
      // we try to repaint — they paint from `state` at mount time.
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const state = /** @type {Uint8Array | undefined} */ (w.cbState);
        const repaint = /** @type {(() => void) | undefined} */ (w.cbPaintAll);
        if (!state || !repaint) return;

        // Reverse-engineer COLS from the grid container's inline width
        // (set in index.js as `COLS * STEP - GAP` px, with STEP=20, GAP=4).
        const grid = document.getElementById('cb-grid');
        if (!grid) return;
        const widthPx = parseInt(grid.style.width, 10);
        if (!isFinite(widthPx) || widthPx <= 0) return;
        const STEP = 20;
        const GAP = 4;
        const COLS = Math.floor((widthPx + GAP) / STEP);
        const N = state.length * 8;
        const setBit = (idx) => {
          if (idx < 0 || idx >= N) return;
          state[idx >> 3] |= 1 << (idx & 7);
        };

        // 1. Seeded random scatter across the first ~35 rows (the area
        //    inside the 1200×630 OG viewport). Density ~10% reads as
        //    "active" without crowding out the heart.
        let seed = 73431;
        const rand = () => {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          return seed / 0x7fffffff;
        };
        const SCATTER_ROWS = 35;
        for (let r = 0; r < SCATTER_ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (rand() < 0.1) setBit(r * COLS + c);
          }
        }

        // 2. Stamp a centered heart. 32 wide × 13 tall — fits inside
        //    any viewport COLS >= 36. Skip on narrow grids (mobile-
        //    sized OG renders, which we don't currently produce).
        const heart = [
          '...........XX........XX.........',
          '..........XXXX......XXXX........',
          '.........XXXXXX....XXXXXX.......',
          '........XXXXXXXX..XXXXXXXX......',
          '........XXXXXXXXXXXXXXXXXX......',
          '.........XXXXXXXXXXXXXXXX.......',
          '..........XXXXXXXXXXXXXX........',
          '...........XXXXXXXXXXXX.........',
          '............XXXXXXXXXX..........',
          '.............XXXXXXXX...........',
          '..............XXXXXX............',
          '...............XXXX.............',
          '................XX..............'
        ];
        const HW = 32;
        const HH = heart.length;
        if (COLS >= HW + 4) {
          const startRow = 5;
          const startCol = Math.floor((COLS - HW) / 2);
          for (let r = 0; r < HH; r++) {
            for (let c = 0; c < HW; c++) {
              if (heart[r][c] === 'X') setBit((startRow + r) * COLS + (startCol + c));
            }
          }
        }

        // Counter, status, banner — make the page read like a real session.
        let count = 0;
        for (let i = 0; i < state.length; i++) {
          let b = state[i];
          while (b) {
            b &= b - 1;
            count++;
          }
        }
        const checkedEl = document.getElementById('cb-checked');
        if (checkedEl) checkedEl.textContent = count.toLocaleString();
        const status = document.getElementById('cb-status');
        if (status) status.textContent = 'live';
        const banner = document.getElementById('cb-banner');
        if (banner) banner.hidden = true;

        repaint();
      });
      await page.waitForTimeout(500);
    }
  },
  {
    url: `${BASE_URL}/airwave/`,
    output: 'airwave/airwave-preview.png',
    title: 'Airwave - YouTube as Audio'
  },
  {
    url: `${BASE_URL}/vibe-coding/`,
    output: 'vibe-coding/vibe-coding-preview.png',
    title: 'Vibe Coding'
  },
  {
    url: `${BASE_URL}/weather/`,
    output: 'weather/weather-preview.png',
    title: 'Weather',
    // Empty state ("No locations yet" + city pills) doesn't sell
    // the app. Click all four suggested-city pills so the preview
    // shows real tiles with live forecast data from Open-Meteo.
    setup: async (page) => {
      for (const city of ['Seattle', 'New York', 'Paris', 'Tokyo']) {
        await page
          .locator(`button.suggested[data-add-suggested*="${city}"]`)
          .click()
          .catch(() => {});
      }
      await page
        .waitForSelector('#tiles:not(.hidden) .weather-tile', { timeout: 5000 })
        .catch(() => {});
      // Wait for live forecast values so tiles don't show "Loading…"
      await page
        .waitForFunction(() => document.querySelectorAll('.weather-tile .tile-temp').length >= 4, {
          timeout: 15000
        })
        .catch(() => {});
      await page.waitForTimeout(1000);
    }
  },
  {
    url: `${BASE_URL}/meme/`,
    output: 'meme/meme-preview.png',
    title: 'Meme Generator',
    // The default landing loads the Drake template with empty boxes.
    // For the OG image we swap to a wider template + caption so the
    // 1200x630 social card actually reads as a meme generator, not a
    // dark UI with a placeholder.
    setup: async (page) => {
      await page.waitForSelector('.tpl-card[data-id="this-is-fine"]', { timeout: 10000 });
      await page.click('.tpl-card[data-id="this-is-fine"]');
      await page.waitForFunction(
        () => document.querySelector('#stage')?.dataset.loaded === '1',
        null,
        { timeout: 8000 }
      );
      const textareas = await page.$$('textarea[data-field="text"]');
      if (textareas[0]) {
        await textareas[0].fill('WHEN A MEME GENERATOR');
        await textareas[0].dispatchEvent('input');
      }
      if (textareas[1]) {
        await textareas[1].fill('HAS NO WATERMARK');
        await textareas[1].dispatchEvent('input');
      }
      // Let one paint cycle settle so the canvas reflects the typing.
      await page.waitForTimeout(400);
    }
  },
  {
    url: `${BASE_URL}/pacman-builder/`,
    output: 'pacman-builder/pacman-builder-preview.png',
    title: 'Pac-Man Level Builder'
  },
  {
    url: `${BASE_URL}/posts/`,
    output: 'posts/posts-preview.png',
    title: 'Posts'
  }
];

async function ensureDirectoryExists(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
}

async function takeScreenshot(page, pageConfig) {
  try {
    // Check if preview already exists (unless force regenerate is enabled)
    if (!FORCE_REGENERATE && fs.existsSync(pageConfig.output)) {
      console.log(`⏭️  Skipping ${pageConfig.title} - preview already exists`);
      console.log(`   File: ${pageConfig.output}`);
      return;
    }

    console.log(`📸 Capturing ${pageConfig.title}...`);
    console.log(`   URL: ${pageConfig.url}`);

    // Two-phase navigation. We *prefer* networkidle so dynamic content
    // (lazy fonts, async data fetches) settles before capture, but a
    // handful of pages (e.g. /read/, /about/) keep cross-origin
    // fetches alive via window.proxyService and never reach the
    // 500ms-of-idle threshold. Falling back to a domcontentloaded
    // wait + a fixed settle window lets those pages still produce a
    // useful screenshot instead of a stale or missing one.
    try {
      await page.goto(pageConfig.url, {
        waitUntil: 'networkidle',
        timeout: 15000
      });
    } catch (gotoErr) {
      console.warn(
        `   ⚠️  networkidle wait timed out for ${pageConfig.title} — falling back to domcontentloaded`
      );
      await page.goto(pageConfig.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      // Give the fallback page extra time so any above-the-fold
      // hydration that *would* have completed during networkidle
      // still has a chance to paint before we capture.
      await page.waitForTimeout(2000);
    }

    // Wait a bit for any animations or dynamic content
    await page.waitForTimeout(2000);

    // Try to close any modals or overlays that might be blocking the view
    try {
      // Common modal close patterns
      await page.click('[id*="close"], [class*="close"], .modal-close, #initialMenu button', {
        timeout: 1000
      });
    } catch (e) {
      // Ignore if no modals found
    }

    // Wait another moment after closing modals
    await page.waitForTimeout(1000);

    // Per-page setup hook — runs after the page has settled so it can
    // do things like hiding capability-gate banners (e.g. the chat app's
    // WebGPU error banner that always shows in headless Chromium) or
    // dismissing onboarding panels that would otherwise dominate the
    // OG image. Hooks are async so they can `await` style/eval calls.
    if (typeof pageConfig.setup === 'function') {
      try {
        await pageConfig.setup(page);
        // Brief wait so any layout reflow from the hook lands before capture.
        await page.waitForTimeout(300);
      } catch (err) {
        console.warn(`   ⚠️  setup hook for ${pageConfig.title} threw: ${err.message}`);
      }
    }

    // Ensure output directory exists
    await ensureDirectoryExists(pageConfig.output);

    // Take screenshot
    await page.screenshot({
      path: pageConfig.output,
      fullPage: false, // Use viewport size
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height }
    });

    console.log(`✅ Saved: ${pageConfig.output}`);
  } catch (error) {
    console.error(`❌ Failed to capture ${pageConfig.title}:`, error.message);
  }
}

async function generatePreviews() {
  console.log('🚀 Starting preview image generation...');
  console.log(`📐 Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log(`🔄 Force regenerate: ${FORCE_REGENERATE ? 'YES' : 'NO'}`);
  console.log(`📊 Total pages: ${PAGES.length}`);
  console.log('');

  // Count existing files
  const existingFiles = PAGES.filter((page) => fs.existsSync(page.output));
  if (!FORCE_REGENERATE && existingFiles.length > 0) {
    console.log(`ℹ️  Found ${existingFiles.length} existing preview(s) - will skip these`);
    console.log(`📸 Will generate ${PAGES.length - existingFiles.length} new preview(s)`);
    console.log('');
  }

  // Hoisted so the summary block below can read these counters.
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  // Launch browser
  const browser = await chromium.launch({
    headless: true // Set to false if you want to see the browser
  });

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1
    });

    const page = await context.newPage();

    // Set user agent to avoid any bot detection
    await page.setExtraHTTPHeaders({
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    for (const pageConfig of PAGES) {
      const existedBefore = fs.existsSync(pageConfig.output);

      try {
        await takeScreenshot(page, pageConfig);

        // Check if file was created
        if (!existedBefore && fs.existsSync(pageConfig.output)) {
          generated++;
        } else if (existedBefore && !FORCE_REGENERATE) {
          skipped++;
        }
      } catch (error) {
        failed++;
      }
    }
  } finally {
    await browser.close();
  }

  console.log('');
  console.log('🎉 Preview generation complete!');
  console.log('');
  console.log('📊 Summary:');
  console.log(`   📸 Generated: ${generated} new preview(s)`);
  console.log(`   ⏭️  Skipped: ${skipped} existing preview(s)`);
  if (failed > 0) {
    console.log(`   ❌ Failed: ${failed} preview(s)`);
  }
  console.log('');
  console.log('📋 All preview files:');
  PAGES.forEach((page) => {
    const exists = fs.existsSync(page.output);
    const status = exists ? '✅' : '❌';
    console.log(`   ${status} ${page.output}`);
  });
  console.log('');
  console.log('💡 Next steps:');
  console.log('   1. Check the generated images');
  console.log('   2. Commit and push to GitHub');
  console.log('   3. Test social media sharing!');
}

// Handle errors gracefully
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});

// Check if server is running
async function checkServer() {
  try {
    const response = await fetch(BASE_URL);
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    console.log('✅ Local server is running');
    return true;
  } catch (error) {
    console.error('❌ Local server not accessible:', error.message);
    console.log('');
    console.log('💡 Please start your local server first:');
    console.log('   python -m http.server 8000');
    console.log('   # or');
    console.log('   npx serve -p 8000');
    console.log('');
    return false;
  }
}

// Main execution
async function main() {
  // Check if server is running first
  const serverRunning = await checkServer();
  if (!serverRunning) {
    process.exit(1);
  }

  // Generate previews
  await generatePreviews();
}

// Run the script
main().catch(console.error);
