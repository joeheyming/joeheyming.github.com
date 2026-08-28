// @ts-nocheck
/** @param {new () => object} FileSystemDB */
export function applyFileSystemDbMime(FileSystemDB) {
  Object.assign(FileSystemDB, {
    pathIsDescendantOrSelf(path, dir) {
      if (path == null || dir == null) return false;
      const strip = (p) => {
        if (p === '/' || p === '') return p;
        return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
      };
      const p = strip(path);
      const d = strip(dir);
      if (p === d) return true;
      if (d === '/') return typeof p === 'string' && p.startsWith('/');
      return p.startsWith(d + '/');
    },

    MIME_TYPES: {
      // Text
      txt: 'text/plain',
      md: 'text/markdown',
      markdown: 'text/markdown',
      html: 'text/html',
      htm: 'text/html',
      css: 'text/css',
      csv: 'text/csv',
      xml: 'text/xml',

      // Code/Scripts
      js: 'text/javascript',
      mjs: 'text/javascript',
      ts: 'text/typescript',
      json: 'application/json',
      py: 'text/x-python',
      sh: 'text/x-shellscript',
      bash: 'text/x-shellscript',
      zsh: 'text/x-shellscript',
      rb: 'text/x-ruby',
      php: 'text/x-php',
      java: 'text/x-java',
      c: 'text/x-c',
      cpp: 'text/x-c++',
      h: 'text/x-c',
      go: 'text/x-go',
      rs: 'text/x-rust',
      sql: 'text/x-sql',
      yaml: 'text/yaml',
      yml: 'text/yaml',
      toml: 'text/x-toml',
      ini: 'text/x-ini',
      conf: 'text/plain',
      log: 'text/plain',

      // Images
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      ico: 'image/x-icon',
      bmp: 'image/bmp',

      // Audio
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
      m4a: 'audio/mp4',
      mid: 'audio/midi',
      midi: 'audio/midi',
      kar: 'audio/midi',
      mmf: 'application/vnd.smaf',

      // Video
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      mkv: 'video/x-matroska',

      // 3D models
      glb: 'model/gltf-binary',
      gltf: 'model/gltf+json',
      stl: 'model/stl',
      obj: 'model/obj',
      mtl: 'model/mtl',
      ply: 'application/x-ply',
      fbx: 'application/x-fbx',
      '3mf': 'model/3mf',

      // Paint project
      paintproj: 'application/x-paintproj',

      // YouTube link
      ytlink: 'application/x-youtube',

      // Documents
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

      // Archives
      zip: 'application/zip',
      tar: 'application/x-tar',
      gz: 'application/gzip',
      '7z': 'application/x-7z-compressed',
      rar: 'application/x-rar-compressed',

      // Fonts
      ttf: 'font/ttf',
      otf: 'font/otf',
      woff: 'font/woff',
      woff2: 'font/woff2',

      // Other
      bin: 'application/octet-stream',
      exe: 'application/x-executable'
    },

    getMimeType(filename) {
      const ext = filename.split('.').pop().toLowerCase();
      return FileSystemDB.MIME_TYPES[ext] || 'application/octet-stream';
    },

    /**
     * MIME type for routing opens to apps (Notepad, image viewer, …).
     * Prefer a stored `mimeType` when it is specific; `application/octet-stream` (and common
     * misspellings) is ignored so the path extension can supply `audio/*`, `image/*`, etc.
     * @param {string|{ path?: string, mimeType?: string, content?: string, contentBytes?: unknown }} itemOrPath - Virtual path or file item
     * @returns {string}
     */
    mimeTypeForOpen(itemOrPath) {
      if (!itemOrPath) return 'application/octet-stream';
      const pathStr = typeof itemOrPath === 'string' ? itemOrPath : itemOrPath.path || '';
      const fromPath = pathStr ? FileSystemDB.getMimeType(pathStr) : 'application/octet-stream';

      if (typeof itemOrPath === 'object' && itemOrPath.mimeType != null) {
        const stored = String(itemOrPath.mimeType).trim();
        if (!stored) return fromPath;
        // Binary uploads used to force application/octet-stream in createFile — ignore that so
        // .mp3 / .gif / … still route to media-player / image-viewer via extension.
        const genericBinary =
          stored === 'application/octet-stream' || /^application\/octe[ct]+-stream$/i.test(stored);
        if (!genericBinary) return stored;
      }

      let result = fromPath || 'application/octet-stream';

      // Extensionless files with string content are very likely plain text (e.g. /etc/passwd,
      // Makefile, LICENSE, Dockerfile). Sniff content to upgrade from octet-stream to text/plain.
      if (result === 'application/octet-stream' && typeof itemOrPath === 'object') {
        const hasTextContent =
          typeof itemOrPath.content === 'string' && itemOrPath.content.length > 0;
        const hasBinaryContent = itemOrPath.contentBytes != null;
        if (hasTextContent && !hasBinaryContent) {
          result = 'text/plain';
        }
      }

      return result;
    },

    /**
     * Payload for postMessage to apps: string from `content`, or a copy of `contentBytes`
     * (binary files store bytes in IndexedDB with an empty string `content`).
     * For `ArrayBufferView` values, copies only `byteOffset`…`byteOffset+byteLength` so shared
     * backing buffers do not leak extra bytes to apps (`.buffer` on a view is often wider).
     * @param {{ type?: string, content?: string, contentBytes?: ArrayBuffer|ArrayBufferView }} item
     * @returns {string|ArrayBuffer}
     */
    getContentForApp(item) {
      if (!item || item.type !== 'file') return '';
      if (item.contentBytes != null) {
        const raw = item.contentBytes;
        if (raw instanceof ArrayBuffer) {
          return raw.slice(0);
        }
        if (ArrayBuffer.isView(raw)) {
          const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
          return /** @type {ArrayBuffer} */ (buf);
        }
      }
      return item.content == null ? '' : String(item.content);
    },

    /**
     * UTF-8 string for text previews and editors. Uses non-empty `content`, else decodes `contentBytes`.
     * Returns '' for empty files or likely binary (NUL within the first 8 KiB).
     *
     * @param {{ type?: string, content?: string, contentBytes?: ArrayBuffer|ArrayBufferView }} item
     * @returns {string}
     */
    getUtf8TextForDisplay(item) {
      if (!item || item.type !== 'file') {
        return '';
      }
      if (item.content != null && item.content !== '') {
        return String(item.content);
      }
      const raw = item.contentBytes;
      if (raw == null) {
        return '';
      }
      let u8;
      if (raw instanceof ArrayBuffer) {
        u8 = new Uint8Array(raw);
      } else if (ArrayBuffer.isView(raw)) {
        u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      } else {
        return '';
      }
      if (u8.byteLength === 0) {
        return '';
      }
      const maxSample = 8192;
      const sample = u8.byteLength > maxSample ? u8.subarray(0, maxSample) : u8;
      if (sample.indexOf(0) !== -1) {
        return '';
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(u8);
    },

    /**
     * Check if a MIME type is text-based (editable in notepad)
     * @param {string} mimeType - MIME type to check
     * @returns {boolean}
     */
    isTextMimeType(mimeType) {
      if (!mimeType) return false;
      return (
        mimeType.startsWith('text/') ||
        mimeType === 'application/json' ||
        mimeType === 'application/xml' ||
        mimeType === 'application/javascript'
      );
    }
  });
  Object.assign(FileSystemDB.prototype, {
    getMimeTypeForItem(item) {
      if (item.type === 'directory') return 'inode/directory';
      return FileSystemDB.mimeTypeForOpen(item);
    }
  });
}
