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
        const useProxy = !args.includes('--no-proxy');

        // Construct URL - try HTTPS first, fallback to HTTP
        let url = host;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${host}`;
        }

        terminal.addOutput(`PING ${host} - attempting HTTP fetch${useProxy ? ' via proxy' : ' (direct)'}...`);

        let successCount = 0;
        let totalTime = 0;
        const times = [];

        for (let i = 1; i <= count; i++) {
          try {
            const startTime = performance.now();
            let response;
            let responseTime;

            // Try proxy service first if available and enabled
            if (useProxy && window.proxyService) {
              try {
                // Use proxy service for HEAD request simulation
                await window.proxyService.fetchWithProxy(url, {
                  timeout: 5000,
                  maxRetries: 0,
                  headers: { 'Accept': 'text/html,*/*' }
                });
                
                const endTime = performance.now();
                responseTime = (endTime - startTime).toFixed(1);
                
                successCount++;
                totalTime += parseFloat(responseTime);
                times.push(parseFloat(responseTime));

                terminal.addOutput(
                  `Response from ${host}: seq=${i} time=${responseTime} ms (via proxy)`
                );
              } catch (proxyError) {
                // Fall back to direct fetch if proxy fails
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                response = await fetch(url, {
                  method: 'HEAD',
                  signal: controller.signal,
                  mode: 'no-cors'
                });

                clearTimeout(timeoutId);
                const endTime = performance.now();
                responseTime = (endTime - startTime).toFixed(1);

                successCount++;
                totalTime += parseFloat(responseTime);
                times.push(parseFloat(responseTime));

                terminal.addOutput(
                  `Response from ${host}: seq=${i} time=${responseTime} ms (proxy failed, direct: ${
                    response.status || 'no-cors'
                  })`
                );
              }
            } else {
              // Direct fetch
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000);

              response = await fetch(url, {
                method: 'HEAD',
                signal: controller.signal,
                mode: 'no-cors'
              });

              clearTimeout(timeoutId);
              const endTime = performance.now();
              responseTime = (endTime - startTime).toFixed(1);

              successCount++;
              totalTime += parseFloat(responseTime);
              times.push(parseFloat(responseTime));

              terminal.addOutput(
                `Response from ${host}: seq=${i} time=${responseTime} ms (status: ${
                  response.status || 'no-cors'
                })`
              );
            }
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
                  
                  if (useProxy && window.proxyService) {
                    // Try proxy with HTTP URL
                    await window.proxyService.fetchWithProxy(httpUrl, {
                      timeout: 5000,
                      maxRetries: 0,
                      headers: { 'Accept': 'text/html,*/*' }
                    });
                    
                    const endTime2 = performance.now();
                    const responseTime2 = (endTime2 - startTime2).toFixed(1);

                    successCount++;
                    totalTime += parseFloat(responseTime2);
                    times.push(parseFloat(responseTime2));

                    terminal.addOutput(
                      `Response from ${host}: seq=${i} time=${responseTime2} ms (HTTP via proxy)`
                    );
                    url = httpUrl; // Use HTTP for remaining requests
                  } else {
                    // Direct HTTP fallback
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
                  }
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
      description: 'ping a host using HTTP fetch (ping [-c count] [--no-proxy] host)'
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
        let useProxy = true; // Default to using proxy

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
  --no-proxy                 Disable CORS proxy (proxy enabled by default)
  -h, --help                 This help text

Examples:
  curl https://api.github.com/users/octocat                    # Uses proxy by default
  curl --no-proxy https://example.com                          # Direct connection
  curl -X POST -H "Content-Type: application/json" -d '{"key":"value"}' https://httpbin.org/post
  curl -i -v https://httpbin.org/json                          # Include headers with verbose output`;
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
          } else if (arg === '--no-proxy') {
            useProxy = false;
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

        // Build status messages but don't output them yet (for redirection compatibility)
        let statusMessages = [];
        
        if (!silent) {
          statusMessages.push(`* Trying ${url}...`);
        }

        try {
          const startTime = performance.now();
          let responseText;
          let responseTime;

          // Use ProxyService for GET requests (default behavior)
          if (useProxy && method === 'GET' && window.proxyService) {
            if (!silent) statusMessages.push('* Using smart CORS proxy service...');
            
            if (verbose) {
              terminal.addOutput(`> ${method} ${new URL(url).pathname} HTTP/1.1`);
              terminal.addOutput(`> Host: ${new URL(url).host}`);
              Object.entries(headers).forEach(([key, value]) => {
                terminal.addOutput(`> ${key}: ${value}`);
              });
            }

            try {
              const proxyOptions = {
                headers,
                timeout: timeout,
                maxRetries: 2
              };

              responseText = await window.proxyService.fetchWithProxy(url, proxyOptions);
              const endTime = performance.now();
              responseTime = (endTime - startTime).toFixed(0);

              if (!silent) {
                statusMessages.push(`* Connected via proxy to ${new URL(url).host}`);
                statusMessages.push(`* Request completed in ${responseTime}ms`);
              }

              if (verbose || showHeaders) {
                terminal.addOutput(`< HTTP/1.1 200 OK (via proxy)`);
                terminal.addOutput(`< content-type: text/plain`);
                terminal.addOutput(`< `);
              }

              // Try to parse as JSON if it looks like JSON
              try {
                if (responseText.trim().startsWith('{') || responseText.trim().startsWith('[')) {
                  const json = JSON.parse(responseText);
                  responseText = JSON.stringify(json, null, 2);
                }
              } catch (e) {
                // Keep as plain text if not valid JSON
              }


            } catch (proxyError) {
              if (!silent) {
                statusMessages.push(`* Proxy failed: ${proxyError.message}`);
                statusMessages.push('* Falling back to direct connection...');
              }
              
              // Fall back to direct fetch
              const fetchOptions = {
                method,
                headers,
                signal: AbortSignal.timeout(timeout)
              };

              const response = await fetch(url, fetchOptions);
              const endTime = performance.now();
              responseTime = (endTime - startTime).toFixed(0);

              if (!silent) {
                statusMessages.push(`* Connected to ${new URL(url).host}`);
                statusMessages.push(`* Request completed in ${responseTime}ms`);
              }

              if (verbose || showHeaders) {
                terminal.addOutput(`< HTTP/1.1 ${response.status} ${response.statusText}`);
                response.headers.forEach((value, key) => {
                  terminal.addOutput(`< ${key}: ${value}`);
                });
                terminal.addOutput(`< `);
              }

              const contentType = response.headers.get('content-type') || '';
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

              if (!silent && !response.ok) {
                terminal.addOutput(`curl: (${response.status}) HTTP error`);
              }
            }
          } else {
            // Use regular fetch for non-GET requests or when proxy disabled
            if (useProxy && method !== 'GET') {
              if (!silent) statusMessages.push('* Note: Proxy only supported for GET requests, using direct connection');
            } else if (!useProxy) {
              if (!silent) statusMessages.push('* Using direct connection (proxy disabled)');
            }

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
            responseTime = (endTime - startTime).toFixed(0);

            if (!silent) {
              statusMessages.push(`* Connected to ${new URL(url).host}`);
              statusMessages.push(`* Request completed in ${responseTime}ms`);
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

            if (!silent && !response.ok) {
              terminal.addOutput(`curl: (${response.status}) HTTP error`);
            }
          }

          // Only show status messages if output is not being redirected
          // In a real shell, these would go to stderr and not be captured by > redirection
          const isRedirected = terminal.redirections && terminal.redirections.stdout;
          if (!silent && statusMessages.length > 0) {
            if (!isRedirected) {
              statusMessages.forEach(msg => terminal.addOutput(msg));
            }
          }
          
          // If redirected, return full response; if not redirected, truncate for display
          if (isRedirected) {
            // Full response goes to file
            return responseText;
          } else {
            // Truncate for terminal display only
            if (responseText.length > 10000) {
              responseText = responseText.substring(0, 10000) + '\n... (response truncated)';
            }
            return responseText;
          }

        } catch (error) {
          if (error.name === 'TimeoutError') {
            return `curl: (28) Connection timed out after ${timeout / 1000} seconds`;
          } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
            return `curl: (6) Could not resolve host: ${new URL(url).host}`;
          } else {
            return `curl: (7) Failed to connect: ${error.message}`;
          }
        }
      },
      description: 'transfer data from or to a server (curl [options] <url>)'
    },

    vi: {
      handler: async (terminal, args) => {
        if (args.length === 0) {
          return 'vi: usage: vi <filename>';
        }

        if (args[0] === '--help' || args[0] === '-h') {
          return `vi - simple text editor

Usage: vi <filename>

Basic Commands:
  Normal Mode:
    h,j,k,l or arrows - Move cursor
    i               - Enter insert mode
    x               - Delete character
    o               - New line below and insert
    :w              - Save file
    :q              - Quit (if no changes)
    :wq             - Save and quit
    :q!             - Quit without saving
  
  Insert Mode:
    Esc             - Return to normal mode
    Type normally   - Insert text`;
        }

        const filename = args[0];
        const filePath = terminal.resolvePath(filename);
        
        try {
          // Try to read existing file
          let content = '';
          const file = await terminal.getFileSystemItem(filePath);
          if (file && file.type === 'file') {
            content = file.content || '';
          }
          
          return terminal.showViEditor(content, filename, filePath);
        } catch (error) {
          return `vi: ${filename}: ${error.message}`;
        }
      },
      description: 'simple text editor (vi <file>)'
    },

    less: {
      handler: async (terminal, args) => {
        let filename = '';
        let renderHtml = false;
        let argIndex = 0;

        // Parse flags
        while (argIndex < args.length) {
          const arg = args[argIndex];
          
          if (arg === '--help' || arg === '-h') {
            return `less - view file contents with paging and search

Usage: less [options] <file>

Options:
  --html, -H    Render HTML content instead of escaping it
  -h, --help    Show this help

Navigation:
  j, ↓          Move down one line
  k, ↑          Move up one line  
  Space, f      Move down one page
  b             Move up one page
  g             Go to beginning
  G             Go to end
  /             Start search
  n             Next search result
  N             Previous search result
  q             Quit
  h, ?          Show help in viewer

Examples:
  less file.txt         # View text file
  less --html page.html # Render HTML file
  cat file | less       # View piped content`;
          } else if (arg === '--html' || arg === '-H') {
            renderHtml = true;
            argIndex++;
          } else if (!arg.startsWith('-')) {
            filename = arg;
            argIndex++;
          } else {
            return `less: unknown option '${arg}'. Try 'less --help' for more information.`;
          }
        }

        if (!filename) {
          // Read from stdin if available
          if (terminal.hasStdin) {
            return terminal.showLessViewer(terminal.stdin, '(stdin)', { renderHtml });
          } else {
            return 'less: usage: less [options] <filename> or pipe content to less';
          }
        }

        const filePath = terminal.resolvePath(filename);
        
        try {
          const file = await terminal.getFileSystemItem(filePath);
          if (!file) {
            return `less: ${filename}: No such file or directory`;
          }
          
          if (file.type !== 'file') {
            return `less: ${filename}: Is a directory`;
          }
          
          const content = file.content || '';
          return terminal.showLessViewer(content, filename, { renderHtml });
        } catch (error) {
          return `less: ${filename}: ${error.message}`;
        }
      },
      description: 'view file contents with paging and search (less [--html] <file>)'
    },

    'proxy-stats': {
      handler: async (terminal, args) => {
        if (!window.proxyService) {
          return 'proxy-stats: ProxyService not available';
        }

        const stats = window.proxyService.getProxyStats();
        
        terminal.addOutput('🌐 Proxy Service Statistics');
        terminal.addOutput('═══════════════════════════');
        terminal.addOutput(`Proxy Count: ${stats.proxyCount}`);
        terminal.addOutput(`Timeout: ${stats.timeoutMs}ms`);
        terminal.addOutput(`Max Retries: ${stats.maxRetries}`);
        terminal.addOutput(`Cache Size: ${stats.cacheSize} entries`);
        terminal.addOutput('');
        terminal.addOutput('Proxy Performance:');
        terminal.addOutput('─────────────────');
        
        stats.proxyStats.forEach((proxy, index) => {
          const rank = index + 1;
          const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
          terminal.addOutput(`${emoji} Score: ${proxy.score} | Success: ${proxy.successRate} (${proxy.successes}/${proxy.attempts})`);
          terminal.addOutput(`   ${proxy.proxy.replace('https://', '').replace('http://', '').substring(0, 50)}...`);
          terminal.addOutput('');
        });

        if (args.includes('--reset')) {
          window.proxyService.resetProxyScores();
          terminal.addOutput('✅ Proxy scores have been reset to default values');
        }

        return '';
      },
      description: 'show proxy service statistics and performance (proxy-stats [--reset])'
    },

    top: {
      handler: (terminal, args) => {
        // Always use OS Mode - Real process information
        const processes = terminal.os.kernel.processManager.getAllProcesses();
        const memStats = terminal.os.kernel.memoryManager.getUsageStats();
        const schedulerStats = terminal.os.kernel.schedulerManager.getStats();
        const systemInfo = terminal.os.getSystemInfo();
        
        const uptime = Math.floor(systemInfo.os.uptime / 1000);
        const uptimeStr = `${Math.floor(uptime / 3600)}:${Math.floor((uptime % 3600) / 60).toString().padStart(2, '0')}`;
        
        let output = `top - ${new Date().toLocaleTimeString()} up ${uptimeStr}, 1 user, load average: 0.${Math.floor(Math.random() * 99)}\n`;
        output += `Tasks: ${processes.length} total, ${schedulerStats.readyProcesses} ready, ${schedulerStats.blockedProcesses} blocked\n`;
        output += `Memory: ${Math.floor(memStats.used / 1024 / 1024)}MB used, ${Math.floor(memStats.free / 1024 / 1024)}MB free\n`;
        output += `CPU: ${schedulerStats.cpuUtilization.toFixed(1)}% utilization, ${schedulerStats.contextSwitches} context switches\n\n`;
        output += `  PID USER      STATE    CPU%   MEM     TIME+ COMMAND\n`;
        
        processes.forEach(proc => {
          const cpuPercent = proc.cpuTime > 0 ? ((proc.cpuTime / systemInfo.os.uptime) * 100).toFixed(1) : '0.0';
          const memUsage = terminal.os.kernel.memoryManager.getProcessMemory(proc.pid);
          const memMB = memUsage ? Math.floor(memUsage.totalMemory / 1024 / 1024) : 0;
          const timeStr = `${Math.floor(proc.cpuTime / 60000)}:${Math.floor((proc.cpuTime % 60000) / 1000).toString().padStart(2, '0')}`;
          
          output += `${proc.pid.toString().padStart(5)} ${proc.uid.toString().padStart(8)} ${proc.state.padEnd(8)} ${cpuPercent.padStart(5)}% ${memMB.toString().padStart(6)}MB ${timeStr.padStart(8)} ${proc.name}\n`;
        });
        
        return output;
      },
      description: 'show system processes'
    },

    ps: {
      handler: (terminal, args) => {
        // Always use OS Mode - Real process list
        const processes = terminal.os.kernel.processManager.getAllProcesses();
        let output = `  PID  PPID USER     STAT  COMMAND\n`;
        
        processes.forEach(proc => {
          output += `${proc.pid.toString().padStart(5)} ${proc.parentPID.toString().padStart(5)} ${proc.uid.toString().padStart(8)} ${proc.state.padEnd(5)} ${proc.name}\n`;
        });
        
        return output;
      },
      description: 'show running processes'
    },

    kill: {
      handler: async (terminal, args) => {
        if (args.length === 0) {
          return 'kill: usage: kill [-signal] pid';
        }
        
        const pid = parseInt(args[args.length - 1]);
        if (isNaN(pid)) {
          return 'kill: invalid process ID';
        }
        
        // Always use OS Mode - Real process killing
        try {
          const signal = args.length > 1 && args[0].startsWith('-') ? 
            parseInt(args[0].substring(1)) : 15; // SIGTERM
          
          await terminal.os.kernel.processManager.kill(pid, signal);
          return `Process ${pid} terminated`;
        } catch (error) {
          return `kill: ${error.message}`;
        }
      },
      description: 'terminate processes by PID'
    },

    debug: {
      handler: (terminal, args) => {

        if (args.length === 0) {
          return `debug: usage: debug [scheduler] [on|off]
Available debug options:
  scheduler - Enable/disable scheduler debug logging`;
        }

        const component = args[0];
        const action = args[1];

        if (component === 'scheduler') {
          if (action === 'on') {
            terminal.os.kernel.schedulerManager.setDebugLogging(true);
            return 'Scheduler debug logging enabled';
          } else if (action === 'off') {
            terminal.os.kernel.schedulerManager.setDebugLogging(false);
            return 'Scheduler debug logging disabled';
          } else {
            const isEnabled = terminal.os.kernel.schedulerManager.debugLogging;
            return `Scheduler debug logging is currently ${isEnabled ? 'enabled' : 'disabled'}`;
          }
        }

        return `debug: unknown component '${component}'`;
      },
      description: 'control debug logging for OS components'
    },

    osinfo: {
      handler: (terminal, args) => {
        let output = '=== Terminal OS Integration Status ===\n';
        output += `OS Instance: ${terminal.os ? 'Present' : 'Missing'}\n`;
        output += `Kernel: ${terminal.os && terminal.os.kernel ? 'Present' : 'Missing'}\n`;
        output += `Process: ${terminal.process ? `PID ${terminal.process.pid}` : 'Missing'}\n`;
        output += `OS Mode: Always Enabled\n`;
        output += `FileSystemDB: ${terminal.fileSystemDB ? 'Present' : 'Missing'}\n`;
        output += `Filesystem Ready: ${terminal.filesystemReady}\n`;
        output += `Commands Loaded: ${terminal.commandsLoaded}\n`;
        
        if (terminal.os && terminal.os.kernel) {
          const sysInfo = terminal.os.getSystemInfo();
          output += `\n=== OS System Info ===\n`;
          output += `OS Version: ${sysInfo.os.name} v${sysInfo.os.version}\n`;
          output += `Processes: ${sysInfo.kernel.processCount}\n`;
          output += `Memory: ${Math.floor(sysInfo.memory.used / 1024 / 1024)}MB used / ${Math.floor(sysInfo.memory.total / 1024 / 1024)}MB total\n`;
          output += `Terminals: ${sysInfo.terminals}\n`;
        }
        
        return output;
      },
      description: 'show OS integration status and system information'
    },

    uname: {
      handler: (terminal, args) => 'Linux heyming-os 5.15.0-generic #1 SMP PREEMPT',
      description: 'show system info'
    },

    fsck: {
      handler: async (terminal, args) => {
        const forceRecreate = args.includes('--recreate') || args.includes('-r');
        const testPath = args.find(arg => arg.startsWith('--test='));
        
        if (testPath) {
          // Test path resolution
          const path = testPath.split('=')[1];
          try {
            console.log(`🔍 Testing path resolution for: ${path}`);
            const directResult = await terminal.fileSystemDB.getItem(path);
            console.log(`Direct FileSystemDB.getItem(${path}):`, directResult ? directResult.type : 'null');
            
            const osResult = await terminal.syscall('stat', path);
            console.log(`OS syscall stat(${path}):`, osResult ? osResult.type : 'null');
            
            return `Direct: ${directResult ? directResult.type : 'null'}, OS: ${osResult ? osResult.type : 'null'}`;
          } catch (error) {
            return `❌ Test failed: ${error.message}`;
          }
        }
        
        if (forceRecreate) {
          try {
            console.log('🔧 Recreating filesystem scaffolding...');
            await terminal.fileSystemDB.createScaffolding(terminal.env.USER);
            await terminal.fileSystemDB.generateBinFiles();
            return '✅ Filesystem scaffolding recreated successfully';
          } catch (error) {
            return `❌ Failed to recreate filesystem: ${error.message}`;
          }
        }
        
        // Show filesystem status
        let output = '=== Filesystem Check ===\n';
        
        try {
          const stats = await terminal.fileSystemDB.getStats();
          output += `Total items: ${stats.totalItems}\n`;
          output += `Files: ${stats.files}\n`;
          output += `Directories: ${stats.directories}\n`;
          output += `Total size: ${stats.totalSize} bytes\n\n`;
          
          // Check critical directories
          const criticalPaths = [
            '/',
            '/home',
            `/home/${terminal.env.USER}`,
            '/tmp',
            '/bin',
            '/etc'
          ];
          
          output += '=== Critical Directories ===\n';
          for (const path of criticalPaths) {
            const item = await terminal.fileSystemDB.getItem(path);
            const status = item ? (item.type === 'directory' ? '📁 OK' : '📄 FILE') : '❌ MISSING';
            output += `${path.padEnd(20)} ${status}\n`;
          }
          
          // Check for scaffolding marker
          const hasScaffolding = await terminal.fileSystemDB.hasScaffolding();
          output += `\nScaffolding marker: ${hasScaffolding ? '✅ Present' : '❌ Missing'}\n`;
          
          if (!hasScaffolding) {
            output += '\n💡 Run "fsck --recreate" to recreate the filesystem';
          }
          
        } catch (error) {
          output += `❌ Error checking filesystem: ${error.message}`;
        }
        
        return output;
      },
      description: 'check filesystem integrity (--recreate to rebuild, --test=/path to test path resolution)'
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
