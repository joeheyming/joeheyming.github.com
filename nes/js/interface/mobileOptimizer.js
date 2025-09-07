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

var MobileOptimizer = function () {
  this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
  this.isAndroid = /Android/i.test(navigator.userAgent);
  this.performanceHistory = [];

  // Start with more aggressive frame skipping on Android
  this.frameSkipLevel = this.isAndroid ? 2 : 1;

  // Frame rate options
  this.targetFPS = 60;
  this.allowDynamicFPS = true; // Allow reducing target FPS for better audio

  // Larger audio buffers for Android devices
  if (this.isAndroid) {
    this.audioBufferSize = 16384; // 4x larger for Android
  } else if (this.isMobile) {
    this.audioBufferSize = 8192; // 2x larger for other mobile
  } else {
    this.audioBufferSize = 4096; // Desktop default
  }

  this.lastFrameTime = 0;
  this.targetFrameTime = this.isAndroid ? 20 : 16.67; // More relaxed target for Android
  this.adaptiveSkipping = true;
};

MobileOptimizer.prototype.shouldSkipFrame = function (frameCount) {
  if (!this.isMobile) {
    return frameCount % 2 === 0; // Desktop: render every other frame
  }

  // Mobile: Dynamic frame skipping based on performance
  switch (this.frameSkipLevel) {
    case 1:
      return frameCount % 2 === 0; // Skip every other frame
    case 2:
      return frameCount % 3 === 0; // Skip 2 out of 3 frames
    case 3:
      return frameCount % 4 === 0; // Skip 3 out of 4 frames
    default:
      return frameCount % 2 === 0;
  }
};

MobileOptimizer.prototype.updatePerformance = function (frameTime) {
  if (!this.isMobile || !this.adaptiveSkipping) return;

  this.performanceHistory.push(frameTime);

  // Keep only last 60 frame times (1 second at 60fps)
  if (this.performanceHistory.length > 60) {
    this.performanceHistory.shift();
  }

  // Adjust frame skipping every 30 frames
  if (this.performanceHistory.length >= 30 && this.performanceHistory.length % 30 === 0) {
    var avgFrameTime =
      this.performanceHistory.reduce((a, b) => a + b, 0) / this.performanceHistory.length;

    if (avgFrameTime > this.targetFrameTime * 1.5) {
      // Performance is poor, try reducing FPS first, then increase frame skipping
      if (!this.reduceFPS() && this.frameSkipLevel < 3) {
        this.frameSkipLevel = Math.min(3, this.frameSkipLevel + 1);
        console.log('Mobile: Increased frame skipping to level', this.frameSkipLevel);
      }
    } else if (avgFrameTime < this.targetFrameTime * 1.1) {
      // Performance is good, try increasing FPS first, then reduce frame skipping
      if (this.targetFPS < 60) {
        this.increaseFPS();
      } else if (this.frameSkipLevel > 1) {
        this.frameSkipLevel = Math.max(1, this.frameSkipLevel - 1);
        console.log('Mobile: Reduced frame skipping to level', this.frameSkipLevel);
      }
    }
  }
};

MobileOptimizer.prototype.getOptimalAudioBufferSize = function () {
  return this.audioBufferSize;
};

MobileOptimizer.prototype.shouldUseAggressiveGC = function (frameCount) {
  if (!this.isMobile) return false;

  // More frequent GC on mobile
  return frameCount % 300 === 0; // Every 5 seconds at 60fps
};

MobileOptimizer.prototype.getAnimationDelay = function () {
  if (!this.isMobile) return 0; // Use requestAnimationFrame

  // Calculate delay based on target FPS and frame skip level
  var targetInterval = 1000 / this.targetFPS;

  // Android: Use longer intervals to reduce CPU pressure
  if (this.isAndroid) {
    // More aggressive timing for Android - prioritize audio over visual smoothness
    return Math.max(12, targetInterval * 0.8); // At least 12ms, but scale with target FPS
  } else {
    // Other mobile: Use shorter setTimeout intervals for better audio timing
    return Math.max(8, targetInterval * 0.6); // At least 8ms, but scale with target FPS
  }
};

MobileOptimizer.prototype.reduceFPS = function () {
  if (this.allowDynamicFPS && this.targetFPS > 30) {
    this.targetFPS = Math.max(30, this.targetFPS - 10);
    console.log(`📉 Reduced target FPS to ${this.targetFPS} for better audio performance`);
    return true;
  }
  return false;
};

MobileOptimizer.prototype.increaseFPS = function () {
  if (this.allowDynamicFPS && this.targetFPS < 60) {
    this.targetFPS = Math.min(60, this.targetFPS + 10);
    console.log(`📈 Increased target FPS to ${this.targetFPS}`);
    return true;
  }
  return false;
};

Gui.MobileOptimizer = MobileOptimizer;
