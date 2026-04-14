// git — real repos via isomorphic-git + IndexedDB; network GETs use proxy.js (like curl), POST is direct fetch (CORS).
import { createJshGitFs } from '../../lib/jsh-git-fs.js';
import { createJshGitHttp } from '../../lib/jsh-git-http.js';
import { createBoundedGitCache, clearGitCache } from '../../lib/jsh-git-cache.js';

const ISO_GIT_URL = 'https://esm.sh/isomorphic-git@1.25.10?bundle';

const GIT_HELP = `Usage: git [--help] [-h] <command> [<args>]

jsh git uses isomorphic-git in your browser with the same virtual filesystem as
ls/touch (IndexedDB). Network / CORS:

  • clone, fetch, pull, and push default to corsProxy https://cors.isomorphic-git.org
    (the @isomorphic-git/cors-proxy service). It forwards git smart HTTP (GET
    info/refs, POST git-upload-pack / git-receive-pack) with CORS. Public clone/fetch
    work without login. push needs a GitHub PAT (see below); tokens in the browser
    are visible on this machine — use a fine-scoped PAT.

  • Set JSH_GIT_CORS_PROXY (env or window.JSH_GIT_CORS_PROXY) to your own proxy
    base URL, or to 0 / false / off to disable and hit remotes directly (usually
    fails for github.com from the browser).

  • curl-style proxy.js is only used for non-corsProxy URLs (raw GETs).

  • Huge packs: default max download size is 128 MiB per fetch. Override with
    window.JSH_GIT_MAX_PACK_BYTES = 200000000 (example); very large values can
    crash the tab (Aw, Snap).

  • IndexedDB vs OOM: Application → Storage shows on-disk usage (e.g. 100+ MiB for packs).
    "Aw, Snap" is the tab’s JavaScript heap while parsing or checkout — not the same limit.
    For big repos try: git clone --depth 1 --no-checkout <url> then git checkout <branch>
    later; rm -rf old clone dirs to shrink IndexedDB.

Commands:
  init [path]              Create a repository (default: current directory)
  clone [--full] [--depth N] [--no-checkout] [--all-branches] <url> [path]
                           Default: shallow (--depth 1). --no-checkout: only .git (no files);
                           run git checkout <branch> after (lowers peak RAM during clone).
                           --full = full history (may crash on big projects).
  status                   Working tree status
  log [--oneline]          Recent commits
  branch                   List branches
  checkout <ref>           Checkout branch or commit
  add [-A] [file...]       Stage files (use "." or -A for all)
  commit -m <msg>          Create a commit
  pull [remote] [branch]   Fetch and merge (same network limits as clone)
  fetch [remote]           Fetch refs only
  push [-f|--force] [remote] [branch]
                           Upload commits (run git login first, or set GITHUB_TOKEN / GIT_TOKEN).
  login <token>            Store a GitHub PAT for this session (then git push works).
                           Create one at: https://github.com/settings/personal-access-tokens/new
                           (fine-grained: pick this repo, Contents + Metadata read/write) or classic:
                           https://github.com/settings/tokens (repo scope).
  logout                   Clear stored PAT from this tab.

See also: curl (HTTP), proxy-stats (proxy health).`;

let isoGitLoadPromise = null;

async function loadIsoGit() {
  if (window.__jshIsoGit) {
    return window.__jshIsoGit;
  }
  if (!isoGitLoadPromise) {
    isoGitLoadPromise = import(ISO_GIT_URL).then((m) => {
      window.__jshIsoGit = m;
      return m;
    });
  }
  return isoGitLoadPromise;
}

function gitAuthor(terminal) {
  return {
    name: terminal.env.GIT_AUTHOR_NAME || terminal.env.USER || 'user',
    email:
      terminal.env.GIT_AUTHOR_EMAIL ||
      `${terminal.env.USER || 'user'}@${terminal.env.HOSTNAME || 'heyming-os'}.local`
  };
}

function errResult(message, code = 1) {
  return { stdout: '', stderr: `git: ${message}`, exitCode: code };
}

function takeFlagValue(args, flag) {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1]) {
    return { value: args[i + 1], without: args.filter((_, j) => j !== i && j !== i + 1) };
  }
  return { value: null, without: args };
}

