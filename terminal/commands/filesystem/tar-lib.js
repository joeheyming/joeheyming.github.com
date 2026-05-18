// tar-lib.js — pure-JS USTAR pack/unpack (no compression).
//
// Supports regular files (typeflag '0') and directories (typeflag '5').
// Output / input are Uint8Arrays. Compression (gzip) is layered on top by
// gzip / gunzip commands using pako.

const BLOCK = 512;
const NAME_LEN = 100;
const PREFIX_LEN = 155;
const HEADER_NAME_OFF = 0;
const MODE_OFF = 100;
const UID_OFF = 108;
const GID_OFF = 116;
const SIZE_OFF = 124;
const MTIME_OFF = 136;
const CHKSUM_OFF = 148;
const TYPEFLAG_OFF = 156;
const LINKNAME_OFF = 157;
const MAGIC_OFF = 257;
const UNAME_OFF = 265;
const GNAME_OFF = 297;
const PREFIX_OFF = 345;

const TEXT = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const DEC = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

function strToBytes(s) {
  if (TEXT) return TEXT.encode(s);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function bytesToStr(b) {
  if (DEC) return DEC.decode(b);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function writeString(buf, offset, str, maxLen) {
  const bytes = strToBytes(str);
  const n = Math.min(bytes.length, maxLen);
  for (let i = 0; i < n; i++) buf[offset + i] = bytes[i];
  // zeros for padding are already there (Uint8Array starts zeroed).
}

function writeOctal(buf, offset, value, width) {
  // width includes the trailing NUL (GNU tar style: width-1 octal digits + NUL).
  let s = Math.max(0, Math.floor(value)).toString(8);
  if (s.length >= width) s = s.slice(-width + 1);
  while (s.length < width - 1) s = '0' + s;
  writeString(buf, offset, s + '\0', width);
}

function readField(buf, offset, length) {
  let end = offset + length;
  for (let i = offset; i < end; i++) {
    if (buf[i] === 0) {
      end = i;
      break;
    }
  }
  return bytesToStr(buf.subarray(offset, end)).replace(/\0+$/, '').replace(/\s+$/, '');
}

function readOctal(buf, offset, length) {
  const s = readField(buf, offset, length).trim();
  if (!s) return 0;
  return parseInt(s, 8) || 0;
}

function computeChecksum(buf, headerOffset) {
  // Sum bytes treating the checksum field as 8 spaces.
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    if (i >= CHKSUM_OFF && i < CHKSUM_OFF + 8) {
      sum += 32; // space
    } else {
      sum += buf[headerOffset + i];
    }
  }
  return sum;
}

/**
 * Build a single USTAR header block.
 * @param {{ name: string, mode?: number, uid?: number, gid?: number, size: number, mtime?: number, typeflag: '0'|'5', uname?: string, gname?: string }} entry
 * @returns {Uint8Array}
 */
function buildHeader(entry) {
  const block = new Uint8Array(BLOCK);
  let name = String(entry.name || '');
  let prefix = '';
  if (name.length > NAME_LEN) {
    // Split into prefix + name on the last '/' that fits.
    const split = name.lastIndexOf('/', NAME_LEN);
    if (split > 0 && name.length - split - 1 <= NAME_LEN) {
      prefix = name.slice(0, split);
      name = name.slice(split + 1);
    } else {
      name = name.slice(-NAME_LEN);
    }
  }
  writeString(block, HEADER_NAME_OFF, name, NAME_LEN);
  writeOctal(block, MODE_OFF, entry.mode != null ? entry.mode : (entry.typeflag === '5' ? 0o755 : 0o644), 8);
  writeOctal(block, UID_OFF, entry.uid != null ? entry.uid : 0, 8);
  writeOctal(block, GID_OFF, entry.gid != null ? entry.gid : 0, 8);
  writeOctal(block, SIZE_OFF, entry.size || 0, 12);
  writeOctal(block, MTIME_OFF, entry.mtime != null ? entry.mtime : Math.floor(Date.now() / 1000), 12);
  // Checksum: fill with spaces first.
  for (let i = 0; i < 8; i++) block[CHKSUM_OFF + i] = 32;
  block[TYPEFLAG_OFF] = (entry.typeflag || '0').charCodeAt(0);
  // linkname stays zero.
  writeString(block, MAGIC_OFF, 'ustar\0', 6);
  block[MAGIC_OFF + 6] = '0'.charCodeAt(0);
  block[MAGIC_OFF + 7] = '0'.charCodeAt(0);
  writeString(block, UNAME_OFF, entry.uname || 'user', 32);
  writeString(block, GNAME_OFF, entry.gname || 'user', 32);
  if (prefix) writeString(block, PREFIX_OFF, prefix, PREFIX_LEN);
  // Now compute and write the checksum (6 octal + NUL + space).
  const sum = computeChecksum(block, 0);
  let s = sum.toString(8);
  while (s.length < 6) s = '0' + s;
  writeString(block, CHKSUM_OFF, s, 6);
  block[CHKSUM_OFF + 6] = 0;
  block[CHKSUM_OFF + 7] = 32;
  return block;
}

/**
 * Pack a list of entries into a USTAR archive.
 * Each entry is { name, type: 'file'|'directory', data?: Uint8Array|string, mode?, uid?, gid?, mtime? }.
 * @param {Array<Object>} entries
 * @returns {Uint8Array}
 */
function packTar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const name = entry.name;
    if (entry.type === 'directory') {
      const hdrName = name.endsWith('/') ? name : name + '/';
      const hdr = buildHeader({
        name: hdrName,
        mode: entry.mode,
        size: 0,
        mtime: entry.mtime,
        typeflag: '5',
        uid: entry.uid,
        gid: entry.gid,
        uname: entry.uname,
        gname: entry.gname
      });
      blocks.push(hdr);
      continue;
    }
    const data = entry.data instanceof Uint8Array ? entry.data : strToBytes(String(entry.data ?? ''));
    const hdr = buildHeader({
      name,
      mode: entry.mode,
      size: data.length,
      mtime: entry.mtime,
      typeflag: '0',
      uid: entry.uid,
      gid: entry.gid,
      uname: entry.uname,
      gname: entry.gname
    });
    blocks.push(hdr);
    blocks.push(data);
    const padLen = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (padLen > 0) blocks.push(new Uint8Array(padLen));
  }
  // Two zero blocks terminator.
  blocks.push(new Uint8Array(BLOCK));
  blocks.push(new Uint8Array(BLOCK));
  let total = 0;
  for (const b of blocks) total += b.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

