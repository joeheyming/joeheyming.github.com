// filesystem-db-proc.js — virtual /proc overlay over the FileSystemDB.
//
// Read-only synthetic entries:
//   /proc                       directory (lists pids + 'self')
//   /proc/<pid>                 directory
//   /proc/<pid>/status          { Name, State, Pid, PPid, Uid, Cmdline }
//   /proc/<pid>/cmdline         NUL-separated argv (jsh uses string command)
//   /proc/<pid>/environ         NUL-separated KEY=VALUE pairs
//   /proc/<pid>/exe             symbolic command name
//   /proc/<pid>/cwd             working directory
//   /proc/self/* → resolved to current pid lazily
//   /proc/uptime                seconds since HeymingOS boot
//   /proc/loadavg               "0.00 0.00 0.00 0/N PID"
//
// Backed by `window.heymingOS.kernel.processManager` and friends; falls back
// to an empty /proc when those aren't loaded (e.g. in Node tests).

function tryGetProcessManager() {
  if (typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).heymingOS) {
    const os = /** @type {any} */ (globalThis).heymingOS;
    if (os.kernel && os.kernel.processManager) return os.kernel.processManager;
  }
  if (typeof window !== 'undefined' && /** @type {any} */ (window).heymingOS) {
    const os = /** @type {any} */ (window).heymingOS;
    if (os.kernel && os.kernel.processManager) return os.kernel.processManager;
  }
  return null;
}

function tryGetBootEpoch() {
  if (typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).heymingOS) {
    const os = /** @type {any} */ (globalThis).heymingOS;
    if (os.bootedAt != null) return Number(os.bootedAt);
  }
  return null;
}

function listPidsFromPm(pm) {
  if (!pm) return [];
  try {
    if (typeof pm.getProcesses === 'function') {
      const all = pm.getProcesses() || [];
      return all.map((p) => p.pid).filter((n) => n != null);
    }
    if (pm.processes && typeof pm.processes.keys === 'function') {
      return Array.from(pm.processes.keys());
    }
    if (pm.processes && typeof pm.processes === 'object') {
      return Object.keys(pm.processes).map((k) => parseInt(k, 10));
    }
  } catch (_) {
    /* ignore */
  }
  return [];
}

function getProcFromPm(pm, pid) {
  if (!pm) return null;
  try {
    if (typeof pm.getProcess === 'function') return pm.getProcess(pid);
    if (pm.processes && typeof pm.processes.get === 'function') return pm.processes.get(pid);
    if (pm.processes && typeof pm.processes === 'object') return pm.processes[pid] || pm.processes[String(pid)];
  } catch (_) {
    /* ignore */
  }
  return null;
}

function getCurrentPidFromPm(pm) {
  if (!pm) return 1;
  try {
    if (typeof pm.getCurrentProcess === 'function') {
      const c = pm.getCurrentProcess();
      if (c && c.pid != null) return c.pid;
    }
    if (pm.currentProcess && pm.currentProcess.pid != null) return pm.currentProcess.pid;
  } catch (_) {
    /* ignore */
  }
  return 1;
}

function makeDirItem(path) {
  return {
    path,
    type: 'directory',
    parentPath: path === '/proc' ? '/' : path.slice(0, path.lastIndexOf('/')) || '/',
    size: 0,
    mode: 0o555,
    uid: 0,
    gid: 0,
    modified: new Date().toISOString(),
    virtual: true
  };
}

function makeFileItem(path, content) {
  return {
    path,
    type: 'file',
    parentPath: path.slice(0, path.lastIndexOf('/')) || '/',
    size: content.length,
    content,
    mode: 0o444,
    uid: 0,
    gid: 0,
    modified: new Date().toISOString(),
    virtual: true
  };
}

function buildStatusFile(proc) {
  const lines = [
    `Name:\t${proc.name || proc.command || 'process'}`,
    `State:\t${proc.state || 'R (running)'}`,
    `Pid:\t${proc.pid}`,
    `PPid:\t${proc.ppid != null ? proc.ppid : 0}`,
    `Uid:\t${proc.uid != null ? proc.uid : 1000}\t${proc.uid != null ? proc.uid : 1000}\t${proc.uid != null ? proc.uid : 1000}\t${proc.uid != null ? proc.uid : 1000}`,
    `Gid:\t${proc.gid != null ? proc.gid : 1000}\t${proc.gid != null ? proc.gid : 1000}\t${proc.gid != null ? proc.gid : 1000}\t${proc.gid != null ? proc.gid : 1000}`,
    `Threads:\t1`,
    `Cmdline:\t${proc.command || proc.cmdline || proc.name || ''}`
  ];
  return lines.join('\n') + '\n';
}

function buildCmdlineFile(proc) {
  const raw = proc.command || proc.cmdline || proc.name || '';
  // jsh stores command as a single string; mimic the NUL-separated layout
  // by splitting on whitespace at a coarse level.
  const parts = String(raw).split(/\s+/).filter(Boolean);
  return parts.join('\0') + (parts.length ? '\0' : '');
}

