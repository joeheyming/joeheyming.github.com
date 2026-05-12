// [SITE] Serialized IDBFS write + user file staging for uzdoom-loader.

export const IDB_WAD_MOUNT = '/wads';
export const IDB_CFG_MOUNT = '/home/web_user/.config';

let _syncInFlight = null;
let _syncQueued = null;

export function syncSavesToIDB() {
  if (typeof FS === 'undefined') return Promise.resolve();
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
