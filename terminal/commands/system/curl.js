// curl command - transfer data from or to a server
(function () {
  'use strict';

  registerCommand(
    'curl',
    async (terminal, args) => {
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
            if (!silent)
              statusMessages.push(
                '* Note: Proxy only supported for GET requests, using direct connection'
              );
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
            statusMessages.forEach((msg) => terminal.addOutput(msg));
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
    'transfer data from or to a server (curl [options] <url>)',
    'System'
  );
})();
