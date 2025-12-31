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

var PerformanceMonitor = function () {
  this.enabled = false;
  this.overlay = null;
  this.metrics = {
    frameTime: [],
    audioLatency: [],
    cpuUsage: [],
    memoryUsage: [],
    frameSkips: 0,
    audioDropouts: 0,
    totalFrames: 0,
    renderTime: [],
    audioTime: [],
    gameLogicTime: []
  };

  this.startTime = performance.now();
  this.lastFrameTime = this.startTime;
  this.maxHistoryLength = 300; // Keep 5 seconds of data at 60fps

  // Timing markers
  this.timingMarkers = {};

  // Delay overlay creation until DOM is ready
  if (document.body) {
    this.createOverlay();
  } else {
    var self = this;
    document.addEventListener('DOMContentLoaded', function () {
      self.createOverlay();
    });
  }
};

PerformanceMonitor.prototype.createOverlay = function () {
  // Check if DOM is ready
  if (!document.body) {
    console.warn('Cannot create performance overlay - document.body not ready');
    return;
  }

  // Create performance overlay
  this.overlay = document.createElement('div');
  this.overlay.id = 'performanceOverlay';
  this.overlay.style.cssText = `
    position: fixed;
    top: 60px;
    right: 10px;
    width: 300px;
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.9);
    color: #00ff00;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    padding: 10px;
    border-radius: 5px;
    border: 1px solid #333;
    z-index: 9999;
    display: none;
    line-height: 1.4;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  `;

  document.body.appendChild(this.overlay);

  // Add performance monitor option to hamburger menu instead of floating button
  this.addToHamburgerMenu();
};

PerformanceMonitor.prototype.addToHamburgerMenu = function () {
  // Wait for the hamburger menu to be created
  var self = this;
  var attempts = 0;
  var maxAttempts = 50; // 5 seconds max wait

  var addMenuItem = function () {
    attempts++;

    // Look for the hamburger menu dropdown
    var hamburgerMenu = document.querySelector('#hamburgerDropdown');
    if (!hamburgerMenu && attempts < maxAttempts) {
      setTimeout(addMenuItem, 100);
      return;
    }

    if (hamburgerMenu) {
      // Create performance monitor menu item
      var menuItem = document.createElement('button');
      menuItem.textContent = '📊 Performance Monitor';
      menuItem.className =
        'block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors duration-200';
      menuItem.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.toggle();
        // Close the hamburger menu by adding 'hidden' class
        hamburgerMenu.classList.add('hidden');
      };

      // Add separator line before our menu item
      var separator = document.createElement('div');
      separator.className = 'border-t border-gray-200 my-1';
      hamburgerMenu.appendChild(separator);

      // Add it to the menu (after the existing items)
      hamburgerMenu.appendChild(menuItem);
      console.log('Performance Monitor added to hamburger menu');
    } else {
      console.warn('Could not find hamburger menu to add Performance Monitor');
      // Fallback: create a simple floating button
      self.createFallbackButton();
    }
  };

  addMenuItem();
};

