/** @param {new () => object} FileSystemDB */
export function applyFileSystemDbListeners(FileSystemDB) {
  Object.assign(FileSystemDB, {
    _debug(...args) {
      const debug = window.HeymingOS?.Config?.DEBUG || window.parent?.HeymingOS?.Config?.DEBUG;
      if (debug) {
        console.log('[FileSystemDB]', ...args);
      }
    },

    _getListeners() {
      const topWindow = window.top || window;
      if (!topWindow._fileSystemListeners) {
        topWindow._fileSystemListeners = {
          create: [],
          delete: [],
          move: [],
          copy: [],
          change: []
        };
      }
      return topWindow._fileSystemListeners;
    },

    on(event, callback) {
      const listeners = FileSystemDB._getListeners();
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(callback);
      return () => {
        const index = listeners[event].indexOf(callback);
        if (index > -1) {
          listeners[event].splice(index, 1);
        }
      };
    },

    emit(event, path, details = {}) {
      const listeners = FileSystemDB._getListeners();
      if (listeners[event]) {
        listeners[event].forEach((cb) => {
          try {
            cb(path, { event, ...details });
          } catch (e) {
            console.error('Filesystem event handler error:', e);
          }
        });
      }
      if (event !== 'change' && listeners.change) {
        listeners.change.forEach((cb) => {
          try {
            cb(path, { event, ...details });
          } catch (e) {
            console.error('Filesystem event handler error:', e);
          }
        });
      }
    }
  });
}
