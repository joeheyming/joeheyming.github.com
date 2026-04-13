// debug command - debugging utilities

import { commandRegistry } from '../../commands.js';

function debugHandler(terminal, args) {
  const subcommand = args[0] || 'status';
  const flags = {
    verbose: args.includes('-v') || args.includes('--verbose'),
    help: args.includes('-h') || args.includes('--help')
  };

  if (flags.help) {
    return `debug - debugging utilities

Usage: debug [subcommand] [options]

Subcommands:
  status          Show debug status and information (default)
  terminal        Debug terminal state and configuration
  storage         Debug storage and filesystem state
  performance     Show performance metrics
  console         Enable/disable console debugging
  clear           Clear debug logs and reset state
  test            Run system tests

Options:
  -v, --verbose   Show detailed debug information
  -h, --help      Show this help message

Examples:
  debug                    Show debug status
  debug terminal -v        Show detailed terminal debug info
  debug storage            Show storage debug information
  debug performance        Show performance metrics`;
  }

  switch (subcommand) {
    case 'status':
      return debugStatus(terminal, flags);
    case 'terminal':
      return debugTerminal(terminal, flags);
    case 'storage':
      return debugStorage(terminal, flags);
    case 'performance':
      return debugPerformance(terminal, flags);
    case 'console':
      return debugConsole(terminal, args);
    case 'clear':
      return debugClear(terminal, flags);
    case 'test':
      return debugTest(terminal, flags);
    default:
      return `Unknown debug subcommand: ${subcommand}\nUse 'debug --help' for available commands.`;
  }
}

export default {
  name: 'debug',
  handler: debugHandler,
  description: 'debugging utilities and system diagnostics',
  category: 'System'
};

function debugStatus(terminal, flags) {
  let output = '🔍 Debug Status\n';
  output += '═'.repeat(40) + '\n\n';

  // System status
  output += '📊 System Status:\n';
  output += `   Terminal Active: ${terminal ? '✅ Yes' : '❌ No'}\n`;
  output += `   Debug Mode: ${
    localStorage.getItem('debug_enabled') === 'true' ? '✅ Enabled' : '❌ Disabled'
  }\n`;
  output += `   Console Logging: ${console.debug ? '✅ Available' : '❌ Not Available'}\n`;
  output += `   Error Tracking: ${window.onerror ? '✅ Active' : '❌ Inactive'}\n\n`;

  // Browser info
  output += '🌐 Browser Environment:\n';
  output += `   User Agent: ${navigator.userAgent.substring(0, 60)}...\n`;
  output += `   JavaScript: ${typeof window !== 'undefined' ? '✅ Enabled' : '❌ Disabled'}\n`;
  output += `   Local Storage: ${
    typeof Storage !== 'undefined' ? '✅ Available' : '❌ Not Available'
  }\n`;
  output += `   IndexedDB: ${
    typeof window.indexedDB !== 'undefined' ? '✅ Available' : '❌ Not Available'
  }\n\n`;

  // Memory usage (if available)
  if (performance.memory) {
    output += '💾 Memory Usage:\n';
    output += `   Used: ${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB\n`;
    output += `   Total: ${(performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB\n`;
    output += `   Limit: ${(performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)} MB\n\n`;
  }

  if (flags.verbose) {
    output += '🔧 Verbose Information:\n';
    output += `   Window Object: ${typeof window}\n`;
    output += `   Document Ready: ${document.readyState}\n`;
    output += `   Page Load Time: ${performance.now().toFixed(2)}ms\n`;
    output += `   Screen Resolution: ${screen.width}x${screen.height}\n`;
    output += `   Color Depth: ${screen.colorDepth}-bit\n`;
  }

  return output;
}

function debugTerminal(terminal, flags) {
  let output = '🖥️  Terminal Debug Information\n';
  output += '═'.repeat(40) + '\n\n';

  if (!terminal) {
    return output + '❌ Terminal object not available\n';
  }

  output += '📋 Terminal State:\n';
  output += `   Current Directory: ${terminal.currentDirectory || 'Not set'}\n`;
  output += `   Command History: ${
    terminal.commandHistory ? terminal.commandHistory.length : 0
  } entries\n`;
  output += `   Environment Variables: ${
    terminal.environment ? Object.keys(terminal.environment).length : 0
  } vars\n`;
  output += `   Aliases: ${
    terminal.aliases ? Object.keys(terminal.aliases).length : 0
  } aliases\n\n`;

  if (flags.verbose && terminal.commandHistory) {
    output += '📜 Recent Commands (last 5):\n';
    const recent = terminal.commandHistory.slice(-5);
    recent.forEach((cmd, i) => {
      output += `   ${recent.length - i}. ${cmd}\n`;
    });
    output += '\n';
  }

  if (flags.verbose && terminal.environment) {
    output += '🌍 Environment Variables:\n';
    Object.entries(terminal.environment).forEach(([key, value]) => {
      output += `   ${key}=${value}\n`;
    });
    output += '\n';
  }

  // Signal system debug
  if (terminal.signalHandlers) {
    output += '📡 Signal System:\n';
    output += `   Active Handlers: ${Object.keys(terminal.signalHandlers).length}\n`;
    output += `   Current Process: ${
      terminal.currentProcess ? terminal.currentProcess.name || 'Unknown' : 'None'
    }\n\n`;
  }

  return output;
}

