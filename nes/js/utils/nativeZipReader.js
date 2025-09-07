/*
This file is part of WebNES.

WebNES is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

WebNES is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with WebNES.  If not, see <http://www.gnu.org/licenses/>.
*/

this.Nes = this.Nes || {};

(function () {
  "use strict";

  /**
   * Native ZIP file reader implementation
   * Supports basic ZIP files with DEFLATE compression
   */
  var NativeZipReader = function (data) {
    this.data = data;
    this.files = [];
    this._parseZip();
  };

  NativeZipReader.prototype._parseZip = function () {
    var data = this.data;
    var view = new DataView(data.buffer || data);

    // Find End of Central Directory Record (EOCD)
    var eocdOffset = this._findEOCD(view);
    if (eocdOffset === -1) {
      throw new Error("Invalid ZIP file: End of Central Directory not found");
    }

    // Read EOCD
    var centralDirEntries = view.getUint16(eocdOffset + 8, true); // Total entries
    var centralDirSize = view.getUint32(eocdOffset + 12, true); // Size of central directory
    var centralDirOffset = view.getUint32(eocdOffset + 16, true); // Offset of central directory

    // Parse Central Directory
    this._parseCentralDirectory(view, centralDirOffset, centralDirEntries);
  };

  NativeZipReader.prototype._findEOCD = function (view) {
    // EOCD signature: 0x06054b50
    var signature = 0x06054b50;

    // Search backwards from end of file (EOCD is typically at the end)
    for (var i = view.byteLength - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === signature) {
        return i;
      }
    }
    return -1;
  };

  NativeZipReader.prototype._parseCentralDirectory = function (
    view,
    offset,
    entryCount
  ) {
    var currentOffset = offset;

    for (var i = 0; i < entryCount; i++) {
      var entry = this._parseCentralDirectoryEntry(view, currentOffset);
      if (entry) {
        this.files.push(entry);
        currentOffset = entry.nextOffset;
      }
    }
  };

  NativeZipReader.prototype._parseCentralDirectoryEntry = function (
    view,
    offset
  ) {
    // Central Directory Entry signature: 0x02014b50
    if (view.getUint32(offset, true) !== 0x02014b50) {
      return null;
    }

    var compressionMethod = view.getUint16(offset + 10, true);
    var compressedSize = view.getUint32(offset + 20, true);
    var uncompressedSize = view.getUint32(offset + 24, true);
    var fileNameLength = view.getUint16(offset + 28, true);
    var extraFieldLength = view.getUint16(offset + 30, true);
    var commentLength = view.getUint16(offset + 32, true);
    var localHeaderOffset = view.getUint32(offset + 42, true);

    // Read filename
    var fileName = "";
    var fileNameOffset = offset + 46;
    for (var i = 0; i < fileNameLength; i++) {
      fileName += String.fromCharCode(view.getUint8(fileNameOffset + i));
    }

    var nextOffset =
      offset + 46 + fileNameLength + extraFieldLength + commentLength;

    return {
      name: fileName,
      compressionMethod: compressionMethod,
      compressedSize: compressedSize,
      uncompressedSize: uncompressedSize,
      localHeaderOffset: localHeaderOffset,
      nextOffset: nextOffset,
    };
  };

  NativeZipReader.prototype._extractFile = function (entry) {
    var view = new DataView(this.data.buffer || this.data);
    var offset = entry.localHeaderOffset;

    // Local File Header signature: 0x04034b50
    if (view.getUint32(offset, true) !== 0x04034b50) {
      throw new Error("Invalid local file header");
    }

    var fileNameLength = view.getUint16(offset + 26, true);
    var extraFieldLength = view.getUint16(offset + 28, true);

    var dataOffset = offset + 30 + fileNameLength + extraFieldLength;
    var compressedData = new Uint8Array(
      this.data.buffer || this.data,
      dataOffset,
      entry.compressedSize
    );

    if (entry.compressionMethod === 0) {
      // No compression (stored)
      return compressedData;
    } else if (entry.compressionMethod === 8) {
      // DEFLATE compression
      return this._inflateData(compressedData, entry.uncompressedSize);
    } else {
      throw new Error(
        "Unsupported compression method: " + entry.compressionMethod
      );
    }
  };

  NativeZipReader.prototype._inflateData = function (
    compressedData,
    uncompressedSize
  ) {
    // Fallback: Use pako library if available for synchronous decompression
    if (typeof pako !== "undefined") {
      return pako.inflateRaw(compressedData);
    }

    // For now, we'll focus on uncompressed files and suggest using pako for compressed ones
    throw new Error(
      "DEFLATE decompression requires pako library. Please use uncompressed ZIP files or include pako library for compressed files."
    );
  };

  // Public API methods to match JSZip interface
  NativeZipReader.prototype.file = function (namePattern) {
    var results = [];

    for (var i = 0; i < this.files.length; i++) {
      var file = this.files[i];
      var matches = false;

      if (namePattern instanceof RegExp) {
        matches = namePattern.test(file.name);
      } else if (typeof namePattern === "string") {
        matches = file.name === namePattern;
      }

      if (matches) {
        var fileEntry = {
          name: file.name,
          asUint8Array: function (entry) {
            return function () {
              return this._extractFile(entry);
            }.bind(this);
          }.bind(this)(file),
        };
        results.push(fileEntry);
      }
    }

    return results;
  };

  // Export the NativeZipReader
  Nes.NativeZipReader = NativeZipReader;
})();
