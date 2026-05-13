import { createJshGitFs } from '../../lib/jsh-git-fs.js';
import { createJshGitHttp } from '../../lib/jsh-git-http.js';
import { GIT_HELP, GIT_CONFIG_JSH_HELP } from './git-help.js';
import { loadIsoGit } from './git-iso.js';
import {
  DEFAULT_CHECKOUT_BATCH_LARGE,
  DEFAULT_CORS_PROXY,
  MAX_CHECKOUT_BATCH,
  MIN_CHECKOUT_BATCH,
  errResult,
  getStoredGitSetting,
  gitAuthor,
  parseCloneArgs,
  parseJshConfigArgs,
  resolveCheckoutBatchLarge,
  resolveCorsProxy,
  resolveGitCredential,
  setStoredGitSetting,
  takeFlagValue
} from './git-utils.js';
import {
  AUTO_NO_CHECKOUT_FILE_THRESHOLD,
  cloneSingleBranch,
  createProgressWriter,
  defaultCloneBranchName,
  safeCheckout
} from './git-clone.js';

const ABS_MAX_PACK_MIB = 512;
const MIN_PACK_MIB = 8;

/**
 * Run `git config --jsh ...`. Pure-ish: only touches localStorage + window.JSH_GIT_*
 * via the helpers in git-utils.js, and only reads from those + env. Returns a
 * shell result so the caller can pass it straight through.
 */
function runJshConfig(terminal, args) {
  const parsed = parseJshConfigArgs(args);
  if (parsed.action === 'help') {
    return { stdout: GIT_CONFIG_JSH_HELP, stderr: '', exitCode: 0 };
  }
  if (parsed.action === 'error') {
    return errResult(`config --jsh: ${parsed.message}`);
  }
  if (parsed.action === 'list') {
    return { stdout: renderJshConfig(terminal), stderr: '', exitCode: 0 };
  }
  if (parsed.action === 'get') {
    return { stdout: renderJshConfig(terminal, parsed.key), stderr: '', exitCode: 0 };
  }
  if (parsed.action === 'unset') {
    return applyJshConfigUnset(parsed.key);
  }
  if (parsed.action === 'set') {
    return applyJshConfigSet(parsed.key, parsed.raw);
  }
  return errResult(`config --jsh: unsupported action`);
}

function effectiveCorsProxy(terminal) {
  const env = terminal && terminal.env && terminal.env.JSH_GIT_CORS_PROXY;
  if (env != null && String(env).trim() !== '') {
    return { value: resolveCorsProxy(terminal), source: 'env' };
  }
  const win = typeof window !== 'undefined' ? window.JSH_GIT_CORS_PROXY : null;
  if (win != null && String(win).trim() !== '') {
    return { value: resolveCorsProxy(terminal), source: 'window' };
  }
  const stored = getStoredGitSetting('corsProxy');
  if (stored != null && String(stored).trim() !== '') {
    return { value: resolveCorsProxy(terminal), source: 'stored' };
  }
  return { value: DEFAULT_CORS_PROXY, source: 'default' };
}

function effectiveMaxPackMiB() {
  if (typeof window !== 'undefined') {
    const w = Number(window.JSH_GIT_MAX_PACK_BYTES);
    if (Number.isFinite(w) && w >= MIN_PACK_MIB * 1024 * 1024) {
      return { mib: Math.round(w / (1024 * 1024)), source: 'window' };
    }
  }
  const stored = Number(getStoredGitSetting('maxPackBytes'));
  if (Number.isFinite(stored) && stored >= MIN_PACK_MIB * 1024 * 1024) {
    return { mib: Math.round(stored / (1024 * 1024)), source: 'stored' };
  }
  return { mib: 256, source: 'default' };
}

function effectiveCheckoutBatch(terminal) {
  const env = terminal && terminal.env && terminal.env.JSH_GIT_CHECKOUT_BATCH;
  if (env != null && String(env).trim() !== '') {
    return { value: resolveCheckoutBatchLarge(terminal), source: 'env' };
  }
  if (typeof window !== 'undefined') {
    const w = window.JSH_GIT_CHECKOUT_BATCH;
    if (w != null && String(w).trim() !== '') {
      return { value: resolveCheckoutBatchLarge(terminal), source: 'window' };
    }
  }
  const stored = getStoredGitSetting('checkoutBatch');
  if (stored != null && String(stored).trim() !== '') {
    return { value: resolveCheckoutBatchLarge(terminal), source: 'stored' };
  }
  return { value: DEFAULT_CHECKOUT_BATCH_LARGE, source: 'default' };
}

function renderRow(key, value, source) {
  const tag = source === 'default' ? '[default]' : `[${source}]`;
  return `  ${key.padEnd(14)} ${String(value).padEnd(40)} ${tag}`;
}

function renderJshConfig(terminal, only) {
  const lines = ['jsh git settings:'];
  const cors = effectiveCorsProxy(terminal);
  const pack = effectiveMaxPackMiB();
  const batch = effectiveCheckoutBatch(terminal);
  if (!only || only === 'cors-proxy') {
    lines.push(renderRow('cors-proxy', cors.value === undefined ? '<off>' : cors.value, cors.source));
  }
  if (!only || only === 'max-pack-mib') {
    lines.push(renderRow('max-pack-mib', pack.mib, pack.source));
  }
  if (!only || only === 'checkout-batch') {
    lines.push(renderRow('checkout-batch', batch.value, batch.source));
  }
  if (!only) {
    lines.push('');
    lines.push('Set:    git config --jsh <key> <value>');
    lines.push('Unset:  git config --jsh <key> --unset');
    lines.push('Help:   git config --jsh --help');
  }
  return lines.join('\n') + '\n';
}