function buildEnvironFile(proc) {
  const env = proc.env && typeof proc.env === 'object' ? proc.env : {};
  const out = [];
  for (const k of Object.keys(env)) {
    out.push(`${k}=${env[k]}`);
  }
  return out.join('\0') + (out.length ? '\0' : '');
}

/**
 * Resolve a /proc path into a synthetic item, or return null.
 * @param {string} path
 * @returns {object|null}
 */
function procVirtualGet(path) {
  if (path == null) return null;
  // Normalize.
  let p = String(path);
  if (p.startsWith('/proc/self/') || p === '/proc/self') {
    const pm = tryGetProcessManager();
    const pid = getCurrentPidFromPm(pm);
    p = p.replace(/^\/proc\/self/, `/proc/${pid}`);
  }
  if (p === '/proc') return makeDirItem('/proc');
  if (p === '/proc/uptime') {
    const boot = tryGetBootEpoch();
    const up = boot != null ? (Date.now() - boot) / 1000 : 0;
    return makeFileItem('/proc/uptime', `${up.toFixed(2)} ${up.toFixed(2)}\n`);
  }
  if (p === '/proc/loadavg') {
    const pm = tryGetProcessManager();
    const n = listPidsFromPm(pm).length || 1;
    return makeFileItem('/proc/loadavg', `0.00 0.00 0.00 1/${n} ${getCurrentPidFromPm(pm)}\n`);
  }
  const m = p.match(/^\/proc\/(\d+)(?:\/([^/]+))?$/);
  if (!m) return null;
  const pid = parseInt(m[1], 10);
  const sub = m[2];
  const pm = tryGetProcessManager();
  const proc = getProcFromPm(pm, pid);
  if (!proc) return null;
  if (!sub) return makeDirItem(`/proc/${pid}`);
  switch (sub) {
    case 'status':
      return makeFileItem(`/proc/${pid}/status`, buildStatusFile(proc));
    case 'cmdline':
      return makeFileItem(`/proc/${pid}/cmdline`, buildCmdlineFile(proc));
    case 'environ':
      return makeFileItem(`/proc/${pid}/environ`, buildEnvironFile(proc));
    case 'exe':
      return makeFileItem(`/proc/${pid}/exe`, String(proc.command || proc.name || ''));
    case 'cwd':
      return makeFileItem(`/proc/${pid}/cwd`, String(proc.cwd || '/'));
    default:
      return null;
  }
}

/**
 * List entries that live under a /proc directory path. Returns null if the
 * path isn't synthesized by the overlay (so the caller can fall through to IDB).
 * @param {string} parentPath
 * @returns {Array<object>|null}
 */
function procVirtualList(parentPath) {
  if (parentPath === '/proc') {
    const pm = tryGetProcessManager();
    const pids = listPidsFromPm(pm);
    const items = pids.map((pid) => makeDirItem(`/proc/${pid}`));
    items.push(makeDirItem('/proc/self'));
    items.push(makeFileItem('/proc/uptime', ''));
    items.push(makeFileItem('/proc/loadavg', ''));
    return items;
  }
  const m = parentPath.match(/^\/proc\/(\d+|self)$/);
  if (!m) return null;
  let pidArg = m[1];
  if (pidArg === 'self') {
    pidArg = String(getCurrentPidFromPm(tryGetProcessManager()));
  }
  const pid = parseInt(pidArg, 10);
  const pm = tryGetProcessManager();
  if (!getProcFromPm(pm, pid)) return [];
  return [
    makeFileItem(`/proc/${pid}/status`, ''),
    makeFileItem(`/proc/${pid}/cmdline`, ''),
    makeFileItem(`/proc/${pid}/environ`, ''),
    makeFileItem(`/proc/${pid}/exe`, ''),
    makeFileItem(`/proc/${pid}/cwd`, '')
  ];
}

/**
 * Wire the /proc overlay into a FileSystemDB-shaped object's prototype. The
 * patch is idempotent: calling apply more than once is a no-op.
 * @param {typeof import('./filesystem-db.js').FileSystemDB} ctor
 */
function applyFileSystemDbProc(ctor) {
  const proto = ctor.prototype;
  if (proto.__procOverlayInstalled) return;
  proto.__procOverlayInstalled = true;
  const originalGetItem = proto.getItem;
  proto.getItem = async function (path) {
    if (typeof path === 'string' && path.startsWith('/proc')) {
      const virt = procVirtualGet(path);
      if (virt) return virt;
    }
    return originalGetItem.call(this, path);
  };
  const originalListDirectory = proto.listDirectory;
  proto.listDirectory = async function (path) {
    if (typeof path === 'string' && (path === '/proc' || path.startsWith('/proc/'))) {
      const virt = procVirtualList(path);
      if (virt) return virt;
    }
    return originalListDirectory.call(this, path);
  };
}

export {
  applyFileSystemDbProc,
  procVirtualGet,
  procVirtualList,
  tryGetProcessManager,
  getCurrentPidFromPm,
  buildStatusFile,
  buildCmdlineFile,
  buildEnvironFile
};
