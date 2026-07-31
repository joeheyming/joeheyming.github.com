// [SITE] Serialized IDBFS write + user file staging for uzdoom-loader.

export const IDB_WAD_MOUNT = '/wads';
export const IDB_CFG_MOUNT = '/home/web_user/.config';

let _syncInFlight = null;
let _syncQueued = null;

/**
 * Emscripten's stock IDBFS (in uzdoom.js) caches IDBDatabase handles in
 * `IDBFS.dbs` with no `onversionchange` / `onclose` reset, and
 * `IDBFS.reconcile` calls `db.transaction(...)` *without* a try/catch.
 * When the browser closes the connection mid-pagehide (or another tab
 * deletes the DB), that throw escapes as an uncaught `InvalidStateError`
 * — the #1 sitewide `exception` in the Jul 2026 GA pull, almost entirely
 * co-occurring with Doom `page_hide` / `page_exit`.
 *
 * We can't sanely edit the minified engine blob, so monkey-patch once
 * after `uzdoom.js` defines `IDBFS`: clear the cache on close, and turn
 * reconcile's sync throw into a callback error (our syncfs wrapper already
 * logs those).
 *
 * Idempotent — safe to call from every sync / mount entry point.
 */
export function hardenEmscriptenIdbfs(idbfs = typeof IDBFS !== 'undefined' ? IDBFS : null) {
  if (!idbfs || idbfs.__heymingHardened) return idbfs;
  idbfs.__heymingHardened = true;
  if (!idbfs.dbs) idbfs.dbs = {};

  const origGetDB = typeof idbfs.getDB === 'function' ? idbfs.getDB.bind(idbfs) : null;
  if (origGetDB) {
    idbfs.getDB = (name, callback) => {
      origGetDB(name, (err, db) => {
        if (err || !db) return callback(err, db);
        if (!db.__heymingCloseHook) {
          db.__heymingCloseHook = true;
          db.onversionchange = () => {
            try {
              db.close();
            } catch (_) {
              /* already closing */
            }
            if (idbfs.dbs[name] === db) delete idbfs.dbs[name];
          };
          db.onclose = () => {
            if (idbfs.dbs[name] === db) delete idbfs.dbs[name];
          };
        }
        callback(null, db);
      });
    };
  }

  const origReconcile = typeof idbfs.reconcile === 'function' ? idbfs.reconcile.bind(idbfs) : null;
  if (origReconcile) {
    idbfs.reconcile = (src, dst, callback) => {
      try {
        return origReconcile(src, dst, callback);
      } catch (e) {
        if (e && e.name === 'InvalidStateError') {
          console.warn('[IDBFS] reconcile on closed DB — dropping cached handles');
          try {
            for (const db of Object.values(idbfs.dbs || {})) {
              try {
                db.close();
              } catch (_) {
                /* ignore */
              }
            }
          } catch (_) {
            /* ignore */
          }
          idbfs.dbs = {};
          if (typeof callback === 'function') return callback(e);
          return;
        }
        throw e;
      }
    };
  }

  return idbfs;
}

export function syncSavesToIDB() {
  if (typeof FS === 'undefined') return Promise.resolve();
  hardenEmscriptenIdbfs();
  if (_syncInFlight) {
    if (!_syncQueued) {
      _syncQueued = _syncInFlight.then(() => {
        _syncQueued = null;
        return _doSyncWrite();
      });
    }
    return _syncQueued;
  }
  return _doSyncWrite();
}

function _doSyncWrite() {
  hardenEmscriptenIdbfs();
  _syncInFlight = new Promise((resolve) => {
    try {
      FS.syncfs(false, (err) => {
        if (err) console.warn('[syncfs] write:', err);
        _syncInFlight = null;
        resolve();
      });
    } catch (e) {
      _syncInFlight = null;
      resolve();
    }
  });
  return _syncInFlight;
}

export function mountFilesystems() {
  hardenEmscriptenIdbfs();
  try {
    FS.mkdir(IDB_WAD_MOUNT);
  } catch (_e) {
    /* already exists */
  }
  try {
    FS.mkdir(IDB_CFG_MOUNT);
  } catch (_e) {
    /* already exists */
  }
  try {
    FS.mkdir(IDB_CFG_MOUNT + '/uzdoom');
  } catch (_e) {
    /* already exists */
  }
  FS.mount(IDBFS, {}, IDB_WAD_MOUNT);
  FS.mount(IDBFS, {}, IDB_CFG_MOUNT);
}

export function fsExists(path) {
  try {
    FS.stat(path);
    return true;
  } catch (e) {
    return false;
  }
}

export function writeUserFiles(state, launcherArgs) {
  const args = [];
  if (state.iwad && state.iwad.bundled) {
    args.push('-iwad', '/' + state.iwad.bundled);
  } else if (state.iwad && state.iwad.persisted) {
    const p = IDB_WAD_MOUNT + '/' + state.iwad.name;
    if (!fsExists(p)) {
      throw new Error(
        'IWAD "' +
          state.iwad.name +
          '" is not in storage yet. ' +
          'Upload it once through the picker, then reuse this URL.'
      );
    }
    args.push('-iwad', p);
  } else if (state.iwad) {
    const p = IDB_WAD_MOUNT + '/' + state.iwad.name;
    FS.writeFile(p, state.iwad.data);
    args.push('-iwad', p);
  }
  for (const m of state.mods) {
    const p = IDB_WAD_MOUNT + '/' + m.name;
    if (m.persisted) {
      if (!fsExists(p)) {
        console.warn('[launcher] mod "' + m.name + '" not in IDBFS, skipping');
        continue;
      }
    } else {
      FS.writeFile(p, m.data);
    }
    args.push('-file', p);
  }
  if (state.soundfont) {
    try {
      FS.mkdirTree('/soundfonts');
    } catch (_e) {
      /* already exists */
    }
    FS.writeFile('/soundfonts/uzdoom.sf2', state.soundfont.data);
  }
  args.push(...launcherArgs.argv);
  return args;
}
