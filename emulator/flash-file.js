// Turn a local Flash upload into one .swf for Ruffle. Not on the first screen:
// launch.js loads it when the chosen file is not already named .swf.
//
// iPad Safari will not select a .swf while the picker is filtered to a type
// the system does not know, so the filter is dropped there and people pick a
// .zip (or a download saved with no extension). The bytes decide.
(function () {
  'use strict';

  const MAX_SWF_BYTES = 80 * 1024 * 1024;

  function userError(message) {
    const err = new Error(message);
    err.userMessage = message;
    return err;
  }

  function isSwf(bytes) {
    if (!bytes || bytes.length < 8) return false;
    const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    return sig === 'FWS' || sig === 'CWS' || sig === 'ZWS';
  }

  function isZip(bytes) {
    if (!bytes || bytes.length < 4) return false;
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
    return (
      (bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08)
    );
  }

  function withSwfExt(filename) {
    const base = String(filename || 'game')
      .replace(/[/\\]/g, '')
      .replace(/^\.+/, '')
      .trim();
    const name = base || 'game';
    return /\.swf$/i.test(name) ? name : name + '.swf';
  }

  function decodeName(bytes, start, len) {
    let name = '';
    const end = start + len;
    for (let i = start; i < end; i++) name += String.fromCharCode(bytes[i]);
    return name.replace(/\\/g, '/').replace(/^\.\//, '');
  }

  function ignoredZipPath(name) {
    if (!name || /\/$/.test(name)) return true;
    return name.split('/').some((part) => part === '__MACOSX' || part.charAt(0) === '.');
  }

  function findEocd(bytes, view) {
    if (bytes.length < 22) return -1;
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
      if (i + 22 + commentLen === bytes.length) return i;
    }
    return -1;
  }

  /** @param {Uint8Array} bytes */
  function listSwfs(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEocd(bytes, view);
    if (eocd < 0) return null;
    const count = view.getUint16(eocd + 10, true);
    if (count > 4096) return null;
    let p = view.getUint32(eocd + 16, true);
    /** @type {{ name: string, flags: number, method: number, compSize: number, size: number, localOffset: number }[]} */
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
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extra = view.getUint16(p + 30, true);
      const comment = view.getUint16(p + 32, true);
      const localOffset = view.getUint32(p + 42, true);
      const nameEnd = p + 46 + nameLen;
      if (nameEnd > bytes.length) return null;
      const name = decodeName(bytes, p + 46, nameLen);
      if (!ignoredZipPath(name) && /\.swf$/i.test(name) && size > 0 && size !== 0xffffffff) {
        entries.push({ name, flags, method, compSize, size, localOffset });
      }
      p = nameEnd + extra + comment;
    }
    entries.sort((a, b) => b.size - a.size);
    return entries;
  }

  /** @param {Blob} blob */
  function readBlob(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    if (typeof FileReader !== 'function') {
      return Promise.reject(userError('Could not read that Flash file.'));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(userError('Could not read that Flash file.'));
      reader.readAsArrayBuffer(blob);
    });
  }

  /** @param {Uint8Array} compressed */
  async function inflateRaw(compressed) {
    if (typeof DecompressionStream !== 'function' || typeof ReadableStream !== 'function') {
      throw userError('This browser cannot open that zip. Load the .swf itself.');
    }
    try {
      const source = new ReadableStream({
        start(controller) {
          controller.enqueue(compressed);
          controller.close();
        }
      });
      const stream = source.pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        const part = new Uint8Array(step.value);
        chunks.push(part);
        total += part.length;
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (let i = 0; i < chunks.length; i++) {
        out.set(chunks[i], offset);
        offset += chunks[i].length;
      }
      return out;
    } catch (err) {
      if (err && err.userMessage) throw err;
      throw userError('That zip could not be opened. Load the .swf itself.');
    }
  }

  /**
   * @param {Uint8Array} bytes
   * @param {{ flags: number, method: number, compSize: number, size: number, localOffset: number }} entry
   */
  async function readEntry(bytes, entry) {
    if (entry.flags & 1) {
      throw userError('That zip is password-protected. Load the .swf itself.');
    }
    if (entry.size > MAX_SWF_BYTES) {
      throw userError('That Flash file is too big for this page.');
    }
    if (entry.localOffset === 0xffffffff) {
      throw userError('That zip could not be opened. Load the .swf itself.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const local = entry.localOffset;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) {
      throw userError('That zip could not be opened. Load the .swf itself.');
    }
    const nameLen = view.getUint16(local + 26, true);
    const extraLen = view.getUint16(local + 28, true);
    const start = local + 30 + nameLen + extraLen;
    const end = start + entry.compSize;
    if (end > bytes.length) {
      throw userError('That zip could not be opened. Load the .swf itself.');
    }
    const compressed = bytes.subarray(start, end);
    if (entry.method === 0) return new Uint8Array(compressed);
    if (entry.method === 8) return inflateRaw(compressed);
    throw userError('That zip uses compression this page cannot open. Load the .swf itself.');
  }

  /** @param {Uint8Array} bytes @param {string} name */
  function fileFrom(bytes, name) {
    const type = 'application/x-shockwave-flash';
    if (typeof File === 'function') return new File([bytes], name, { type: type });
    return new Blob([bytes], { type: type });
  }

  /**
   * @param {Blob} file
   * @param {string} name
   * @returns {Promise<{ file: Blob, name: string }>}
   */
  async function prepare(file, name) {
    const filename = String(name || (file && file.name) || '').trim();
    if (/\.swf$/i.test(filename)) return { file: file, name: filename };
    if (!file || (typeof file.arrayBuffer !== 'function' && typeof FileReader !== 'function')) {
      throw userError('Load a .swf, or a .zip that contains one.');
    }
    const bytes = new Uint8Array(await readBlob(file));
    if (isSwf(bytes)) {
      const swfName = withSwfExt(filename);
      return { file: fileFrom(bytes, swfName), name: swfName };
    }
    if (!isZip(bytes)) throw userError('Load a .swf, or a .zip that contains one.');
    const entries = listSwfs(bytes);
    if (!entries) throw userError('That zip could not be opened. Load the .swf itself.');
    if (!entries.length) throw userError('That zip has no .swf in it.');
    const entry = entries[0];
    const swf = await readEntry(bytes, entry);
    if (!isSwf(swf)) throw userError('That zip has no playable .swf in it.');
    const base = entry.name.split('/').pop();
    const swfName = withSwfExt(base);
    return { file: fileFrom(swf, swfName), name: swfName };
  }

  window.emulatorFlashFile = { prepare: prepare };
})();
