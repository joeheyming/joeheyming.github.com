/**
 * ID3 Tag Parser
 * Extracts metadata (title, artist, album) from MP3 files
 * Supports ID3v1 and ID3v2 (v2.3 and v2.4) formats
 */

class ID3Parser {
  /**
   * Extract ID3 tags from audio data
   * @param {string} src - Data URL or Blob URL of the audio file
   * @returns {Promise<{title: string|null, artist: string|null, album: string|null}>}
   */
  static async extractTags(src) {
    const tags = { title: null, artist: null, album: null };

    try {
      let arrayBuffer;

      if (src.startsWith('data:')) {
        // Convert data URL to ArrayBuffer
        const response = await fetch(src);
        arrayBuffer = await response.arrayBuffer();
      } else if (src.startsWith('blob:')) {
        const response = await fetch(src);
        arrayBuffer = await response.arrayBuffer();
      } else {
        return tags;
      }

      const dataView = new DataView(arrayBuffer);

      // Check for ID3v2 header (at start of file)
      if (this._getString(dataView, 0, 3) === 'ID3') {
        const id3Tags = this._parseID3v2(dataView);
        Object.assign(tags, id3Tags);
      }

      // Check for ID3v1 tag (at end of file, last 128 bytes)
      if (arrayBuffer.byteLength >= 128) {
        const tagOffset = arrayBuffer.byteLength - 128;
        if (this._getString(dataView, tagOffset, 3) === 'TAG') {
          const id3v1Tags = this._parseID3v1(dataView, tagOffset);
          // Only use v1 if v2 didn't have the info
          if (!tags.title && id3v1Tags.title) tags.title = id3v1Tags.title;
          if (!tags.artist && id3v1Tags.artist) tags.artist = id3v1Tags.artist;
        }
      }
    } catch (error) {
      console.warn('Failed to extract ID3 tags:', error);
    }

    return tags;
  }

  /**
   * Read a string from DataView at given offset
   * @private
   */
  static _getString(dataView, offset, length) {
    const bytes = [];
    for (let i = 0; i < length; i++) {
      const byte = dataView.getUint8(offset + i);
      if (byte === 0) break;
      bytes.push(byte);
    }
    // Try UTF-8 decoding first, fall back to Latin-1
    try {
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    } catch {
      return new TextDecoder('iso-8859-1').decode(new Uint8Array(bytes));
    }
  }

  /**
   * Decode text with specified encoding
   * @private
   */
  static _decodeText(dataView, offset, length, encoding) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = dataView.getUint8(offset + i);
    }
    // Find null terminator
    let end = bytes.indexOf(0);
    if (end === -1) end = length;
    try {
      return new TextDecoder(encoding).decode(bytes.slice(0, end));
    } catch {
      return new TextDecoder('iso-8859-1').decode(bytes.slice(0, end));
    }
  }

  /**
   * Parse ID3v1 tags (last 128 bytes of file)
   * @private
   */
  static _parseID3v1(dataView, offset) {
    return {
      title: this._getString(dataView, offset + 3, 30).trim(),
      artist: this._getString(dataView, offset + 33, 30).trim(),
      album: this._getString(dataView, offset + 63, 30).trim()
    };
  }

  /**
   * Parse ID3v2 tags (at start of file)
   * @private
   */
  static _parseID3v2(dataView) {
    const tags = { title: null, artist: null, album: null };

    try {
      // ID3v2 header is 10 bytes
      const majorVersion = dataView.getUint8(3);
      const flags = dataView.getUint8(5);

      // Size is syncsafe integer (4 bytes, 7 bits each)
      const size =
        ((dataView.getUint8(6) & 0x7f) << 21) |
        ((dataView.getUint8(7) & 0x7f) << 14) |
        ((dataView.getUint8(8) & 0x7f) << 7) |
        (dataView.getUint8(9) & 0x7f);

      let offset = 10;

      // Skip extended header if present
      if (flags & 0x40) {
        const extSize = dataView.getUint32(offset);
        offset += extSize;
      }

      const endOffset = Math.min(10 + size, dataView.byteLength);

      // Parse frames
      while (offset < endOffset - 10) {
        const frameId = this._getString(dataView, offset, 4);
        if (!frameId || frameId[0] === '\0') break;

        let frameSize;
        if (majorVersion >= 4) {
          // ID3v2.4 uses syncsafe integers
          frameSize =
            ((dataView.getUint8(offset + 4) & 0x7f) << 21) |
            ((dataView.getUint8(offset + 5) & 0x7f) << 14) |
            ((dataView.getUint8(offset + 6) & 0x7f) << 7) |
            (dataView.getUint8(offset + 7) & 0x7f);
        } else {
          frameSize = dataView.getUint32(offset + 4);
        }

        if (frameSize <= 0 || frameSize > endOffset - offset) break;

        const frameData = offset + 10;

        // Text frames start with encoding byte
        if (frameId === 'TIT2' || frameId === 'TPE1' || frameId === 'TALB') {
          const encoding = dataView.getUint8(frameData);
          let text = '';

          if (encoding === 0) {
            // ISO-8859-1
            text = this._decodeText(dataView, frameData + 1, frameSize - 1, 'iso-8859-1');
          } else if (encoding === 1) {
            // UTF-16 with BOM
            text = this._getUTF16String(dataView, frameData + 1, frameSize - 1);
          } else if (encoding === 2) {
            // UTF-16BE without BOM
            text = this._decodeText(dataView, frameData + 1, frameSize - 1, 'utf-16be');
          } else if (encoding === 3) {
            // UTF-8
            text = this._decodeText(dataView, frameData + 1, frameSize - 1, 'utf-8');
          }

          if (frameId === 'TIT2') tags.title = text;
          if (frameId === 'TPE1') tags.artist = text;
          if (frameId === 'TALB') tags.album = text;
        }

        offset += 10 + frameSize;
      }
    } catch (error) {
      console.warn('Error parsing ID3v2:', error);
    }

    return tags;
  }

  /**
   * Parse UTF-16 string with BOM detection
   * @private
   */
  static _getUTF16String(dataView, offset, length) {
    let str = '';
    const bom = dataView.getUint16(offset);
    const littleEndian = bom === 0xfffe;
    const start = bom === 0xfeff || bom === 0xfffe ? 2 : 0;

    for (let i = start; i < length - 1; i += 2) {
      const code = littleEndian
        ? dataView.getUint16(offset + i, true)
        : dataView.getUint16(offset + i, false);
      if (code === 0) break;
      str += String.fromCharCode(code);
    }
    return str;
  }
}

// Export for use in media player
window.ID3Parser = ID3Parser;
