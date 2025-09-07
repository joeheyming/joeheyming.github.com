/*
Memory monitoring utility for debugging Chrome crashes
*/

this.Debug = this.Debug || {};

(function () {
  'use strict';

  var MemoryMonitor = function () {
    this.startTime = performance.now();
    this.samples = [];
    this.isMonitoring = false;
    this.intervalId = null;
  };

  MemoryMonitor.prototype.start = function () {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    var that = this;

    this.intervalId = setInterval(function () {
      that.sample();
    }, 1000); // Sample every second

    console.log('Memory monitoring started');
  };

  MemoryMonitor.prototype.stop = function () {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('Memory monitoring stopped');
    this.report();
  };

  MemoryMonitor.prototype.sample = function () {
    if (!performance.memory) {
      console.warn('performance.memory not available');
      return;
    }

    var sample = {
      timestamp: performance.now() - this.startTime,
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
    };

    this.samples.push(sample);

    // Log warning if memory usage is high
    var usedMB = sample.usedJSHeapSize / (1024 * 1024);
    var limitMB = sample.jsHeapSizeLimit / (1024 * 1024);
    var percentUsed = (usedMB / limitMB) * 100;

    if (percentUsed > 80) {
      console.warn(
        'High memory usage detected:',
        usedMB.toFixed(2) + 'MB (' + percentUsed.toFixed(1) + '%)'
      );
    }

    // EMERGENCY: Pause emulator if memory usage is critical
    if (percentUsed > 20 && window.Gui && window.Gui.App) {
      console.error('🚨 CRITICAL MEMORY! Pausing emulator for 2 seconds...');
      window.Gui.App.pause(true);
      setTimeout(function () {
        if (window.Gui && window.Gui.App) {
          window.Gui.App.pause(false);
          console.log('Emulator resumed after emergency pause');
        }
      }, 2000);
    }

    // Detect memory leaks (continuous growth)
    if (this.samples.length > 10) {
      var recent = this.samples.slice(-10);
      var isGrowing = recent.every((sample, i) => {
        return i === 0 || sample.usedJSHeapSize >= recent[i - 1].usedJSHeapSize;
      });

      if (isGrowing) {
        var growthRate =
          (recent[recent.length - 1].usedJSHeapSize - recent[0].usedJSHeapSize) / (1024 * 1024);

        // Only warn about significant leaks (>5MB/9s) to reduce noise
        if (growthRate > 5) {
          console.warn('🚨 MEMORY LEAK DETECTED! 🚨');
          console.warn('Continuous growth over 10 samples');
          console.warn(
            'Growth rate: +' +
              growthRate.toFixed(2) +
              'MB in ' +
              ((recent[recent.length - 1].timestamp - recent[0].timestamp) / 1000).toFixed(1) +
              's'
          );
          console.warn(
            'Current usage: ' + usedMB.toFixed(2) + 'MB (' + percentUsed.toFixed(1) + '% of limit)'
          );
        } else {
          // Just log minor growth quietly
          console.log(
            'Minor memory growth: +' + growthRate.toFixed(2) + 'MB/9s (normal JS overhead)'
          );
        }

        // Trigger emergency cleanup much more aggressively
        if (percentUsed > 15) {
          // Trigger at 15% instead of 90%
          console.error('🔥 HIGH MEMORY USAGE DETECTED! Attempting emergency cleanup...');
          this.emergencyCleanup();
        }
      }
    }
  };

  MemoryMonitor.prototype.report = function () {
    if (this.samples.length === 0) return;

    var first = this.samples[0];
    var last = this.samples[this.samples.length - 1];
    var maxUsed = Math.max(...this.samples.map((s) => s.usedJSHeapSize));

    console.log('=== Memory Usage Report ===');
    console.log('Duration:', (last.timestamp / 1000).toFixed(1) + 's');
    console.log('Initial memory:', (first.usedJSHeapSize / (1024 * 1024)).toFixed(2) + 'MB');
    console.log('Final memory:', (last.usedJSHeapSize / (1024 * 1024)).toFixed(2) + 'MB');
    console.log('Peak memory:', (maxUsed / (1024 * 1024)).toFixed(2) + 'MB');
    console.log(
      'Memory growth:',
      ((last.usedJSHeapSize - first.usedJSHeapSize) / (1024 * 1024)).toFixed(2) + 'MB'
    );
    console.log('Heap limit:', (last.jsHeapSizeLimit / (1024 * 1024)).toFixed(2) + 'MB');

    // Export data for analysis
    window.memoryData = this.samples;
    console.log('Raw data available in window.memoryData');
  };

  MemoryMonitor.prototype.forceGC = function () {
    if (window.gc) {
      console.log('Forcing garbage collection...');
      window.gc();
    } else {
      console.warn('Garbage collection not available. Start Chrome with --js-flags="--expose-gc"');
    }
  };

  MemoryMonitor.prototype.emergencyCleanup = function () {
    console.log('🚨 Emergency cleanup initiated...');

    // Force multiple garbage collection cycles
    this.forceGC();
    setTimeout(() => this.forceGC(), 100);
    setTimeout(() => this.forceGC(), 500);

    // Try gentle cleanup without breaking the emulator
    if (window.Gui && window.Gui.App && window.Gui.App._cleanup) {
      window.Gui.App._cleanup();
    }

    console.log('Emergency cleanup completed');
  };

  Debug.MemoryMonitor = MemoryMonitor;
})();

// Auto-start monitoring if in debug mode
if (window.location.search.includes('debug=memory')) {
  window.memoryMonitor = new Debug.MemoryMonitor();
  window.memoryMonitor.start();

  // Stop monitoring on page unload
  window.addEventListener('beforeunload', function () {
    window.memoryMonitor.stop();
  });

  // Add debug controls to the page
  setTimeout(function () {
    var debugPanel = document.createElement('div');
    debugPanel.style.cssText =
      'position:fixed;top:10px;left:10px;background:rgba(0,0,0,0.8);color:white;padding:10px;border-radius:5px;z-index:9999;font-family:monospace;font-size:12px;';
    debugPanel.innerHTML = `
      <div>🔍 Memory Debug Panel</div>
      <button onclick="window.memoryMonitor.forceGC()" style="margin:5px;padding:5px;background:yellow;">Force GC</button>
      <button onclick="window.memoryMonitor.emergencyCleanup()" style="margin:5px;padding:5px;background:red;color:white;">🚨 EMERGENCY CLEANUP</button>
      <button onclick="console.log('Current memory:', (performance.memory.usedJSHeapSize/(1024*1024)).toFixed(2) + 'MB')" style="margin:5px;padding:5px;background:lightblue;">Check Memory</button>
      <button onclick="if(window.Gui && window.Gui.App) window.Gui.App.pause(true); setTimeout(() => {if(window.Gui && window.Gui.App) window.Gui.App.pause(false)}, 2000);" style="margin:5px;padding:5px;background:orange;">Pause 2s</button>
    `;
    document.body.appendChild(debugPanel);
  }, 1000);
}
