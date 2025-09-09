// neofetch command - system information display
(function () {
  'use strict';

  registerCommand(
    'neofetch',
    (terminal, args) => {
      const flags = {
        help: args.includes('-h') || args.includes('--help'),
        ascii: !args.includes('--no-ascii'),
        colors: !args.includes('--no-colors')
      };

      if (flags.help) {
        return `neofetch - system information display

Usage: neofetch [options]

Options:
  --no-ascii      Disable ASCII art
  --no-colors     Disable colored output
  -h, --help      Show this help message

Description:
  Displays system information in a visually appealing format,
  similar to the popular neofetch utility for Unix systems.`;
      }

      // ASCII Art for HeymingOS
      const asciiArt = `
    ██╗  ██╗███████╗██╗   ██╗███╗   ███╗██╗███╗   ██╗ ██████╗  ██████╗ ███████╗
    ██║  ██║██╔════╝╚██╗ ██╔╝████╗ ████║██║████╗  ██║██╔════╝ ██╔═══██╗██╔════╝
    ███████║█████╗   ╚████╔╝ ██╔████╔██║██║██╔██╗ ██║██║  ███╗██║   ██║███████╗
    ██╔══██║██╔══╝    ╚██╔╝  ██║╚██╔╝██║██║██║╚██╗██║██║   ██║██║   ██║╚════██║
    ██║  ██║███████╗   ██║   ██║ ╚═╝ ██║██║██║ ╚████║╚██████╔╝╚██████╔╝███████║
    ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝  ╚═════╝ ╚══════╝`;

      // Get system information
      const getSystemInfo = () => {
        const nav = navigator;
        const screen = window.screen;
        const performance = window.performance;

        // Parse user agent for OS info
        const userAgent = nav.userAgent;
        let osName = 'Unknown OS';
        let osVersion = '';

        if (userAgent.includes('Windows')) {
          osName = 'Windows';
          const match = userAgent.match(/Windows NT ([\d.]+)/);
          osVersion = match ? match[1] : '';
        } else if (userAgent.includes('Mac OS X')) {
          osName = 'macOS';
          const match = userAgent.match(/Mac OS X ([\d_]+)/);
          osVersion = match ? match[1].replace(/_/g, '.') : '';
        } else if (userAgent.includes('Linux')) {
          osName = 'Linux';
        } else if (userAgent.includes('Android')) {
          osName = 'Android';
          const match = userAgent.match(/Android ([\d.]+)/);
          osVersion = match ? match[1] : '';
        } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
          osName = 'iOS';
          const match = userAgent.match(/OS ([\d_]+)/);
          osVersion = match ? match[1].replace(/_/g, '.') : '';
        }

        // Browser detection
        let browser = 'Unknown Browser';
        if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
          browser = 'Chrome';
        } else if (userAgent.includes('Firefox')) {
          browser = 'Firefox';
        } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
          browser = 'Safari';
        } else if (userAgent.includes('Edg')) {
          browser = 'Edge';
        }

        // Memory info (approximate)
        const memoryInfo = nav.deviceMemory ? `${nav.deviceMemory} GB` : 'Unknown';

        // CPU info (approximate)
        const cpuCores = nav.hardwareConcurrency || 'Unknown';

        // Uptime (page load time)
        const uptime = performance ? Math.floor(performance.now() / 1000) : 0;
        const uptimeStr =
          uptime > 3600
            ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
            : `${Math.floor(uptime / 60)}m ${uptime % 60}s`;

        return {
          osName,
          osVersion,
          browser,
          memoryInfo,
          cpuCores,
          uptime: uptimeStr,
          resolution: `${screen.width}x${screen.height}`,
          colorDepth: `${screen.colorDepth}-bit`,
          language: nav.language,
          platform: nav.platform,
          cookieEnabled: nav.cookieEnabled,
          onlineStatus: nav.onLine ? 'Online' : 'Offline'
        };
      };

      const info = getSystemInfo();

      // Color codes (if colors enabled)
      const colors = flags.colors
        ? {
            reset: '\x1b[0m',
            bright: '\x1b[1m',
            red: '\x1b[31m',
            green: '\x1b[32m',
            yellow: '\x1b[33m',
            blue: '\x1b[34m',
            magenta: '\x1b[35m',
            cyan: '\x1b[36m',
            white: '\x1b[37m'
          }
        : {
            reset: '',
            bright: '',
            red: '',
            green: '',
            yellow: '',
            blue: '',
            magenta: '',
            cyan: '',
            white: ''
          };

      let output = '';

      if (flags.ascii) {
        output += `${colors.cyan}${asciiArt}${colors.reset}\n\n`;
      }

      // System information display
      const infoLines = [
        `${colors.bright}${colors.red}OS${colors.reset}: HeymingOS (Browser-based)`,
        `${colors.bright}${colors.green}Host${colors.reset}: ${info.osName} ${info.osVersion}`,
        `${colors.bright}${colors.yellow}Browser${colors.reset}: ${info.browser}`,
        `${colors.bright}${colors.blue}Platform${colors.reset}: ${info.platform}`,
        `${colors.bright}${colors.magenta}Resolution${colors.reset}: ${info.resolution}`,
        `${colors.bright}${colors.cyan}Color Depth${colors.reset}: ${info.colorDepth}`,
        `${colors.bright}${colors.white}CPU Cores${colors.reset}: ${info.cpuCores}`,
        `${colors.bright}${colors.red}Memory${colors.reset}: ${info.memoryInfo}`,
        `${colors.bright}${colors.green}Uptime${colors.reset}: ${info.uptime}`,
        `${colors.bright}${colors.yellow}Language${colors.reset}: ${info.language}`,
        `${colors.bright}${colors.blue}Network${colors.reset}: ${info.onlineStatus}`,
        `${colors.bright}${colors.magenta}Cookies${colors.reset}: ${
          info.cookieEnabled ? 'Enabled' : 'Disabled'
        }`,
        `${colors.bright}${colors.cyan}Terminal${colors.reset}: HeymingOS Terminal v1.0`,
        `${colors.bright}${colors.white}Shell${colors.reset}: hsh (Heyming Shell)`
      ];

      // Add username and hostname
      const username = 'user';
      const hostname = 'heyming-os';

      output += `${colors.bright}${colors.green}${username}${colors.white}@${colors.blue}${hostname}${colors.reset}\n`;
      output += `${colors.white}${'─'.repeat(username.length + hostname.length + 1)}${
        colors.reset
      }\n`;

      infoLines.forEach((line) => {
        output += line + '\n';
      });

      // Color palette (if colors enabled)
      if (flags.colors) {
        output += '\n';
        output += `${colors.red}███${colors.green}███${colors.yellow}███${colors.blue}███${colors.magenta}███${colors.cyan}███${colors.white}███${colors.reset}\n`;
        output += `${colors.bright}${colors.red}███${colors.green}███${colors.yellow}███${colors.blue}███${colors.magenta}███${colors.cyan}███${colors.white}███${colors.reset}\n`;
      }

      return output;
    },
    'display system information',
    'System'
  );
})();
