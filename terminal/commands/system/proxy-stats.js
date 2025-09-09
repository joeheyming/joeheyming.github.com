// proxy-stats command - display proxy statistics
(function () {
  'use strict';

  registerCommand(
    'proxy-stats',
    (terminal, args) => {
      const flags = {
        reset: args.includes('--reset'),
        json: args.includes('--json'),
        help: args.includes('-h') || args.includes('--help')
      };

      if (flags.help) {
        return `proxy-stats - display proxy statistics

Usage: proxy-stats [options]

Options:
  --reset         Reset all proxy statistics
  --json          Output in JSON format
  -h, --help      Show this help message

Description:
  Displays statistics about proxy usage, including request counts,
  data transfer, and performance metrics.`;
      }

      // Get or initialize proxy stats
      let stats = {};
      try {
        const stored = localStorage.getItem('proxy_stats');
        stats = stored
          ? JSON.parse(stored)
          : {
              requests: {
                total: Math.floor(Math.random() * 10000) + 1000,
                successful: 0,
                failed: 0,
                cached: 0
              },
              bandwidth: {
                totalBytes: Math.floor(Math.random() * 1000000000) + 100000000,
                uploadBytes: 0,
                downloadBytes: 0,
                savedBytes: 0
              },
              performance: {
                avgResponseTime: Math.floor(Math.random() * 500) + 50,
                minResponseTime: 12,
                maxResponseTime: 2340,
                cacheHitRate: (Math.random() * 0.4 + 0.6).toFixed(2)
              },
              uptime: {
                startTime: Date.now() - Math.random() * 86400000 * 30, // Up to 30 days ago
                totalUptime: 0
              },
              errors: {
                timeouts: Math.floor(Math.random() * 50),
                connectionErrors: Math.floor(Math.random() * 20),
                serverErrors: Math.floor(Math.random() * 30),
                clientErrors: Math.floor(Math.random() * 100)
              }
            };

        // Calculate derived stats
        stats.requests.successful = Math.floor(stats.requests.total * 0.95);
        stats.requests.failed = stats.requests.total - stats.requests.successful;
        stats.requests.cached = Math.floor(
          stats.requests.successful * parseFloat(stats.performance.cacheHitRate)
        );

        stats.bandwidth.downloadBytes = Math.floor(stats.bandwidth.totalBytes * 0.8);
        stats.bandwidth.uploadBytes = stats.bandwidth.totalBytes - stats.bandwidth.downloadBytes;
        stats.bandwidth.savedBytes = Math.floor(
          stats.bandwidth.downloadBytes * parseFloat(stats.performance.cacheHitRate)
        );

        stats.uptime.totalUptime = Date.now() - stats.uptime.startTime;
      } catch (error) {
        return `Error reading proxy statistics: ${error.message}`;
      }

      if (flags.reset) {
        localStorage.removeItem('proxy_stats');
        return 'Proxy statistics have been reset.';
      }

      if (flags.json) {
        return JSON.stringify(stats, null, 2);
      }

      // Format bytes
      const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };

      // Format duration
      const formatDuration = (ms) => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
      };

      let output = '🌐 Proxy Statistics\n';
      output += '═'.repeat(50) + '\n\n';

      // Request Statistics
      output += '📊 Request Statistics:\n';
      output += `   Total Requests: ${stats.requests.total.toLocaleString()}\n`;
      output += `   Successful: ${stats.requests.successful.toLocaleString()} (${(
        (stats.requests.successful / stats.requests.total) *
        100
      ).toFixed(1)}%)\n`;
      output += `   Failed: ${stats.requests.failed.toLocaleString()} (${(
        (stats.requests.failed / stats.requests.total) *
        100
      ).toFixed(1)}%)\n`;
      output += `   Cached: ${stats.requests.cached.toLocaleString()} (${(
        parseFloat(stats.performance.cacheHitRate) * 100
      ).toFixed(1)}%)\n\n`;

      // Bandwidth Statistics
      output += '📈 Bandwidth Statistics:\n';
      output += `   Total Transfer: ${formatBytes(stats.bandwidth.totalBytes)}\n`;
      output += `   Downloaded: ${formatBytes(stats.bandwidth.downloadBytes)}\n`;
      output += `   Uploaded: ${formatBytes(stats.bandwidth.uploadBytes)}\n`;
      output += `   Cache Savings: ${formatBytes(stats.bandwidth.savedBytes)}\n\n`;

      // Performance Statistics
      output += '⚡ Performance Statistics:\n';
      output += `   Avg Response Time: ${stats.performance.avgResponseTime}ms\n`;
      output += `   Min Response Time: ${stats.performance.minResponseTime}ms\n`;
      output += `   Max Response Time: ${stats.performance.maxResponseTime}ms\n`;
      output += `   Cache Hit Rate: ${(parseFloat(stats.performance.cacheHitRate) * 100).toFixed(
        1
      )}%\n\n`;

      // Uptime Statistics
      output += '⏱️  Uptime Statistics:\n';
      output += `   Started: ${new Date(stats.uptime.startTime).toLocaleString()}\n`;
      output += `   Total Uptime: ${formatDuration(stats.uptime.totalUptime)}\n\n`;

      // Error Statistics
      output += '❌ Error Statistics:\n';
      output += `   Timeouts: ${stats.errors.timeouts}\n`;
      output += `   Connection Errors: ${stats.errors.connectionErrors}\n`;
      output += `   Server Errors (5xx): ${stats.errors.serverErrors}\n`;
      output += `   Client Errors (4xx): ${stats.errors.clientErrors}\n\n`;

      // Health Status
      const errorRate = (stats.requests.failed / stats.requests.total) * 100;
      const healthStatus =
        errorRate < 1
          ? '🟢 Excellent'
          : errorRate < 5
          ? '🟡 Good'
          : errorRate < 10
          ? '🟠 Fair'
          : '🔴 Poor';

      output += '🏥 Proxy Health:\n';
      output += `   Status: ${healthStatus}\n`;
      output += `   Error Rate: ${errorRate.toFixed(2)}%\n`;
      output += `   Cache Efficiency: ${
        parseFloat(stats.performance.cacheHitRate) > 0.7
          ? '🟢 High'
          : parseFloat(stats.performance.cacheHitRate) > 0.4
          ? '🟡 Medium'
          : '🔴 Low'
      }\n\n`;

      output += '💡 Use --json for machine-readable output\n';
      output += '💡 Use --reset to clear all statistics\n';

      // Save updated stats
      try {
        localStorage.setItem('proxy_stats', JSON.stringify(stats));
      } catch (error) {
        output += `\n⚠️  Warning: Could not save statistics: ${error.message}\n`;
      }

      return output;
    },
    'display proxy statistics and performance metrics',
    'System'
  );
})();
