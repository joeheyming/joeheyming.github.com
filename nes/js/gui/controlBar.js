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

  var ControlBar = function (app) {
    var that = this;
    this._debugEnabled = false;
    this._isLimitOn = true;
    this._traceRunning = false;
    this._isPaused = false;
    this._encodingIgnoreNextClick = false;
    this._app = app;
    this._eventBus = new Nes.EventBus();

    this._app.connect('cartLoaded', function (cart) {
      that._onCartLoaded(cart);
    });
    this._app._mainboard.connect('soundEnabled', function (enabled, supported) {
      that._onSoundEnabled(enabled, supported);
    });
    this._app.connect('frameLimit', function (on) {
      that._onFrameLimitSet(on);
    });
    this._app.connect('isPausedChange', function (on) {
      that._onPauseChange(on);
    });
    this._app.connect('romLoadFailure', function (reason) {
      that._onRomLoadFailure(reason);
    });

    this._element = document.querySelector('.fixed.top-5.right-5'); // The top-level container
    this._hamburgerButton = document.getElementById('hamburgerButton');
    this._hamburgerDropdown = document.getElementById('hamburgerDropdown');

    this._buttons = [];

    // primary buttons
    this._addButton('controlBar_loadRomButton', {
      primary: { label: 'Open ROM', icon: 'ui-icon-folder-open' },
      click: function () {
        that._loadRomButtonClick();
      }
    });
    this._addButton('controlBar_browseRomsButton', {
      primary: { label: 'Browse ROMs', icon: 'ui-icon-search' },
      click: function () {
        that._browseRomsButtonClick();
      }
    });
    this._addButton('controlBar_resetButton', {
      enabledWhenRomIsLoaded: true,
      primary: { label: 'Reset', icon: 'ui-icon-refresh' },
      click: function () {
        that._onResetButtonClick();
      }
    });
    this._playButton = this._addButton('controlBar_playButton', {
      primary: { label: 'Pause', icon: 'ui-icon-pause' },
      toggle: { label: 'Play', icon: 'ui-icon-play' },
      click: function () {
        that._onPlayButtonClick();
      }
    });
    this._gameGenieButton = this._addButton('controlBar_gameGenieButton', {
      enabledWhenRomIsLoaded: true,
      primary: { label: 'Game Genie', icon: 'ui-icon-star' },
      click: function () {
        that._onGameGenieButtonClick();
      }
    });
    this._addButton('controlBar_quickSaveButton', {
      enabledWhenRomIsLoaded: true,
      primary: { label: 'Quick save', icon: 'ui-icon-disk' },
      click: function () {
        that._onSaveButtonClick();
      }
    });
    this._addButton('controlBar_quickLoadButton', {
      enabledWhenRomIsLoaded: true,
      primary: { label: 'Quick load', icon: 'ui-icon-folder-collapsed' },
      click: function () {
        that._onLoadButtonClick();
      }
    });
    this._addButton('controlBar_screenshotButton', {
      enabledWhenRomIsLoaded: true,
      primary: { label: 'Screenshot', icon: 'ui-icon-image' },
      click: function () {
        that._onScreenshotButtonClick();
      }
    });
    this._keyboardRemapperButton = this._addButton('controlBar_keyboardRemap', {
      primary: { label: 'Remap controls', icon: 'ui-icon-calculator' },
      click: function () {
        that._onKeyboardRemapButtonClick();
      }
    });

    // Volume slider removed - users can use device volume controls
    this._errorDisplayButton = this._addButton('controlBar_errorDisplay', {
      primary: { label: 'Alerts', icon: 'ui-icon-alert' },
      click: function () {
        that._errorDisplayButtonClick();
      }
    });
    this._errorDisplayMessage = new Gui.ControlBarMessage(
      'controlBar_alertMessage',
      this._errorDisplayButton
    );

    // Override the hide method to also hide the alert button
    var originalHide = this._errorDisplayMessage.hide.bind(this._errorDisplayMessage);
    this._errorDisplayMessage.hide = function () {
      originalHide();
      that._hideAlertButton();
    };

    this._element.style.visibility = 'visible';

    // Add hamburger menu toggle functionality
    if (this._hamburgerButton) {
      this._hamburgerButton.addEventListener('click', function () {
        that._toggleHamburgerMenu();
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', function (event) {
      if (!that._element.contains(event.target)) {
        that._closeHamburgerMenu();
      }
    });

    window.addEventListener('resize', function () {
      that._setPosition();
    });

    // Listen for canvas resize events to reposition control bar
    this._app.connect('canvasResize', function () {
      setTimeout(function () {
        that._setPosition();
      }, 10); // Small delay to ensure canvas is fully resized
    });

    this._setPosition();
  };

  ControlBar.prototype._onKeyboardRemapButtonClick = function () {
    this._dismissMenuAndNotify('Opening keyboard remapper...');
    this._app._keyboardRemapDialog.show();
  };

  ControlBar.prototype._errorDisplayButtonClick = function () {
    this._errorDisplayButton.alert(false);
    // Hide the alert button when the user clicks it (dismisses the alert)
    this._hideAlertButton();
  };

  ControlBar.prototype._showAlertButton = function () {
    var alertButton = document.getElementById('controlBar_errorDisplay');
    if (alertButton) {
      alertButton.classList.remove('hidden');
    }
  };

  ControlBar.prototype._hideAlertButton = function () {
    var alertButton = document.getElementById('controlBar_errorDisplay');
    if (alertButton) {
      alertButton.classList.add('hidden');
    }
  };

  ControlBar.prototype._onRomLoadFailure = function (reason) {
    this._errorDisplayMessage.setText(reason);
    this._errorDisplayMessage.show();
    // Show the alert button when there's an error
    this._showAlertButton();
  };

  ControlBar.prototype._addButton = function (jqId, options) {
    var but = new Gui.ControlBarButton(this._app._mainboard, jqId, options);
    this._buttons.push(but);
    return but;
  };

  ControlBar.prototype.connect = function (name, cb) {
    this._eventBus.connect(name, cb);
  };

  ControlBar.prototype._onPauseChange = function (isPaused) {
    this._playButton.toggleIcon(isPaused);
    // Update the text label for the play/pause button
    var playButtonTextSpan = document.querySelector('#controlBar_playButton span:last-child');
    if (playButtonTextSpan) {
      playButtonTextSpan.textContent = isPaused ? 'Play' : 'Pause';
    }
  };

  ControlBar.prototype._onScreenshotButtonClick = function () {
    this._dismissMenuAndNotify('Screenshot taken');
    this._app.screenshot();
  };

  ControlBar.prototype._onCartLoaded = function (cart) {
    this._gameGenieButton.highlight(cart.areGameGenieCodesAvailable());
    // Encoding change handling was removed with debug cleanup
    // if ( !this._element.is(":visible") ) {
    // this._element.show( "slide", { direction: "down" }, 1000 );
    // }
  };

  ControlBar.prototype._onSoundEnabled = function (enabled, supported) {
    if (supported) {
      this._soundButton.enable(true);
      this._soundButton.toggleIcon(!enabled);
    } else {
      this._soundButton.enable(false);
      this._soundButton.toggleIcon(true);
    }
  };

  ControlBar.prototype._onSaveButtonClick = function () {
    this._closeHamburgerMenu();
    this._app._saveStateManager.quickSaveState();
  };

  ControlBar.prototype._onLoadButtonClick = function () {
    // Check if we're on mobile - if so, use quick load instead of dialog
    var isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth <= 768;

    if (isMobile) {
      this._closeHamburgerMenu();
      this._app._saveStateManager.quickLoadState();
    } else {
      this._dismissMenuAndNotify('Opening load state dialog...');
      this._app._saveStateManager.showLoadStateDialog();
    }
  };

  ControlBar.prototype._getFrameHashButtonClick = function () {
    console.log(
      '{ frame: ' +
        this._app._mainboard.ppu.frameCounter +
        ', expectedHash: "' +
        this._app._renderSurface.getRenderBufferHash() +
        '" }'
    );
  };

  ControlBar.prototype._onResetButtonClick = function () {
    this._dismissMenuAndNotify('Game reset');
    this._app.reset();
  };

  ControlBar.prototype._loadRomButtonClick = function () {
    var that = this;

    this._closeHamburgerMenu();

    var handleFileSelect = function (evt) {
      var file = evt.target.files[0];
      if (file) {
        var reader = new FileReader();

        // If we use onloadend, we need to check the readyState.
        reader.onloadend = function (loadEvent) {
          if (loadEvent.target.readyState === FileReader.DONE) {
            that._eventBus.invoke('romLoaded', file.name, new Uint8Array(loadEvent.target.result));
            that._showSnackbar('ROM loaded: ' + file.name);
          }
        };

        reader.readAsArrayBuffer(file);
      }
    };

    var input = document.createElement('input');
    input.type = 'file';
    input.addEventListener('change', handleFileSelect);
    input.click(); // open dialog
  };

  ControlBar.prototype._browseRomsButtonClick = function () {
    this._dismissMenuAndNotify('Opening ROM browser...');

    // Find the ROM browser element and call its openBrowser method
    var romBrowser = document.querySelector('rom-browser');
    if (romBrowser && romBrowser.openBrowser) {
      romBrowser.openBrowser();
    } else {
      console.error('ROM browser element not found or not ready');
      this._showSnackbar('ROM browser not available');
    }
  };

  ControlBar.prototype._onFrameLimitSet = function (limitOn) {
    this._isLimitOn = limitOn;
    //	this._frameLimitButton.toggleIcon( !this._isLimitOn );
  };

  ControlBar.prototype._onPlayButtonClick = function () {
    this._isPaused = !this._isPaused;
    this._dismissMenuAndNotify(this._isPaused ? 'Game paused' : 'Game resumed');
    this._app.pause(this._isPaused);
  };

  ControlBar.prototype._onGameGenieButtonClick = function () {
    if (this._app._mainboard.cart) {
      this._dismissMenuAndNotify('Opening Game Genie...');
      this._app._ggDialog.show();
    } else {
      this._dismissMenuAndNotify('Load a ROM first to use Game Genie');
    }
  };

  ControlBar.prototype._toggleHamburgerMenu = function () {
    var isOpen = !this._hamburgerDropdown.classList.contains('hidden');
    if (isOpen) {
      this._closeHamburgerMenu();
    } else {
      this._openHamburgerMenu();
    }
  };

  ControlBar.prototype._openHamburgerMenu = function () {
    this._hamburgerDropdown.classList.remove('hidden');
    this._hamburgerButton.classList.add('active');

    // Hide mobile controller when hamburger menu is open
    console.log('hamburger menu open');
    var mobileController = document.getElementById('mobileController');
    if (mobileController) {
      console.log('hiding mobile controller');
      mobileController.style.display = 'none';
    }
  };

  ControlBar.prototype._closeHamburgerMenu = function () {
    this._hamburgerDropdown.classList.add('hidden');
    this._hamburgerButton.classList.remove('active');

    // Show mobile controller again when hamburger menu is closed
    if (typeof window.ensureMobileControllerVisible === 'function') {
      window.ensureMobileControllerVisible();
    }
  };

  ControlBar.prototype._setPosition = function () {
    // Hamburger menu is positioned with fixed CSS, no dynamic positioning needed
    // This method is kept for compatibility but doesn't need to do anything
  };

  ControlBar.prototype._showSnackbar = function (message, duration) {
    duration = duration || 3000; // Default 3 seconds
    var snackbar = document.getElementById('snackbar');
    var messageElement = document.getElementById('snackbarMessage');

    if (snackbar && messageElement) {
      messageElement.textContent = message;
      snackbar.classList.remove('opacity-0');
      snackbar.classList.add('opacity-100');

      setTimeout(function () {
        snackbar.classList.remove('opacity-100');
        snackbar.classList.add('opacity-0');
      }, duration);
    }
  };

  ControlBar.prototype._dismissMenuAndNotify = function (message) {
    this._closeHamburgerMenu();
    if (message) {
      this._showSnackbar(message);
    }
  };

  Gui.ControlBar = ControlBar;
})();
