import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkManager } from '../core/device-manager.js';
import { parseNcArgv } from '../commands/system/nc.js';
import { parseWgetArgv, urlBasename } from '../commands/system/wget.js';

function makeKernel() {
  return { log: () => {} };
}

test('NetworkManager: socket allocates monotonically growing fds', () => {
  const nm = new NetworkManager(makeKernel());
  const a = nm.createSocket();
  const b = nm.createSocket();
  assert.ok(b > a);
  assert.equal(nm.sockets.size, 2);
});

test('NetworkManager: connect populates host/port and scheme', () => {
  const nm = new NetworkManager(makeKernel());
  const fd = nm.createSocket();
  nm.connect(fd, { host: 'example.com', port: 443 });
  const sock = nm.sockets.get(fd);
  assert.equal(sock.host, 'example.com');
  assert.equal(sock.port, 443);
  assert.equal(sock.scheme, 'https');
  assert.equal(sock.connected, true);
});

test('NetworkManager: connect on bad fd throws EBADF', () => {
  const nm = new NetworkManager(makeKernel());
  assert.throws(() => nm.connect(9999, { host: 'x' }), /Bad file descriptor/);
});

test('NetworkManager: send on unconnected fd throws ENOTCONN', async () => {
  const nm = new NetworkManager(makeKernel());
  const fd = nm.createSocket();
  await assert.rejects(() => nm.send(fd, 'GET / HTTP/1.0\r\n\r\n'), /Not connected/);
});

test('NetworkManager: listen is unsupported', () => {
  const nm = new NetworkManager(makeKernel());
  assert.throws(() => nm.listen(), /jsh does not implement inbound sockets/);
});

test('NetworkManager: flush captures errors into a 502 recv', async () => {
  const nm = new NetworkManager(makeKernel());
  const fd = nm.createSocket();
  nm.connect(fd, { host: 'definitely.invalid.example', port: 80 });
  // Override fetch to throw deterministically.
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('net::ERR_NAME_NOT_RESOLVED');
  };
  try {
    await nm.send(fd, 'GET / HTTP/1.0\r\nHost: definitely.invalid.example\r\n\r\n');
    const out = nm.recv(fd);
    assert.match(out, /502 Bad Gateway/);
    assert.match(out, /ERR_NAME_NOT_RESOLVED/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('NetworkManager: round-trip via stubbed fetch produces wire-shaped response', async () => {
  const nm = new NetworkManager(makeKernel());
  const fd = nm.createSocket();
  nm.connect(fd, { host: 'example.com', port: 80 });
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    statusText: 'OK',
    headers: new Map([['content-type', 'text/plain']]),
    async text() {
      return 'hi';
    }
  });
  try {
    await nm.send(fd, 'GET / HTTP/1.0\r\nHost: example.com\r\n\r\n');
    const out = nm.recv(fd);
    assert.ok(out.startsWith('HTTP/1.1 200 OK\r\n'));
    assert.ok(out.endsWith('\r\n\r\nhi'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('parseNcArgv: rejects -l and -e', () => {
  const a = parseNcArgv(['-l', 'h', '1']);
  assert.equal(a.ok, false);
  assert.match(a.stderr, /unsupported/);
  const b = parseNcArgv(['-e', 'sh', 'h', '1']);
  assert.equal(b.ok, false);
});

test('parseNcArgv: -s forces https', () => {
  const r = parseNcArgv(['-s', 'example.com', '80']);
  assert.equal(r.ok, true);
  assert.equal(r.useHttps, true);
  assert.equal(r.host, 'example.com');
  assert.equal(r.port, 80);
});

test('parseNcArgv: -w SEC sets timeoutMs', () => {
  const r = parseNcArgv(['-w', '2', 'example.com', '80']);
  assert.equal(r.timeoutMs, 2000);
});

test('parseNcArgv: requires host and port', () => {
  const r = parseNcArgv(['example.com']);
  assert.equal(r.ok, false);
  assert.match(r.stderr, /HOST and PORT/);
});

test('parseWgetArgv: defaults and -O', () => {
  const r1 = parseWgetArgv(['https://x.test/y/z.html']);
  assert.equal(r1.ok, true);
  assert.equal(r1.url, 'https://x.test/y/z.html');
  assert.equal(r1.outPath, null);
  const r2 = parseWgetArgv(['-O', 'out.bin', 'https://x.test/']);
  assert.equal(r2.outPath, 'out.bin');
  const r3 = parseWgetArgv(['-Oout.bin', 'https://x.test/']);
  assert.equal(r3.outPath, 'out.bin');
});

test('parseWgetArgv: -q and --no-proxy', () => {
  const r = parseWgetArgv(['-q', '--no-proxy', 'https://x.test/']);
  assert.equal(r.quiet, true);
  assert.equal(r.noProxy, true);
});

test('parseWgetArgv: missing URL is an error', () => {
  const r = parseWgetArgv([]);
  assert.equal(r.ok, false);
  assert.match(r.stderr, /missing URL/);
});

test('urlBasename: returns last path segment or index.html', () => {
  assert.equal(urlBasename('https://x.test/a/b/file.txt'), 'file.txt');
  assert.equal(urlBasename('https://x.test/'), 'index.html');
  assert.equal(urlBasename('not a url'), 'index.html');
});
