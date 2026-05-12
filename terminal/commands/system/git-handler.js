import { createJshGitFs } from '../../lib/jsh-git-fs.js';
import { createJshGitHttp } from '../../lib/jsh-git-http.js';
import { GIT_HELP } from './git-help.js';
import { loadIsoGit } from './git-iso.js';
import {
  errResult,
  gitAuthor,
  resolveCorsProxy,
  resolveGitCredential,
  takeFlagValue
} from './git-utils.js';
import { cloneSingleBranch, createProgressWriter, defaultCloneBranchName } from './git-clone.js';

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
