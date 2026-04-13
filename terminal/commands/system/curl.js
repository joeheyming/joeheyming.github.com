// curl command - transfer data from or to a server
(function () {
  'use strict';

  const CURL_USAGE = `curl - transfer data from or to a server

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

  registerCommand(
    'curl',
    async (terminal, args) => {
      if (args.length === 0) {
        return {
          stdout: '',
          stderr: "curl: try 'curl --help' for more information",
          exitCode: 2
        };
      }

      /** @type {string[]} */
      const stderrLines = [];
      const logErr = (line) => {
        stderrLines.push(line);
      };

      // Parse arguments
      let url = '';
      let method = 'GET';
      const headers = {};
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
          return { stdout: CURL_USAGE, stderr: '', exitCode: 0 };
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
          maxRedirects = parseInt(args[++i], 10) || 5;
        } else if (arg === '--connect-timeout') {
          timeout = (parseInt(args[++i], 10) || 30) * 1000;
        } else if (arg === '--no-proxy') {
          useProxy = false;
        } else if (!arg.startsWith('-')) {
          url = arg;
        }
      }

      if (!url) {
        return { stdout: '', stderr: 'curl: no URL specified!', exitCode: 2 };
      }

      // Handle different URL types
      if (url.startsWith('/')) {
        const currentDomain = window.location.origin;
        url = `${currentDomain}${url}`;
      } else if (url.startsWith('./') || (!url.includes('://') && !url.includes('.'))) {
        const currentDomain = window.location.origin;
        const currentPath = window.location.pathname.replace(/\/[^/]*$/, '/');
        url = `${currentDomain}${currentPath}${url.replace('./', '')}`;
      } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }

      /** @type {string[]} */
      const statusMessages = [];

      if (!silent) {
        statusMessages.push(`* Trying ${url}...`);
      }

      try {
        const startTime = performance.now();
        /** @type {string} */
        let responseText;
        let responseTime;

        // Use ProxyService for GET requests (default behavior)
        if (useProxy && method === 'GET' && window.proxyService) {
          if (!silent) statusMessages.push('* Using smart CORS proxy service...');

          if (verbose) {
            logErr(`> ${method} ${new URL(url).pathname} HTTP/1.1`);
            logErr(`> Host: ${new URL(url).host}`);
            Object.entries(headers).forEach(([key, value]) => {
              logErr(`> ${key}: ${value}`);
            });
          }

          try {
            const proxyOptions = {
              headers,
              timeout: timeout,
              maxRetries: 2,
              signal: terminal.runAbortSignal ?? undefined
            };

            responseText = await window.proxyService.fetchWithProxy(
              url,
              /** @type {RequestInit & { timeout?: number; maxRetries?: number }} */ (
                /** @type {unknown} */ (proxyOptions)
              )
            );
            const endTime = performance.now();
            responseTime = (endTime - startTime).toFixed(0);

            if (!silent) {
              statusMessages.push(`* Connected via proxy to ${new URL(url).host}`);
              statusMessages.push(`* Request completed in ${responseTime}ms`);
            }

            if (verbose || showHeaders) {
              logErr('< HTTP/1.1 200 OK (via proxy)');
              logErr('< content-type: text/plain');
              logErr('< ');
            }

            try {
              if (responseText.trim().startsWith('{') || responseText.trim().startsWith('[')) {
                const json = JSON.parse(responseText);
                responseText = JSON.stringify(json, null, 2);
              }
            } catch (e) {
              // Keep as plain text if not valid JSON
            }
          } catch (proxyError) {
            if (terminal.isAbortLikeError(proxyError)) {
              throw proxyError;
            }
            if (!silent) {
              statusMessages.push(`* Proxy failed: ${proxyError.message}`);
              statusMessages.push('* Falling back to direct connection...');
            }

            const fetchOptions = {
              method,
              headers,
              signal: ShellCore.combinedFetchSignal(timeout, terminal.runAbortSignal ?? undefined)
            };

            const response = await fetch(
              url,
              /** @type {RequestInit} */ (/** @type {unknown} */ (fetchOptions))
            );
            const endTime = performance.now();
            responseTime = (endTime - startTime).toFixed(0);

            if (!silent) {
              statusMessages.push(`* Connected to ${new URL(url).host}`);
              statusMessages.push(`* Request completed in ${responseTime}ms`);
            }

            if (verbose || showHeaders) {
              logErr(`< HTTP/1.1 ${response.status} ${response.statusText}`);
              response.headers.forEach((value, key) => {
                logErr(`< ${key}: ${value}`);
              });
              logErr('< ');
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
              logErr(`curl: (${response.status}) HTTP error`);
            }
          }
        } else {
          if (useProxy && method !== 'GET') {
            if (!silent) {
              statusMessages.push(
                '* Note: Proxy only supported for GET requests, using direct connection'
              );
            }
          } else if (!useProxy) {
            if (!silent) statusMessages.push('* Using direct connection (proxy disabled)');
          }

          const fetchOptions = {
            method,
            headers,
            signal: ShellCore.combinedFetchSignal(timeout, terminal.runAbortSignal ?? undefined)
          };

          if (data && ['POST', 'PUT', 'PATCH'].includes(method)) {
            fetchOptions.body = data;
            if (!headers['Content-Type']) {
              headers['Content-Type'] = 'application/json';
            }
          }

          if (verbose) {
            logErr(`> ${method} ${new URL(url).pathname} HTTP/1.1`);
            logErr(`> Host: ${new URL(url).host}`);
            Object.entries(headers).forEach(([key, value]) => {
              logErr(`> ${key}: ${value}`);
            });
            if (data) {
              logErr('> ');
              logErr(`${data}`);
            }
          }

          const response = await fetch(
            url,
            /** @type {RequestInit} */ (/** @type {unknown} */ (fetchOptions))
          );
          const endTime = performance.now();
          responseTime = (endTime - startTime).toFixed(0);

          if (!silent) {
            statusMessages.push(`* Connected to ${new URL(url).host}`);
            statusMessages.push(`* Request completed in ${responseTime}ms`);
          }

          if (verbose || showHeaders) {
            logErr(`< HTTP/1.1 ${response.status} ${response.statusText}`);
            response.headers.forEach((value, key) => {
              logErr(`< ${key}: ${value}`);
            });
            logErr('< ');
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
            logErr(`curl: (${response.status}) HTTP error`);
          }
        }

        const reds = terminal.redirections;
        const isRedirected =
          !!reds &&
          typeof reds === 'object' &&
          !Array.isArray(reds) &&
          !!(/** @type {{ stdout?: string }} */ (reds).stdout);
        if (!silent && statusMessages.length > 0) {
          if (!isRedirected) {
            statusMessages.forEach((msg) => logErr(msg));
          }
        }

        let out = responseText != null ? String(responseText) : '';
        if (isRedirected) {
          return {
            stdout: out,
            stderr: stderrLines.join('\n'),
            exitCode: 0
          };
        }
        if (out.length > 10000) {
          out = out.substring(0, 10000) + '\n... (response truncated)';
        }
        return {
          stdout: out,
          stderr: stderrLines.join('\n'),
          exitCode: 0
        };
      } catch (error) {
        if (terminal.isAbortLikeError(error)) {
          throw error;
        }
        if (error.name === 'TimeoutError') {
          return {
            stdout: '',
            stderr: `curl: (28) Connection timed out after ${timeout / 1000} seconds`,
            exitCode: 28
          };
        }
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          return {
            stdout: '',
            stderr: `curl: (6) Could not resolve host: ${new URL(url).host}`,
            exitCode: 6
          };
        }
        return {
          stdout: '',
          stderr: `curl: (7) Failed to connect: ${error.message}`,
          exitCode: 7
        };
      }
    },
    'transfer data from or to a server (curl [options] <url>)',
    'System'
  );
})();