PerformanceMonitor.prototype.createFallbackButton = function () {
  // Fallback floating button if hamburger menu not found
  var toggleBtn = document.createElement('button');
  toggleBtn.textContent = '📊';
  toggleBtn.title = 'Performance Monitor';
  toggleBtn.style.cssText = `
    position: fixed;
    top: 60px;
    right: 10px;
    z-index: 10001;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    border: 1px solid #666;
    padding: 8px;
    border-radius: 50%;
    font-size: 16px;
    cursor: pointer;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  toggleBtn.onclick = this.toggle.bind(this);
  document.body.appendChild(toggleBtn);
};

PerformanceMonitor.prototype.toggle = function () {
  // Create overlay if it doesn't exist yet
  if (!this.overlay && document.body) {
    this.createOverlay();
  }

  if (!this.overlay) {
    console.warn('Cannot toggle performance monitor - overlay not created');
    return;
  }

  this.enabled = !this.enabled;
  this.overlay.style.display = this.enabled ? 'block' : 'none';

  if (this.enabled) {
    console.log('Performance Monitor enabled - collecting metrics...');
    this.startProfiling();
  } else {
    console.log('Performance Monitor disabled');
    this.stopProfiling();
  }
};

PerformanceMonitor.prototype.startProfiling = function () {
  // Start collecting detailed performance data
  if (window.performance && window.performance.mark) {
    window.performance.mark('nes-profiling-start');
  }
};

PerformanceMonitor.prototype.stopProfiling = function () {
  if (window.performance && window.performance.mark) {
    window.performance.mark('nes-profiling-end');
    window.performance.measure('nes-total-time', 'nes-profiling-start', 'nes-profiling-end');
  }
};

PerformanceMonitor.prototype.startTiming = function (label) {
  if (!this.enabled) return;
  this.timingMarkers[label] = performance.now();
};

PerformanceMonitor.prototype.endTiming = function (label) {
  if (!this.enabled || !this.timingMarkers[label]) return;

  var duration = performance.now() - this.timingMarkers[label];
  delete this.timingMarkers[label];

  // Store timing data
  switch (label) {
    case 'render':
      this.addMetric('renderTime', duration);
      break;
    case 'audio':
      this.addMetric('audioTime', duration);
      break;
    case 'gameLogic':
      this.addMetric('gameLogicTime', duration);
      break;
  }

  return duration;
};

PerformanceMonitor.prototype.addMetric = function (type, value) {
  if (!this.enabled) return;

  if (!this.metrics[type]) {
    this.metrics[type] = [];
  }

  this.metrics[type].push(value);

  // Keep history limited
  if (this.metrics[type].length > this.maxHistoryLength) {
    this.metrics[type].shift();
  }
};

PerformanceMonitor.prototype.recordFrame = function (frameSkipped) {
  if (!this.enabled) return;

  var now = performance.now();
  var frameTime = now - this.lastFrameTime;
  this.lastFrameTime = now;

  this.addMetric('frameTime', frameTime);
  this.metrics.totalFrames++;

  if (frameSkipped) {
    this.metrics.frameSkips++;
  }

  // Record memory usage if available
  if (performance.memory) {
    this.addMetric('memoryUsage', performance.memory.usedJSHeapSize / 1024 / 1024);
  }

  this.updateOverlay();
};

PerformanceMonitor.prototype.recordAudioDropout = function () {
  if (!this.enabled) return;
  this.metrics.audioDropouts++;
};

PerformanceMonitor.prototype.getAverageMetric = function (type) {
  if (!this.metrics[type] || this.metrics[type].length === 0) return 0;
  return this.metrics[type].reduce((a, b) => a + b, 0) / this.metrics[type].length;
};

PerformanceMonitor.prototype.getMaxMetric = function (type) {
  if (!this.metrics[type] || this.metrics[type].length === 0) return 0;
  return Math.max(...this.metrics[type]);
};

PerformanceMonitor.prototype.getMinMetric = function (type) {
  if (!this.metrics[type] || this.metrics[type].length === 0) return 0;
  return Math.min(...this.metrics[type]);
};

PerformanceMonitor.prototype.updateOverlay = function () {
  if (!this.enabled) return;

  // Create overlay if it doesn't exist yet
  if (!this.overlay && document.body) {
    this.createOverlay();
  }

  if (!this.overlay) return;

  var avgFrameTime = this.getAverageMetric('frameTime');
  var maxFrameTime = this.getMaxMetric('frameTime');
  var avgRenderTime = this.getAverageMetric('renderTime');
  var avgAudioTime = this.getAverageMetric('audioTime');
  var avgGameLogicTime = this.getAverageMetric('gameLogicTime');
  var avgMemory = this.getAverageMetric('memoryUsage');

  var fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
  var frameSkipRate =
    this.metrics.totalFrames > 0 ? (this.metrics.frameSkips / this.metrics.totalFrames) * 100 : 0;

  var html = `
    <div style="color: #00ff00; font-weight: bold; margin-bottom: 5px;">🎮 NES Performance Monitor</div>
    
    <div style="color: #ffff00;">📊 Frame Performance:</div>
    FPS: ${fps.toFixed(1)} (target: 60.0)
    Avg Frame Time: ${avgFrameTime.toFixed(2)}ms
    Max Frame Time: ${maxFrameTime.toFixed(2)}ms
    Frame Skip Rate: ${frameSkipRate.toFixed(1)}%
    
    <div style="color: #ffff00; margin-top: 8px;">⏱️ Component Timing:</div>
    Render Time: ${avgRenderTime.toFixed(2)}ms
    Audio Time: ${avgAudioTime.toFixed(2)}ms
    Game Logic: ${avgGameLogicTime.toFixed(2)}ms
    
    <div style="color: #ffff00; margin-top: 8px;">🔊 Audio Performance:</div>
    Audio Dropouts: ${this.metrics.audioDropouts}
    Audio Latency: ${this.getAverageMetric('audioLatency').toFixed(2)}ms
    
    <div style="color: #ffff00; margin-top: 8px;">💾 Memory Usage:</div>
    Current: ${avgMemory.toFixed(1)}MB
    Max: ${this.getMaxMetric('memoryUsage').toFixed(1)}MB
    
    <div style="color: #ffff00; margin-top: 8px;">📈 Totals:</div>
    Total Frames: ${this.metrics.totalFrames}
    Runtime: ${((performance.now() - this.startTime) / 1000).toFixed(1)}s
    
    <div style="color: #ff6666; margin-top: 8px; font-size: 10px;">
    Press F12 → Console for detailed logs<br/>
    Console commands:<br/>
    • performanceMonitor.setTargetFPS(30) - Reduce FPS<br/>
    • performanceMonitor.setTargetFPS(60) - Restore FPS<br/>
    <button onclick="window.performanceMonitor.quickFixAudio()" style="margin-top:5px;padding:3px 6px;background:#ff6666;color:white;border:none;border-radius:3px;font-size:10px;cursor:pointer;">🔧 Quick Fix Audio</button>
    </div>
  `;

  this.overlay.innerHTML = html;
};

PerformanceMonitor.prototype.exportMetrics = function () {
  var report = {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    runtime: (performance.now() - this.startTime) / 1000,
    summary: {
      avgFPS:
        this.getAverageMetric('frameTime') > 0 ? 1000 / this.getAverageMetric('frameTime') : 0,
      avgFrameTime: this.getAverageMetric('frameTime'),
      maxFrameTime: this.getMaxMetric('frameTime'),
      frameSkipRate:
        this.metrics.totalFrames > 0
          ? (this.metrics.frameSkips / this.metrics.totalFrames) * 100
          : 0,
      avgRenderTime: this.getAverageMetric('renderTime'),
      avgAudioTime: this.getAverageMetric('audioTime'),
      avgGameLogicTime: this.getAverageMetric('gameLogicTime'),
      audioDropouts: this.metrics.audioDropouts,
      avgMemoryUsage: this.getAverageMetric('memoryUsage'),
      maxMemoryUsage: this.getMaxMetric('memoryUsage')
    },
    rawMetrics: this.metrics
  };

  console.log('📊 Performance Report:', report);

  // Also create downloadable JSON
  var blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = `nes-performance-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  return report;
};