/** isomorphic-git CORS proxy base (no trailing slash). Undefined = user turned git CORS off only. */
function resolveCorsProxy(terminal) {
  const fromEnv = terminal.env && terminal.env.JSH_GIT_CORS_PROXY;
  if (fromEnv !== undefined && fromEnv !== null) {
    const t = String(fromEnv).trim();
    const tl = t.toLowerCase();
    if (tl === '0' || tl === 'false' || tl === 'off') {
      return undefined;
    }
    if (t !== '') {
      return t.replace(/\/+$/, '');
    }
  }
  const win = window.JSH_GIT_CORS_PROXY;
  if (win != null && String(win).trim() !== '') {
    const w = String(win).trim();
    const wl = w.toLowerCase();
    if (wl === '0' || wl === 'false' || wl === 'off') {
      return undefined;
    }
    return w.replace(/\/+$/, '');
  }
  return 'https://cors.isomorphic-git.org';
}

/** Personal access token for git push (never log the value). */
function resolveGitCredential(terminal) {
  const e = terminal.env || {};
  const fromEnv = e.GITHUB_TOKEN || e.GIT_TOKEN;
  if (fromEnv != null && String(fromEnv).trim() !== '') {
    return String(fromEnv).trim();
  }
  const w = typeof window !== 'undefined' ? window.JSH_GIT_TOKEN : null;
  if (w != null && String(w).trim() !== '') {
    return String(w).trim();
  }
  return null;
}

/**
 * Short branch name for git.clone({ singleBranch: true, ref }) — from remote HEAD / refs.
 */
