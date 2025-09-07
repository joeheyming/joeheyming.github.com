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

('use strict');

var WebAudioBuffer = function (audioContext, masterVolNode, size) {
  this._locked = false;
  this.audioContext = audioContext;
  this._size = size;

  this.audioNode = null;
  this._gainNode = this.audioContext['createGain']();
  this._gainNode['connect'](masterVolNode);

  this.audioBuffer = this.audioContext['createBuffer'](1, size, this.audioContext['sampleRate']);

  // Android optimization: Use ScriptProcessorNode for continuous audio
  var isAndroid = /Android/i.test(navigator.userAgent);
  this._useScriptProcessor = isAndroid;
  this._scriptProcessor = null;
  this._audioData = new Float32Array(size);
  this._writeIndex = 0;
  this._readIndex = 0;
};

WebAudioBuffer.prototype.lockBuffer = function () {
  this._locked = true;
  return this.audioBuffer['getChannelData'](0);
};

WebAudioBuffer.prototype.unlockBuffer = function () {
  this._locked = false;

  if (this._useScriptProcessor) {
    // Android: Use ScriptProcessorNode for continuous audio stream
    this._setupScriptProcessor();
  } else {
    // iOS/Desktop: Use BufferSource method
    this._setupBufferSource();
  }
};

WebAudioBuffer.prototype._setupScriptProcessor = function () {
  if (!this._scriptProcessor) {
    try {
      // Create ScriptProcessorNode for continuous audio
      this._scriptProcessor = this.audioContext.createScriptProcessor(4096, 0, 1);

      var audioData = this.audioBuffer.getChannelData(0);
      var dataIndex = 0;

      this._scriptProcessor.onaudioprocess = function (event) {
        var output = event.outputBuffer.getChannelData(0);

        // Copy audio data to output buffer
        for (var i = 0; i < output.length; i++) {
          if (dataIndex < audioData.length) {
            output[i] = audioData[dataIndex++];
          } else {
            output[i] = 0; // Silence when no more data
            dataIndex = 0; // Loop for continuous playback
          }
        }
      };

      this._scriptProcessor.connect(this._gainNode);
    } catch (e) {
      console.warn('ScriptProcessor setup failed, falling back to BufferSource:', e);
      this._useScriptProcessor = false;
      this._setupBufferSource();
    }
  }
};

WebAudioBuffer.prototype._setupBufferSource = function () {
  // Mobile optimization: Reuse audio nodes when possible to reduce GC pressure
  var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

  if (this.audioNode) {
    try {
      this.audioNode['disconnect']();
    } catch (e) {
      // Ignore disconnect errors on mobile
    }
    this.audioNode = null;
  }

  try {
    this.audioNode = this.audioContext['createBufferSource']();
    this.audioNode['buffer'] = this.audioBuffer;

    // Mobile optimization: Add error handling for audio context issues
    if (isMobile) {
      this.audioNode.onended = function () {
        // Clean up reference to prevent memory leaks
        this.audioNode = null;
      }.bind(this);
    }

    this.audioNode['connect'](this._gainNode);
    this.audioNode['start'](0);

    // Track audio dropouts for performance monitoring
    this.audioNode.onended = function () {
      if (window.performanceMonitor) {
        window.performanceMonitor.recordAudioDropout();
      }
    };
  } catch (e) {
    console.warn('Audio playback error (mobile):', e);
    if (window.performanceMonitor) {
      window.performanceMonitor.recordAudioDropout();
    }
    // Continue without audio rather than crashing
  }
};

////////////////////////////////////////////////////////////////////////////////////////

var WebAudioRenderer = function (bufferSize, sampleRate) {
  window.AudioContext = window.AudioContext || window.webkitAudioContext;
  if (window.AudioContext === undefined) {
    throw new Error('WebAudio not supported in this browser');
  }
  this.audioContext = new window.AudioContext();

  // Mobile optimization: Set lower latency hint for better performance
  var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
  var isSamsung = /Samsung/i.test(navigator.userAgent);

  if (isMobile && this.audioContext.audioWorklet) {
    // Use lower latency settings for mobile when supported
    this.audioContext.latencyHint = 'playback';
  }

  // Samsung-specific optimizations
  if (isSamsung) {
    console.log('Samsung device detected - applying audio optimizations');
    // Force audio context to interactive mode for Samsung devices
    if (this.audioContext.latencyHint !== undefined) {
      this.audioContext.latencyHint = 'interactive';
    }
  }

  this._gainNode = this.audioContext['createGain']();
  this._gainNode['connect'](this.audioContext['destination']);

  // Mobile-specific: Resume audio context on user interaction
  if (isMobile && this.audioContext.state === 'suspended') {
    var resumeAudio = function () {
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
    }.bind(this);

    document.addEventListener('touchstart', resumeAudio, { once: true });
    document.addEventListener('touchend', resumeAudio, { once: true });
    document.addEventListener('click', resumeAudio, { once: true });
  }
};

WebAudioRenderer.prototype.setVolume = function (val) {
  if (this._gainNode) {
    this._gainNode['gain']['value'] = val / 100;
  }
};

WebAudioRenderer.prototype.getSampleRate = function () {
  return this.audioContext['sampleRate'];
};

WebAudioRenderer.prototype.createBuffer = function (size) {
  return new WebAudioBuffer(this.audioContext, this._gainNode, size);
};

Gui.WebAudioRenderer = WebAudioRenderer;
