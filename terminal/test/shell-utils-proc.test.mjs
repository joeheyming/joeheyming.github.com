import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  procVirtualGet,
  procVirtualList,
  buildStatusFile,
  buildCmdlineFile,
  buildEnvironFile
} from '../../os/filesystem-db-proc.js';

// Install a fake heymingOS for the lifetime of these tests.
globalThis.heymingOS = {
  bootedAt: Date.now() - 5000,
  kernel: {
    processManager: {
      currentProcess: { pid: 42 },
      processes: new Map([
        [
          1,
          {
            pid: 1,
            ppid: 0,
            name: 'init',
            command: 'init',
            state: 'S (sleeping)',
            uid: 0,
            gid: 0,
            cwd: '/',
            env: { TERM: 'jsh' }
          }
        ],
        [
          42,
          {
            pid: 42,
            ppid: 1,
            name: 'bash',
            command: 'bash --login',
            state: 'R (running)',
            uid: 1000,
            gid: 1000,
            cwd: '/home/user',
            env: { PATH: '/bin', USER: 'jheyming' }
          }
        ]
      ]),
      getProcess(pid) {
        return this.processes.get(pid);
      },
      getProcesses() {
        return Array.from(this.processes.values());
      },
      getCurrentProcess() {
        return this.currentProcess;
      }
    }
  }
};

test('procVirtualGet: /proc is a directory', () => {
  const item = procVirtualGet('/proc');
  assert.ok(item);
  assert.equal(item.type, 'directory');
  assert.equal(item.virtual, true);
});

test('procVirtualGet: /proc/42 is a directory', () => {
  const item = procVirtualGet('/proc/42');
  assert.ok(item);
  assert.equal(item.type, 'directory');
});

test('procVirtualGet: /proc/9999 returns null (no such pid)', () => {
  assert.equal(procVirtualGet('/proc/9999'), null);
});

test('procVirtualGet: /proc/42/status returns parseable text', () => {
  const item = procVirtualGet('/proc/42/status');
  assert.ok(item);
  assert.match(item.content, /^Name:\tbash/m);
  assert.match(item.content, /^Pid:\t42/m);
  assert.match(item.content, /^PPid:\t1/m);
  assert.match(item.content, /^State:\tR \(running\)/m);
});

test('procVirtualGet: /proc/42/cmdline is NUL-separated', () => {
  const item = procVirtualGet('/proc/42/cmdline');
  assert.ok(item);
  assert.equal(item.content, 'bash\0--login\0');
});

test('procVirtualGet: /proc/42/environ is NUL-separated', () => {
  const item = procVirtualGet('/proc/42/environ');
  assert.ok(item);
  assert.ok(item.content.includes('PATH=/bin'));
  assert.ok(item.content.includes('USER=jheyming'));
  assert.ok(item.content.endsWith('\0'));
});

test('procVirtualGet: /proc/self resolves to current pid', () => {
  const item = procVirtualGet('/proc/self/status');
  assert.ok(item);
  assert.match(item.content, /^Pid:\t42/m);
});

test('procVirtualGet: /proc/uptime returns 2 floats', () => {
  const item = procVirtualGet('/proc/uptime');
  assert.ok(item);
  assert.match(item.content, /^\d+\.\d{2} \d+\.\d{2}\n$/);
});

test('procVirtualGet: /proc/loadavg has expected layout', () => {
  const item = procVirtualGet('/proc/loadavg');
  assert.ok(item);
  assert.match(item.content, /^0\.00 0\.00 0\.00 1\/\d+ \d+\n$/);
});

test('procVirtualList: /proc lists pids and self', () => {
  const items = procVirtualList('/proc');
  assert.ok(items);
  const paths = items.map((i) => i.path);
  assert.ok(paths.includes('/proc/1'));
  assert.ok(paths.includes('/proc/42'));
  assert.ok(paths.includes('/proc/self'));
  assert.ok(paths.includes('/proc/uptime'));
});

test('procVirtualList: /proc/42 lists status/cmdline/environ/exe/cwd', () => {
  const items = procVirtualList('/proc/42');
  assert.ok(items);
  const names = items.map((i) => i.path.split('/').pop());
  assert.ok(names.includes('status'));
  assert.ok(names.includes('cmdline'));
  assert.ok(names.includes('environ'));
  assert.ok(names.includes('exe'));
  assert.ok(names.includes('cwd'));
});

test('buildStatusFile: includes core fields', () => {
  const text = buildStatusFile({
    pid: 7,
    ppid: 1,
    name: 'foo',
    state: 'S',
    uid: 2,
    gid: 3,
    command: 'foo --bar'
  });
  assert.match(text, /^Pid:\t7/m);
  assert.match(text, /^PPid:\t1/m);
  assert.match(text, /^Cmdline:\tfoo --bar/m);
});

test('buildCmdlineFile / buildEnvironFile: NUL-terminated', () => {
  assert.equal(buildCmdlineFile({ command: 'a b c' }), 'a\0b\0c\0');
  assert.equal(
    buildEnvironFile({ env: { K: 'v', N: 'x' } }),
    'K=v\0N=x\0'
  );
});