async function defaultCloneBranchName(git, http, url, corsProxy) {
  const refs = await git.listServerRefs({
    http,
    url,
    corsProxy,
    protocolVersion: 1,
    symrefs: true
  });
  for (const r of refs) {
    if (r.ref === 'HEAD' && r.target && r.target.startsWith('refs/heads/')) {
      return r.target.slice('refs/heads/'.length);
    }
  }
  for (const r of refs) {
    if (r.ref === 'refs/heads/main') {
      return 'main';
    }
  }
  for (const r of refs) {
    if (r.ref === 'refs/heads/master') {
      return 'master';
    }
  }
  for (const r of refs) {
    if (r.ref.startsWith('refs/heads/')) {
      return r.ref.replace(/^refs\/heads\//, '');
    }
  }
  throw new Error('no refs/heads/* advertised by remote');
}

function jshGitTrace(...args) {
  console.log('[jsh-git]', ...args);
  const fn = window.jshGitTrace;
  if (typeof fn === 'function') {
    fn(...args);
  }
}

/** Remove partial clone directory after a failed clone. */
async function cleanupPartialGitDir(fsClient, dest) {
  try {
    console.warn('[jsh-git] cleaning up partial clone dir:', dest);
    await fsClient.promises.rm(dest, { recursive: true, maxRetries: 10 });
  } catch (cleanupErr) {
    console.warn('[jsh-git] cleanup failed (non-fatal):', dest, cleanupErr);
  }
}

/**
 * Rebuild .idx from on-disk .pack via indexPack. Fresh cache avoids stale in-memory pack maps
 * after fetch; fixes cases where the first idx write/read round-trip through IndexedDB was wrong.
 */
async function reindexPackFiles(git, fsClient, dest, cache) {
  const packDir = `${dest}/.git/objects/pack`;
  let names;
  try {
    names = await fsClient.promises.readdir(packDir);
  } catch (readdirErr) {
    console.warn('[jsh-git] readdir failed for pack dir:', packDir, readdirErr);
    names = [];
  }
  const packs = names.filter((n) => n.endsWith('.pack'));
  jshGitTrace('reindex objects/pack', {
    packDir,
    entries: names,
    packFiles: packs
  });
  if (packs.length === 0) {
    throw new Error(
      `no .pack files under ${packDir} after fetch (empty transfer or objects not written)`
    );
  }
  for (const name of packs) {
    await git.indexPack({
      fs: fsClient,
      dir: dest,
      filepath: `.git/objects/pack/${name}`,
      cache
    });
  }
}

/**
 * If readCommit works after fetch, skip indexPack (avoids re-reading the whole pack into RAM).
 */
async function ensureFetchHeadReadable(git, fsClient, dest, fetchHeadOid, cache) {
  try {
    await git.readCommit({
      fs: fsClient,
      dir: dest,
      oid: fetchHeadOid,
      cache
    });
    jshGitTrace('pack read OK without reindex', { oid: fetchHeadOid.slice(0, 7) });
  } catch (firstErr) {
    jshGitTrace('pack read failed, reindexing', {
      oid: fetchHeadOid.slice(0, 7),
      err: firstErr && firstErr.message
    });
    await reindexPackFiles(git, fsClient, dest, cache);
    await git.readCommit({
      fs: fsClient,
      dir: dest,
      oid: fetchHeadOid,
      cache
    });
  }
}

const CHECKOUT_BATCH_SIZE = 100;
const CHECKOUT_BATCH_THRESHOLD = 100;

function newGitCache() {
  return createBoundedGitCache();
}

function releaseGitCache(cache) {
  clearGitCache(cache);
}

function formatBytes(n) {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${n} B`;
}

/**
 * Live progress line that updates in-place inside the terminal DOM.
 * Call update(text) to rewrite the line; finish() to finalize it.
 */
function createProgressWriter(terminal) {
  const outputEl = terminal.windowId
    ? document.getElementById(`window-${terminal.windowId}`)?.querySelector('.terminal-content')
    : document.getElementById('terminal-output');
  if (!outputEl) return null;
  const el = document.createElement('div');
  el.className = 'terminal-output git-progress';
  el.textContent = '';
  outputEl.appendChild(el);
  const scroll = () => {
    const s = document.getElementById('terminal-scroll');
    if (s) {
      s.scrollTop = s.scrollHeight;
    } else {
      outputEl.scrollTop = outputEl.scrollHeight;
    }
  };
  let lastUpdate = 0;
  return {
    update(text) {
      const now = Date.now();
      if (now - lastUpdate < 80) return;
      lastUpdate = now;
      el.textContent = text;
      scroll();
    },
    finish(text) {
      if (text != null) el.textContent = text;
      scroll();
    }
  };
}

/**
 * Checkout files in batches to cap peak memory.  The caller provides a shared
 * cache that already holds the pack from fetch — avoiding redundant 90 MiB IDB
 * reads.  Between batches we yield with a generous setTimeout so Chrome's
 * LevelDB backend can compact and V8 can GC intermediate buffers.
 * @param {object} cache - shared cache (already loaded by fetch/verify phases)
 */
async function batchedCheckout(git, fsClient, dest, branch, allFiles, progress, cache) {
  const total = allFiles.length;
  // Batch IDB writes disabled for now — isolating crash cause. When safe,
  // re-enable by setting useBatch = typeof fsClient.enableBatchWrites === 'function';
  const useBatch = false;

  if (total <= CHECKOUT_BATCH_THRESHOLD) {
    console.log('[jsh-git] checkout: small repo (' + total + ' files), single checkout');
    if (progress) progress.update(`Checking out files: ${total} files`);
    if (useBatch) fsClient.enableBatchWrites();
    try {
      await git.checkout({ fs: fsClient, dir: dest, ref: branch, remote: 'origin', cache });
    } catch (err) {
      console.error('[jsh-git] checkout (single) FAILED', err);
      throw err;
    } finally {
      if (useBatch) await fsClient.flushBatchWrites();
    }
    if (progress) progress.finish(`Checking out files: ${total}/${total}, done.`);
    return;
  }

  const numBatches = Math.ceil(total / CHECKOUT_BATCH_SIZE);
  console.log(
    '[jsh-git] batched checkout:',
    total,
    'files in',
    numBatches,
    'batches of',
    CHECKOUT_BATCH_SIZE
  );
  jshGitTrace('batched checkout', { files: total, batchSize: CHECKOUT_BATCH_SIZE });
  const checkoutStart = Date.now();
  for (let i = 0; i < total; i += CHECKOUT_BATCH_SIZE) {
    const batch = allFiles.slice(i, i + CHECKOUT_BATCH_SIZE);
    const done = Math.min(i + batch.length, total);
    const pct = Math.round((done / total) * 100);
    const batchNum = Math.floor(i / CHECKOUT_BATCH_SIZE) + 1;
    const elapsed = Math.round((Date.now() - checkoutStart) / 1000);
    const suffix = elapsed > 2 ? ` (${elapsed}s)` : '';
    if (progress) progress.update(`Checking out files: ${pct}% (${done}/${total})${suffix}`);
    if (useBatch) fsClient.enableBatchWrites();
    try {
      await git.checkout({
        fs: fsClient,
        dir: dest,
        ref: branch,
        remote: 'origin',
        filepaths: batch,
        force: true,
        cache
      });
    } catch (batchErr) {
      console.error(
        '[jsh-git] checkout batch',
        batchNum + '/' + numBatches,
        'FAILED at files',
        i,
        '-',
        done,
        batchErr
      );
      throw batchErr;
    } finally {
      if (useBatch) await fsClient.flushBatchWrites();
    }
    console.log(
      '[jsh-git] checkout batch',
      batchNum + '/' + numBatches,
      'done (' + done + '/' + total + ')'
    );
    // Yield so Chrome's IDB/LevelDB backend can compact and V8 can
    // collect intermediate inflate buffers before the next batch.
    await new Promise((r) => setTimeout(r, 50));
  }
  const totalElapsed = ((Date.now() - checkoutStart) / 1000).toFixed(1);
  if (progress)
    progress.finish(`Checking out files: 100% (${total}/${total}), done. (${totalElapsed}s)`);
}

/**
 * Single-branch clone without git.clone: explicit remoteRef + verify pack, then checkout.
 *
 * ONE cache is shared across every phase (fetch → verify → listFiles → checkout)
 * so the ~90 MiB pack is loaded from IndexedDB exactly once.  Previously each
 * phase created its own cache, re-reading 90 MiB per phase — 4× redundant I/O
 * that triggered Chrome renderer OOM crashes (Error code 5) when V8's GC didn't
 * reclaim previous copies fast enough.
 */
async function cloneSingleBranch(git, fsClient, http, opts, terminal) {
  const { dest, url, corsProxy, branch, depth, noCheckout } = opts;
  console.log('[jsh-git] cloneSingleBranch START', { dest, url, branch, depth, noCheckout });
  const cloneStart = Date.now();
  const fetchProgress = terminal ? createProgressWriter(terminal) : null;
  const cloneCache = newGitCache();
  try {
    console.log('[jsh-git] phase: git.init');
    await git.init({ fs: fsClient, dir: dest, defaultBranch: branch });
    console.log('[jsh-git] phase: git.addRemote');
    await git.addRemote({ fs: fsClient, dir: dest, remote: 'origin', url });
    if (corsProxy) {
      await git.setConfig({
        fs: fsClient,
        dir: dest,
        path: 'http.corsProxy',
        value: corsProxy
      });
    }
    const fetchOpts = {
      fs: fsClient,
      http,
      dir: dest,
      url,
      corsProxy,
      remote: 'origin',
      ref: branch,
      remoteRef: `refs/heads/${branch}`,
      singleBranch: true,
      tags: true,
      cache: cloneCache,
      onProgress(evt) {
        if (!fetchProgress) return;
        const { phase, loaded, total } = evt;
        if (total) {
          const pct = Math.round((loaded / total) * 100);
          fetchProgress.update(`${phase}: ${pct}% (${loaded}/${total})`);
        } else {
          fetchProgress.update(`${phase}: ${loaded}`);
        }
      },
      onMessage(msg) {
        if (!fetchProgress) return;
        const line = String(msg).replace(/[\r\n]+$/, '');
        if (line) fetchProgress.update(`remote: ${line}`);
      }
    };
    if (depth != null) {
      fetchOpts.depth = depth;
    }
    jshGitTrace('clone fetch start', { dest, url, branch, depth: depth ?? null });
    if (fetchProgress) fetchProgress.update('Fetching objects...');

    // Heartbeat keeps the user informed while the pack downloads (onProgress
    // only fires during client-side indexPack, not during the HTTP transfer).
    let lastProgressAt = Date.now();
    const fetchStart = lastProgressAt;
    const origOnProgress = fetchOpts.onProgress;
    const origOnMessage = fetchOpts.onMessage;
    fetchOpts.onProgress = (evt) => {
      lastProgressAt = Date.now();
      if (origOnProgress) origOnProgress(evt);
    };
    fetchOpts.onMessage = (msg) => {
      lastProgressAt = Date.now();
      if (origOnMessage) origOnMessage(msg);
    };
    const heartbeat = fetchProgress
      ? setInterval(() => {
          const silent = Date.now() - lastProgressAt;
          if (silent > 1500) {
            const elapsed = Math.round((Date.now() - fetchStart) / 1000);
            fetchProgress.update(`Receiving objects... ${elapsed}s elapsed (downloading pack)`);
          }
        }, 1000)
      : null;

    let fetchResult;
    console.log('[jsh-git] phase: git.fetch START');
    try {
      fetchResult = await git.fetch(fetchOpts);
    } catch (fetchErr) {
      console.error(
        '[jsh-git] git.fetch FAILED after',
        ((Date.now() - cloneStart) / 1000).toFixed(1) + 's',
        fetchErr
      );
      throw fetchErr;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
    console.log(
      '[jsh-git] phase: git.fetch DONE in',
      ((Date.now() - cloneStart) / 1000).toFixed(1) + 's'
    );
    jshGitTrace('clone fetch done', {
      fetchHead: fetchResult.fetchHead,
      defaultBranch: fetchResult.defaultBranch
    });
    if (fetchResult.fetchHead == null) {
      throw new Error('remote repository is empty (no refs)');
    }
    const fetchElapsed = ((Date.now() - cloneStart) / 1000).toFixed(1);
    if (fetchProgress) fetchProgress.finish(`Receiving objects: 100%, done. (${fetchElapsed}s)`);

    console.log('[jsh-git] phase: ensureFetchHeadReadable START');
    const verifyProgress = terminal ? createProgressWriter(terminal) : null;
    if (verifyProgress) verifyProgress.update('Resolving deltas...');
    try {
      await ensureFetchHeadReadable(git, fsClient, dest, fetchResult.fetchHead, cloneCache);
    } catch (readErr) {
      console.error('[jsh-git] ensureFetchHeadReadable FAILED', readErr);
      const hint = readErr && readErr.message ? readErr.message : String(readErr);
      throw new Error(
        `object ${fetchResult.fetchHead.slice(
          0,
          7
        )} not readable after fetch/reindex (${hint}). Pack may be corrupt; check network or CORS proxy.`
      );
    }
    if (verifyProgress) verifyProgress.finish('Resolving deltas: done.');
    console.log(
      '[jsh-git] phase: ensureFetchHeadReadable DONE in',
      ((Date.now() - cloneStart) / 1000).toFixed(1) + 's'
    );

    console.log('[jsh-git] phase: writeRef HEAD + branch');
    if (terminal) terminal.addOutput(`Updating references...`);
    await git.writeRef({
      fs: fsClient,
      dir: dest,
      ref: `refs/heads/${branch}`,
      value: fetchResult.fetchHead,
      force: true
    });
    await git.writeRef({
      fs: fsClient,
      dir: dest,
      ref: 'HEAD',
      value: `refs/heads/${branch}`,
      symbolic: true,
      force: true
    });

    if (!noCheckout) {
      console.log('[jsh-git] phase: listFiles START');
      const checkoutProgress = terminal ? createProgressWriter(terminal) : null;
      if (checkoutProgress) checkoutProgress.update('Enumerating files for checkout...');
      let allFiles;
      try {
        allFiles = await git.listFiles({
          fs: fsClient,
          dir: dest,
          ref: branch,
          cache: cloneCache
        });
      } catch (listErr) {
        console.error('[jsh-git] listFiles FAILED', listErr);
        throw listErr;
      }
      console.log('[jsh-git] phase: listFiles DONE, count:', allFiles.length);
      console.log('[jsh-git] phase: batchedCheckout START');
      await batchedCheckout(git, fsClient, dest, branch, allFiles, checkoutProgress, cloneCache);
      console.log(
        '[jsh-git] phase: batchedCheckout DONE in',
        ((Date.now() - cloneStart) / 1000).toFixed(1) + 's'
      );
    }
    // Notify file manager / desktop once after all files are written
    if (typeof window !== 'undefined' && window.FileSystemDB) {
      window.FileSystemDB.emit('change', dest, { type: 'batch', event: 'clone' });
    }
    console.log(
      '[jsh-git] cloneSingleBranch COMPLETE in',
      ((Date.now() - cloneStart) / 1000).toFixed(1) + 's'
    );
  } catch (e) {
    console.error(
      '[jsh-git] cloneSingleBranch FAILED after',
      ((Date.now() - cloneStart) / 1000).toFixed(1) + 's',
      e
    );
    await cleanupPartialGitDir(fsClient, dest);
    throw e;
  } finally {
    releaseGitCache(cloneCache);
  }
}

async function gitHandler(terminal, args) {
  if (args.length === 0) {
    return errResult("missing subcommand (try 'git --help')");
  }

  // Normalize so "login", stray spaces, or odd casing still hit handlers (otherwise switch default).
  const sub = String(args[0] || '')
    .trim()
    .toLowerCase();
  if (!sub) {
    return errResult("missing subcommand (try 'git --help')");
  }

  if (sub === '--help' || sub === '-h' || (sub === 'help' && args.length === 1)) {
    return { stdout: GIT_HELP, stderr: '', exitCode: 0 };
  }

  if (sub === 'login') {
    const token = args.slice(1).join(' ').trim();
    if (!token) {
      return errResult(
        'usage: git login <github_pat>\n\nCreate a token on GitHub:\n' +
          '  • Fine-grained (recommended): https://github.com/settings/personal-access-tokens/new\n' +
          '    → Resource owner: your account, Repository access: pick the repo,\n' +
          '    → Permissions: Repository contents + Metadata (read/write).\n' +
          '  • Classic PAT: https://github.com/settings/tokens → Generate new token (classic)\n' +
          '    → enable the "repo" scope.\n\n' +
          'The token is stored in this tab for git push; it is not encrypted and may appear in shell history — revoke the token when done (same settings pages).'
      );
    }
    terminal.env.GITHUB_TOKEN = token;
    if (typeof window !== 'undefined') {
      window.JSH_GIT_TOKEN = token;
    }
    return {
      stdout: 'Logged in. You can run git push.\n',
      stderr:
        'Warning: the token lives in browser memory (and may be in history). Use git logout to clear.\n',
      exitCode: 0
    };
  }

  if (sub === 'logout') {
    delete terminal.env.GITHUB_TOKEN;
    delete terminal.env.GIT_TOKEN;
    if (typeof window !== 'undefined') {
      try {
        delete window.JSH_GIT_TOKEN;
      } catch (_) {
        window.JSH_GIT_TOKEN = '';
      }
    }
    return { stdout: 'Logged out (git credentials cleared).\n', stderr: '', exitCode: 0 };
  }

  let git;
  try {
    git = await loadIsoGit();
  } catch (e) {
    return errResult(
      `could not load isomorphic-git from CDN (${e.message}). Check network / ad blockers.`
    );
  }

  const corsProxy = resolveCorsProxy(terminal);
  const fs = createJshGitFs(terminal);
  const http = createJshGitHttp({
    corsProxyBase: corsProxy,
    getAbortSignal: () => terminal.runAbortSignal
  });

  const rest = args.slice(1);

  try {
    switch (sub) {
      case 'init': {
        const target = rest[0] ? terminal.resolvePath(rest[0]) : terminal.currentDirectory;
        await git.init({ fs, dir: target, defaultBranch: 'main' });
        return {
          stdout: `Initialized empty Git repository in ${target}/.git/\n`,
          stderr: '',
          exitCode: 0
        };
      }

      case 'clone': {
        const cloneArgs = [...rest];
        let depth;
        let allBranches = false;
        let fullHistory = false;
        let noCheckout = false;
        for (let i = 0; i < cloneArgs.length; ) {
          if (cloneArgs[i] === '--depth' && cloneArgs[i + 1]) {
            const n = parseInt(cloneArgs[i + 1], 10);
            if (!Number.isFinite(n) || n < 1) {
              return errResult('clone: --depth requires a positive integer');
            }
            depth = n;
            cloneArgs.splice(i, 2);
            continue;
          }
          if (cloneArgs[i] === '--full') {
            fullHistory = true;
            cloneArgs.splice(i, 1);
            continue;
          }
          if (cloneArgs[i] === '--all-branches') {
            allBranches = true;
            cloneArgs.splice(i, 1);
            continue;
          }
          if (cloneArgs[i] === '--no-checkout') {
            noCheckout = true;
            cloneArgs.splice(i, 1);
            continue;
          }
          i++;
        }
        if (fullHistory) {
          depth = undefined;
        } else if (depth == null) {
          depth = 1;
        }
        if (!cloneArgs[0]) {
          return errResult('clone requires a repository URL');
        }
        const url = cloneArgs[0];
        let dest = cloneArgs[1] ? terminal.resolvePath(cloneArgs[1]) : null;
        if (!dest) {
          try {
            const u = new URL(url);
            const base = u.pathname.split('/').filter(Boolean).pop() || 'repo';
            dest = terminal.resolvePath(base.replace(/\.git$/i, ''));
          } catch {
            dest = terminal.resolvePath('repo');
          }
        }
        // Real git: "fatal: destination path '...' already exists and is not an empty directory"
        try {
          const destStat = await fs.promises.stat(dest);
          if (destStat && destStat.type === 'directory') {
            const destEntries = await fs.promises.readdir(dest);
            if (destEntries && destEntries.length > 0) {
              return errResult(
                `fatal: destination path '${dest}' already exists and is not an empty directory`
              );
            }
          }
        } catch (_) {
          /* dest doesn't exist — good, proceed */
        }

        terminal.addOutput(`Cloning into '${dest}'...`);
        console.log(
          '[jsh-git] clone: url=' + url,
          'dest=' + dest,
          'depth=' + depth,
          'noCheckout=' + noCheckout,
          'allBranches=' + allBranches
        );
        let defaultBranchName = '';
        if (allBranches) {
          console.log('[jsh-git] clone: using allBranches path (git.clone)');
          const cloneOpts = {
            fs,
            http,
            dir: dest,
            url,
            corsProxy,
            singleBranch: false,
            noCheckout
          };
          if (depth != null) {
            cloneOpts.depth = depth;
          }
          await git.clone(cloneOpts);
        } else {
          let branch;
          try {
            branch = await defaultCloneBranchName(git, http, url, corsProxy);
          } catch (e) {
            return errResult(
              `clone: could not read default branch from remote (${e.message || e})`
            );
          }
          defaultBranchName = branch;
          await cloneSingleBranch(
            git,
            fs,
            http,
            {
              dest,
              url,
              corsProxy,
              branch,
              depth,
              noCheckout
            },
            terminal
          );
        }
        const doneMsg = noCheckout
          ? `Done (objects only, no working tree).\nRun: cd '${dest}' && git checkout ${
              allBranches ? '<branch>' : defaultBranchName
            }`
          : 'Done.';
        return { stdout: doneMsg, stderr: '', exitCode: 0 };
      }

      case 'status': {
        const dir = terminal.currentDirectory;
        let branchHint = 'detached';
        try {
          branchHint = await git.currentBranch({ fs, dir });
        } catch (_) {
          /* empty or detached */
        }
        const matrix = await git.statusMatrix({ fs, dir });
        const dirty = matrix.filter((row) => {
          const [, h, w, s] = row;
          return !(h === 1 && w === 1 && s === 1);
        });
        if (dirty.length === 0) {
          return {
            stdout: `On branch ${branchHint}\nnothing to commit, working tree clean\n`,
            stderr: '',
            exitCode: 0
          };
        }
        const lines = dirty.map((row) => `${row[1]}${row[2]}${row[3]}\t${row[0]}`);
        return {
          stdout: `On branch ${branchHint}\n\nChanges:\n${lines.join('\n')}\n`,
          stderr: '',
          exitCode: 0
        };
      }

      case 'log': {
        const oneline = rest.includes('--oneline');
        const dir = terminal.currentDirectory;
        const commits = await git.log({ fs, dir, depth: 20 });
        if (!commits.length) {
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        const out = commits
          .map((c) => {
            const oid = c.oid.slice(0, oneline ? 7 : 40);
            const msg = (c.commit && c.commit.message) || '';
            return oneline ? `${oid} ${msg.split('\n')[0]}` : `commit ${c.oid}\n\n${msg}\n`;
          })
          .join(oneline ? '\n' : '\n---\n');
        return { stdout: out + '\n', stderr: '', exitCode: 0 };
      }

      case 'branch': {
        const dir = terminal.currentDirectory;
        const branches = await git.listBranches({ fs, dir });
        let current = '';
        try {
          current = await git.currentBranch({ fs, dir });
        } catch (_) {
          /* detached */
        }
        const out = branches.map((b) => `${b === current ? '* ' : '  '}${b}`).join('\n');
        return { stdout: `${out}\n`, stderr: '', exitCode: 0 };
      }

      case 'checkout': {
        if (!rest[0]) {
          return errResult('checkout requires a ref');
        }
        const dir = terminal.currentDirectory;
        await git.checkout({ fs, dir, ref: rest[0] });
        return { stdout: `Switched to ${rest[0]}\n`, stderr: '', exitCode: 0 };
      }

      case 'add': {
        const dir = terminal.currentDirectory;
        const all = rest.includes('-A') || rest.includes('--all');
        const paths = rest.filter((a) => a !== '-A' && a !== '--all');
        if (all || paths.length === 0 || paths.includes('.')) {
          await git.add({ fs, dir, filepath: '.' });
        } else {
          for (const p of paths) {
            const filepath = p.replace(/^\.\//, '');
            await git.add({ fs, dir, filepath });
          }
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      case 'commit': {
        const { value: message } = takeFlagValue(rest, '-m');
        if (!message) {
          return errResult(
            'commit requires -m "message" (interactive editor not available in jsh)'
          );
        }
        const dir = terminal.currentDirectory;
        let sha = await git.commit({
          fs,
          dir,
          message,
          author: gitAuthor(terminal)
        });
        if (sha && typeof sha === 'object' && sha.oid) {
          sha = sha.oid;
        }
        sha = String(sha || '');
        return { stdout: `[${sha.slice(0, 7)}] ${message}\n`, stderr: '', exitCode: 0 };
      }

      case 'fetch': {
        const dir = terminal.currentDirectory;
        const remote = rest[0] || 'origin';
        const fetchProg = createProgressWriter(terminal);
        const fetchProgCb = fetchProg
          ? (evt) => {
              const { phase, loaded, total } = evt;
              const pct = total
                ? `${Math.round((loaded / total) * 100)}% (${loaded}/${total})`
                : `${loaded}`;
              fetchProg.update(`${phase}: ${pct}`);
            }
          : undefined;
        await git.fetch({ fs, http, dir, remote, corsProxy, onProgress: fetchProgCb });
        if (fetchProg) fetchProg.finish(`Fetched from ${remote}`);
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      case 'pull': {
        const dir = terminal.currentDirectory;
        const remote = rest[0] || 'origin';
        const branch = rest[1] || (await git.currentBranch({ fs, dir }));
        const pullProg = createProgressWriter(terminal);
        const pullProgCb = pullProg
          ? (evt) => {
              const { phase, loaded, total } = evt;
              const pct = total
                ? `${Math.round((loaded / total) * 100)}% (${loaded}/${total})`
                : `${loaded}`;
              pullProg.update(`${phase}: ${pct}`);
            }
          : undefined;
        await git.pull({
          fs,
          http,
          dir,
          remote,
          ref: branch,
          remoteRef: branch,
          corsProxy,
          author: gitAuthor(terminal),
          onProgress: pullProgCb
        });
        if (pullProg) pullProg.finish(`Pulled ${remote} ${branch}`);
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      case 'push': {
        const dir = terminal.currentDirectory;
        const pushArgs = [...rest];
        let force = false;
        for (let i = 0; i < pushArgs.length; ) {
          if (pushArgs[i] === '--force' || pushArgs[i] === '-f') {
            force = true;
            pushArgs.splice(i, 1);
            continue;
          }
          i++;
        }
        const remote = pushArgs[0] || 'origin';
        let branch = pushArgs[1];
        if (!branch) {
          branch = await git.currentBranch({ fs, dir });
          if (!branch) {
            return errResult('push: detached HEAD — specify branch (e.g. git push origin main)');
          }
        }
        const token = resolveGitCredential(terminal);
        if (!token) {
          return errResult(
            'push needs credentials: run git login <github_pat> (or export GITHUB_TOKEN / GIT_TOKEN).\n' +
              'Create a PAT: https://github.com/settings/personal-access-tokens/new (fine-grained) or https://github.com/settings/tokens (classic, repo scope).'
          );
        }
        await git.push({
          fs,
          http,
          dir,
          remote,
          ref: branch,
          remoteRef: `refs/heads/${branch}`,
          corsProxy,
          force,
          onAuth: () => ({ username: 'git', password: token })
        });
        return { stdout: `Pushed ${branch} to ${remote}\n`, stderr: '', exitCode: 0 };
      }

      default:
        return errResult(`'${sub}' is not a jsh git command. See git --help.`);
    }
  } catch (e) {
    if (typeof terminal.isAbortLikeError === 'function' && terminal.isAbortLikeError(e)) {
      console.warn('[jsh-git] command aborted (Ctrl+C or signal):', sub, e);
      throw e;
    }
    console.error('[jsh-git] command "' + sub + '" FAILED:', e);
    const msg = e && e.message ? e.message : String(e);
    return { stdout: '', stderr: `git: ${sub} failed: ${msg}\n`, exitCode: 1 };
  }
}

export default {
  name: 'git',
  handler: gitHandler,
  description:
    'distributed version control (isomorphic-git + IndexedDB; GET via proxy when available)',
  category: 'System'
};

export const _testExports = {
  formatBytes,
  takeFlagValue,
  errResult,
  resolveCorsProxy,
  resolveGitCredential,
  gitAuthor
};