PerformanceMonitor.prototype.setTargetFPS = function (fps) {
  if (window.Gui && window.Gui.App && window.Gui.App._mobileOptimizer) {
    window.Gui.App._mobileOptimizer.targetFPS = fps;
    console.log(`🎯 Target FPS set to ${fps}`);
  } else {
    console.warn('Mobile optimizer not available');
  }
};

PerformanceMonitor.prototype.quickFixAudio = function () {
  // Get recent average FPS
  var recentFrameTimes = this.metrics.frameTime.slice(-60); // Last 60 frames
  if (recentFrameTimes.length > 10) {
    var avgFrameTime = recentFrameTimes.reduce((a, b) => a + b, 0) / recentFrameTimes.length;
    var avgFPS = 1000 / avgFrameTime;

    if (avgFPS < 50) {
      // Set target FPS to slightly above actual performance
      var newTargetFPS = Math.max(30, Math.floor(avgFPS) + 2);
      this.setTargetFPS(newTargetFPS);
      console.log(
        `🔧 Quick Fix: Reduced target FPS from 60 to ${newTargetFPS} based on actual performance (${avgFPS.toFixed(
          1
        )} FPS)`
      );
      alert(
        `Audio Quick Fix Applied!\nTarget FPS reduced to ${newTargetFPS} to match your device's performance.\nAudio should now be smoother.`
      );
    } else {
      console.log(
        `🔧 Quick Fix: Performance looks good (${avgFPS.toFixed(1)} FPS), no adjustment needed`
      );
      alert(
        `Performance looks good!\nYour device is running at ${avgFPS.toFixed(
          1
        )} FPS.\nIf audio is still choppy, try reducing buffer size or closing other applications.`
      );
    }
  } else {
    console.log('🔧 Quick Fix: Not enough performance data yet, please wait a few seconds');
    alert('Not enough performance data yet.\nPlease play for a few more seconds, then try again.');
  }
};

// Add keyboard shortcut to export metrics
document.addEventListener('keydown', function (e) {
  if (e.ctrlKey && e.shiftKey && e.key === 'P') {
    if (window.performanceMonitor) {
      window.performanceMonitor.exportMetrics();
    }
  }
});

Gui.PerformanceMonitor = PerformanceMonitor;

// Debug: Verify the performance monitor loaded
console.log('Performance Monitor loaded successfully');
