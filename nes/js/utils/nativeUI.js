// Native UI replacements for jQuery UI components
(function () {
  'use strict';

  // Simple native dialog implementation
  function NativeDialog(element, options) {
    this.element = element;
    this.options = Object.assign(
      {
        autoOpen: false,
        modal: true,
        draggable: false,
        resizable: false,
        width: 400,
        height: 300,
        buttons: {}
      },
      options
    );

    this.isOpen = false;
    this.init();
  }

  NativeDialog.prototype.init = function () {
    var that = this;

    // Style the dialog element
    this.element.style.position = 'fixed';
    this.element.style.zIndex = '1000';
    this.element.style.backgroundColor = 'var(--surface-1)';
    this.element.style.color = 'var(--text-1)';
    this.element.style.border = '1px solid var(--hairline-strong)';
    this.element.style.borderRadius = 'var(--radius-md, 4px)';
    this.element.style.boxShadow = 'var(--shadow-modal)';
    this.element.style.padding = '20px';
    this.element.style.display = 'none';

    // Create close button
    this.closeButton = document.createElement('button');
    this.closeButton.innerHTML = '&times;';
    this.closeButton.style.position = 'absolute';
    this.closeButton.style.top = '5px';
    this.closeButton.style.right = '10px';
    this.closeButton.style.background = 'none';
    this.closeButton.style.border = 'none';
    this.closeButton.style.fontSize = '20px';
    this.closeButton.style.cursor = 'pointer';
    this.closeButton.style.color = 'var(--text-3)';
    this.closeButton.style.lineHeight = '1';
    this.closeButton.style.padding = '0';
    this.closeButton.style.width = '20px';
    this.closeButton.style.height = '20px';
    this.closeButton.title = 'Close';

    this.closeButton.addEventListener('click', function () {
      that.close();
    });

    // Hover effect for close button
    this.closeButton.addEventListener('mouseenter', function () {
      this.style.color = 'var(--text-1)';
    });
    this.closeButton.addEventListener('mouseleave', function () {
      this.style.color = 'var(--text-3)';
    });

    this.element.appendChild(this.closeButton);

    // Create backdrop if modal
    if (this.options.modal) {
      this.backdrop = document.createElement('div');
      this.backdrop.style.position = 'fixed';
      this.backdrop.style.top = '0';
      this.backdrop.style.left = '0';
      this.backdrop.style.width = '100%';
      this.backdrop.style.height = '100%';
      this.backdrop.style.backgroundColor = 'var(--scrim)';
      this.backdrop.style.zIndex = '999';
      this.backdrop.style.display = 'none';
      document.body.appendChild(this.backdrop);

      // Allow closing by clicking backdrop
      this.backdrop.addEventListener('click', function () {
        that.close();
      });
    }

    // ESC key handling
    this.keydownHandler = function (event) {
      if (event.key === 'Escape' && that.isOpen) {
        that.close();
      }
    };

    this.setSize();
    this.center();
  };

  NativeDialog.prototype.setSize = function () {
    this.element.style.width = this.options.width + 'px';
    this.element.style.height = this.options.height + 'px';
  };

  NativeDialog.prototype.center = function () {
    this.element.style.left = '50%';
    this.element.style.top = '50%';
    this.element.style.transform = 'translate(-50%, -50%)';
  };

  NativeDialog.prototype.open = function () {
    if (this.backdrop) {
      this.backdrop.style.display = 'block';
    }
    this.element.style.display = 'block';
    this.isOpen = true;

    // Add ESC key listener when dialog opens
    document.addEventListener('keydown', this.keydownHandler);

    if (this.options.open) {
      this.options.open();
    }
  };

  NativeDialog.prototype.close = function () {
    if (this.backdrop) {
      this.backdrop.style.display = 'none';
    }
    this.element.style.display = 'none';
    this.isOpen = false;

    // Remove ESC key listener when dialog closes
    document.removeEventListener('keydown', this.keydownHandler);

    if (this.options.close) {
      this.options.close();
    }
  };

  NativeDialog.prototype.option = function (key, value) {
    if (arguments.length === 1) {
      return this.options[key];
    }
    this.options[key] = value;

    if (key === 'width' || key === 'height') {
      this.setSize();
    }
    if (key === 'position') {
      // Handle position updates
      this.center();
    }
  };

  NativeDialog.prototype.destroy = function () {
    // Close dialog if open
    if (this.isOpen) {
      this.close();
    }

    // Remove backdrop from DOM
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }

    // Remove close button from dialog element
    if (this.closeButton && this.closeButton.parentNode) {
      this.closeButton.parentNode.removeChild(this.closeButton);
    }

    // Clean up references
    this.backdrop = null;
    this.closeButton = null;
    this.keydownHandler = null;
  };

  // Simple native button implementation
  function NativeButton(element, options) {
    this.element = element;
    this.options = Object.assign(
      {
        text: true,
        icons: {}
      },
      options
    );

    this.init();
  }

  NativeButton.prototype.init = function () {
    this.element.className += ' native-button';
    if (this.options.label) {
      this.element.title = this.options.label;
    }
  };

  NativeButton.prototype.option = function (key, value) {
    if (arguments.length === 1) {
      return this.options[key];
    }
    this.options[key] = value;
  };

  // Simple native slider implementation
  function NativeSlider(element, options) {
    this.element = element;
    this.options = Object.assign(
      {
        min: 0,
        max: 100,
        value: 0,
        step: 1
      },
      options
    );

    this.init();
  }

  NativeSlider.prototype.init = function () {
    // Create HTML5 range input
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = this.options.min;
    this.slider.max = this.options.max;
    this.slider.value = this.options.value;
    this.slider.step = this.options.step;

    var that = this;
    this.slider.addEventListener('input', function () {
      if (that.options.slide) {
        that.options.slide(null, { value: parseInt(that.slider.value) });
      }
    });

    this.element.appendChild(this.slider);
  };

  NativeSlider.prototype.value = function (val) {
    if (arguments.length === 0) {
      return parseInt(this.slider.value);
    }
    this.slider.value = val;
  };

  // Extend native elements with jQuery-like methods
  HTMLElement.prototype.nativeDialog = function (options) {
    if (!this._nativeDialog) {
      this._nativeDialog = new NativeDialog(this, options);
    }
    return this._nativeDialog;
  };

  HTMLElement.prototype.nativeButton = function (options) {
    if (!this._nativeButton) {
      this._nativeButton = new NativeButton(this, options);
    }
    return this._nativeButton;
  };

  HTMLElement.prototype.nativeSlider = function (options) {
    if (!this._nativeSlider) {
      this._nativeSlider = new NativeSlider(this, options);
    }
    return this._nativeSlider;
  };

  // Export to global scope
  window.NativeUI = {
    Dialog: NativeDialog,
    Button: NativeButton,
    Slider: NativeSlider
  };
})();
