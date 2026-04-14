import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceManager } from '../core/device-manager.js';

function mockKernel() {
  return {
    log() {},
    emit() {}
  };
}

async function makeDiskManager() {
  const dm = new DeviceManager(mockKernel());
  await dm.initializeStorageDevices();
  return dm;
}

const VDA = '/dev/vda';

// ---------------------------------------------------------------------------
// sparse read — unwritten blocks return zeros
// ---------------------------------------------------------------------------

test('read from unwritten block returns all zeros', async () => {
  const dm = await makeDiskManager();
  const buf = new Uint8Array(64);
  buf.fill(0xff);
  const n = await dm.deviceRead(VDA, buf, 0, 64);
  assert.equal(n, 64);
  assert.ok(buf.every((b) => b === 0), 'unwritten block should be zeros');
});

// ---------------------------------------------------------------------------
// write then read round-trip
// ---------------------------------------------------------------------------

test('write then read round-trips correctly', async () => {
  const dm = await makeDiskManager();
  const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const written = await dm.deviceWrite(VDA, data, 0, 4);
  assert.equal(written, 4);

  const readBuf = new Uint8Array(4);
  const read = await dm.deviceRead(VDA, readBuf, 0, 4);
  assert.equal(read, 4);
  assert.deepEqual(Array.from(readBuf), [0xde, 0xad, 0xbe, 0xef]);
});

// ---------------------------------------------------------------------------
// write spanning multiple block boundaries (blockSize = 512)
// ---------------------------------------------------------------------------

test('write spanning block boundary', async () => {
  const dm = await makeDiskManager();
  const data = new Uint8Array(1024);
  for (let i = 0; i < data.length; i++) data[i] = i & 0xff;

  const offset = 500;
  await dm.deviceWrite(VDA, data, offset, data.length);

  const readBuf = new Uint8Array(1024);
  await dm.deviceRead(VDA, readBuf, offset, data.length);
  assert.deepEqual(Array.from(readBuf), Array.from(data));
});

// ---------------------------------------------------------------------------
// unaligned offset read
// ---------------------------------------------------------------------------

test('unaligned offset read/write', async () => {
  const dm = await makeDiskManager();
  const offset = 137;
  const data = new Uint8Array([10, 20, 30]);
  await dm.deviceWrite(VDA, data, offset, data.length);

  const readBuf = new Uint8Array(3);
  await dm.deviceRead(VDA, readBuf, offset, 3);
  assert.deepEqual(Array.from(readBuf), [10, 20, 30]);
});

// ---------------------------------------------------------------------------
// capacity clamp — read/write beyond total capacity
// ---------------------------------------------------------------------------

test('read beyond capacity returns 0 bytes', async () => {
  const dm = await makeDiskManager();
  const capacity = 1024 * 1024 * 512; // totalBlocks * blockSize
  const buf = new Uint8Array(10);
  const n = await dm.deviceRead(VDA, buf, capacity, 10);
  assert.equal(n, 0);
});

test('write beyond capacity returns 0 bytes', async () => {
  const dm = await makeDiskManager();
  const capacity = 1024 * 1024 * 512;
  const data = new Uint8Array(10);
  const n = await dm.deviceWrite(VDA, data, capacity, 10);
  assert.equal(n, 0);
});

test('write clamped to remaining capacity', async () => {
  const dm = await makeDiskManager();
  const capacity = 1024 * 1024 * 512;
  const data = new Uint8Array(100);
  const offset = capacity - 50;
  const n = await dm.deviceWrite(VDA, data, offset, 100);
  assert.equal(n, 50, 'should write only bytes within capacity');
});

// ---------------------------------------------------------------------------
// sparse — only written blocks are stored
// ---------------------------------------------------------------------------

test('sparse storage: only written blocks allocated', async () => {
  const dm = await makeDiskManager();
  const device = dm.devices.get('vda');
  assert.equal(device.storage.size, 0, 'no blocks before writes');

  const data = new Uint8Array(10);
  await dm.deviceWrite(VDA, data, 0, 10);
  assert.equal(device.storage.size, 1, 'one block after small write at start');

  await dm.deviceWrite(VDA, data, 512 * 100, 10);
  assert.equal(device.storage.size, 2, 'two blocks after write to distant offset');
});

test('multiple writes to same block do not duplicate', async () => {
  const dm = await makeDiskManager();
  const device = dm.devices.get('vda');
  const data = new Uint8Array(10);
  await dm.deviceWrite(VDA, data, 0, 10);
  await dm.deviceWrite(VDA, data, 100, 10);
  assert.equal(device.storage.size, 1, 'same block reused');
});