function applyJshConfigUnset(key) {
  if (key === 'cors-proxy') {
    if (!setStoredGitSetting('corsProxy', null)) {
      return errResult('config --jsh: localStorage unavailable');
    }
    return { stdout: `unset cors-proxy (now: ${DEFAULT_CORS_PROXY} [default])\n`, stderr: '', exitCode: 0 };
  }
  if (key === 'max-pack-mib') {
    if (!setStoredGitSetting('maxPackBytes', null)) {
      return errResult('config --jsh: localStorage unavailable');
    }
    return { stdout: `unset max-pack-mib (now: 256 [default])\n`, stderr: '', exitCode: 0 };
  }
  if (key === 'checkout-batch') {
    if (!setStoredGitSetting('checkoutBatch', null)) {
      return errResult('config --jsh: localStorage unavailable');
    }
    return {
      stdout: `unset checkout-batch (now: ${DEFAULT_CHECKOUT_BATCH_LARGE} [default])\n`,
      stderr: '',
      exitCode: 0
    };
  }
  return errResult(`config --jsh: unknown setting '${key}'`);
}

function applyJshConfigSet(key, raw) {
  if (key === 'cors-proxy') {
    const tl = raw.toLowerCase();
    let stored = raw;
    if (tl === '0' || tl === 'false' || tl === 'off') {
      stored = 'off';
    } else {
      try {
        const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return errResult(`config --jsh: cors-proxy must be http(s) URL or 'off'`);
        }
      } catch (_) {
        return errResult(`config --jsh: '${raw}' is not a valid URL or 'off'`);
      }
      stored = raw.replace(/\/+$/, '');
    }
    if (!setStoredGitSetting('corsProxy', stored)) {
      return errResult('config --jsh: localStorage unavailable');
    }
    const human = stored === 'off' ? '<off>' : stored;
    return { stdout: `cors-proxy = ${human} (saved)\n`, stderr: '', exitCode: 0 };
  }
  if (key === 'max-pack-mib') {
    const mib = Number(raw);
    if (!Number.isFinite(mib) || mib < MIN_PACK_MIB || mib > ABS_MAX_PACK_MIB) {
      return errResult(
        `config --jsh: max-pack-mib must be ${MIN_PACK_MIB}..${ABS_MAX_PACK_MIB} (got '${raw}')`
      );
    }
    const bytes = Math.floor(mib) * 1024 * 1024;
    if (!setStoredGitSetting('maxPackBytes', String(bytes))) {
      return errResult('config --jsh: localStorage unavailable');
    }
    return { stdout: `max-pack-mib = ${Math.floor(mib)} (saved)\n`, stderr: '', exitCode: 0 };
  }
  if (key === 'checkout-batch') {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < MIN_CHECKOUT_BATCH || n > MAX_CHECKOUT_BATCH) {
      return errResult(
        `config --jsh: checkout-batch must be ${MIN_CHECKOUT_BATCH}..${MAX_CHECKOUT_BATCH} (got '${raw}')`
      );
    }
    if (!setStoredGitSetting('checkoutBatch', String(Math.floor(n)))) {
      return errResult('config --jsh: localStorage unavailable');
    }
    return {
      stdout: `checkout-batch = ${Math.floor(n)} (saved)\n`,
      stderr: '',
      exitCode: 0
    };
  }
  return errResult(`config --jsh: unknown setting '${key}'`);
}

export async function gitHandler(terminal, args) {
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

  // `git config --jsh ...` manages persistent jsh-git defaults (cors-proxy,
  // max-pack-mib) without touching the network or loading isomorphic-git.
  if (sub === 'config' && String(args[1] || '') === '--jsh') {
    return runJshConfig(terminal, args.slice(2));
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
        const parsed = parseCloneArgs(rest);
        if (!parsed.ok) {
          return errResult(parsed.error);
        }
        const { url, destArg, depth, allBranches, noCheckout, forceCheckout } = parsed;
        let dest = destArg ? terminal.resolvePath(destArg) : null;
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
          'forceCheckout=' + forceCheckout,
          'allBranches=' + allBranches
        );
        let defaultBranchName = '';
        let cloneResult = { autoSkippedCheckout: false, fileCount: 0 };
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
          cloneResult =
            (await cloneSingleBranch(
              git,
              fs,
              http,
              {
                dest,
                url,
                corsProxy,
                branch,
                depth,
                noCheckout,
                forceCheckout
              },
              terminal
            )) || cloneResult;
        }
        const branchHint = allBranches ? '<branch>' : defaultBranchName;
        let doneMsg;
        if (cloneResult.autoSkippedCheckout) {
          doneMsg =
            `Done (objects only — auto-skipped checkout: ${cloneResult.fileCount} files is above the auto-OOM safety threshold of ${AUTO_NO_CHECKOUT_FILE_THRESHOLD}).\n` +
            `Run: cd '${dest}' && git checkout ${branchHint}    (uses streaming checkout: bounded heap, ~1 file/ms)\n` +
            `(Override with 'git clone --force-checkout <url>' next time to attempt checkout anyway.)`;
        } else if (noCheckout) {
          doneMsg = `Done (objects only, no working tree).\nRun: cd '${dest}' && git checkout ${branchHint}`;
        } else {
          doneMsg = 'Done.';
        }
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
        // Route through safeCheckout so a `git checkout <branch>` after a
        // `git clone --no-checkout` (or after the auto-skip) batches the
        // file writes and evicts the pack between batches — same OOM
        // protection we use during the clone phase.
        const { fileCount } = await safeCheckout(git, fs, dir, rest[0], terminal);
        return {
          stdout: `Switched to ${rest[0]} (${fileCount} files)\n`,
          stderr: '',
          exitCode: 0
        };
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
