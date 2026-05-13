import { createBoundedGitCache, clearGitCache } from '../../lib/jsh-git-cache.js';

/**
 * Short branch name for git.clone({ singleBranch: true, ref }) — from remote HEAD / refs.
 */
export async function defaultCloneBranchName(git, http, url, corsProxy) {
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
/** Above this file count, switch to smaller batches + longer GC yields to dodge OOM. */
const CHECKOUT_LARGE_TREE_FILES = 5000;
/**
 * Batch size for large trees. Chosen so that the per-batch inflate buffers stay
 * under ~10 MiB (assuming ~40 KiB average file), keeping total heap pressure
 * dominated by the cached pack (~128 MiB) and not by transient batch state.
 * Override at runtime via `git config --jsh checkout-batch <N>`.
 */
const CHECKOUT_BATCH_SIZE_LARGE = 25;
const CHECKOUT_YIELD_MS_NORMAL = 50;
const CHECKOUT_YIELD_MS_LARGE = 200;
/**
 * Above this file count, the default `git clone` skips the working-tree write
 * and prints a follow-up `git checkout <branch>` command. Now that the
 * checkout phase uses streamingCheckout (single tree walk + sequential blob
 * writes), the practical OOM ceiling is much higher than the old batched path.
 * The threshold is kept as a final safety net for genuinely huge repos
 * (e.g. linux kernel-class trees). Override per-clone with `--force-checkout`.
 */
export const AUTO_NO_CHECKOUT_FILE_THRESHOLD = 30000;

export function newGitCache() {
  return createBoundedGitCache();
}

export function releaseGitCache(cache) {
  clearGitCache(cache);
}

/**
 * Live progress line that updates in-place inside the terminal DOM.
 * Call update(text) to rewrite the line; finish() to finalize it.
 */
export function createProgressWriter(terminal) {
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
 * Checkout files in batches to cap peak memory. The caller provides a shared
 * cache that already holds the pack from fetch — avoiding redundant 90 MiB IDB
 * reads. The pack stays pinned in cache for the entire checkout (single ~128
 * MiB allocation), and we shrink the per-batch decode pressure with smaller
 * batches on large trees instead of clearing the cache (which forced a 128
 * MiB realloc per batch and was actually *causing* OOMs).
 *
 * Between batches we yield with setTimeout so Chrome's LevelDB backend can
 * compact and V8 can GC intermediate inflate buffers.
 *
 * @param {object} git - isomorphic-git module
 * @param {object} fsClient - jsh git fs adapter
 * @param {string} dest - working dir
 * @param {string} branch - ref to checkout
 * @param {string[]} allFiles - paths from git.listFiles()
 * @param {{update:Function, finish:Function} | null} progress - terminal progress writer
 * @param {object} cache - shared cache (already loaded by fetch/verify phases when called from clone)
 * @param {{ remote?: string, batchSize?: number }} [opts] - extra checkout opts.
 *        Pass `remote: 'origin'` when checking out a branch that hasn't been
 *        initialized locally yet. `batchSize` overrides the auto-chosen size.
 */
export async function batchedCheckout(git, fsClient, dest, branch, allFiles, progress, cache, opts) {
  const total = allFiles.length;
  const remote = opts && opts.remote;
  // Batch IDB writes disabled for now — isolating crash cause. When safe,
  // re-enable by setting useBatch = typeof fsClient.enableBatchWrites === 'function';
  const useBatch = false;

  if (total <= CHECKOUT_BATCH_THRESHOLD) {
    console.log('[jsh-git] checkout: small repo (' + total + ' files), single checkout');
    if (progress) progress.update(`Checking out files: ${total} files`);
    if (useBatch) fsClient.enableBatchWrites();
    try {
      const checkoutOpts = { fs: fsClient, dir: dest, ref: branch, cache };
      if (remote) checkoutOpts.remote = remote;
      await git.checkout(checkoutOpts);
    } catch (err) {
      console.error('[jsh-git] checkout (single) FAILED', err);
      throw err;
    } finally {
      if (useBatch) await fsClient.flushBatchWrites();
    }
    if (progress) progress.finish(`Checking out files: ${total}/${total}, done.`);
    return;
  }

  const isLargeTree = total > CHECKOUT_LARGE_TREE_FILES;
  const overrideBatch = opts && opts.batchSize;
  const batchSize =
    overrideBatch && overrideBatch > 0
      ? overrideBatch
      : isLargeTree
        ? CHECKOUT_BATCH_SIZE_LARGE
        : CHECKOUT_BATCH_SIZE;
  const numBatches = Math.ceil(total / batchSize);
  const yieldMs = isLargeTree ? CHECKOUT_YIELD_MS_LARGE : CHECKOUT_YIELD_MS_NORMAL;
  console.log(
    '[jsh-git] batched checkout:',
    total,
    'files in',
    numBatches,
    'batches of',
    batchSize,
    isLargeTree ? '(large tree, smaller batches + longer GC yields)' : ''
  );
  jshGitTrace('batched checkout', {
    files: total,
    batchSize,
    yieldMs,
    largeTree: isLargeTree
  });
  if (isLargeTree && progress) {
    progress.update(
      `Checking out ${total} files in batches of ${batchSize} (large tree; this may take a few minutes).`
    );
  }
  const checkoutStart = Date.now();
  for (let i = 0; i < total; i += batchSize) {
    const batch = allFiles.slice(i, i + batchSize);
    const done = Math.min(i + batch.length, total);
    const pct = Math.round((done / total) * 100);
    const batchNum = Math.floor(i / batchSize) + 1;
    const elapsed = Math.round((Date.now() - checkoutStart) / 1000);
    const suffix = elapsed > 2 ? ` (${elapsed}s)` : '';
    if (progress) progress.update(`Checking out files: ${pct}% (${done}/${total})${suffix}`);
    if (useBatch) fsClient.enableBatchWrites();
    try {
      const checkoutOpts = {
        fs: fsClient,
        dir: dest,
        ref: branch,
        filepaths: batch,
        force: true,
        cache
      };
      if (remote) checkoutOpts.remote = remote;
      await git.checkout(checkoutOpts);
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
    if (batchNum % 20 === 0 || batchNum === numBatches) {
      console.log(
        '[jsh-git] checkout batch',
        batchNum + '/' + numBatches,
        'done (' + done + '/' + total + ')'
      );
    }
    // Yield so Chrome's IDB/LevelDB backend can compact and V8 can
    // collect intermediate inflate buffers before the next batch.
    // We deliberately do NOT clear the cache here — keeping the pack
    // pinned (~128 MiB once) is much cheaper than re-allocating it
    // per batch (~128 MiB × N batches of churn that defeats GC).
    await new Promise((r) => setTimeout(r, yieldMs));
  }
  const totalElapsed = ((Date.now() - checkoutStart) / 1000).toFixed(1);
  if (progress)
    progress.finish(`Checking out files: 100% (${total}/${total}), done. (${totalElapsed}s)`);
}

/**
 * Number of files written between GC yields during streamingCheckout.
 * Smaller = lower peak heap, more wall-clock spent yielding. 100 keeps yields
 * to ~1% overhead while still giving V8 frequent reset points.
 */
const STREAMING_YIELD_EVERY_FILES = 100;
const STREAMING_YIELD_MS = 50;

/**
 * Streaming checkout. Walks the working-tree ref exactly ONCE to enumerate
 * all blobs, then streams each file to the VFS sequentially. ~50× faster than
 * batched git.checkout({ filepaths }) on big trees because git.checkout walks
 * the entire tree on every call — so 200 batches of 50 files each ends up
 * doing 200 full tree walks.
 *
 * Memory profile (joeheyming.github.com, 9722 files, ~395 MiB tree):
 *   • pack pinned in cache: ~128 MiB (one allocation, never re-loaded)
 *   • current blob in flight: one file's worth (largest single file in repo)
 *   • path table: ~9722 × ~80 bytes ≈ 0.8 MiB
 *   ≈ ~135 MiB peak — fits comfortably in Chrome's renderer.
 *
 * Wall-clock estimate: 30–120 seconds for 9722 files (vs 44 minutes batched).
 *
 * @param {object} git - isomorphic-git module
 * @param {object} fsClient - jsh git fs adapter
 * @param {string} dir - working dir (no trailing slash)
 * @param {string} ref - branch / commit to materialize
 * @param {object|null} terminal - for progress writer; null is fine
 * @param {{ cache?: object }} [opts] - reuse a caller-owned cache (e.g. clone shares its fetch cache)
 * @returns {Promise<{ fileCount: number }>}
 */
export async function streamingCheckout(git, fsClient, dir, ref, terminal, opts) {
  const sharedCache = opts && opts.cache;
  const cache = sharedCache || newGitCache();
  const ownsCache = !sharedCache;
  const enumProgress = terminal ? createProgressWriter(terminal) : null;
  if (enumProgress) enumProgress.update('Enumerating tree...');
  const enumStart = Date.now();
  /** @type {Array<{ path: string, oid: string, mode: number }>} */
  const entries = [];
  try {
    await git.walk({
      fs: fsClient,
      dir,
      trees: [git.TREE({ ref })],
      // Returning anything truthy keeps the walk going; we only care about the
      // side effect (push to entries). `git.walk` recurses into subtrees on its own.
      map: async (filepath, walkEntries) => {
        if (!walkEntries || walkEntries.length === 0) return undefined;
        const entry = walkEntries[0];
        if (!entry || filepath === '.') return true;
        const type = await entry.type();
        if (type !== 'blob') return true;
        const oid = await entry.oid();
        const mode = await entry.mode();
        entries.push({ path: filepath, oid, mode });
        return true;
      }
    });
  } catch (walkErr) {
    if (enumProgress) enumProgress.finish(`Enumerating tree: failed.`);
    if (ownsCache) releaseGitCache(cache);
    throw walkErr;
  }
  const enumSec = ((Date.now() - enumStart) / 1000).toFixed(1);
  if (enumProgress) enumProgress.finish(`Enumerating tree: ${entries.length} files (${enumSec}s).`);
  console.log(
    '[jsh-git] streamingCheckout: enumerated',
    entries.length,
    'files in',
    enumSec + 's'
  );
  jshGitTrace('streamingCheckout enumerate', { files: entries.length, seconds: Number(enumSec) });

  // Phase 1.5: bulk-create all unique parent directories in one IDB transaction.
  // Without this, mkdirp's per-file getItem checks on uncached parents dominated
  // the trace (Trace-20260512T220920.json.gz: 436 onsuccess in store.js = ~16s).
  // Pre-warming caches every dir in jsh-git-fs's `knownDirs`, so the per-file
  // mkdirp path inside writeFile becomes O(1) hash lookup with zero IDB hits.
  if (typeof fsClient.prewarmDirs === 'function') {
    const prewarmStart = Date.now();
    const uniqueParents = new Set();
    for (const e of entries) {
      const full = `${dir}/${e.path}`;
      const lastSlash = full.lastIndexOf('/');
      if (lastSlash > 0) uniqueParents.add(full.substring(0, lastSlash));
    }
    let createdDirs = 0;
    try {
      createdDirs = await fsClient.prewarmDirs([...uniqueParents]);
    } catch (prewarmErr) {
      console.warn('[jsh-git] streamingCheckout: prewarmDirs failed (non-fatal)', prewarmErr);
    }
    const prewarmSec = ((Date.now() - prewarmStart) / 1000).toFixed(2);
    console.log(
      '[jsh-git] streamingCheckout: prewarmed',
      createdDirs,
      'directories in',
      prewarmSec + 's'
    );
    jshGitTrace('streamingCheckout prewarm', {
      dirs: createdDirs,
      seconds: Number(prewarmSec)
    });
  }

  const writeProgress = terminal ? createProgressWriter(terminal) : null;
  const total = entries.length;
  const writeStart = Date.now();
  let lastProgressMs = 0;

  // Coalesce IDB puts into ~200-file transactions. Trace evidence (Trace-
  // 20260512T220023.json.gz) showed `request.onsuccess` in filesystem-db-store.js
  // consuming 49% of CPU during streaming checkout — ~34 ms per IDB request,
  // dominated by per-file transaction setup/commit. Batching cuts that to one
  // transaction per ~200 files, ~50–100× fewer commits.
  const useBatch = typeof fsClient.enableBatchWrites === 'function';
  if (useBatch) fsClient.enableBatchWrites();

  try {
    for (let i = 0; i < total; i++) {
      const { path, oid, mode } = entries[i];
      const { blob } = await git.readBlob({ fs: fsClient, dir, oid, cache });
      const filePath = `${dir}/${path}`;
      // Git modes: 100644 (regular), 100755 (executable), 120000 (symlink).
      // Decimal 0o120000 === 40960 — both representations show up in the wild.
      const isSymlink = mode === 0o120000 || mode === 40960;
      if (isSymlink) {
        // Symlinks bypass the batch writer (different store path). Flush the
        // pending batch first so the unlink/symlink see a consistent state.
        if (useBatch) await fsClient.flushBatchWrites();
        const target = new TextDecoder().decode(blob);
        try {
          await fsClient.promises.unlink(filePath);
        } catch (_) {
          /* ignore: file may not exist */
        }
        await fsClient.promises.symlink(target, filePath);
        if (useBatch) fsClient.enableBatchWrites();
      } else {
        await fsClient.promises.writeFile(filePath, blob);
      }

      // Throttled progress (~1 Hz)
      const nowMs = Date.now();
      if (writeProgress && nowMs - lastProgressMs >= 750) {
        const pct = Math.round(((i + 1) / total) * 100);
        const elapsedSec = Math.round((nowMs - writeStart) / 1000);
        const suffix = elapsedSec > 2 ? ` (${elapsedSec}s)` : '';
        writeProgress.update(`Checking out files: ${pct}% (${i + 1}/${total})${suffix}`);
        lastProgressMs = nowMs;
      }

      // Yield every N files: lets V8 GC inflate buffers and IDB compact transactions.
      if ((i + 1) % STREAMING_YIELD_EVERY_FILES === 0 && i + 1 < total) {
        await new Promise((r) => setTimeout(r, STREAMING_YIELD_MS));
      }
    }
    if (useBatch) await fsClient.flushBatchWrites();
  } catch (writeErr) {
    console.error('[jsh-git] streamingCheckout: write failed', writeErr);
    if (writeProgress) writeProgress.finish(`Checking out files: FAILED at ${0}/${total}.`);
    if (useBatch) {
      try {
        await fsClient.flushBatchWrites();
      } catch (_) {
        /* ignore: best-effort flush of partial batch */
      }
    }
    if (ownsCache) releaseGitCache(cache);
    throw writeErr;
  }
  const writeSec = ((Date.now() - writeStart) / 1000).toFixed(1);
  if (writeProgress) {
    writeProgress.finish(`Checking out files: 100% (${total}/${total}), done. (${writeSec}s)`);
  }
  console.log('[jsh-git] streamingCheckout: wrote', total, 'files in', writeSec + 's');
  jshGitTrace('streamingCheckout write', { files: total, seconds: Number(writeSec) });

  if (ownsCache) releaseGitCache(cache);
  return { fileCount: total };
}

/**
 * Standalone checkout used by `git checkout <ref>` outside of clone. Routes
 * through streamingCheckout: single tree walk + sequential writes with GC
 * yields. Safe to call after `git clone --no-checkout` or after an auto-skipped
 * clone, even on big working trees that previously OOMed the renderer.
 */
export async function safeCheckout(git, fsClient, dir, ref, terminal) {
  return streamingCheckout(git, fsClient, dir, ref, terminal);
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
export async function cloneSingleBranch(git, fsClient, http, opts, terminal) {
  const { dest, url, corsProxy, branch, depth, noCheckout, forceCheckout } = opts;
  console.log('[jsh-git] cloneSingleBranch START', {
    dest,
    url,
    branch,
    depth,
    noCheckout,
    forceCheckout: !!forceCheckout
  });
  /** Mutated below: true when noCheckout was forced on by the auto-OOM safety. */
  let autoSkippedCheckout = false;
  let fileCount = 0;
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
      // For the auto-skip safety (huge trees), we need a fast file count
      // *without* materializing files. listFiles walks the tree, but it's a
      // single walk and reasonably cheap with the warm cache from fetch.
      console.log('[jsh-git] phase: listFiles START');
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
      fileCount = allFiles.length;
      console.log('[jsh-git] phase: listFiles DONE, count:', fileCount);

      // OOM safety net for genuinely enormous trees only (> 30000 files).
      // streamingCheckout below handles 10k-class trees safely now, but a
      // tree with 50k+ files might still strain a low-end tab. Override
      // with --force-checkout.
      if (fileCount > AUTO_NO_CHECKOUT_FILE_THRESHOLD && !forceCheckout) {
        autoSkippedCheckout = true;
        if (terminal) {
          terminal.addOutput(
            `Skipping checkout: ${fileCount} files (> ${AUTO_NO_CHECKOUT_FILE_THRESHOLD}) is above the auto-OOM safety threshold.`
          );
        }
        console.log(
          '[jsh-git] phase: auto-skip checkout (fileCount=' +
            fileCount +
            ' > ' +
            AUTO_NO_CHECKOUT_FILE_THRESHOLD +
            ')'
        );
        clearGitCache(cloneCache);
      } else {
        console.log('[jsh-git] phase: streamingCheckout START');
        await streamingCheckout(git, fsClient, dest, branch, terminal, { cache: cloneCache });
        console.log(
          '[jsh-git] phase: streamingCheckout DONE in',
          ((Date.now() - cloneStart) / 1000).toFixed(1) + 's'
        );
      }
    }
    // Notify file manager / desktop once after all files are written
    if (typeof window !== 'undefined' && window.FileSystemDB) {
      window.FileSystemDB.emit('change', dest, { type: 'batch', event: 'clone' });
    }
    console.log(
      '[jsh-git] cloneSingleBranch COMPLETE in',
      ((Date.now() - cloneStart) / 1000).toFixed(1) + 's'
    );
    return { autoSkippedCheckout, fileCount };
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
