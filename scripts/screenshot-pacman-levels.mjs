#!/usr/bin/env node
/**
 * Screenshot every Pacman level in birds-eye mode and save a PNG next to
 * its JSON in pacman/levels/. The file name matches the JSON name
 * (`level0.json` -> `level0.png`) so they sort together in a file browser.
 *
 *   node scripts/screenshot-pacman-levels.mjs              # only missing PNGs
 *   node scripts/screenshot-pacman-levels.mjs --force      # regenerate all
 *   node scripts/screenshot-pacman-levels.mjs level0 ...   # subset by name
 *
 * Requires a local server on port 8000 (auto-spawned with `python3 -m
 * http.server 8000` if not already running).
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const LEVELS_DIR = path.join(REPO, 'pacman/levels');
const PORT = 8000;
const VIEWPORT = { width: 1024, height: 1024 }; // square — full maze fits

const FORCE = process.argv.includes('--force') || process.argv.includes('-f');
const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));

function pingPort(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection(port, '127.0.0.1');
    sock.once('connect', () => {
      sock.end();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
    setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 500);
  });
}

async function ensureServer() {
  if (await pingPort(PORT)) return null;
  console.log(`Spawning http.server on :${PORT}`);
  const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: REPO,
    stdio: 'ignore',
    detached: true
  });
  proc.unref();
  for (let i = 0; i < 20; i++) {
    if (await pingPort(PORT)) return proc;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server on :${PORT} did not come up`);
}

async function main() {
  const allLevels = fs
    .readdirSync(LEVELS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();

  const levels = args.length ? allLevels.filter((n) => args.includes(n)) : allLevels;
  if (levels.length === 0) {
    console.error('No matching levels.');
    process.exit(1);
  }

  await ensureServer();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();

  let made = 0;
  let skipped = 0;
  for (const name of levels) {
    const outPath = path.join(LEVELS_DIR, `${name}.png`);
    if (!FORCE && fs.existsSync(outPath)) {
      console.log(`✓ ${name}.png (exists, skip)`);
      skipped++;
      continue;
    }

    const url = `http://localhost:${PORT}/pacman/?level=${name}&startcamera=birdseye&debug=true`;
    console.log(`→ ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Wait for the game to fully boot (Game.init is async).
    await page.waitForFunction(() => !!window.game?.level && !!window.game?.pacman, null, {
      timeout: 20_000
    });

    // Click START and let one render frame go by so Pacman + ghosts are placed.
    await page.click('#start-btn');
    await page.waitForTimeout(500);

    // Hide UI overlays that occlude the maze: hint banners, intro screen, HUD.
    await page.evaluate(() => {
      const ids = ['intro-screen', 'pause-screen', 'game-over-screen', 'win-screen'];
      for (const id of ids) document.getElementById(id)?.classList.add('hidden');
    });

    await page.screenshot({ path: outPath });
    console.log(`✓ ${name}.png`);
    made++;
  }

  await browser.close();
  console.log(`\nDone. Made ${made}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
