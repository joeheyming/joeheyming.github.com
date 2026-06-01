// figlet + tree.
//
// figlet is pure rendering. tree walks the VFS, so we feed it a tiny
// in-memory mock terminal that satisfies the same getFileSystemItem /
// listDirectoryContents / fileSystemDB.getFileName contract that find uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import figletCmd from '../commands/fun/figlet.js';
import treeCmd from '../commands/filesystem/tree.js';

const figlet = figletCmd.handler;
const tree = treeCmd.handler;

// ---------------------------------------------------------------------------
// figlet
// ---------------------------------------------------------------------------

const stdinTerminal = (text) => ({ stdinSupplied: true, hasStdin: true, stdin: text });
const noStdinTerminal = () => ({ stdinSupplied: false, hasStdin: false, stdin: null });

test('figlet A: renders 5 rows', () => {
  const r = figlet(noStdinTerminal(), ['A']);
  assert.equal(r.exitCode, 0);
  const rows = r.stdout.replace(/\n$/, '').split('\n');
  assert.equal(rows.length, 5);
  // Every row of an A-glyph contains at least one filled block.
  assert.ok(rows.every((row) => row.includes('█')));
});

test('figlet hi: lowercase auto-uppercased to known glyphs', () => {
  const lower = figlet(noStdinTerminal(), ['hi']);
  const upper = figlet(noStdinTerminal(), ['HI']);
  assert.equal(lower.stdout, upper.stdout);
});

test('figlet AB: rows widen as glyphs concatenate horizontally', () => {
  const a = figlet(noStdinTerminal(), ['A']);
  const ab = figlet(noStdinTerminal(), ['AB']);
  const aRow = a.stdout.split('\n')[0];
  const abRow = ab.stdout.split('\n')[0];
  assert.ok(abRow.length > aRow.length, 'AB should be wider than A');
});

test('figlet --gap 0 AB: glyphs touch (no inter-glyph space)', () => {
  const gap1 = figlet(noStdinTerminal(), ['AB']);
  const gap0 = figlet(noStdinTerminal(), ['--gap', '0', 'AB']);
  // gap=0 must be strictly narrower than the default gap=1 rendering.
  assert.ok(gap0.stdout.length < gap1.stdout.length);
});

test('figlet -c -w 80 X: leading whitespace centers the line', () => {
  const r = figlet(noStdinTerminal(), ['-c', '-w', '80', 'X']);
  assert.equal(r.exitCode, 0);
  const firstRow = r.stdout.split('\n')[0];
  // Centering on width 80 with a 5-wide glyph should leave ~37 spaces left.
  assert.ok(firstRow.startsWith(' '.repeat(30)));
});

test('figlet -k AB: kerning produces output no wider than default', () => {
  const def = figlet(noStdinTerminal(), ['AB']);
  const kerned = figlet(noStdinTerminal(), ['-k', 'AB']);
  // Kerning either trims or breaks even; never widens.
  assert.ok(kerned.stdout.length <= def.stdout.length);
});

test('figlet: stdin with multiple non-empty lines → multiple banners', () => {
  const r = figlet(stdinTerminal('A\nB\n'), []);
  assert.equal(r.exitCode, 0);
  // Two 5-row banners separated by a blank line.
  const lines = r.stdout.replace(/\n$/, '').split('\n');
  assert.equal(lines.length, 11); // 5 + 1 blank + 5
  assert.equal(lines[5], '');
});

test('figlet: no input and no stdin → exit 1', () => {
  const r = figlet(noStdinTerminal(), []);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /no input/);
});

test('figlet: invalid -w rejected', () => {
  const r = figlet(noStdinTerminal(), ['-w', 'abc', 'A']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /invalid width/);
});

test('figlet: invalid --gap rejected', () => {
  const r = figlet(noStdinTerminal(), ['--gap', '-1', 'A']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /invalid gap/);
});

test('figlet --help', () => {
  const r = figlet(noStdinTerminal(), ['--help']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /Usage: figlet/);
});

test('figlet -- -text: -- treats following arg as literal text', () => {
  const r = figlet(noStdinTerminal(), ['--', '-c']);
  // Renders "-c" rather than treating -c as a flag.
  assert.equal(r.exitCode, 0);
  assert.ok(r.stdout.length > 0);
});

// ---------------------------------------------------------------------------
// tree — mock VFS
// ---------------------------------------------------------------------------

/**
 * Build a stub terminal backed by a flat in-memory FS map.
 * @param {Record<string, { type: 'directory' | 'file' }>} fs
 *   absolute paths → entry. Directories must list their children separately
 *   via the `children` map below (kept independent so tests stay readable).
 * @param {Record<string, string[]>} children
 *   absolute dir path → list of child basenames
 */
