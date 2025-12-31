// ping command - ping a host using HTTP fetch
(function () {
  'use strict';

  registerCommand(
    'ping',
    async (terminal, args) => {
      const host = args[0] || 'google.com';
      const count = parseInt(args.find((arg) => arg.startsWith('-c'))?.split('c')[1]) || 4;
      const useProxy = !args.includes('--no-proxy');

      // Construct URL - try HTTPS first, fallback to HTTP
      let url = host;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${host}`;
      }

      terminal.addOutput(
        `PING ${host} - attempting HTTP fetch${useProxy ? ' via proxy' : ' (direct)'}...`
      );

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
                headers: { Accept: 'text/html,*/*' }
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
                    headers: { Accept: 'text/html,*/*' }
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
    'ping a host using HTTP fetch (ping [-c count] [--no-proxy] host)',
    'System'
  );
})();
