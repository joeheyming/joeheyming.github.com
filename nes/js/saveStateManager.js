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

  var SaveStateManager = function (app, createGuiComponents) {
    this._app = app;
    this._mainboard = this._app._mainboard;
    this._renderSurface = this._app._renderSurface;

    this._loadPending = '';
    this._loadStatePending = false;
    this._saveStatePending = false;
    if (createGuiComponents) {
      this._lsDialog = new Gui.LoadStateDialog(app);
    }
  };

  SaveStateManager.prototype.quickSaveState = function () {
    this._saveStatePending = true;
  };

  SaveStateManager.prototype.quickLoadState = function () {
    this.loadState('quicksave');
  };

  SaveStateManager.prototype.loadState = function (slotName) {
    this._loadPending = slotName;
    this._loadStatePending = true;
  };

  SaveStateManager.prototype._doQuickSave = function () {
    // push back previous quicksaves by renaming them, pushing them back in the queue
    var hash = this._mainboard.cart.getHash();
    Gui.renameQuickSaveStates('quicksave', hash, 3);
    var screen = this._renderSurface.screenshotToString();
    var state = this._mainboard.saveState();
    Gui.saveState('quicksave', hash, state, screen);

    // Notify user of successful save
    this._showSaveSuccessNotification();
  };

  SaveStateManager.prototype._doQuickLoad = function () {
    var cartHash = this._mainboard.cart.getHash();
    var state = Gui.loadState(this._loadPending, cartHash);

    if (state) {
      this._mainboard.loadState(state);

      // Ensure mobile controller stays visible after loading state
      if (typeof window.ensureMobileControllerVisible === 'function') {
        setTimeout(window.ensureMobileControllerVisible, 100);
      }

      // Notify user of successful load
      this._showLoadSuccessNotification();
    } else {
      // Check if there was corrupted data that got cleared
      // We can detect this by checking if the slot existed in metadata but load returned null
      var meta = Gui.getStateMetaData(cartHash, false);
      var hadCorruptedData = meta.slots && meta.slots[this._loadPending];

      if (hadCorruptedData) {
        // Corrupted data was detected and cleared
        this._showCorruptedDataNotification();
      } else {
        // No save state was found
        this._showNoSaveStateNotification();
      }
    }
  };

  SaveStateManager.prototype.showLoadStateDialog = function () {
    // Check if we're on mobile - if so, use quick load instead of dialog
    var isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth <= 768;

    if (isMobile) {
      // On mobile, just do a quick load instead of showing dialog
      this.quickLoadState();
      return;
    }

    var hash = this._mainboard.cart.getHash();
    var metaData = Gui.getStateMetaData(hash, true);
    this._lsDialog.show(hash, metaData);
  };

  SaveStateManager.prototype._showSaveSuccessNotification = function () {
    // Find the control bar to show notification
    if (this._app._controlBar && this._app._controlBar._showSnackbar) {
      this._app._controlBar._showSnackbar('Game state saved successfully');
    }
  };

  SaveStateManager.prototype._showLoadSuccessNotification = function () {
    // Find the control bar to show notification
    if (this._app._controlBar && this._app._controlBar._showSnackbar) {
      this._app._controlBar._showSnackbar('Game state loaded successfully');
    }
  };

  SaveStateManager.prototype._showNoSaveStateNotification = function () {
    // Find the control bar to show notification
    if (this._app._controlBar && this._app._controlBar._showSnackbar) {
      this._app._controlBar._showSnackbar('No save state found. Save a game first!');
    }
  };

  SaveStateManager.prototype._showCorruptedDataNotification = function () {
    // Find the control bar to show notification
    if (this._app._controlBar && this._app._controlBar._showSnackbar) {
      this._app._controlBar._showSnackbar('Corrupted save data cleared. Please save again.');
    }
  };

  SaveStateManager.prototype.onFrame = function () {
    var that = this;
    if (this._mainboard.cart) {
      if (this._saveStatePending) {
        this._saveStatePending = false;
        this._doQuickSave();
      } else if (this._loadStatePending) {
        this._loadStatePending = false;
        this._doQuickLoad();
      }
    }
  };

  Gui.SaveStateManager = SaveStateManager;
})();
