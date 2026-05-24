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

  var isClickWithinElementBounds = function (element, clickX, clickY) {
    // look for a click outside the menu, then close the menu if it's outside of the menu's bounds
    var margin = 40;
    var rect = element.getBoundingClientRect();
    var pos = {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY
    };
    var width = rect.width;
    var height = rect.height;
    var inBounds =
      pos.left - margin <= clickX &&
      pos.left + width + margin >= clickX &&
      pos.top - margin <= clickY &&
      pos.top + height + margin >= clickY;
    return inBounds;
  };

  var ControlBarButton = function (mainboard, jqId, options) {
    var that = this;
    this._options = options;
    this._toggleState = false;
    this._button = document.getElementById(jqId);
    this._button.title = this._options.primary.label;

    // Apply the primary icon class to the button
    if (this._options.primary && this._options.primary.icon) {
      this._button.classList.add(this._options.primary.icon);
    }

    if (this._options.toggleIcon || this._options.click) {
      this._button.addEventListener('click', function () {
        var ret = that._onClick();
        return ret === undefined ? true : ret;
      });
    }

    if (this._options.enabledWhenRomIsLoaded) {
      this.enable(false);
      mainboard.connect('romLoaded', function (cart) {
        that._onRomLoaded(cart);
      });
    }
  };

  ControlBarButton.prototype._onClick = function () {
    if (this._options.click) {
      return this._options.click();
    }
    return true;
  };

  ControlBarButton.prototype._onRomLoaded = function (cart) {
    if (this._options.enabledWhenRomIsLoaded) {
      this.enable(true);
    }
  };

  ControlBarButton.prototype.toggleIcon = function (forceToggle) {
    if (forceToggle === undefined) {
      this._toggleState = !this._toggleState;
    } else {
      this._toggleState = forceToggle;
    }
    if (this._options.toggle) {
      if (this._toggleState) {
        this._button.title = this._options.toggle.label || this._options.primary.label;
        // Switch to toggle icon
        if (this._options.primary.icon) {
          this._button.classList.remove(this._options.primary.icon);
        }
        if (this._options.toggle.icon) {
          this._button.classList.add(this._options.toggle.icon);
        }
      } else {
        this._button.title = this._options.primary.label;
        // Switch back to primary icon
        if (this._options.toggle.icon) {
          this._button.classList.remove(this._options.toggle.icon);
        }
        if (this._options.primary.icon) {
          this._button.classList.add(this._options.primary.icon);
        }
      }
    }
  };

  ControlBarButton.prototype.highlight = function (hl) {
    if (hl === true || hl === undefined) {
      this._button.classList.add('ui-state-highlight');
    } else {
      this._button.classList.remove('ui-state-highlight');
    }
  };

  ControlBarButton.prototype.alert = function (hl) {
    if (hl === true || hl === undefined) {
      this._button.classList.add('ui-state-error');
    } else {
      this._button.classList.remove('ui-state-error');
    }
  };

  ControlBarButton.prototype.enable = function (enable) {
    var shouldEnable = enable === undefined || enable;
    this._button.disabled = !shouldEnable;
  };

  var ControlBarMenu = function (menuJqId, buttonObject, options) {
    var that = this;

    this._buttonObject = buttonObject;
    this._options = options || {};
    this._menu = document.getElementById(menuJqId);
    this._menu.style.display = 'none';

    document.addEventListener('click', function (e) {
      that._onDocClick(e);
    });

    // Connect checkbox change events
    if (this._options.checkBoxes && Array.isArray(this._options.checkBoxes)) {
      for (var i = 0; i < this._options.checkBoxes.length; ++i) {
        var obj = this._options.checkBoxes[i];
        if (obj.change) {
          obj.checkBoxSelector.change(obj.change);
        }
      }
    }
  };

  ControlBarMenu.prototype._onDocClick = function (e) {
    // hide menu when clicked somewhere else
    // HACK: cx and cy will be zero on a forced (manual) click event invoked by .click(). So we ignore these
    if (e.clientX === 0 && e.clientY === 0) {
      return;
    }
    if (this.isVisible()) {
      if (!isClickWithinElementBounds(this._menu, e.clientX, e.clientY)) {
        this.hide();
      } else {
        // click was inside the menu. check the options object for specified behaviour
        if (this._options.checkBoxes && Array.isArray(this._options.checkBoxes)) {
          for (var i = 0; i < this._options.checkBoxes.length; ++i) {
            var obj = this._options.checkBoxes[i];
            // if we clicked on the li element, check the checkbox (this way user doesnt have to click checkbox exactly)
            if (e.target.id === obj.parentId) {
              obj.checkBoxSelector.click();
            }
          }
        }
      }
    }
  };

  ControlBarMenu.prototype.toggleShow = function () {
    if (this.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  };

  ControlBarMenu.prototype.show = function () {
    this._menu.show().position({
      my: 'left bottom',
      at: 'left top',
      of: this._buttonObject._button
    });
  };

  ControlBarMenu.prototype.hide = function () {
    if (this._menu.is(':visible')) {
      this._menu.hide();
    }
  };

  ControlBarMenu.prototype.isVisible = function () {
    return this._menu.is(':visible');
  };

  var ControlBarSlider = function (jqId, buttonObject, options) {
    var that = this;
    this._buttonObject = buttonObject;
    this._options = options;
    this._options.defaultValueIndex =
      this._options.defaultValueIndex === undefined ? 0 : this._options.defaultValueIndex;
    this._currentIndex = this._options.defaultValueIndex;
    this._tooltipCreated = false;

    this._dialog = document.getElementById(jqId).nativeDialog({
      autoOpen: false,
      height: 130,
      width: 40,
      modal: false,
      resizable: false
    });

    var sliderElement = document.createElement('div');
    document.getElementById(jqId).appendChild(sliderElement);

    var isRangeSlider = this._options.values === undefined;

    if (isRangeSlider) {
      this._slider = sliderElement.nativeSlider({
        value: this._options.defaultValueIndex,
        min: this._options.minValue,
        max: this._options.maxValue,
        slide: function (event, ui) {
          that._updateTooltip(ui.handle, ui.value);
          if (that._options.change) {
            that._options.change(ui.value);
          }
        }
      });
    } else {
      this._slider = sliderElement.nativeSlider({
        value: this._options.defaultValueIndex,
        min: 0,
        max: this._options.values.length - 1,
        step: 1,
        slide: function (event, ui) {
          that._updateTooltip(ui.handle, ui.value);
          if (that._options.change) {
            var actualValue = that._options.values ? that._options.values[ui.value] : ui.value;
            that._options.change(actualValue);
          }
        }
      });
    }
    sliderElement.classList.add('controlBarSliderContents');
    this._createTooltip();

    document.addEventListener('click', function (e) {
      that._onDocClick(e);
    });
  };

  ControlBarSlider.prototype._getTooltipText = function (val) {
    if (this._options.values && val >= 0 && val < this._options.values.length) {
      return this._options.values[val].text;
    } else {
      return val.toString();
    }
  };

  ControlBarSlider.prototype._createTooltip = function () {
    // Simplified tooltip using native title attribute
    this._tooltipCreated = true;
  };

  ControlBarSlider.prototype._updateTooltip = function (handle, val) {
    if (this._currentIndex !== val) {
      this._currentIndex = val;
      // Simplified tooltip - could set title attribute on handle if needed
      if (this._options.change) {
        this._options.change(
          this._options.values ? this._options.values[this._currentIndex].value : val
        );
      }
    }
  };

  ControlBarSlider.prototype._onDocClick = function (e) {
    // HACK: cx and cy will be zero on a forced (manual) click event invoked by .click(). So we ignore these
    if (e.clientX === 0 && e.clientY === 0) {
      return;
    }
    // hide menu when clicked somewhere else
    if (this.isVisible()) {
      if (!isClickWithinElementBounds(this._dialog.element, e.clientX, e.clientY)) {
        this.hide();
      }
    }
  };

  ControlBarSlider.prototype.show = function () {
    // Position dialog in a fixed location in the top-right area
    // Since the volume button is inside the hamburger menu, we position the slider externally
    this._dialog.element.style.position = 'fixed';
    this._dialog.element.style.right = '20px';
    this._dialog.element.style.top = '60px';
    this._dialog.element.style.left = 'auto';

    // Ensure the dialog is visible and properly sized
    this._dialog.element.style.zIndex = '2000';
    this._dialog.element.style.backgroundColor = 'var(--surface-1)';
    this._dialog.element.style.color = 'var(--text-1)';
    this._dialog.element.style.border = '2px solid var(--hairline-strong)';
    this._dialog.element.style.borderRadius = '8px';
    this._dialog.element.style.padding = '10px';
    this._dialog.element.style.boxShadow = 'var(--shadow-modal)';
    this._dialog.element.style.minWidth = '60px';
    this._dialog.element.style.minHeight = '120px';

    this._dialog.open();
  };

  ControlBarSlider.prototype.hide = function () {
    if (this._dialog.isOpen) {
      this._dialog.close();
    }
  };

  ControlBarSlider.prototype.isVisible = function () {
    return this._dialog.isOpen;
  };

  var ControlBarMessage = function (jqId, buttonObject, options) {
    var that = this;
    this._buttonObject = buttonObject;
    this._options = options;
    this._allowAutoHide = false;

    this._dialog = document.getElementById(jqId).nativeDialog({
      autoOpen: false,
      height: 50,
      width: 100,
      modal: false,
      resizable: false
    });

    this._textElement = document.createElement('div');
    document.getElementById(jqId).appendChild(this._textElement);

    document.addEventListener('click', function (e) {
      that._onDocClick(e);
    });
  };

  ControlBarMessage.prototype.setText = function (text) {
    this._textElement.innerHTML = '<p>' + text + '</p>';
  };

  ControlBarMessage.prototype._onDocClick = function (e) {
    // HACK: cx and cy will be zero on a forced (manual) click event invoked by .click(). So we ignore these
    if (e.clientX === 0 && e.clientY === 0) {
      return;
    }
    // hide menu when clicked somewhere else
    if (this.isVisible()) {
      if (!isClickWithinElementBounds(this._dialog.element, e.clientX, e.clientY)) {
        if (this._allowAutoHide) {
          this.hide();
        }
      }
    }
  };

  ControlBarMessage.prototype.show = function () {
    var that = this;
    // Position dialog near button (simplified positioning)
    this._dialog.open();
    this._buttonObject.alert(true);
    this._allowAutoHide = false;
    setTimeout(function () {
      that._allowAutoHide = true;
    }, 300);
  };

  ControlBarMessage.prototype.hide = function () {
    if (this._dialog.isOpen) {
      this._dialog.close();
    }
    this._buttonObject.alert(false);
  };

  ControlBarMessage.prototype.isVisible = function () {
    return this._dialog.isOpen;
  };

  Gui.ControlBarButton = ControlBarButton;
  Gui.ControlBarMenu = ControlBarMenu;
  Gui.ControlBarSlider = ControlBarSlider;
  Gui.ControlBarMessage = ControlBarMessage;
})();
