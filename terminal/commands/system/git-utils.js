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

/** Defaults shared with the rest of the git stack. Bytes for max-pack so the http layer can read them directly. */
export const DEFAULT_CORS_PROXY = 'https://cors.isomorphic-git.org';

/**
 * Default checkout batch size when the working tree is "large" (> 5000 files,
 * see CHECKOUT_LARGE_TREE_FILES in git-clone.js). 25 is small enough that
 * per-batch inflate/IDB buffers don't blow Chrome's renderer heap on a 9000+
 * file tree; the pack itself sits in cache once (~128 MiB) and is re-used.
 *
 * Range allowed: 1..500. Override per-tab via window.JSH_GIT_CHECKOUT_BATCH or
 * persistently via `git config --jsh checkout-batch <N>`.
 */
export const DEFAULT_CHECKOUT_BATCH_LARGE = 25;
export const MIN_CHECKOUT_BATCH = 1;
export const MAX_CHECKOUT_BATCH = 500;

/**
 * Persistent, per-origin advanced jsh-git settings. Keep this list small —
 * tokens are deliberately session-only and never persisted here.
 */
export const STORED_GIT_SETTING_KEYS = Object.freeze({
  corsProxy: 'jsh.git.corsProxy',
  maxPackBytes: 'jsh.git.maxPackBytes',
  checkoutBatch: 'jsh.git.checkoutBatch'
});

function safeLocalStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch (_) {
    return null;
  }
}

/** Read a persisted jsh-git setting; returns null when missing or storage is unavailable. */
export function getStoredGitSetting(name) {
  const key = STORED_GIT_SETTING_KEYS[name];
  if (!key) return null;
  const ls = safeLocalStorage();
  if (!ls) return null;
  try {
    const v = ls.getItem(key);
    return v == null ? null : v;
  } catch (_) {
    return null;
  }
}

/**
 * Persist (or clear, when value is null/undefined) a jsh-git setting in localStorage.
 * Returns true when the write succeeded.
 */
