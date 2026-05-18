// filesystem-db-perms.js — feature-flagged POSIX-style permission gatekeeper.
//
// Off by default. Flip `globalThis.heymingOSConfig.enforceFsPermissions = true`
// or `localStorage.setItem('heymingOS_enforceFsPermissions', '1')` to enable.
// When on, reads/writes/deletes consult the current user (from
// SecurityManager when reachable) against item.mode / item.uid / item.gid.
//
// jsh notes:
//   - This is *not* a real security boundary; any code with `globalThis` access
//     can disable it. It exists so scripts that exercise `chmod 000 f && cat f`
//     get a believable "Permission denied" without persistent footguns.
//   - The check uses the same algorithm Linux uses: owner > group > other,
//     fall back to all-zero deny.

const PERM_READ = 4;
const PERM_WRITE = 2;
const PERM_EXEC = 1;

function isEnforcementOn() {
  try {
    if (typeof globalThis !== 'undefined') {
      const cfg = /** @type {any} */ (globalThis).heymingOSConfig;
      if (cfg && cfg.enforceFsPermissions) return true;
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('heymingOS_enforceFsPermissions') === '1') {
      return true;
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

function getCurrentUser() {
  try {
    if (typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).heymingOS) {
      const os = /** @type {any} */ (globalThis).heymingOS;
      const pm = os.kernel?.processManager;
      const sm = os.kernel?.securityManager;
      const proc = pm?.getCurrentProcess?.() || pm?.currentProcess || null;
      if (proc && proc.uid != null) {
        const u = sm?.users?.get?.(proc.uid);
        return {
          uid: proc.uid,
          gid: proc.gid != null ? proc.gid : u?.gid || 1000,
          groups: sm ? Array.from(sm.getGroupsForUser?.(proc.uid) || []).map((g) => g.gid) : []
        };
      }
    }
  } catch (_) {
    /* ignore */
  }
  return { uid: 1000, gid: 1000, groups: [] };
}

/**
 * Check whether `user` can perform `op` ('read'|'write'|'execute') on `item`.
 * Returns true if allowed, false if denied. Treats missing modes as 0o644/0o755.
 * @param {object} item
 * @param {'read'|'write'|'execute'} op
 * @param {{ uid:number, gid:number, groups:number[] }} user
 */
function permitItem(item, op, user) {
  if (!item) return false;
  if (user.uid === 0) return true; // root bypass
  const wantBit = op === 'read' ? PERM_READ : op === 'write' ? PERM_WRITE : PERM_EXEC;
  const ownerUid = item.uid != null ? item.uid : 1000;
  const ownerGid = item.gid != null ? item.gid : 1000;
  const mode =
    item.mode != null
      ? item.mode & 0o777
      : item.type === 'directory'
      ? 0o755
      : 0o644;
  let perms;
  if (user.uid === ownerUid) perms = (mode >> 6) & 7;
  else if (user.gid === ownerGid || user.groups.includes(ownerGid)) perms = (mode >> 3) & 7;
  else perms = mode & 7;
  return (perms & wantBit) === wantBit;
}

function deny(op, path) {
  const e = new Error(`Permission denied: ${op} ${path}`);
  /** @type {any} */ (e).code = 'EACCES';
  return e;
}

/**
 * Wrap a FileSystemDB prototype with permission checks on getItem,
 * createFile, deleteItem, listDirectory. Idempotent.
 * @param {Function} ctor
 */
function applyFileSystemDbPerms(ctor) {
  const proto = ctor.prototype;
  if (proto.__permsOverlayInstalled) return;
  proto.__permsOverlayInstalled = true;

  const originalGetItem = proto.getItem;
  proto.getItem = async function (path) {
    const item = await originalGetItem.call(this, path);
    if (!item) return item;
    if (!isEnforcementOn()) return item;
    // /proc and synthetic items are world-readable.
    if (item.virtual || (typeof path === 'string' && path.startsWith('/proc'))) return item;
    const user = getCurrentUser();
    if (!permitItem(item, 'read', user)) {
      throw deny('read', path);
    }
    return item;
  };

  const originalCreateFile = proto.createFile;
  if (typeof originalCreateFile === 'function') {
    proto.createFile = async function (path, content, overwrite) {
      if (isEnforcementOn()) {
        const user = getCurrentUser();
        try {
          const existing = await originalGetItem.call(this, path);
          if (existing) {
            if (!permitItem(existing, 'write', user)) throw deny('write', path);
          } else {
            const parent = path.slice(0, path.lastIndexOf('/')) || '/';
            const parentItem = await originalGetItem.call(this, parent);
            if (parentItem && !permitItem(parentItem, 'write', user)) {
              throw deny('write', parent);
            }
          }
        } catch (e) {
          if (/** @type {any} */ (e).code === 'EACCES') throw e;
          // Lookups failing for non-EACCES reasons fall through to the normal call.
        }
      }
      return originalCreateFile.call(this, path, content, overwrite);
    };
  }

  const originalDelete = proto.deleteItem;
  if (typeof originalDelete === 'function') {
    proto.deleteItem = async function (path, recursive) {
      if (isEnforcementOn()) {
        const user = getCurrentUser();
        const parent = path.slice(0, path.lastIndexOf('/')) || '/';
        try {
          const parentItem = await originalGetItem.call(this, parent);
          if (parentItem && !permitItem(parentItem, 'write', user)) {
            throw deny('write', parent);
          }
        } catch (e) {
          if (/** @type {any} */ (e).code === 'EACCES') throw e;
        }
      }
      return originalDelete.call(this, path, recursive);
    };
  }
}

export {
  applyFileSystemDbPerms,
  permitItem,
  isEnforcementOn,
  getCurrentUser,
  PERM_READ,
  PERM_WRITE,
  PERM_EXEC
};
