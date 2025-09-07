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

  var CanvasParent = function (renderSurface) {
    var that = this;

    this._eventBus = new Nes.EventBus();
    this._parent = document.getElementById('content');
    this._element = document.getElementById('canvasWrapper');

    this._canvasElement = document.createElement('canvas');
    this._element.appendChild(this._canvasElement);

    this._setSize();

    window.addEventListener('resize', function () {
      that._setSize();
    });

    // Also listen for orientation changes on mobile devices
    window.addEventListener('orientationchange', function () {
      // Small delay to ensure viewport dimensions are updated
      setTimeout(function () {
        that._setSize();
      }, 100);
    });
  };

  CanvasParent.prototype.connect = function (name, cb) {
    this._eventBus.connect(name, cb);
  };

  CanvasParent.prototype.getCanvasElement = function () {
    return this._canvasElement;
  };

  CanvasParent.prototype._setSize = function () {
    var parentWidth = this._parent.clientWidth;
    var parentHeight = this._parent.clientHeight;

    var resizeType = 'keepAspectRatio';

    if (resizeType === 'keepAspectRatio') {
      var aspectRatio = SCREEN_WIDTH / SCREEN_HEIGHT;

      // Check if we're on mobile
      var isMobile =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent
        ) || window.innerWidth <= 768;

      var availableWidth = parentWidth;
      var availableHeight = parentHeight;

      // On mobile, account for mobile controller and other UI elements
      if (isMobile) {
        // Account for mobile controller height (approximately 120px in landscape, 200px in portrait)
        var isLandscape = window.innerWidth > window.innerHeight;
        var controllerHeight = isLandscape ? 120 : 200;
        var titleHeight = isLandscape ? 0 : 60; // Title is hidden in landscape
        var padding = 40; // Additional padding for safety

        availableHeight = Math.min(
          parentHeight,
          window.innerHeight - controllerHeight - titleHeight - padding
        );
        availableWidth = Math.min(parentWidth, window.innerWidth - 20); // 20px for side padding
      }

      // Calculate size based on both width and height constraints
      var widthBasedHeight = availableWidth / aspectRatio;
      var heightBasedWidth = aspectRatio * availableHeight;

      var newWidth, newHeight;

      if (widthBasedHeight <= availableHeight) {
        // Width is the limiting factor
        newWidth = availableWidth;
        newHeight = widthBasedHeight;
      } else {
        // Height is the limiting factor
        newWidth = heightBasedWidth;
        newHeight = availableHeight;
      }

      this._canvasElement.width = Math.floor(newWidth);
      this._canvasElement.height = Math.floor(newHeight);

      this._eventBus.invoke('resize');
    }
  };

  Gui.CanvasParent = CanvasParent;
})();
