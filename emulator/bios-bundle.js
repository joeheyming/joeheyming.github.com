// Multi-file BIOS bundles (Dreamcast): download the loose dumps, pack them
// into one ZIP, and check a ZIP's entries. Not on the first screen:
// emulator/bios.js loads it before fetching or checking a bundle.
//
// Public surface: window.emulatorBiosBundle
(function () {
  'use strict';

  /**
   * Read a ZIP central directory. Returns `{ name, size }` entries, or null
   * when the archive has no end-of-central-directory record.
   * @param {Uint8Array} bytes
   * @returns {{ name: string, size: number }[]|null}
   */
  function zipEntries(bytes) {
    if (!bytes || bytes.length < 22) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const min = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (
        bytes[i] !== 0x50 ||
        bytes[i + 1] !== 0x4b ||
        bytes[i + 2] !== 0x05 ||
        bytes[i + 3] !== 0x06
      ) {
        continue;
      }
      const commentLen = view.getUint16(i + 20, true);
      if (i + 22 + commentLen === bytes.length) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    const count = view.getUint16(eocd + 10, true);
    if (count > 256) return null;
    let p = view.getUint32(eocd + 16, true);
    const entries = [];
    for (let n = 0; n < count; n++) {
      if (p + 46 > bytes.length) return null;
      if (
        bytes[p] !== 0x50 ||
        bytes[p + 1] !== 0x4b ||
        bytes[p + 2] !== 0x01 ||
        bytes[p + 3] !== 0x02
      ) {
        return null;
      }
      const nameLen = view.getUint16(p + 28, true);
      const extra = view.getUint16(p + 30, true);
      const comment = view.getUint16(p + 32, true);
      const size = view.getUint32(p + 24, true);
      const nameEnd = p + 46 + nameLen;
      if (nameEnd > bytes.length) return null;
      // ZIP names here are ASCII paths. fromCharCode stays inside the
      // page's classic script, where TextDecoder is not always present.
      let name = '';
      for (let i = p + 46; i < nameEnd; i++) name += String.fromCharCode(bytes[i]);
      name = name.replace(/\\/g, '/').replace(/^\.\//, '');
      entries.push({ name, size });
      p = nameEnd + extra + comment;
    }
    return entries;
  }

  function zipNameMatches(name, wanted) {
    const got = String(name || '').toLowerCase();
    const need = String(wanted || '').toLowerCase();
    return got === need || got.endsWith('/' + need);
  }

  /** @param {object} cfg @param {Uint8Array} bytes */
  function zipHasBiosEntries(cfg, bytes) {
    const entries = zipEntries(bytes);
    if (!entries) return false;
    const sizes = (cfg && cfg.biosEntrySizes) || {};
    return cfg.biosEntries.every((wanted) =>
      entries.some(
        (entry) =>
          zipNameMatches(entry.name, wanted) &&
          (sizes[wanted] == null || entry.size === sizes[wanted])
      )
    );
  }

  /** @param {Uint8Array} bytes */
  function crc32(bytes) {
    let crc = ~0;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    return ~crc >>> 0;
  }

  function putU16(buf, offset, value) {
    buf[offset] = value & 0xff;
    buf[offset + 1] = (value >>> 8) & 0xff;
  }

  function putU32(buf, offset, value) {
    buf[offset] = value & 0xff;
    buf[offset + 1] = (value >>> 8) & 0xff;
    buf[offset + 2] = (value >>> 16) & 0xff;
    buf[offset + 3] = (value >>> 24) & 0xff;
  }

  /**
   * Uncompressed ZIP. Dreamcast BIOS is two loose dumps; Flycast wants them
   * under dc/ inside one archive EmulatorJS can extract.
   * @param {{ path: string, bytes: Uint8Array }[]} files
   * @returns {Uint8Array}
   */
  function packStoredZip(files) {
    const parts = [];
    const centrals = [];
    let offset = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = String(file.path || '');
      const nameBytes = new Uint8Array(name.length);
      for (let c = 0; c < name.length; c++) nameBytes[c] = name.charCodeAt(c) & 0xff;
      const data = file.bytes;
      const crc = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      putU32(local, 0, 0x04034b50);
      putU16(local, 4, 20);
      putU32(local, 14, crc);
      putU32(local, 18, data.length);
      putU32(local, 22, data.length);
      putU16(local, 26, nameBytes.length);
      local.set(nameBytes, 30);
      const central = new Uint8Array(46 + nameBytes.length);
      putU32(central, 0, 0x02014b50);
      putU16(central, 4, 20);
      putU16(central, 6, 20);
      putU32(central, 16, crc);
      putU32(central, 20, data.length);
      putU32(central, 24, data.length);
      putU16(central, 28, nameBytes.length);
      putU32(central, 42, offset);
      central.set(nameBytes, 46);
      parts.push(local, data);
      centrals.push(central);
      offset += local.length + data.length;
    }
    const cdOffset = offset;
    let cdSize = 0;
    for (let i = 0; i < centrals.length; i++) cdSize += centrals[i].length;
    const eocd = new Uint8Array(22);
    putU32(eocd, 0, 0x06054b50);
    putU16(eocd, 8, files.length);
    putU16(eocd, 10, files.length);
    putU32(eocd, 12, cdSize);
    putU32(eocd, 16, cdOffset);
    const out = new Uint8Array(offset + cdSize + eocd.length);
    let cursor = 0;
    for (let i = 0; i < parts.length; i++) {
      out.set(parts[i], cursor);
      cursor += parts[i].length;
    }
    for (let i = 0; i < centrals.length; i++) {
      out.set(centrals[i], cursor);
      cursor += centrals[i].length;
    }
    out.set(eocd, cursor);
    return out;
  }

  async function downloadBytes(url, onProgress) {
    if (!window.proxyService) {
      const lazy = await import('/shared/lazy.js');
      await lazy.loadScript('/proxy.js').catch(() => {});
    }
    if (!window.proxyService) return null;
    let blob;
    if (typeof window.proxyService.fetchBinaryStream === 'function') {
      blob = await window.proxyService.fetchBinaryStream(url, {
        headers: { Accept: 'application/octet-stream,*/*' },
        maxRetries: 3,
        contentType: 'application/octet-stream',
        onProgress
      });
    } else {
      const data = await window.proxyService.fetchBinaryWithProxy(url, {
        headers: { Accept: 'application/octet-stream,*/*' },
        timeout: 120000,
        maxRetries: 3
      });
      if (!data) return null;
      blob = new Blob([data], { type: 'application/octet-stream' });
    }
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * Download each dump, pack them, and return the BIOS File, or null when a
   * download fails or a dump has the wrong size.
   * @param {object} cfg
   * @param {{ url: string, path: string, size: number }[]} files
   * @param {(received: number, total: number) => void} onProgress
   * @returns {Promise<File|null>}
   */
  async function fetchBundle(cfg, files, onProgress) {
    const knownTotal = files.reduce((sum, file) => sum + (file.size || 0), 0);
    const packed = [];
    let done = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const bytes = await downloadBytes(file.url, (p) => {
        onProgress(done + (p && p.received ? p.received : 0), knownTotal);
      });
      if (!bytes || (file.size && bytes.length !== file.size)) return null;
      packed.push({ path: file.path, bytes });
      done += bytes.length;
      onProgress(done, knownTotal);
    }
    const zip = packStoredZip(packed);
    if (Array.isArray(cfg.biosEntries) && !zipHasBiosEntries(cfg, zip)) return null;
    onProgress(zip.length, zip.length);
    return new File([zip], cfg.biosFileName, { type: 'application/zip' });
  }

  window.emulatorBiosBundle = { zipEntries, zipHasBiosEntries, packStoredZip, fetchBundle };
})();
