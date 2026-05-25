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
var animateFunction;

(function () {
  'use strict';

  var App = function () {
    var that = this;

    this._cart = null;
    this._romLoaded = false;
    this._mainboard = null;
    this._renderSurface = null;
    this._fpsMeter = null;
    this._spriteDisplay = null;
    this._paletteDisplay = null;
    this._logWindow = null;
    this._cpuInstructionsWindow = null;
    this._input = null;
    this._encodingTypeToSet = '';
    this._newRomWaiting = false;
    this._newRomLoaded = { name: '', binaryString: null };
    this._eventBus = new Nes.EventBus();

    this._frameTimeTarget = 0;
    this._lastFrameTime = 0;
    this._gameSpeed = 100; // 100% normal speed

    this._isPaused = 0;
    this._pauseNextFrame = false;
    this._pauseOnFrame = -1;

    this._options = {};

    // Mobile performance optimizer
    this._mobileOptimizer = new Gui.MobileOptimizer();

    // Performance monitoring system
    console.log('Initializing performance monitor...', typeof Gui.PerformanceMonitor);
    try {
      if (typeof Gui.PerformanceMonitor === 'function') {
        this._performanceMonitor = new Gui.PerformanceMonitor();
        window.performanceMonitor = this._performanceMonitor; // Global access for debugging
        console.log('Performance monitor initialized successfully');
      } else {
        throw new Error('Gui.PerformanceMonitor is not available');
      }
    } catch (e) {
      console.warn('Performance monitor not available:', e);
      // Create a dummy performance monitor to prevent errors
      this._performanceMonitor = {
        startTiming: function () {},
        endTiming: function () {},
        recordFrame: function () {},
        recordAudioDropout: function () {}
      };
    }

    window.onerror = function (e) {
      that._showError(e);
    };

    // Auto-save SRAM when page is unloaded
    window.addEventListener('beforeunload', function () {
      if (that._mainboard && that._mainboard.cart) {
        that._mainboard.cart.saveSram();
      }
      // Cleanup memory to prevent crashes
      that._cleanup();
    });
  };

  App.prototype.connect = function (name, cb) {
    this._eventBus.connect(name, cb);
  };

  App.prototype.setColourEncodingType = function (encodingType) {
    this._encodingTypeToSet = encodingType;
  };

  App.prototype._loadRomCallback = function (name, binaryString) {
    this._newRomWaiting = true;
    this._newRomLoaded = { name: name, binaryString: binaryString };
    // Single funnel for every ROM source (drag-drop, file picker, Internet
    // Archive browser). Label = filename so GA4 surfaces which titles
    // actually get loaded. Truncated to keep event_label well under GA4's
    // 100-char cap, and the binaryString size goes in `value` so we can
    // sanity-check ROM sizes (NES carts are typically 8 KB – 1 MB).
    if (typeof window !== 'undefined' && window.trackEvent) {
      var label = (typeof name === 'string' ? name : 'unknown').slice(0, 80);
      var sizeKb = binaryString && binaryString.length ? Math.round(binaryString.length / 1024) : 0;
      window.trackEvent('nes_rom_loaded', 'NES', label, sizeKb);
    }
  };

  App.prototype.start = function (options) {
    this._options = options || {};
    this._options.triggerFrameRenderedEvent =
      this._options.triggerFrameRenderedEvent === undefined
        ? false
        : this._options.triggerFrameRenderedEvent;
    this._options.createGuiComponents =
      this._options.createGuiComponents === undefined ? true : this._options.createGuiComponents;

    var that = this;

    if (this._options.createGuiComponents) {
      window.addEventListener(
        'contextmenu',
        function (event) {
          event.preventDefault();
        },
        false
      );

      this._fpsMeter = new FPSMeter(null, { top: '10%', left: '80%' });
      this._fpsMeter.hide();
      Gui.hookDragDropEvents(function (name, binaryString) {
        that._loadRomCallback(name, binaryString);
      });

      this._canvasParent = new Gui.CanvasParent();

      // Connect to canvas resize events to notify other components
      this._canvasParent.connect('resize', function () {
        that._eventBus.invoke('canvasResize');
      });

      this._renderSurface = null;
      if (WebGl.webGlSupported()) {
        console.log('Using WebGL for rendering...');
        this._renderSurface = new Gui.WebGlRenderSurface(this._canvasParent);
      } else {
        console.log('WebGL not supported. Using canvas for rendering...');
        this._renderSurface = new Gui.CanvasRenderSurface(this._canvasParent);
      }
    } else {
      this._renderSurface = new Test.TestRenderSurface();
    }

    this._mainboard = new Nes.mainboard(this._renderSurface);
    this._mainboard.connect('reset', function () {
      that._onReset();
    });

    if (this._options.createGuiComponents) {
      this._ggDialog = new Gui.GameGenieDialog(this);
      this._controlBar = new Gui.ControlBar(this);
      this._controlBar.connect('romLoaded', function (name, binaryString) {
        that._loadRomCallback(name, binaryString);
      });
      this._input = new Gui.Input(this._mainboard);
      this._keyboardRemapDialog = new Gui.KeyboardRemapper(this);
    }

    this._saveStateManager = new Gui.SaveStateManager(this, this._options.createGuiComponents);

    window.setFastTimeout(animateFunction);
    if (this._options.loadUrl) {
      this.loadRomFromUrl(this._options.loadUrl);
    }
    this._animate();
  };

  App.prototype.pause = function (isPaused) {
    var changed = false;

    if (isPaused) {
      changed = this._isPaused === 0;
      this._isPaused = 1;
    } else {
      changed = this._isPaused === 1;
      this._isPaused = 0;
    }

    if (changed) {
      this._eventBus.invoke('isPausedChange', this.isPaused());
    }
  };

  App.prototype.isPaused = function () {
    return this._isPaused > 0;
  };

  App.prototype._onReset = function () {
    this._calculateFrameTimeTarget();
  };

  App.prototype._calculateFrameTimeTarget = function () {
    if (this._gameSpeed > 0) {
      var base = 100000 / this._gameSpeed; // 100000 = 1000 * 100 ( 1000 milliseconds, multiplied by 100 as gameSpeed is a %)
      this._frameTimeTarget = base / COLOUR_ENCODING_REFRESHRATE;
    }
  };

  App.prototype.reset = function () {
    this._mainboard.reset();
  };

  App.prototype.playOneFrame = function () {
    this.pause(false);
    this._pauseNextFrame = true;
  };

  App.prototype.playUntilFrame = function (frameNum) {
    this.pause(false);
    this._pauseOnFrame = frameNum;
  };

  App.prototype.enableSound = function (enable) {
    this._mainboard.enableSound(enable);
  };

  App.prototype.soundEnabled = function () {
    return this._mainboard.apu.soundEnabled();
  };

  App.prototype.soundSupported = function () {
    return this._mainboard.apu.soundSupported();
  };

  App.prototype.setVolume = function (val) {
    this._mainboard.setVolume(val);
  };

  App.prototype.setGameSpeed = function (gameSpeed) {
    this._gameSpeed = gameSpeed;
    this._calculateFrameTimeTarget();
  };

  App.prototype.setTraceOption = function (traceType, checked) {
    this._mainboard.setTraceOption(traceType, checked);
  };

  App.prototype._readyToRender = function () {
    if (this._gameSpeed <= 0) {
      return true;
    }
    var now = performance ? performance.now() : Date.now(); // Date.now() in unsupported browsers
    var diff = now - this._lastFrameTime;
    if (diff >= this._frameTimeTarget) {
      this._lastFrameTime = now;
      return true;
    } else {
      return false;
    }
  };

  App.prototype.showFpsMeter = function (show) {
    if (show) {
      this._fpsMeter.show();
    } else {
      this._fpsMeter.hide();
    }
  };

  App.prototype.startTrace = function () {
    this._eventBus.invoke('traceRunning', true);
    // if ( traceType === 'cpuInstructions' ) {
    this._mainboard.cpu.enableTrace(true);
    // }
    Nes.Trace.start();
  };

  App.prototype.stopTrace = function () {
    Nes.Trace.stop();
    this._mainboard.cpu.enableTrace(false);
    this._eventBus.invoke('traceRunning', false);
  };

  App.prototype.screenshot = function () {
    this._renderSurface.screenshotToFile();
  };

  App.prototype._animate = function () {
    var that = this;

    if (this._newRomWaiting) {
      this._doRomLoad(this._newRomLoaded.name, this._newRomLoaded.binaryString);
      this._newRomWaiting = false;
    }

    if (this._romLoaded) {
      this._romLoaded = false;
      this._mainboard.loadCartridge(this._cart);
      this._eventBus.invoke('cartLoaded', this._cart);
    }

    if (this._encodingTypeToSet.length > 0) {
      setColourEncodingType(this._encodingTypeToSet);
      this._encodingTypeToSet = '';
    }

    if (this._isPaused <= 0) {
      if (this._readyToRender()) {
        if (this._input) {
          this._input.poll();
        }

        // Safety checks to prevent null reference errors
        if (!this._mainboard || !this._mainboard.renderBuffer || !this._renderSurface) {
          return;
        }

        // Dynamic frame skipping: only skip frames on mobile or when performance is poor
        var frameCount = this._mainboard.ppu ? this._mainboard.ppu.frameCounter : 0;
        var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent
        );

        var shouldRender;
        if (isMobile) {
          // Mobile: use frame skipping
          shouldRender = this._mobileOptimizer.shouldSkipFrame(frameCount);
        } else {
          // Desktop: render every frame like original WebNES (unless performance is terrible)
          shouldRender = true;
        }

        if (shouldRender) {
          this._performanceMonitor.startTiming('render');
          var bgColour = this._mainboard.renderBuffer.pickColour(
            this._mainboard.ppu.getBackgroundPaletteIndex()
          );
          this._renderSurface.clearBuffers(bgColour);
          this._mainboard.renderBuffer.clearBuffer();
        }

        // Android optimization: Process audio first, then game logic
        var isAndroid = /Android/i.test(navigator.userAgent);

        this._performanceMonitor.startTiming('audio');
        if (isAndroid) {
          // On Android, prioritize audio processing
          if (this._mainboard.apu && this._mainboard.apu._enabled && this._mainboard.apu._buffers) {
            // Force audio buffer commit before frame processing
            for (var i = 0; i < this._mainboard.apu._buffers.length; i++) {
              var buf = this._mainboard.apu._buffers[i];
              if (buf && buf.commit) {
                buf.commit();
              }
            }
          }
        }
        this._performanceMonitor.endTiming('audio');

        this._performanceMonitor.startTiming('gameLogic');
        this._mainboard.doFrame();
        this._performanceMonitor.endTiming('gameLogic');

        if (shouldRender) {
          this._renderSurface.render(this._mainboard);
          this._performanceMonitor.endTiming('render');
        }

        // Record frame performance
        this._performanceMonitor.recordFrame(!shouldRender);

        // Simple FPS display for debugging and auto-adjustment
        if (frameCount % 60 === 0) {
          // Every 60 frames (1 second)
          var now = performance.now();
          if (this._lastFpsCheck) {
            var actualFPS = 60000 / (now - this._lastFpsCheck);
            // too noisy
            //console.log(
            //  `🎮 Actual FPS: ${actualFPS.toFixed(1)} | Target: ${this._mobileOptimizer.targetFPS} | Frame Skip Level: ${this._mobileOptimizer.frameSkipLevel}`
            //);

            // Auto-adjust target FPS based on actual performance
            if (!this._fpsAdjusted && frameCount > 300) {
              // After 5 seconds of gameplay
              if (actualFPS < 50 && this._mobileOptimizer.targetFPS > actualFPS + 5) {
                this._mobileOptimizer.targetFPS = Math.max(30, Math.floor(actualFPS) + 2);
                console.log(
                  `🎯 Auto-adjusted target FPS to ${this._mobileOptimizer.targetFPS} for smoother audio`
                );
                this._fpsAdjusted = true;
              }
            }
          }
          this._lastFpsCheck = now;
        }

        if (this._options.triggerFrameRenderedEvent && shouldRender) {
          this._eventBus.invoke(
            'frameRendered',
            this._renderSurface,
            this._mainboard.ppu.frameCounter
          );
        }

        if (this._fpsMeter && shouldRender) {
          this._fpsMeter.tick();
        }
      }

      if (this._pauseNextFrame) {
        this._pauseNextFrame = false;
        this.pause(true);
      }

      if (this._pauseOnFrame >= 0 && this._pauseOnFrame === this._mainboard.ppu.frameCounter) {
        this._pauseOnFrame = -1;
        this.pause(true);
      }

      this._saveStateManager.onFrame();

      // Use original WebNES timing: setImmediate for maximum performance
      // Only use mobile optimizations when actually on mobile AND performance is poor
      var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );

      if (isMobile && this._mobileOptimizer.frameSkipLevel > 1) {
        // Only use setTimeout on mobile when performance is actually poor
        var delay = this._mobileOptimizer.getAnimationDelay();
        setTimeout(animateFunction, delay);
      } else {
        // Use original high-performance timing for desktop and good mobile performance
        if (typeof setImmediate !== 'undefined') {
          setImmediate(animateFunction);
        } else {
          // Fallback to requestAnimationFrame if setImmediate not available
          requestAnimationFrame(animateFunction);
        }
      }

      // Update performance metrics for adaptive optimization
      var now = performance ? performance.now() : Date.now();
      var frameTime = now - this._lastFrameTime;
      this._mobileOptimizer.updatePerformance(frameTime);

      // Memory leak prevention: more aggressive garbage collection
      if (this._mainboard && this._mainboard.ppu) {
        var frameCount = this._mainboard.ppu.frameCounter;

        // Force GC every 10 seconds during heavy memory usage
        if (frameCount % 600 === 0 && window.gc) {
          window.gc();
        }

        // Emergency cleanup every 30 seconds if memory monitor detects issues
        if (frameCount % 1800 === 0 && window.memoryMonitor) {
          var currentMemory = performance.memory ? performance.memory.usedJSHeapSize : 0;
          var memoryLimitMB = performance.memory
            ? performance.memory.jsHeapSizeLimit / (1024 * 1024)
            : 4096;
          var currentMemoryMB = currentMemory / (1024 * 1024);

          if (currentMemoryMB > memoryLimitMB * 0.6) {
            // If using >60% of available memory
            console.warn('High memory usage detected, triggering cleanup...');
            window.memoryMonitor.emergencyCleanup();
          }
        }
      }
    } else {
      setTimeout(animateFunction, 300);
    }
  };

  App.prototype._doRomLoad = function (name, binaryString) {
    var that = this;
    this._cart = new Nes.cartridge(this._mainboard);
    this._cart.loadRom(name, binaryString, function (err) {
      if (!err) {
        that._romLoaded = true;
      } else {
        that._showError(err);
      }
    });
  };

  App.prototype.loadRomFromUrl = function (url) {
    var that = this;
    Nes.loadRomFromUrl(url, function (err, name, binary) {
      if (!err) {
        that._loadRomCallback(name, binary);
      } else {
        that._showError(err);
      }
    });
  };

  App.prototype._showError = function (err) {
    console.log(err);
    var errorType = typeof err;
    var msg = '';
    if (errorType === 'string') {
      msg = err;
    } else if (errorType === 'object') {
      if (err.message) {
        msg = err.message;
      } else {
        msg = err.toString();
      }
    } else {
      msg = err.toString();
    }
    this._eventBus.invoke('romLoadFailure', msg);
  };

  App.prototype.gameGenieCode = function (code) {
    Nes.processGameGenieCode(this._mainboard, code, true);
  };

  App.prototype.loadShaderFromUrl = function (url) {
    if (this._renderSurface.loadShaderFromUrl) {
      this._renderSurface.loadShaderFromUrl(url);
    }
  };

  App.prototype._cleanup = function () {
    console.log('Cleaning up NES emulator resources...');

    // DON'T null critical objects that are still being used
    // Just clear large arrays and buffers
    if (
      this._mainboard &&
      this._mainboard.renderBuffer &&
      this._mainboard.renderBuffer.priorityBuffer
    ) {
      this._mainboard.renderBuffer.priorityBuffer.fill(0);
    }

    // Force garbage collection if available
    if (window.gc) {
      window.gc();
    }

    console.log('NES emulator cleanup completed');
  };

  Gui.App = new App();
})();

animateFunction = function () {
  Gui.App._animate();
};
