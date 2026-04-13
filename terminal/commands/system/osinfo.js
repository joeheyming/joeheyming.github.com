// osinfo command - operating system information

function osinfoHandler(terminal, args) {
  const flags = {
    detailed: args.includes('-d') || args.includes('--detailed'),
    json: args.includes('--json'),
    help: args.includes('-h') || args.includes('--help')
  };

  if (flags.help) {
    return `osinfo - operating system information

Usage: osinfo [options]

Options:
  -d, --detailed  Show detailed system information
  --json          Output in JSON format
  -h, --help      Show this help message

Description:
  Displays comprehensive information about the operating system,
  browser environment, and system capabilities.`;
  }

  // Gather system information
  const getOSInfo = () => {
    const nav = navigator;
    const screen = window.screen;
    const userAgent = nav.userAgent;

    // Parse OS information
    let osInfo = {
      name: 'Unknown',
      version: 'Unknown',
      architecture: 'Unknown',
      platform: nav.platform || 'Unknown'
    };

    // Detect OS
    if (userAgent.includes('Windows NT')) {
      osInfo.name = 'Windows';
      const match = userAgent.match(/Windows NT ([\d.]+)/);
      if (match) {
        osInfo.version = match[1];
        // Map NT versions to friendly names
        const ntVersions = {
          '10.0': 'Windows 10/11',
          6.3: 'Windows 8.1',
          6.2: 'Windows 8',
          6.1: 'Windows 7',
          '6.0': 'Windows Vista'
        };
        osInfo.version = ntVersions[match[1]] || `NT ${match[1]}`;
      }
      osInfo.architecture =
        userAgent.includes('WOW64') || userAgent.includes('Win64') ? 'x64' : 'x86';
    } else if (userAgent.includes('Mac OS X')) {
      osInfo.name = 'macOS';
      const match = userAgent.match(/Mac OS X ([\d_]+)/);
      if (match) {
        osInfo.version = match[1].replace(/_/g, '.');
      }
      osInfo.architecture = userAgent.includes('Intel') ? 'Intel' : 'Apple Silicon';
    } else if (userAgent.includes('Linux')) {
      osInfo.name = 'Linux';
      if (userAgent.includes('Ubuntu')) osInfo.name = 'Ubuntu';
      else if (userAgent.includes('Debian')) osInfo.name = 'Debian';
      else if (userAgent.includes('Fedora')) osInfo.name = 'Fedora';
      else if (userAgent.includes('CentOS')) osInfo.name = 'CentOS';
      osInfo.architecture = userAgent.includes('x86_64')
        ? 'x64'
        : userAgent.includes('i686')
        ? 'x86'
        : 'Unknown';
    } else if (userAgent.includes('Android')) {
      osInfo.name = 'Android';
      const match = userAgent.match(/Android ([\d.]+)/);
      if (match) osInfo.version = match[1];
      osInfo.architecture = userAgent.includes('arm64') ? 'ARM64' : 'ARM';
    } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
      osInfo.name = userAgent.includes('iPad') ? 'iPadOS' : 'iOS';
      const match = userAgent.match(/OS ([\d_]+)/);
      if (match) osInfo.version = match[1].replace(/_/g, '.');
      osInfo.architecture = 'ARM64';
    }

    // Browser information
    let browserInfo = {
      name: 'Unknown Browser',
      version: 'Unknown',
      engine: 'Unknown'
    };

    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
      browserInfo.name = 'Chrome';
      browserInfo.engine = 'Blink';
      const match = userAgent.match(/Chrome\/([\d.]+)/);
      if (match) browserInfo.version = match[1];
    } else if (userAgent.includes('Firefox')) {
      browserInfo.name = 'Firefox';
      browserInfo.engine = 'Gecko';
      const match = userAgent.match(/Firefox\/([\d.]+)/);
      if (match) browserInfo.version = match[1];
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      browserInfo.name = 'Safari';
      browserInfo.engine = 'WebKit';
      const match = userAgent.match(/Version\/([\d.]+)/);
      if (match) browserInfo.version = match[1];
    } else if (userAgent.includes('Edg')) {
      browserInfo.name = 'Microsoft Edge';
      browserInfo.engine = 'Blink';
      const match = userAgent.match(/Edg\/([\d.]+)/);
      if (match) browserInfo.version = match[1];
    }

    // Hardware information
    const hardwareInfo = {
      cpuCores: nav.hardwareConcurrency || 'Unknown',
      memory: nav.deviceMemory ? `${nav.deviceMemory} GB` : 'Unknown',
      screen: {
        resolution: `${screen.width}x${screen.height}`,
        colorDepth: `${screen.colorDepth}-bit`,
        pixelRatio: window.devicePixelRatio || 1
      }
    };

    // Network information
    const networkInfo = {
      online: nav.onLine,
      connection: nav.connection
        ? {
            effectiveType: nav.connection.effectiveType,
            downlink: nav.connection.downlink,
            rtt: nav.connection.rtt
          }
        : null
    };

    // Capabilities
    const capabilities = {
      localStorage: typeof Storage !== 'undefined',
      indexedDB: typeof window.indexedDB !== 'undefined',
      webGL: !!window.WebGLRenderingContext,
      webAssembly: typeof WebAssembly !== 'undefined',
      serviceWorker: 'serviceWorker' in navigator,
      geolocation: 'geolocation' in navigator,
      notifications: 'Notification' in window,
      webRTC: !!(
        navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia
      ),
      touchScreen: 'ontouchstart' in window || navigator.maxTouchPoints > 0
    };

    return {
      os: osInfo,
      browser: browserInfo,
      hardware: hardwareInfo,
      network: networkInfo,
      capabilities: capabilities,
      heymingOS: {
        version: '1.0.0',
        kernel: 'HeymingKernel',
        shell: 'hsh (Heyming Shell)',
        terminal: 'HeymingOS Terminal'
      }
    };
  };

  const info = getOSInfo();

  if (flags.json) {
    return JSON.stringify(info, null, 2);
  }

  let output = '🖥️  Operating System Information\n';
  output += '═'.repeat(50) + '\n\n';

  // HeymingOS Information
  output += '🚀 HeymingOS:\n';
  output += `   Version: ${info.heymingOS.version}\n`;
  output += `   Kernel: ${info.heymingOS.kernel}\n`;
  output += `   Shell: ${info.heymingOS.shell}\n`;
  output += `   Terminal: ${info.heymingOS.terminal}\n\n`;

  // Host OS Information
  output += '💻 Host Operating System:\n';
  output += `   Name: ${info.os.name}\n`;
  output += `   Version: ${info.os.version}\n`;
  output += `   Architecture: ${info.os.architecture}\n`;
  output += `   Platform: ${info.os.platform}\n\n`;

  // Browser Information
  output += '🌐 Browser Environment:\n';
  output += `   Browser: ${info.browser.name} ${info.browser.version}\n`;
  output += `   Engine: ${info.browser.engine}\n`;
  output += `   User Agent: ${navigator.userAgent.substring(0, 60)}...\n\n`;

  // Hardware Information
  output += '⚙️  Hardware Information:\n';
  output += `   CPU Cores: ${info.hardware.cpuCores}\n`;
  output += `   Memory: ${info.hardware.memory}\n`;
  output += `   Screen: ${info.hardware.screen.resolution} (${info.hardware.screen.colorDepth})\n`;
  output += `   Pixel Ratio: ${info.hardware.screen.pixelRatio}x\n\n`;

  // Network Information
  output += '🌍 Network Information:\n';
  output += `   Status: ${info.network.online ? '🟢 Online' : '🔴 Offline'}\n`;
  if (info.network.connection) {
    output += `   Connection: ${info.network.connection.effectiveType}\n`;
    output += `   Downlink: ${info.network.connection.downlink} Mbps\n`;
    output += `   RTT: ${info.network.connection.rtt}ms\n`;
  }
  output += '\n';

  // Capabilities
  output += '🔧 System Capabilities:\n';
  Object.entries(info.capabilities).forEach(([key, value]) => {
    const icon = value ? '✅' : '❌';
    const name = key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
    output += `   ${name}: ${icon}\n`;
  });

  if (flags.detailed) {
    output += '\n📊 Detailed Information:\n';
    output += `   Language: ${navigator.language}\n`;
    output += `   Languages: ${navigator.languages ? navigator.languages.join(', ') : 'Unknown'}\n`;
    output += `   Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}\n`;
    output += `   Cookies Enabled: ${navigator.cookieEnabled ? 'Yes' : 'No'}\n`;
    output += `   Do Not Track: ${navigator.doNotTrack || 'Not set'}\n`;

    if (performance.memory) {
      output += `   JS Heap Used: ${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(
        2
      )} MB\n`;
      output += `   JS Heap Total: ${(performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(
        2
      )} MB\n`;
      output += `   JS Heap Limit: ${(performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(
        2
      )} MB\n`;
    }
  }

  output += '\n💡 Use --json for machine-readable output\n';
  output += '💡 Use --detailed for additional system information\n';

  return output;
}

export default {
  name: 'osinfo',
  handler: osinfoHandler,
  description: 'display comprehensive operating system information',
  category: 'System'
};
