// git — real repos via isomorphic-git + IndexedDB; network GETs use proxy.js (like curl), POST is direct fetch (CORS).
(function () {
  'use strict';

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
      name: terminal.env.GIT_AUTHOR_NAME || terminal.env.USER || 'jheyming',
      email: terminal.env.GIT_AUTHOR_EMAIL || 'jheyming@heyming-os.local'
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
    const fn = window.jshGitTrace;
    if (typeof fn === 'function') {
      fn(...args);
    }
  }

  /** Remove partial .git after a failed clone (matches isomorphic-git clone cleanup). */
  async function cleanupPartialGitDir(fsClient, dest) {
    const gitdir = `${dest}/.git`;
    try {
      await fsClient.promises.rm(gitdir, { recursive: true, maxRetries: 10 });
    } catch (_) {
      /* ignore */
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
    } catch (_) {
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

  /**
   * Single-branch clone without git.clone: explicit remoteRef + verify pack, then checkout.
   */
  async function cloneSingleBranch(git, fsClient, http, opts) {
    const { dest, url, corsProxy, branch, depth, noCheckout } = opts;
    const fetchCache = new Map();
    try {
      await git.init({ fs: fsClient, dir: dest, defaultBranch: branch });
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
        cache: fetchCache
      };
      if (depth != null) {
        fetchOpts.depth = depth;
      }
      jshGitTrace('clone fetch start', { dest, url, branch, depth: depth ?? null });
      const fetchResult = await git.fetch(fetchOpts);
      jshGitTrace('clone fetch done', {
        fetchHead: fetchResult.fetchHead,
        defaultBranch: fetchResult.defaultBranch
      });
      if (fetchResult.fetchHead == null) {
        throw new Error('remote repository is empty (no refs)');
      }

      const objectCache = new Map();
      try {
        await ensureFetchHeadReadable(git, fsClient, dest, fetchResult.fetchHead, objectCache);
      } catch (readErr) {
        const hint = readErr && readErr.message ? readErr.message : String(readErr);
        throw new Error(
          `object ${fetchResult.fetchHead.slice(
            0,
            7
          )} not readable after fetch/reindex (${hint}). Pack may be corrupt; check network or CORS proxy.`
        );
      }

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
        await git.checkout({
          fs: fsClient,
          dir: dest,
          ref: branch,
          remote: 'origin',
          cache: objectCache
        });
      }
    } catch (e) {
      await cleanupPartialGitDir(fsClient, dest);
      throw e;
    }
  }

  registerCommand(
    'git',
    async (terminal, args) => {
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

      if (
        typeof window.createJshGitFs !== 'function' ||
        typeof window.createJshGitHttp !== 'function'
      ) {
        return errResult(
          'internal: jsh-git-fs.js and jsh-git-http.js must be loaded before git (see terminal/index.html).'
        );
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
      const fs = window.createJshGitFs(terminal);
      const http = window.createJshGitHttp({
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
            let defaultBranchName = '';
            if (allBranches) {
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
              await cloneSingleBranch(git, fs, http, {
                dest,
                url,
                corsProxy,
                branch,
                depth,
                noCheckout
              });
            }
            const doneMsg = noCheckout
              ? `Cloning into '${dest}'...\nDone (objects only, no working tree).\nRun: cd '${dest}' && git checkout ${
                  allBranches ? '<branch>' : defaultBranchName
                }\n`
              : `Cloning into '${dest}'...\nDone.\n`;
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
            await git.fetch({ fs, http, dir, remote, corsProxy });
            return { stdout: `Fetched from ${remote}\n`, stderr: '', exitCode: 0 };
          }

          case 'pull': {
            const dir = terminal.currentDirectory;
            const remote = rest[0] || 'origin';
            const branch = rest[1] || (await git.currentBranch({ fs, dir }));
            await git.pull({
              fs,
              http,
              dir,
              remote,
              ref: branch,
              remoteRef: branch,
              corsProxy,
              author: gitAuthor(terminal)
            });
            return { stdout: `Pulled ${remote} ${branch}\n`, stderr: '', exitCode: 0 };
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
                return errResult(
                  'push: detached HEAD — specify branch (e.g. git push origin main)'
                );
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
          throw e;
        }
        const msg = e && e.message ? e.message : String(e);
        return { stdout: '', stderr: `git: ${sub} failed: ${msg}\n`, exitCode: 1 };
      }
    },
    'distributed version control (isomorphic-git + IndexedDB; GET via proxy when available)',
    'System'
  );
})();