/**
 * Unpack a USTAR archive into entries.
 * @param {Uint8Array} buf
 * @returns {Array<{ name: string, type: 'file'|'directory', size: number, data?: Uint8Array, mode: number, mtime: number }>}
 */
function unpackTar(buf) {
  const out = [];
  let off = 0;
  while (off + BLOCK <= buf.length) {
    const header = buf.subarray(off, off + BLOCK);
    // Detect end-of-archive (zero block).
    let allZero = true;
    for (let i = 0; i < BLOCK; i++) {
      if (header[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) {
      off += BLOCK;
      continue;
    }
    const namePart = readField(header, HEADER_NAME_OFF, NAME_LEN);
    const prefixPart = readField(header, PREFIX_OFF, PREFIX_LEN);
    const fullName = prefixPart ? `${prefixPart}/${namePart}` : namePart;
    const size = readOctal(header, SIZE_OFF, 12);
    const mode = readOctal(header, MODE_OFF, 8);
    const mtime = readOctal(header, MTIME_OFF, 12);
    const typeflag = String.fromCharCode(header[TYPEFLAG_OFF]);
    off += BLOCK;
    if (typeflag === '5' || fullName.endsWith('/')) {
      out.push({
        name: fullName.replace(/\/$/, ''),
        type: 'directory',
        size: 0,
        mode,
        mtime
      });
      // Directories have no data blocks.
      continue;
    }
    const data = buf.subarray(off, off + size);
    out.push({ name: fullName, type: 'file', size, data, mode, mtime });
    const padded = Math.ceil(size / BLOCK) * BLOCK;
    off += padded;
  }
  return out;
}

export const TarLib = {
  BLOCK,
  buildHeader,
  computeChecksum,
  packTar,
  unpackTar,
  readField,
  readOctal,
  strToBytes,
  bytesToStr
};

export { packTar, unpackTar, buildHeader, strToBytes, bytesToStr };