function debugStorage(terminal, flags) {
  let output = '💾 Storage Debug Information\n';
  output += '═'.repeat(40) + '\n\n';

  // LocalStorage analysis
  let totalSize = 0;
  let itemCount = 0;
  const categories = {};

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key);
    const size = key.length + (value ? value.length : 0);

    totalSize += size;
    itemCount++;

    // Categorize by prefix
    const prefix = key.split('_')[0];
    categories[prefix] = (categories[prefix] || 0) + 1;
  }

  output += '📊 LocalStorage Analysis:\n';
  output += `   Total Items: ${itemCount}\n`;
  output += `   Total Size: ${(totalSize / 1024).toFixed(2)} KB\n`;
  output += `   Available: ${typeof Storage !== 'undefined' ? '✅ Yes' : '❌ No'}\n\n`;

  if (flags.verbose) {
    output += '📂 Storage Categories:\n';
    Object.entries(categories).forEach(([prefix, count]) => {
      output += `   ${prefix}: ${count} items\n`;
    });
    output += '\n';
  }

  // IndexedDB check
  output += '🗄️  IndexedDB Status:\n';
  if (typeof window.indexedDB !== 'undefined') {
    output += `   Available: ✅ Yes\n`;
    output += `   Version: ${window.indexedDB.constructor.name}\n`;
  } else {
    output += `   Available: ❌ No\n`;
  }

  return output;
}

function debugPerformance(terminal, flags) {
  let output = '⚡ Performance Debug Information\n';
  output += '═'.repeat(40) + '\n\n';

  // Performance timing
  if (performance.timing) {
    const timing = performance.timing;
    output += '⏱️  Page Load Timing:\n';
    output += `   DNS Lookup: ${timing.domainLookupEnd - timing.domainLookupStart}ms\n`;
    output += `   TCP Connect: ${timing.connectEnd - timing.connectStart}ms\n`;
    output += `   Request: ${timing.responseStart - timing.requestStart}ms\n`;
    output += `   Response: ${timing.responseEnd - timing.responseStart}ms\n`;
    output += `   DOM Loading: ${timing.domContentLoadedEventEnd - timing.domLoading}ms\n\n`;
  }

  // Current performance
  output += '📈 Current Performance:\n';
  output += `   Time Since Load: ${performance.now().toFixed(2)}ms\n`;

  if (performance.memory) {
    const memory = performance.memory;
    output += `   Memory Used: ${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB\n`;
    output += `   Memory Total: ${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB\n`;
    output += `   Memory Limit: ${(memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)} MB\n`;
  }

  // FPS estimation (if available)
  if (flags.verbose) {
    output += '\n🎯 Performance Hints:\n';
    output += `   Hardware Concurrency: ${navigator.hardwareConcurrency || 'Unknown'} cores\n`;
    output += `   Device Memory: ${navigator.deviceMemory || 'Unknown'} GB\n`;
    output += `   Connection: ${
      navigator.connection ? navigator.connection.effectiveType : 'Unknown'
    }\n`;
  }

  return output;
}

function debugConsole(terminal, args) {
  const action = args[1] || 'status';

  switch (action) {
    case 'enable':
      localStorage.setItem('debug_enabled', 'true');
      return '✅ Console debugging enabled';
    case 'disable':
      localStorage.setItem('debug_enabled', 'false');
      return '❌ Console debugging disabled';
    case 'status': {
      const enabled = localStorage.getItem('debug_enabled') === 'true';
      return `Console debugging is ${enabled ? '✅ enabled' : '❌ disabled'}`;
    }
    default:
      return `Usage: debug console [enable|disable|status]`;
  }
}

function debugClear(terminal, flags) {
  let output = '🧹 Clearing Debug State\n';
  output += '═'.repeat(30) + '\n\n';

  // Clear debug-related localStorage
  const debugKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('debug_')) {
      debugKeys.push(key);
    }
  }

  debugKeys.forEach((key) => localStorage.removeItem(key));

  output += `✅ Cleared ${debugKeys.length} debug entries\n`;

  // Clear console if available
  if (console.clear) {
    console.clear();
    output += '✅ Cleared browser console\n';
  }

  output += '\n🔄 Debug state has been reset\n';
  return output;
}

function debugTest(terminal, flags) {
  let output = '🧪 Running System Tests\n';
  output += '═'.repeat(30) + '\n\n';

  const tests = [
    { name: 'Terminal Object', test: () => !!terminal },
    { name: 'LocalStorage', test: () => typeof Storage !== 'undefined' },
    { name: 'Console API', test: () => typeof console !== 'undefined' },
    { name: 'Performance API', test: () => typeof performance !== 'undefined' },
    { name: 'Navigator API', test: () => typeof navigator !== 'undefined' },
    { name: 'Command Registry', test: () => typeof commandRegistry !== 'undefined' },
    { name: 'Signal System', test: () => terminal && typeof terminal.onSignal === 'function' }
  ];

  let passed = 0;
  let failed = 0;

  tests.forEach((test) => {
    try {
      const result = test.test();
      if (result) {
        output += `✅ ${test.name}\n`;
        passed++;
      } else {
        output += `❌ ${test.name}\n`;
        failed++;
      }
    } catch (error) {
      output += `❌ ${test.name} (Error: ${error.message})\n`;
      failed++;
    }
  });

  output += `\n📊 Test Results: ${passed} passed, ${failed} failed\n`;

  if (failed === 0) {
    output += '🎉 All tests passed!\n';
  } else {
    output += '⚠️  Some tests failed - system may have issues\n';
  }

  return output;
}
