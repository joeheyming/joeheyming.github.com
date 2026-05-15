// Archive extraction for the moddb browser. Adapted from
// nes/js/utils/nativeZipReader.js and trimmed down for a single use case:
// "give me a list of {name, data: Uint8Array} entries that match a filter".
//
// Supports stored (compression method 0) and DEFLATE (method 8) entries.
// DEFLATE relies on `pako` loaded from cdnjs (same source nes/index.html
// uses). We load it lazily and on-demand so the regular flavor picker
// page doesn't pay the ~30 KB cost.
//
// .rar and .7z are NOT supported. Mods shipping in those formats throw a
// clear error pointing the user at the manual upload picker.

const PAKO_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js';

let pakoPromise = null;
function ensurePako() {
  if (typeof window.pako !== 'undefined') return Promise.resolve(window.pako);
  if (pakoPromise) return pakoPromise;
  pakoPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PAKO_URL;
    s.async = false;
    s.onload = () => {
      if (typeof window.pako !== 'undefined') resolve(window.pako);
      else reject(new Error('pako loaded but window.pako is undefined'));
    };
    s.onerror = () => reject(new Error('failed to load pako from CDN'));
    document.head.appendChild(s);
  });
  return pakoPromise;
}

const SIG_EOCD = 0x06054b50;
const SIG_CDFH = 0x02014b50;
const SIG_LFH = 0x04034b50;

function findEocd(view) {
  const max = view.byteLength - 22;
  const min = Math.max(0, max - 65557);
  for (let i = max; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

function parseCentralDirectory(view) {
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('not a valid ZIP (no EOCD)');
  const entryCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);

  const entries = [];
  let off = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(off, true) !== SIG_CDFH) {
      throw new Error('central-directory entry at ' + off + ' is malformed');
    }
    const compressionMethod = view.getUint16(off + 10, true);
    const compressedSize = view.getUint32(off + 20, true);
    const uncompressedSize = view.getUint32(off + 24, true);
    const fileNameLength = view.getUint16(off + 28, true);
    const extraFieldLength = view.getUint16(off + 30, true);
    const commentLength = view.getUint16(off + 32, true);
    const localHeaderOffset = view.getUint32(off + 42, true);

    let fileName = '';
    const fileNameOffset = off + 46;
    for (let j = 0; j < fileNameLength; j++) {
      fileName += String.fromCharCode(view.getUint8(fileNameOffset + j));
    }

    entries.push({
      name: fileName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });

    off = off + 46 + fileNameLength + extraFieldLength + commentLength;
  }
  return entries;
}

function readEntryBytes(buf, view, entry) {
  const off = entry.localHeaderOffset;
  if (view.getUint32(off, true) !== SIG_LFH) {
    throw new Error('invalid local-file-header for ' + entry.name);
  }
  const fileNameLength = view.getUint16(off + 26, true);
  const extraFieldLength = view.getUint16(off + 28, true);
  const dataOffset = off + 30 + fileNameLength + extraFieldLength;
  return new Uint8Array(buf.buffer, buf.byteOffset + dataOffset, entry.compressedSize);
}

async function extractZip(bytes, opts) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('extractZip: expected Uint8Array');
  }
  if (bytes.length < 22) {
    throw new Error('extractZip: file too small to be a zip');
  }

  const sig = signatureName(bytes);
  if (sig === 'rar' || sig === '7z') {
    throw new Error(
      'Archive is .' +
        sig +
        ' which we cannot extract in-browser. ' +
        'Download manually from moddb and use the manual upload picker.'
    );
  }

  const filter = (opts && opts.filter) || (() => true);
  const max = (opts && opts.max) || 64;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = parseCentralDirectory(view);

  const wanted = entries.filter((e) => !endsWith(e.name, '/') && filter(e.name));
  if (wanted.length === 0) return [];

  const needsInflate = wanted.some((e) => e.compressionMethod === 8);
  let pako = null;
  if (needsInflate) {
    try {
      pako = await ensurePako();
    } catch (e) {
      throw new Error("Couldn't unpack this mod archive. Try again in a moment.");
    }
  }

  const out = [];
  for (const entry of wanted.slice(0, max)) {
    const raw = readEntryBytes(bytes, view, entry);
    let data;
    if (entry.compressionMethod === 0) {
      data = new Uint8Array(raw);
    } else if (entry.compressionMethod === 8) {
      data = pako.inflateRaw(raw);
    } else {
      throw new Error(
        'Unsupported compression method ' + entry.compressionMethod + ' in ' + entry.name
      );
    }
    out.push({ name: basename(entry.name), data });
  }
  return out;
}

function endsWith(s, suffix) {
  return s.length >= suffix.length && s.slice(s.length - suffix.length) === suffix;
}

function basename(p) {
  if (!p) return p;
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function signatureName(bytes) {
  if (!bytes || bytes.length < 4) return 'unknown';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'zip';
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) {
    return 'rar';
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x37 &&
    bytes[1] === 0x7a &&
    bytes[2] === 0xbc &&
    bytes[3] === 0xaf &&
    bytes[4] === 0x27 &&
    bytes[5] === 0x1c
  ) {
    return '7z';
  }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gz';
  return 'unknown';
}

export const UZDoomModdbArchive = {
  extractZip,
  signatureName,
  _internal: {
    parseCentralDirectory,
    readEntryBytes,
    findEocd,
    basename
  }
};

window.UZDoomModdbArchive = UZDoomModdbArchive;
