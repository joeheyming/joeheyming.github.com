// System Commands for Heyming Terminal
(function () {
  'use strict';

  const systemCommands = {
    whoami: {
      handler: (terminal, args) => 'user',
      description: 'display username'
    },

    date: {
      handler: (terminal, args) => new Date().toString(),
      description: 'display current date/time'
    },

    clear: {
      handler: (terminal, args) => {
        if (terminal.isStandalone) {
          // Standalone mode - clear the output
          const terminalOutput = document.getElementById('terminal-output');
          terminalOutput.innerHTML = '';
        } else {
          // OS-integrated mode - original behavior
          setTimeout(() => {
            const windowElement = document.getElementById(`window-${terminal.windowId}`);
            const terminalContent = windowElement.querySelector('.terminal-content');
            terminalContent.innerHTML = `
              <div class="terminal-line">
                <span class="terminal-prompt">user@heyming-os:${terminal.getShortPath()}$</span> <input type="text" class="terminal-input" placeholder="Type a command...">
              </div>
            `;
            terminal.initialize();
          }, 100);
        }
        return '';
      },
      description: 'clear terminal'
    },

    version: {
      handler: (terminal, args) => 'Heyming OS Terminal v2.0 - Now with 100% more jokes! 🎉',
      description: 'show terminal version'
    },

    env: {
      handler: (terminal, args) => {
        const envVars = terminal.getAllEnv();
        return Object.entries(envVars)
          .map(([key, value]) => `${key}=${value}`)
          .sort()
          .join('\n');
      },
      description: 'display environment variables'
    },

    export: {
      handler: (terminal, args) => {
        if (args.length === 0) {
          // Show all exported variables (same as env for now)
          const envVars = terminal.getAllEnv();
          return Object.entries(envVars)
            .map(([key, value]) => `export ${key}="${value}"`)
            .sort()
            .join('\n');
        }

        // Parse VAR=value format
        const assignment = args.join(' ');
        const match = assignment.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);

        if (!match) {
          return 'export: usage: export VAR=value';
        }

        const [, varName, value] = match;
        // Remove quotes if present
        const cleanValue = value.replace(/^["']|["']$/g, '');
        terminal.setEnv(varName, cleanValue);

        return '';
      },
      description: 'set environment variables (export VAR=value)'
    },

    unset: {
      handler: (terminal, args) => {
        if (args.length === 0) {
          return 'unset: usage: unset VAR';
        }

        args.forEach((varName) => {
          if (terminal.env[varName]) {
            delete terminal.env[varName];
          }
        });

        return '';
      },
      description: 'unset environment variables'
    },

    whoami: {
      handler: (terminal, args) => terminal.env.USER,
      description: 'display current username'
    },

    hostname: {
      handler: (terminal, args) => terminal.env.HOSTNAME,
      description: 'display system hostname'
    },

    history: {
      handler: (terminal, args) => {
        if (terminal.commandHistory.length === 0) {
          return '';
        }

        return terminal.commandHistory
          .map((cmd, index) => `${(index + 1).toString().padStart(4)} ${cmd}`)
          .join('\n');
      },
      description: 'show command history'
    },

    alias: {
      handler: (terminal, args) => {
        if (args.length === 0) {
          // Show all aliases
          const aliases = Object.entries(terminal.aliases);
          if (aliases.length === 0) {
            return '';
          }
          return aliases
            .map(([name, value]) => `alias ${name}='${value}'`)
            .sort()
            .join('\n');
        }

        // Parse alias definition
        const aliasStr = args.join(' ');
        const match = aliasStr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);

        if (!match) {
          // Show specific alias
          const aliasName = args[0];
          if (terminal.aliases[aliasName]) {
            return `alias ${aliasName}='${terminal.aliases[aliasName]}'`;
          } else {
            return `jsh: alias: ${aliasName}: not found`;
          }
        }

        const [, aliasName, aliasValue] = match;
        // Remove quotes if present
        const cleanValue = aliasValue.replace(/^["']|["']$/g, '');
        terminal.aliases[aliasName] = cleanValue;

        return '';
      },
      description: 'create command aliases (alias name=command)'
    },

    unalias: {
      handler: (terminal, args) => {
        if (args.length === 0) {
          return 'unalias: usage: unalias name';
        }

        args.forEach((aliasName) => {
          if (terminal.aliases[aliasName]) {
            delete terminal.aliases[aliasName];
          } else {
            return `jsh: unalias: ${aliasName}: not found`;
          }
        });

        return '';
      },
      description: 'remove command aliases'
    },

    which: {
      handler: (terminal, args) => {
        if (args.length === 0) {
          return 'which: usage: which command';
        }

        const cmdName = args[0];

        // Check if it's an alias
        if (terminal.aliases[cmdName]) {
          return `${cmdName}: aliased to ${terminal.aliases[cmdName]}`;
        }

        // Check if it's a built-in command
        if (window.commandRegistry.get(cmdName)) {
          return `/bin/${cmdName}`;
        }

        return `which: no ${cmdName} in (${terminal.env.PATH})`;
      },
      description: 'locate a command'
    },

    date: {
      handler: (terminal, args) => {
        const now = new Date();

        // Basic date formats
        if (args.includes('-u')) {
          return now.toUTCString();
        } else if (args.includes('-I')) {
          return now.toISOString().split('T')[0];
        } else {
          return now.toString();
        }
      },
      description: 'display current date and time (-u for UTC, -I for ISO)'
    },

    ps: {
      handler: (terminal, args) => {
        // Fake process list for demo
        const processes = [
          { pid: 1, cmd: 'init', cpu: '0.0', mem: '0.1' },
          { pid: 42, cmd: 'jsh', cpu: '0.1', mem: '0.5' },
          { pid: 123, cmd: 'heyming-os', cpu: '0.2', mem: '2.1' },
          { pid: 456, cmd: 'filesystem-db', cpu: '0.0', mem: '1.2' },
          { pid: 789, cmd: 'terminal-ui', cpu: '0.1', mem: '3.4' }
        ];

        let output = '  PID CMD          %CPU %MEM\n';
        processes.forEach((proc) => {
          output += `${proc.pid.toString().padStart(5)} ${proc.cmd.padEnd(12)} ${proc.cpu.padStart(
            4
          )} ${proc.mem.padStart(4)}\n`;
        });

        return output.trim();
      },
      description: 'display running processes'
    },

    uptime: {
      handler: (terminal, args) =>
        'System has been running for ' + Math.floor(Math.random() * 100) + ' hours',
      description: 'system uptime'
    },

    reset: {
      handler: async (terminal, args) => {
        if (args.includes('--filesystem') || args.includes('-f')) {
          try {
            // Check if clearDatabase method exists
            if (typeof terminal.fileSystemDB.clearDatabase === 'function') {
              // Clear the filesystem database
              await terminal.fileSystemDB.clearDatabase();
              // Reinitialize with current username
              await terminal.fileSystemDB.initializeWithScaffolding(terminal.env.USER);
            } else {
              // Fallback: Delete the IndexedDB database entirely
              return 'Please refresh the page to reset the filesystem. The clearDatabase method is not available (likely due to browser caching).';
            }
            terminal.filesystemReady = true;
            return 'Filesystem has been reset and reinitialized.';
          } catch (error) {
            return `Error resetting filesystem: ${error.message}`;
          }
        } else {
          return 'reset: usage: reset --filesystem (or -f) to reset the filesystem database';
        }
      },
      description: 'reset filesystem database (--filesystem or -f)'
    },

    clearfs: {
      handler: async (terminal, args) => {
        try {
          // Check for force flag
          if (args.includes('--force') || args.includes('-f')) {
            // Just regenerate /bin files without clearing database
            await terminal.fileSystemDB.generateBinFiles();
            return 'All /bin files regenerated without clearing database. Try "ls /bin" now.';
          }

          // Force delete the IndexedDB database
          const deleteRequest = indexedDB.deleteDatabase('HeymingTerminalFS');

          return new Promise((resolve, reject) => {
            deleteRequest.onsuccess = async () => {
              try {
                // Create a new FileSystemDB instance
                terminal.fileSystemDB = new FileSystemDB();
                // Initialize with current username (this will also generate /bin files)
                await terminal.fileSystemDB.initializeWithScaffolding(terminal.env.USER);
                terminal.filesystemReady = true;
                resolve(
                  'Filesystem database cleared and recreated successfully! All /bin files generated. Try "ls /bin" now.'
                );
              } catch (error) {
                resolve(`Database cleared but error reinitializing: ${error.message}`);
              }
            };

            deleteRequest.onerror = () => {
              resolve(`Error deleting database: ${deleteRequest.error}`);
            };

            deleteRequest.onblocked = () => {
              resolve('Database deletion blocked. Please close other tabs and try again.');
            };
          });
        } catch (error) {
          return `Error: ${error.message}`;
        }
      },
      description: 'clear and recreate filesystem database'
    },

    cmdcount: {
      handler: (terminal, args) => {
        if (!window.commandRegistry) {
          return 'Command registry not available';
        }
        const commands = window.commandRegistry.getCommands();
        return `Total registered commands: ${commands.length}\nCommands: ${commands
          .map((c) => c.name)
          .sort()
          .join(', ')}`;
      },
      description: 'show count and list of all registered commands'
    },

    genbin: {
      handler: async (terminal, args) => {
        try {
          // Force regenerate /bin files
          await terminal.fileSystemDB.generateBinFiles();
          return 'All /bin files regenerated. Try "ls /bin" now.';
        } catch (error) {
          return `Error generating /bin files: ${error.message}`;
        }
      },
      description: 'force regenerate all /bin files'
    },

    neofetch: {
      handler: (terminal, args) => {
        return `user@heyming-os
----------------
OS: Heyming OS 2.0
Kernel: Linux 5.15.0-generic
Shell: bash 5.1.16
Terminal: Heyming Terminal
CPU: Intel i7-12700K
Memory: 16GB RAM
Disk: 1TB SSD
Uptime: ${Math.floor(Math.random() * 10)} days, ${Math.floor(Math.random() * 24)} hours`;
      },
      description: 'show system information'
    },

    ping: {
      handler: async (terminal, args) => {
        const host = args[0] || 'google.com';
        const count = parseInt(args.find((arg) => arg.startsWith('-c'))?.split('c')[1]) || 4;

        // Construct URL - try HTTPS first, fallback to HTTP
        let url = host;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${host}`;
        }

        terminal.addOutput(`PING ${host} - attempting HTTP fetch...`);

        let successCount = 0;
        let totalTime = 0;
        const times = [];

        for (let i = 1; i <= count; i++) {
          try {
            const startTime = performance.now();

            // Attempt fetch with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(url, {
              method: 'HEAD', // Use HEAD to minimize data transfer
              signal: controller.signal,
              mode: 'no-cors' // Allow cross-origin requests
            });

            clearTimeout(timeoutId);
            const endTime = performance.now();
            const responseTime = (endTime - startTime).toFixed(1);

            successCount++;
            totalTime += parseFloat(responseTime);
            times.push(parseFloat(responseTime));

            terminal.addOutput(
              `Response from ${host}: seq=${i} time=${responseTime} ms (status: ${
                response.status || 'no-cors'
              })`
            );
          } catch (error) {
            const endTime = performance.now();
            const responseTime = (endTime - startTime).toFixed(1);

            if (error.name === 'AbortError') {
              terminal.addOutput(`Request timeout for ${host}: seq=${i} (>5000ms)`);
            } else {
              // Try HTTP fallback if HTTPS failed
              if (url.startsWith('https://') && i === 1) {
                const httpUrl = url.replace('https://', 'http://');
                try {
                  const startTime2 = performance.now();
                  const controller2 = new AbortController();
                  const timeoutId2 = setTimeout(() => controller2.abort(), 5000);

                  const response2 = await fetch(httpUrl, {
                    method: 'HEAD',
                    signal: controller2.signal,
                    mode: 'no-cors'
                  });

                  clearTimeout(timeoutId2);
                  const endTime2 = performance.now();
                  const responseTime2 = (endTime2 - startTime2).toFixed(1);

                  successCount++;
                  totalTime += parseFloat(responseTime2);
                  times.push(parseFloat(responseTime2));

                  terminal.addOutput(
                    `Response from ${host}: seq=${i} time=${responseTime2} ms (HTTP fallback)`
                  );
                  url = httpUrl; // Use HTTP for remaining requests
                } catch (httpError) {
                  terminal.addOutput(`Request failed for ${host}: seq=${i} (${error.message})`);
                }
              } else {
                terminal.addOutput(`Request failed for ${host}: seq=${i} (${error.message})`);
              }
            }
          }

          // Wait 1 second between requests (except for the last one)
          if (i < count) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        // Calculate statistics
        const packetLoss = (((count - successCount) / count) * 100).toFixed(1);
        const avgTime = successCount > 0 ? (totalTime / successCount).toFixed(1) : 0;
        const minTime = times.length > 0 ? Math.min(...times).toFixed(1) : 0;
        const maxTime = times.length > 0 ? Math.max(...times).toFixed(1) : 0;

        terminal.addOutput(`--- ${host} ping statistics ---`);
        terminal.addOutput(
          `${count} requests transmitted, ${successCount} received, ${packetLoss}% packet loss`
        );
        if (successCount > 0) {
          terminal.addOutput(`round-trip min/avg/max = ${minTime}/${avgTime}/${maxTime} ms`);
        }

        return '';
      },
      description: 'ping a host using HTTP fetch (ping [-c count] host)'
    },

    curl: {
      handler: async (terminal, args) => {
        if (args.length === 0) {
          return "curl: try 'curl --help' for more information";
        }

        // Parse arguments
        let url = '';
        let method = 'GET';
        let headers = {};
        let data = null;
        let showHeaders = false;
        let silent = false;
        let followRedirects = true;
        let maxRedirects = 5;
        let timeout = 30000;
        let verbose = false;
        let useProxy = false;

        for (let i = 0; i < args.length; i++) {
          const arg = args[i];

          if (arg === '--help' || arg === '-h') {
            return `curl - transfer data from or to a server

Usage: curl [options] <url>

Options:
  -X, --request <method>     Specify request method (GET, POST, PUT, DELETE, etc.)
  -H, --header <header>      Pass custom header to server
  -d, --data <data>          HTTP POST data
  -i, --include              Include response headers in output
  -s, --silent               Silent mode (don't show progress)
  -L, --location             Follow redirects
  -v, --verbose              Make the operation more talkative
  --max-redirs <num>         Maximum number of redirects (default: 5)
  --connect-timeout <sec>    Maximum time for connection (default: 30)
  --proxy                    Use CORS proxy to bypass restrictions
  -h, --help                 This help text

Examples:
  curl https://api.github.com/users/octocat
  curl -X POST -H "Content-Type: application/json" -d '{"key":"value"}' https://httpbin.org/post
  curl -i https://example.com`;
          }

          if (arg === '-X' || arg === '--request') {
            method = args[++i]?.toUpperCase() || 'GET';
          } else if (arg === '-H' || arg === '--header') {
            const header = args[++i];
            if (header) {
              const [key, ...valueParts] = header.split(':');
              headers[key.trim()] = valueParts.join(':').trim();
            }
          } else if (arg === '-d' || arg === '--data') {
            data = args[++i];
            if (method === 'GET') method = 'POST'; // Auto-switch to POST when data is provided
          } else if (arg === '-i' || arg === '--include') {
            showHeaders = true;
          } else if (arg === '-s' || arg === '--silent') {
            silent = true;
          } else if (arg === '-L' || arg === '--location') {
            followRedirects = true;
          } else if (arg === '-v' || arg === '--verbose') {
            verbose = true;
          } else if (arg === '--max-redirs') {
            maxRedirects = parseInt(args[++i]) || 5;
          } else if (arg === '--connect-timeout') {
            timeout = (parseInt(args[++i]) || 30) * 1000;
          } else if (arg === '--proxy') {
            useProxy = true;
          } else if (!arg.startsWith('-')) {
            url = arg;
          }
        }

        if (!url) {
          return 'curl: no URL specified!';
        }

        // Handle different URL types
        if (url.startsWith('/')) {
          // Absolute path - treat as local file or relative to current domain
          const currentDomain = window.location.origin;
          url = `${currentDomain}${url}`;
        } else if (url.startsWith('./') || (!url.includes('://') && !url.includes('.'))) {
          // Relative path or simple name - treat as relative to current domain
          const currentDomain = window.location.origin;
          const currentPath = window.location.pathname.replace(/\/[^\/]*$/, '/');
          url = `${currentDomain}${currentPath}${url.replace('./', '')}`;
        } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
          // Domain name without protocol
          url = `https://${url}`;
        }

        // Use CORS proxy if requested
        if (useProxy) {
          if (!silent) terminal.addOutput('* Using CORS proxy...');
          // Use a public CORS proxy service
          const originalUrl = url;
          url = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
          if (verbose) {
            terminal.addOutput(`* Proxying ${originalUrl} through ${url}`);
          }
        }

        if (!silent) {
          terminal.addOutput(`* Trying ${url}...`);
        }

        try {
          const startTime = performance.now();

          // Setup fetch options
          const fetchOptions = {
            method,
            headers,
            signal: AbortSignal.timeout(timeout)
          };

          // Add body for POST/PUT/PATCH requests
          if (data && ['POST', 'PUT', 'PATCH'].includes(method)) {
            fetchOptions.body = data;
            if (!headers['Content-Type']) {
              headers['Content-Type'] = 'application/json';
            }
          }

          if (verbose) {
            terminal.addOutput(`> ${method} ${new URL(url).pathname} HTTP/1.1`);
            terminal.addOutput(`> Host: ${new URL(url).host}`);
            Object.entries(headers).forEach(([key, value]) => {
              terminal.addOutput(`> ${key}: ${value}`);
            });
            if (data) {
              terminal.addOutput(`> `);
              terminal.addOutput(`${data}`);
            }
          }

          const response = await fetch(url, fetchOptions);
          const endTime = performance.now();
          const responseTime = (endTime - startTime).toFixed(0);

          if (!silent) {
            terminal.addOutput(`* Connected to ${new URL(url).host}`);
            terminal.addOutput(`* Request completed in ${responseTime}ms`);
          }

          if (verbose || showHeaders) {
            terminal.addOutput(`< HTTP/1.1 ${response.status} ${response.statusText}`);
            response.headers.forEach((value, key) => {
              terminal.addOutput(`< ${key}: ${value}`);
            });
            terminal.addOutput(`< `);
          }

          // Get response body
          const contentType = response.headers.get('content-type') || '';
          let responseText;

          try {
            if (contentType.includes('application/json')) {
              const json = await response.json();
              responseText = JSON.stringify(json, null, 2);
            } else {
              responseText = await response.text();
            }
          } catch (e) {
            responseText = await response.text();
          }

          // Limit output size for very large responses
          if (responseText.length > 10000) {
            responseText = responseText.substring(0, 10000) + '\n... (response truncated)';
          }

          terminal.addOutput(responseText);

          if (!silent && !response.ok) {
            terminal.addOutput(`curl: (${response.status}) HTTP error`);
          }
        } catch (error) {
          if (error.name === 'TimeoutError') {
            terminal.addOutput(`curl: (28) Connection timed out after ${timeout / 1000} seconds`);
          } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
            terminal.addOutput(`curl: (6) Could not resolve host: ${new URL(url).host}`);
          } else {
            terminal.addOutput(`curl: (7) Failed to connect: ${error.message}`);
          }
        }

        return '';
      },
      description: 'transfer data from or to a server (curl [options] <url>)'
    },

    top: {
      handler: (terminal, args) => {
        return `top - ${new Date().toLocaleTimeString()} up 3 days,  7:15,  1 user,  load average: 0.52, 0.58, 0.55
Tasks: 245 total,   1 running, 244 sleeping,   0 stopped,   0 zombie
%Cpu(s):  2.1 us,  1.2 sy,  0.0 ni, 96.5 id,  0.2 wa,  0.0 hi,  0.0 si,  0.0 st
MiB Mem :  16384.0 total,  10240.0 free,   2048.0 used,   4096.0 buff/cache
MiB Swap:   8192.0 total,   8192.0 free,      0.0 used.  13312.0 avail Mem

  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
 1234 user      20   0  1234567  12345  1234 S   2.1   0.1   0:15.23 terminal
 5678 user      20   0   987654   9876   987 S   1.8   0.1   0:12.45 browser
 9012 user      20   0   654321   6543   654 S   1.5   0.0   0:08.92 editor`;
      },
      description: 'show system processes'
    },

    kill: {
      handler: (terminal, args) => {
        if (!args[0]) {
          return 'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]';
        }
        return `Process ${args[0]} killed`;
      },
      description: 'kill a process'
    },

    uname: {
      handler: (terminal, args) => 'Linux heyming-os 5.15.0-generic #1 SMP PREEMPT',
      description: 'show system info'
    },

    history: {
      handler: (terminal, args) => {
        let output = '';
        terminal.commandHistory.forEach((cmd, index) => {
          output += `${index + 1}  ${cmd}\n`;
        });
        return output || 'No command history available.';
      },
      description: 'show command history'
    },

    exit: {
      handler: (terminal, args) => 'Goodbye! (Window will close)',
      description: 'exit terminal'
    }
  };

  // if in an iframe, add the launch command
  if (window.self !== window.top) {
    systemCommands.launch = {
      handler: (terminal, args) => {
        console.log('Launching app:', args[0]);
        window.parent.postMessage(
          { type: 'iframe-message', message: { type: 'launch', app: args[0] } },
          '*'
        );
        return `Launching ${args[0]}...`;
      },
      description: 'launch an app'
    };
  }

  // Define which commands are apps vs system utilities
  const appCommands = ['exit'];

  // Register all system commands with appropriate categories
  Object.entries(systemCommands).forEach(([name, cmd]) => {
    const category = appCommands.includes(name) ? 'Apps' : 'System';
    registerCommand(name, cmd.handler, cmd.description, category);
  });
})();
