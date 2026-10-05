import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_URL = pathToFileURL(path.join(ROOT, 'doom/uzdoom-loader-idbfs.js')).href;

async function loadModule() {
  return import(`${MODULE_URL}?test=${Date.now()}-${Math.random()}`);
}

test('IDBFS hardening clears cached handles when a database closes', async () => {
  const { hardenEmscriptenIdbfs } = await loadModule();
  const db = {
    close() {},
    onclose: null,
    onversionchange: null
  };
  const idbfs = {
    dbs: { saves: db },
    getDB(_name, callback) {
      callback(null, db);
    },
    reconcile() {}
  };

  hardenEmscriptenIdbfs(idbfs);
  await new Promise((resolve, reject) => {
    idbfs.getDB('saves', (error, opened) => {
      if (error) return reject(error);
      assert.equal(opened, db);
      resolve();
    });
  });

  assert.equal(typeof db.onclose, 'function');
  db.onclose();
  assert.equal(idbfs.dbs.saves, undefined);
});

test('IDBFS hardening converts a closed-transaction throw into a callback error', async () => {
  const { hardenEmscriptenIdbfs } = await loadModule();
  let closeCalls = 0;
  const db = { close: () => closeCalls++ };
  const closed = new Error('The database connection is closing');
  closed.name = 'InvalidStateError';
  const idbfs = {
    dbs: { saves: db },
    getDB() {},
    reconcile() {
      throw closed;
    }
  };

  hardenEmscriptenIdbfs(idbfs);
  let callbackError = null;
  assert.doesNotThrow(() => {
    idbfs.reconcile({}, {}, (error) => {
      callbackError = error;
    });
  });

  assert.equal(callbackError, closed);
  assert.equal(closeCalls, 1);
  assert.deepEqual(idbfs.dbs, {});
});

test('IDBFS hardening does not hide unrelated reconcile failures', async () => {
  const { hardenEmscriptenIdbfs } = await loadModule();
  const failure = new TypeError('bad reconciliation input');
  const idbfs = {
    dbs: {},
    getDB() {},
    reconcile() {
      throw failure;
    }
  };

  hardenEmscriptenIdbfs(idbfs);

  assert.throws(() => idbfs.reconcile({}, {}, () => {}), failure);
});
