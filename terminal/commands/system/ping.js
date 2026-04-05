// ping command - ping a host using HTTP fetch (not ICMP; browser limitation)
(function () {
  'use strict';

  const PING_USAGE =
    'Usage: ping [-c count] [--no-proxy] [HOST]\n' +
    'Send HTTP HEAD-like probes to HOST (default: google.com). Not real ICMP.\n' +
    '\n' +
    '  -c COUNT      Stop after COUNT requests (default 4)\n' +
    '  --no-proxy    Prefer direct fetch instead of proxy when available\n' +
    '  -h, --help    Show this help\n';

  /**
   * @param {string[]} args
   * @returns {{ help?: boolean, count?: number, useProxy?: boolean, host?: string, stderr?: string, exitCode?: number }}
   */
  function parsePingArgs(args) {
    let count = 4;
    let useProxy = true;
    /** @type {string|null} */
    let host = null;
    let i = 0;
    while (i < args.length) {
      const a = args[i];
      if (a === '--help' || a === '-h') {
        return { help: true };
      }
      if (a === '--no-proxy') {
        useProxy = false;
        i++;
        continue;
      }
      if (a === '-c') {
        const val = args[i + 1];
        if (val === undefined || (val.startsWith('-') && !/^\d/.test(val))) {
          return { stderr: "ping: option requires an argument -- 'c'", exitCode: 2 };
        }
        const n = parseInt(val, 10);
        i += 2;
        if (Number.isNaN(n) || n < 1) {
          return { stderr: `ping: invalid count: '${val}'`, exitCode: 2 };
        }
        count = n;
        continue;
      }
      if (a.startsWith('-c') && a.length > 2) {
        const rest = a.slice(2);
        const n = parseInt(rest, 10);
        if (Number.isNaN(n) || n < 1) {
          return { stderr: `ping: invalid count: '${rest}'`, exitCode: 2 };
        }
        count = n;
        i++;
        continue;
      }
      if (a.startsWith('-')) {
        return { stderr: `ping: invalid option -- '${a}'`, exitCode: 2 };
      }
      host = a;
      i++;
    }
    return { count, useProxy, host: host || 'google.com' };
  }

  /**
   * @param {number} ms
   * @param {AbortSignal|null|undefined} signal
   */
  function sleepWithAbort(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      const t = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          },
          { once: true }
        );
      }
    });
  }

  registerCommand(
    'ping',
    async (terminal, args) => {
      const parsed = parsePingArgs(args);
      if (parsed.help) {
        return { stdout: PING_USAGE, stderr: '', exitCode: 0 };
      }
      if (parsed.stderr != null) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode ?? 2 };
      }

      const host = parsed.host;
      const count = parsed.count;
      const useProxy = parsed.useProxy;

      /** @type {string[]} */
      const lines = [];

      let url = host;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${host}`;
      }

      lines.push(`PING ${host} - attempting HTTP fetch${useProxy ? ' via proxy' : ' (direct)'}...`);

      let successCount = 0;
      let totalTime = 0;
      const times = [];

      const userSig = terminal.runAbortSignal;

      for (let i = 1; i <= count; i++) {
        if (userSig && userSig.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        let startTime = performance.now();
        try {
          let response;
          let responseTime;

          if (useProxy && window.proxyService) {
            try {
              await window.proxyService.fetchWithProxy(url, {
                timeout: 5000,
                maxRetries: 0,
                headers: { Accept: 'text/html,*/*' },
                signal: userSig
              });

              const endTime = performance.now();
              responseTime = (endTime - startTime).toFixed(1);

              successCount++;
              totalTime += parseFloat(responseTime);
              times.push(parseFloat(responseTime));

              lines.push(`Response from ${host}: seq=${i} time=${responseTime} ms (via proxy)`);
            } catch (proxyError) {
              if (terminal.isAbortLikeError(proxyError)) {
                throw proxyError;
              }
              response = await fetch(url, {
                method: 'HEAD',
                signal: ShellUtils.combinedFetchSignal(5000, userSig),
                mode: 'no-cors'
              });
              const endTime = performance.now();
              responseTime = (endTime - startTime).toFixed(1);

              successCount++;
              totalTime += parseFloat(responseTime);
              times.push(parseFloat(responseTime));

              lines.push(
                `Response from ${host}: seq=${i} time=${responseTime} ms (proxy failed, direct: ${
                  response.status || 'no-cors'
                })`
              );
            }
          } else {
            response = await fetch(url, {
              method: 'HEAD',
              signal: ShellUtils.combinedFetchSignal(5000, userSig),
              mode: 'no-cors'
            });
            const endTime = performance.now();
            responseTime = (endTime - startTime).toFixed(1);

            successCount++;
            totalTime += parseFloat(responseTime);
            times.push(parseFloat(responseTime));

            lines.push(
              `Response from ${host}: seq=${i} time=${responseTime} ms (status: ${
                response.status || 'no-cors'
              })`
            );
          }
        } catch (error) {
          if (terminal.isAbortLikeError(error)) {
            if (userSig && userSig.aborted) {
              throw error;
            }
            lines.push(`Request timeout for ${host}: seq=${i} (>5000ms)`);
          } else {
            if (url.startsWith('https://') && i === 1) {
              const httpUrl = url.replace('https://', 'http://');
              try {
                startTime = performance.now();

                if (useProxy && window.proxyService) {
                  await window.proxyService.fetchWithProxy(httpUrl, {
                    timeout: 5000,
                    maxRetries: 0,
                    headers: { Accept: 'text/html,*/*' },
                    signal: userSig
                  });

                  const endTime2 = performance.now();
                  const responseTime2 = (endTime2 - startTime).toFixed(1);

                  successCount++;
                  totalTime += parseFloat(responseTime2);
                  times.push(parseFloat(responseTime2));

                  lines.push(
                    `Response from ${host}: seq=${i} time=${responseTime2} ms (HTTP via proxy)`
                  );
                  url = httpUrl;
                } else {
                  const response2 = await fetch(httpUrl, {
                    method: 'HEAD',
                    signal: ShellUtils.combinedFetchSignal(5000, userSig),
                    mode: 'no-cors'
                  });
                  const endTime2 = performance.now();
                  const responseTime2 = (endTime2 - startTime).toFixed(1);

                  successCount++;
                  totalTime += parseFloat(responseTime2);
                  times.push(parseFloat(responseTime2));

                  lines.push(
                    `Response from ${host}: seq=${i} time=${responseTime2} ms (HTTP fallback)`
                  );
                  url = httpUrl;
                }
              } catch (httpError) {
                if (terminal.isAbortLikeError(httpError)) {
                  throw httpError;
                }
                lines.push(`Request failed for ${host}: seq=${i} (${httpError.message})`);
              }
            } else {
              lines.push(`Request failed for ${host}: seq=${i} (${error.message})`);
            }
          }
        }

        if (i < count) {
          await sleepWithAbort(1000, userSig);
        }
      }

      const packetLoss = (((count - successCount) / count) * 100).toFixed(1);
      const avgTime = successCount > 0 ? (totalTime / successCount).toFixed(1) : 0;
      const minTime = times.length > 0 ? Math.min(...times).toFixed(1) : 0;
      const maxTime = times.length > 0 ? Math.max(...times).toFixed(1) : 0;

      lines.push(`--- ${host} ping statistics ---`);
      lines.push(
        `${count} requests transmitted, ${successCount} received, ${packetLoss}% packet loss`
      );
      if (successCount > 0) {
        lines.push(`round-trip min/avg/max = ${minTime}/${avgTime}/${maxTime} ms`);
      }

      const exitCode = successCount > 0 ? 0 : 1;
      return { stdout: lines.join('\n'), stderr: '', exitCode };
    },
    'ping a host using HTTP fetch (ping [-c count] [--no-proxy] [host])',
    'System'
  );
})();
