export function gitAuthor(terminal) {
  return {
    name: terminal.env.GIT_AUTHOR_NAME || terminal.env.USER || 'user',
    email:
      terminal.env.GIT_AUTHOR_EMAIL ||
      `${terminal.env.USER || 'user'}@${terminal.env.HOSTNAME || 'heyming-os'}.local`
  };
}

export function errResult(message, code = 1) {
  return { stdout: '', stderr: `git: ${message}`, exitCode: code };
}

export function takeFlagValue(args, flag) {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1]) {
    return { value: args[i + 1], without: args.filter((_, j) => j !== i && j !== i + 1) };
  }
  return { value: null, without: args };
}

/** isomorphic-git CORS proxy base (no trailing slash). Undefined = user turned git CORS off only. */
export function resolveCorsProxy(terminal) {
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
export function resolveGitCredential(terminal) {
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

export function formatBytes(n) {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${n} B`;
}
