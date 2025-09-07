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

  var HotkeyManager = function (app) {
    this._app = app;
    this._isRomLoaded = false;

    // Check if we're on a mobile device
    this._isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth <= 768;

    // Only setup hotkeys on non-mobile devices
    if (!this._isMobile) {
      this._setupEventListeners();
    }
    this._setupRomLoadedListener();
  };

  HotkeyManager.prototype._setupEventListeners = function () {
    var that = this;

    document.addEventListener('keydown', function (event) {
      // Don't handle game controls when user is typing in an input field
      if (
        event.target.tagName === 'INPUT' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.contentEditable === 'true' ||
        event.target.isContentEditable ||
        event.target.nodeName === 'ROM-BROWSER'
      ) {
        return;
      }

      // Only handle hotkeys if a ROM is loaded and we're not in an input field
      if (!that._isRomLoaded || that._isInputFocused()) {
        return;
      }

      // Prevent default behavior for our hotkeys
      var handled = false;

      switch (event.code) {
        case 'F5':
          // Quick Save (F5)
          event.preventDefault();
          that._quickSave();
          handled = true;
          break;

        case 'F9':
          // Quick Load (F9)
          event.preventDefault();
          that._quickLoad();
          handled = true;
          break;

        case 'Space':
          // Pause/Unpause (Space)
          event.preventDefault();
          that._togglePause();
          handled = true;
          break;

        case 'KeyR':
          if (event.ctrlKey || event.metaKey) {
            return;
          }
          // Reset (R)
          event.preventDefault();
          that._reset();
          handled = true;
          break;
      }

      if (handled) {
        // Stop propagation to prevent other handlers from processing these keys
        event.stopPropagation();
      }
    });
  };

  HotkeyManager.prototype._setupRomLoadedListener = function () {
    var that = this;

    if (this._app && this._app._mainboard) {
      this._app._mainboard.connect('romLoaded', function () {
        that._isRomLoaded = true;
      });
    }
  };

  HotkeyManager.prototype._isInputFocused = function () {
    var activeElement = document.activeElement;
    if (!activeElement) return false;

    var tagName = activeElement.tagName.toLowerCase();
    var inputTypes = ['input', 'textarea', 'select'];

    return (
      inputTypes.indexOf(tagName) !== -1 ||
      activeElement.contentEditable === 'true' ||
      activeElement.isContentEditable
    );
  };

  HotkeyManager.prototype._quickSave = function () {
    if (this._app && this._app._saveStateManager) {
      this._app._saveStateManager.quickSaveState();
      this._showNotification('Quick Save (F5): Game state saved');
    }
  };

  HotkeyManager.prototype._quickLoad = function () {
    if (this._app && this._app._saveStateManager) {
      this._app._saveStateManager.quickLoadState();
      this._showNotification('Quick Load (F9): Game state loaded');
    }
  };

  HotkeyManager.prototype._togglePause = function () {
    if (this._app) {
      var isPaused = this._app._isPaused;
      this._app.pause(!isPaused);
      this._showNotification(isPaused ? 'Game Resumed (Space)' : 'Game Paused (Space)');
    }
  };

  HotkeyManager.prototype._reset = function () {
    if (this._app) {
      this._app.reset();
      this._showNotification('Game Reset (R)');
    }
  };

  HotkeyManager.prototype._showNotification = function (message) {
    // Use the existing snackbar system if available
    var snackbar = document.getElementById('snackbar');
    var snackbarMessage = document.getElementById('snackbarMessage');

    if (snackbar && snackbarMessage) {
      snackbarMessage.textContent = message;
      snackbar.classList.remove('opacity-0');
      snackbar.classList.add('opacity-100');

      // Hide after 2 seconds
      setTimeout(function () {
        snackbar.classList.remove('opacity-100');
        snackbar.classList.add('opacity-0');
      }, 2000);
    } else {
      // Fallback to console log
      console.log(message);
    }
  };

  Gui.HotkeyManager = HotkeyManager;
})();
