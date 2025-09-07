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

this.Gui = this.Gui || {};

(function () {
  'use strict';

  var InitialMenu = function () {
    this._element = document.getElementById('initialMenu');
    this._browseButton = document.getElementById('initialBrowseRomsButton');
    this._lastRomButton = document.getElementById('initialLastRomButton');
    this._loadRomButton = document.getElementById('initialLoadRomButton');
    this._lastRomNameSpan = document.getElementById('lastRomName');

    this._isVisible = true;
    this._lastRomData = null;

    // Hide mobile controller since initial menu is visible by default
    const mobileController = document.getElementById('mobileController');
    if (mobileController) {
      mobileController.style.display = 'none';
    }

    this._setupEventListeners();
    this._loadLastRomInfo();
  };

  InitialMenu.prototype._setupEventListeners = function () {
    var that = this;

    // Browse ROMs button
    this._browseButton.addEventListener('click', function () {
      that._onBrowseRomsClick();
    });

    // Load last ROM button
    this._lastRomButton.addEventListener('click', function () {
      that._onLastRomClick();
    });

    // Load local ROM button
    this._loadRomButton.addEventListener('click', function () {
      that._onLoadRomClick();
    });

    // Listen for ROM loading events to hide the menu
    if (window.Gui && window.Gui.App) {
      window.Gui.App.connect('cartLoaded', function () {
        that._hideMenu();
      });
    }
  };

  InitialMenu.prototype._loadLastRomInfo = function () {
    try {
      var lastRomInfo = localStorage.getItem('webnes_lastRom');
      if (lastRomInfo) {
        this._lastRomData = JSON.parse(lastRomInfo);
        var displayName = this._cleanRomName(this._lastRomData.name || 'Unknown ROM');
        this._lastRomNameSpan.textContent = displayName;
        this._lastRomButton.classList.remove('hidden');
      }
    } catch (e) {
      console.log('No last ROM data found or invalid data');
    }
  };

  InitialMenu.prototype._saveLastRomInfo = function (name, data) {
    try {
      var romInfo = {
        name: name,
        timestamp: Date.now(),
        // Store a small portion of the ROM data for verification
        checksum: this._calculateSimpleChecksum(data)
      };
      localStorage.setItem('webnes_lastRom', JSON.stringify(romInfo));
      localStorage.setItem('webnes_lastRomData', this._arrayBufferToBase64(data));
    } catch (e) {
      console.error('Failed to save ROM info:', e);
    }
  };

  InitialMenu.prototype._calculateSimpleChecksum = function (data) {
    var sum = 0;
    var view = new Uint8Array(data);
    for (var i = 0; i < Math.min(view.length, 1000); i++) {
      sum += view[i];
    }
    return sum;
  };

  InitialMenu.prototype._arrayBufferToBase64 = function (buffer) {
    var binary = '';
    var bytes = new Uint8Array(buffer);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  InitialMenu.prototype._base64ToArrayBuffer = function (base64) {
    var binary_string = window.atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  };

  InitialMenu.prototype._cleanRomName = function (name) {
    if (!name) return 'Unknown ROM';

    // Remove file extensions
    var cleanName = name.replace(/\.(nes|zip|7z|gz)$/i, '');

    // Clean up common ROM naming patterns
    cleanName = cleanName
      .replace(/[\[\(].*?[\]\)]/g, '') // Remove content in brackets/parentheses
      .replace(/[_-]+/g, ' ') // Replace underscores and dashes with spaces
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim(); // Remove leading/trailing whitespace

    // Capitalize first letter of each word
    cleanName = cleanName.replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });

    return cleanName || 'Unknown ROM';
  };

  InitialMenu.prototype._onBrowseRomsClick = function () {
    // Find the ROM browser element and call its openBrowser method
    var romBrowser = document.querySelector('rom-browser');
    if (romBrowser && romBrowser.openBrowser) {
      romBrowser.openBrowser();
    } else {
      console.error('ROM browser element not found or not ready');
      alert('ROM browser not available. Please try again.');
    }
  };

  InitialMenu.prototype._onLastRomClick = function () {
    if (!this._lastRomData) {
      alert('No previous ROM found');
      return;
    }

    try {
      var romDataBase64 = localStorage.getItem('webnes_lastRomData');
      if (!romDataBase64) {
        throw new Error('ROM data not found');
      }

      var romData = this._base64ToArrayBuffer(romDataBase64);
      var romBytes = new Uint8Array(romData);

      // Verify checksum
      var currentChecksum = this._calculateSimpleChecksum(romData);
      if (currentChecksum !== this._lastRomData.checksum) {
        throw new Error('ROM data appears corrupted');
      }

      // Load the ROM
      if (window.Gui && window.Gui.App && window.Gui.App._loadRomCallback) {
        window.Gui.App._loadRomCallback(this._lastRomData.name, romBytes);
      } else {
        throw new Error('NES emulator not ready');
      }
    } catch (e) {
      console.error('Failed to load last ROM:', e);
      alert('Failed to load previous ROM: ' + e.message);
      // Clear invalid data
      localStorage.removeItem('webnes_lastRom');
      localStorage.removeItem('webnes_lastRomData');
      this._lastRomButton.classList.add('hidden');
    }
  };

  InitialMenu.prototype._onLoadRomClick = function () {
    var that = this;

    var handleFileSelect = function (evt) {
      var file = evt.target.files[0];
      if (file) {
        var reader = new FileReader();

        reader.onloadend = function (loadEvent) {
          if (loadEvent.target.readyState === FileReader.DONE) {
            var romData = new Uint8Array(loadEvent.target.result);

            // Save this ROM as the last ROM
            that._saveLastRomInfo(file.name, romData);

            // Load the ROM
            if (window.Gui && window.Gui.App && window.Gui.App._loadRomCallback) {
              window.Gui.App._loadRomCallback(file.name, romData);
            } else {
              alert('NES emulator not ready. Please try again.');
            }
          }
        };

        reader.readAsArrayBuffer(file);
      }
    };

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.nes,.zip,.7z,.gz';
    input.addEventListener('change', handleFileSelect);
    input.click();
  };

  InitialMenu.prototype._hideMenu = function () {
    if (this._isVisible) {
      this._element.style.display = 'none';
      this._isVisible = false;

      // Show mobile controller when initial menu is hidden
      if (typeof window.ensureMobileControllerVisible === 'function') {
        window.ensureMobileControllerVisible();
      }
    }
  };

  InitialMenu.prototype._showMenu = function () {
    if (!this._isVisible) {
      this._element.style.display = 'flex';
      this._isVisible = true;

      // Hide mobile controller when initial menu is shown
      const mobileController = document.getElementById('mobileController');
      if (mobileController) {
        mobileController.style.display = 'none';
      }
    }
  };

  InitialMenu.prototype.isVisible = function () {
    return this._isVisible;
  };

  // Hook into ROM loading to save ROM info
  InitialMenu.prototype._hookRomLoading = function () {
    var that = this;

    if (window.Gui && window.Gui.App) {
      var originalLoadRomCallback = window.Gui.App._loadRomCallback;

      window.Gui.App._loadRomCallback = function (name, binaryString) {
        // Save ROM info when loaded
        that._saveLastRomInfo(name, binaryString);

        // Call original callback
        return originalLoadRomCallback.call(this, name, binaryString);
      };
    }
  };

  Gui.InitialMenu = InitialMenu;
})();