export function setStoredGitSetting(name, value) {
  const key = STORED_GIT_SETTING_KEYS[name];
  if (!key) return false;
  const ls = safeLocalStorage();
  if (!ls) return false;
  try {
    if (value == null || value === '') {
      ls.removeItem(key);
    } else {
      ls.setItem(key, String(value));
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Effective checkout batch size for large trees. Same precedence as the other
 * jsh-git settings:
 *   env JSH_GIT_CHECKOUT_BATCH → window.JSH_GIT_CHECKOUT_BATCH → localStorage → default.
 *
 * @param {{env?: Record<string,string|undefined>} | null} terminal
 * @returns {number}
 */
export function resolveCheckoutBatchLarge(terminal) {
  const tryParse = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n < MIN_CHECKOUT_BATCH || n > MAX_CHECKOUT_BATCH) return null;
    return Math.floor(n);
  };
  const fromEnv = terminal && terminal.env && terminal.env.JSH_GIT_CHECKOUT_BATCH;
  if (fromEnv != null && String(fromEnv).trim() !== '') {
    const v = tryParse(fromEnv);
    if (v != null) return v;
  }
  const win = typeof window !== 'undefined' ? window.JSH_GIT_CHECKOUT_BATCH : null;
  if (win != null && String(win).trim() !== '') {
    const v = tryParse(win);
    if (v != null) return v;
  }
  const stored = getStoredGitSetting('checkoutBatch');
  if (stored != null && String(stored).trim() !== '') {
    const v = tryParse(stored);
    if (v != null) return v;
  }
  return DEFAULT_CHECKOUT_BATCH_LARGE;
}

function normalizeCorsProxyValue(raw) {
  const t = String(raw).trim();
  if (t === '') return { kind: 'unset' };
  const tl = t.toLowerCase();
  if (tl === '0' || tl === 'false' || tl === 'off') return { kind: 'disabled' };
  return { kind: 'value', value: t.replace(/\/+$/, '') };
}

/**
 * isomorphic-git CORS proxy base (no trailing slash). Undefined = user turned git CORS off only.
 *
 * Precedence: env (per-session) → window.JSH_GIT_CORS_PROXY (per-tab) →
 * localStorage[jsh.git.corsProxy] (persistent) → DEFAULT_CORS_PROXY.
 */
export function resolveCorsProxy(terminal) {
  const fromEnv = terminal && terminal.env && terminal.env.JSH_GIT_CORS_PROXY;
  if (fromEnv !== undefined && fromEnv !== null) {
    const r = normalizeCorsProxyValue(fromEnv);
    if (r.kind === 'disabled') return undefined;
    if (r.kind === 'value') return r.value;
  }
  const win = typeof window !== 'undefined' ? window.JSH_GIT_CORS_PROXY : null;
  if (win != null && String(win).trim() !== '') {
    const r = normalizeCorsProxyValue(win);
    if (r.kind === 'disabled') return undefined;
    if (r.kind === 'value') return r.value;
  }
  const stored = getStoredGitSetting('corsProxy');
  if (stored != null && String(stored).trim() !== '') {
    const r = normalizeCorsProxyValue(stored);
    if (r.kind === 'disabled') return undefined;
    if (r.kind === 'value') return r.value;
  }
  return DEFAULT_CORS_PROXY;
}

/**
 * Parse the post-`clone` argv (everything after `git clone`) into a structured
 * shape. Pure so the OOM-safety thresholds and force-checkout flag can be
 * unit-tested without spinning up isomorphic-git.
 *
 * Returns:
 *   { ok: true, url, dest, depth, allBranches, fullHistory, noCheckout, forceCheckout }
 *   { ok: false, error }   — usage error (missing url, bad --depth, etc.)
 *
 * Defaults match the existing handler:
 *   • depth = 1 (shallow), unless --full given
 *   • dest = null (caller derives from URL)
 */
export function parseCloneArgs(args) {
  const remaining = [];
  let depth;
  let allBranches = false;
  let fullHistory = false;
  let noCheckout = false;
  let forceCheckout = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--depth') {
      const next = args[i + 1];
      const n = parseInt(next, 10);
      if (!Number.isFinite(n) || n < 1) {
        return { ok: false, error: 'clone: --depth requires a positive integer' };
      }
      depth = n;
      i++;
      continue;
    }
    if (a === '--full') {
      fullHistory = true;
      continue;
    }
    if (a === '--all-branches') {
      allBranches = true;
      continue;
    }
    if (a === '--no-checkout') {
      noCheckout = true;
      continue;
    }
    if (a === '--force-checkout') {
      forceCheckout = true;
      continue;
    }
    remaining.push(a);
  }

  if (fullHistory) {
    depth = undefined;
  } else if (depth == null) {
    depth = 1;
  }

  if (noCheckout && forceCheckout) {
    return {
      ok: false,
      error: 'clone: --no-checkout and --force-checkout are mutually exclusive'
    };
  }

  const url = remaining[0];
  const destArg = remaining[1] || null;
  if (!url) {
    return { ok: false, error: 'clone requires a repository URL' };
  }

  return {
    ok: true,
    url,
    destArg,
    depth,
    allBranches,
    fullHistory,
    noCheckout,
    forceCheckout
  };
}

/**
 * Parse `git config --jsh <key> [value|--unset]` arguments into a structured action.
 * Pure function so it's easy to test without a terminal.
 *
 * Returns:
 *   { action: 'list' }                      → no args after `--jsh`
 *   { action: 'help' }                      → --help / -h
 *   { action: 'set',   key, raw }           → `<key> <value>`
 *   { action: 'unset', key }                → `<key> --unset`
 *   { action: 'get',   key }                → just `<key>`
 *   { action: 'error', message }            → unrecognized form
 */
export function parseJshConfigArgs(args) {
  if (!args || args.length === 0) return { action: 'list' };
  const first = String(args[0] || '').trim();
  if (first === '--help' || first === '-h' || first === 'help') {
    return { action: 'help' };
  }
  const known = new Set(['cors-proxy', 'max-pack-mib', 'checkout-batch']);
  if (!known.has(first)) {
    return {
      action: 'error',
      message: `unknown setting '${first}'. Known: ${[...known].join(', ')}`
    };
  }
  if (args.length === 1) return { action: 'get', key: first };
  const second = String(args[1] || '').trim();
  if (second === '--unset' || second === '-u') return { action: 'unset', key: first };
  if (args.length > 2) {
    return {
      action: 'error',
      message: `too many arguments for '${first}' (expected 1 value or --unset)`
    };
  }
  return { action: 'set', key: first, raw: second };
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
