// sudo — run a single pipeline as another user (default: root).
//
// jsh notes: this is a UX / teaching simulation. There is no real privilege
// boundary; "sudo" just swaps `terminal.env.USER` (and `terminal.process.uid`
// when present) around the inner pipeline and reverts on exit. Anything the
// inner command can do, the user could already do — see JSH-SPEC.md.

const SUDO_HELP = `Usage: sudo [OPTION]... COMMAND [ARG]...
Run COMMAND with elevated (or different) user identity for one pipeline.

  -u, --user USER   target user (default: root)
  -i                run an interactive login shell (no-op stub)
  -n, --non-interactive  fail rather than prompt for a password
  -h, --help        display this help and exit

jsh: there is no real privilege boundary. The user/uid swap is cooperative
and lasts only for the single pipeline.
`;

function parseSudoArgv(args) {
  let user = 'root';
  let nonInteractive = false;
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '-h' || a === '--help') return { ok: true, help: true };
    if (a === '-u' || a === '--user') {
      if (i + 1 >= args.length) return { ok: false, stderr: "sudo: -u requires an argument\n", exitCode: 2 };
      user = args[++i];
      i++;
      continue;
    }
    if (a === '-n' || a === '--non-interactive') {
      nonInteractive = true;
      i++;
      continue;
    }
    if (a === '-i') {
      i++;
      continue;
    }
    if (a === '--') {
      i++;
      break;
    }
    if (a.startsWith('-') && a.length > 1) {
      return { ok: false, stderr: `sudo: unrecognized option '${a}'\n`, exitCode: 2 };
    }
    break;
  }
  const cmd = args.slice(i);
  return { ok: true, user, nonInteractive, cmd };
}

function quoteForShell(s) {
  if (/^[A-Za-z0-9_./@%+=:,-]+$/.test(s)) return s;
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

async function sudoHandler(terminal, args) {
  const parsed = parseSudoArgv(args || []);
  if (parsed.ok === false) return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  if (parsed.help) return { stdout: SUDO_HELP, stderr: '', exitCode: 0 };
  if (!parsed.cmd.length) {
    return { stdout: '', stderr: 'sudo: a command is required\n', exitCode: 1 };
  }

  const sm = terminal.os?.kernel?.securityManager;
  let target = sm ? sm.getUserByName(parsed.user) : null;
  if (sm && !target) {
    return { stdout: '', stderr: `sudo: unknown user '${parsed.user}'\n`, exitCode: 1 };
  }
  // No password prompt in this implementation (documented stub).

  // Snapshot identity-related state.
  const prevUser = terminal.env.USER;
  const prevHome = terminal.env.HOME;
  const prevUid = terminal.process ? terminal.process.uid : null;
  const prevGid = terminal.process ? terminal.process.gid : null;
  const prevCwd = terminal.cwd;

  // Swap.
  if (target) {
    terminal.env.USER = target.username;
    terminal.env.HOME = target.home;
    if (terminal.process) {
      terminal.process.uid = target.uid;
      terminal.process.gid = target.gid;
    }
  } else {
    // No SecurityManager (e.g. tests): just set USER for visibility.
    terminal.env.USER = parsed.user;
  }

  let exit = 0;
  let stdout = '';
  let stderr = '';
  try {
    const cmdline = parsed.cmd.map(quoteForShell).join(' ');
    if (typeof terminal.captureInnerPipeline === 'function') {
      const out = await terminal.captureInnerPipeline(cmdline);
      stdout = out || '';
      exit = terminal.lastExitCode | 0;
    } else {
      stderr = 'sudo: shell does not support inner pipelines\n';
      exit = 1;
    }
  } catch (e) {
    stderr = `sudo: ${e.message}\n`;
    exit = 1;
  } finally {
    terminal.env.USER = prevUser;
    terminal.env.HOME = prevHome;
    if (terminal.process) {
      if (prevUid != null) terminal.process.uid = prevUid;
      if (prevGid != null) terminal.process.gid = prevGid;
    }
    terminal.cwd = prevCwd;
  }
  return { stdout, stderr, exitCode: exit };
}

export default {
  name: 'sudo',
  handler: sudoHandler,
  description: 'run a single pipeline as another user (default: root); cooperative, not enforced',
  category: 'System'
};

export { parseSudoArgv };
