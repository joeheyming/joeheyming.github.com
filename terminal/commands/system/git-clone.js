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

function newGitCache() {
  return createBoundedGitCache();
}

function releaseGitCache(cache) {
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
export async function cloneSingleBranch(git, fsClient, http, opts, terminal) {
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
