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
  'use strict';

  var showZipFileSelectionDialog = function (fileArray, callback) {
    // Create a simple modal dialog for file selection
    var dialog = document.createElement('div');
    dialog.innerHTML =
      '<div title="Select ROM File">' +
      '<p>This zip file contains multiple ROM files. Please select one:</p>' +
      '<select id="zipFileSelector" style="width: 100%; margin: 10px 0;">' +
      '</select>' +
      '</div>';

    var selector = dialog.querySelector('#zipFileSelector');

    // Populate the selector with file names
    for (var i = 0; i < fileArray.length; i++) {
      var option = document.createElement('option');
      option.value = i;
      option.textContent = fileArray[i].name;
      selector.appendChild(option);
    }

    // Show the dialog
    var nativeDialog = dialog.nativeDialog({
      modal: true,
      width: 400,
      height: 200,
      resizable: false
    });

    // Add buttons manually since native dialog doesn't support button config
    var loadButton = document.createElement('button');
    loadButton.textContent = 'Load Selected';
    loadButton.addEventListener('click', function () {
      var selectedIndex = parseInt(selector.value);
      var selectedFile = fileArray[selectedIndex];
      nativeDialog.close();
      callback(selectedFile);
    });

    var cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', function () {
      nativeDialog.close();
      callback(null);
    });

    dialog.appendChild(loadButton);
    dialog.appendChild(cancelButton);

    nativeDialog.open();
  };

  var decompressIfNecessary = function (name, binaryString, completeCallback) {
    if (name.match(/\.zip$/i)) {
      // zip - decompress using native zip reader
      try {
        var zip = new Nes.NativeZipReader(binaryString);
        var findArray = zip.file(/\.nes$/i);
        if (findArray.length === 0) {
          throw new Error('Could not find .nes file in zip file ' + name);
        }

        if (findArray.length === 1) {
          // Single file, load it directly
          try {
            var fileData = findArray[0].asUint8Array();
            completeCallback(null, fileData);
          } catch (extractError) {
            completeCallback(extractError);
          }
        } else {
          // Multiple files, show selection dialog
          showZipFileSelectionDialog(findArray, function (selectedFile) {
            if (selectedFile) {
              try {
                var fileData = selectedFile.asUint8Array();
                completeCallback(null, fileData);
              } catch (extractError) {
                completeCallback(extractError);
              }
            } else {
              completeCallback(new Error('No file selected from zip archive'));
            }
          });
        }
      } catch (zipError) {
        completeCallback(zipError);
      }
    } else if (name.match(/\.7z$/i)) {
      // 7z - attempt to use lzma lib if it's compressed using LZMA
      Nes.decompress7z(name, binaryString, completeCallback);
    } else if (name.match(/\.gz$/i)) {
      // gzip - use jsziptools lib
      var result = jz.gz.decompress(binaryString);
      completeCallback(null, result);
    } else if (name.match(/\.nes$/i)) {
      // uncompressed file
      completeCallback(null, binaryString);
    } else {
      throw new Error('Unsupported file extension for file ' + name);
    }
  };

  var getRomNameFromUrl = function (url) {
    var slashIndex = url.lastIndexOf('/');
    if (slashIndex >= 0) {
      return url.slice(slashIndex + 1);
    }
    return url;
  };

  var loadRomFromUrl = function (url, callback) {
    // Load using a bog standard XHR request as then we can load as binary
    var that = this;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.overrideMimeType('application/octet-stream');
    xhr.onerror = function (err) {
      callback(err);
    };
    xhr.onload = function (err) {
      if (xhr.status === 200) {
        var binaryString = new Uint8Array(this.response);
        callback(null, getRomNameFromUrl(url), binaryString);
      } else {
        callback("Error loading rom file from URL: '" + url + "' HTTP code: " + xhr.status);
      }
    };

    xhr.send();
  };

  Nes.decompressIfNecessary = decompressIfNecessary;
  Nes.loadRomFromUrl = loadRomFromUrl;
})();