function buildTreeTerminal(fs, children) {
  return {
    resolvePath: (p) => p,
    getFileSystemItem: async (p) => fs[p] ?? null,
    listDirectoryContents: async (p) => {
      const kids = children[p] || [];
      return kids.map((name) => {
        const childPath = p === '/' ? `/${name}` : `${p}/${name}`;
        return { path: childPath, type: fs[childPath].type };
      });
    },
    fileSystemDB: {
      getFileName: (p) => p.split('/').filter(Boolean).pop() || ''
    }
  };
}

function sampleFS() {
  // /root
  // ├── .hidden
  // ├── a.txt
  // ├── b.txt
  // └── sub/
  //     ├── c.txt
  //     └── nested/
  //         └── deep.txt
  const fs = {
    '/root': { type: 'directory' },
    '/root/.hidden': { type: 'file' },
    '/root/a.txt': { type: 'file' },
    '/root/b.txt': { type: 'file' },
    '/root/sub': { type: 'directory' },
    '/root/sub/c.txt': { type: 'file' },
    '/root/sub/nested': { type: 'directory' },
    '/root/sub/nested/deep.txt': { type: 'file' }
  };
  const children = {
    '/root': ['.hidden', 'a.txt', 'b.txt', 'sub'],
    '/root/sub': ['c.txt', 'nested'],
    '/root/sub/nested': ['deep.txt']
  };
  return buildTreeTerminal(fs, children);
}

test('tree /root: dirs first, hidden filtered, summary at end', async () => {
  const r = await tree(sampleFS(), ['/root']);
  assert.equal(r.exitCode, 0);
  // Header shows the path the user asked for.
  assert.match(r.stdout, /^\/root\n/);
  // .hidden must NOT appear by default.
  assert.doesNotMatch(r.stdout, /\.hidden/);
  // sub comes before files (dirsFirst default).
  const subIdx = r.stdout.indexOf('sub');
  const aIdx = r.stdout.indexOf('a.txt');
  assert.ok(subIdx > 0);
  assert.ok(aIdx > subIdx, 'sub should appear before a.txt with dirsFirst');
  // Box-drawing connectors present.
  assert.match(r.stdout, /├──/);
  assert.match(r.stdout, /└──/);
  // Summary: 2 directories (sub, nested), 4 files (a, b, c, deep).
  assert.match(r.stdout, /2 directories, 4 files/);
});

test('tree -a /root: includes hidden file', async () => {
  const r = await tree(sampleFS(), ['-a', '/root']);
  assert.match(r.stdout, /\.hidden/);
});

test('tree -d /root: directories only, file count is 0', async () => {
  const r = await tree(sampleFS(), ['-d', '/root']);
  assert.doesNotMatch(r.stdout, /a\.txt/);
  assert.doesNotMatch(r.stdout, /c\.txt/);
  assert.match(r.stdout, /sub/);
  assert.match(r.stdout, /nested/);
  assert.match(r.stdout, /2 directories, 0 files/);
});

test('tree -L 1 /root: descends only one level', async () => {
  const r = await tree(sampleFS(), ['-L', '1', '/root']);
  assert.match(r.stdout, /sub/);
  // nested/ and deep.txt are 2 levels in, must be missing.
  assert.doesNotMatch(r.stdout, /nested/);
  assert.doesNotMatch(r.stdout, /deep\.txt/);
});

test('tree --noreport /root: no trailing summary line', async () => {
  const r = await tree(sampleFS(), ['--noreport', '/root']);
  assert.doesNotMatch(r.stdout, /\d+ director/);
});

test('tree on a missing path: exit 1, stderr explains', async () => {
  const r = await tree(sampleFS(), ['/nope']);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /No such file or directory/);
});

test('tree on a file root: prints just the file with "0 directories, 1 file"', async () => {
  const r = await tree(sampleFS(), ['/root/a.txt']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /0 directories, 1 file/);
});

test('tree --no-dirsfirst: alphabetical sort regardless of type', async () => {
  const r = await tree(sampleFS(), ['--no-dirsfirst', '/root']);
  // a.txt < b.txt < sub alphabetically; dirs no longer hoisted.
  const aIdx = r.stdout.indexOf('a.txt');
  const subIdx = r.stdout.indexOf('sub');
  assert.ok(aIdx > 0 && aIdx < subIdx, 'a.txt should appear before sub when --no-dirsfirst');
});

test('tree -f /root: prints full paths on each entry', async () => {
  const r = await tree(sampleFS(), ['-f', '/root']);
  assert.match(r.stdout, /\/root\/a\.txt/);
  assert.match(r.stdout, /\/root\/sub\/c\.txt/);
});

test('tree --help', async () => {
  const r = await tree(sampleFS(), ['--help']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /Usage: tree/);
});

test('tree: rejects unknown option', async () => {
  const r = await tree(sampleFS(), ['-Z']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /invalid option/);
});

test('tree: invalid -L value rejected', async () => {
  const r = await tree(sampleFS(), ['-L', 'abc']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /invalid level/);
});
