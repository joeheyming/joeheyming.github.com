// genbin command - generate binary files
(function () {
  'use strict';

  registerCommand(
    'genbin',
    (terminal, args) => {
      const flags = {
        count: parseInt(args.find((arg) => arg.startsWith('--count='))?.split('=')[1]) || 10,
        size: args.find((arg) => arg.startsWith('--size='))?.split('=')[1] || 'random',
        prefix: args.find((arg) => arg.startsWith('--prefix='))?.split('=')[1] || 'bin',
        help: args.includes('-h') || args.includes('--help')
      };

      if (flags.help) {
        return `genbin - generate binary files

Usage: genbin [options]

Options:
  --count=N       Number of binary files to generate (default: 10)
  --size=SIZE     Size of each file: small, medium, large, or random (default: random)
  --prefix=NAME   Prefix for generated filenames (default: bin)
  -h, --help      Show this help message

Description:
  Generates mock binary files in the /bin directory for testing purposes.
  Files are simulated and contain metadata about typical Unix utilities.

Examples:
  genbin                    Generate 10 random binary files
  genbin --count=5          Generate 5 binary files
  genbin --size=large       Generate large binary files
  genbin --prefix=tool      Generate files with 'tool' prefix`;
      }

      const binaryNames = [
        'ls',
        'cat',
        'grep',
        'sed',
        'awk',
        'find',
        'sort',
        'uniq',
        'head',
        'tail',
        'cut',
        'tr',
        'wc',
        'diff',
        'patch',
        'tar',
        'gzip',
        'curl',
        'wget',
        'ssh',
        'scp',
        'rsync',
        'git',
        'vim',
        'nano',
        'emacs',
        'gcc',
        'make',
        'python',
        'node',
        'npm',
        'docker',
        'kubectl',
        'terraform',
        'ansible',
        'nginx'
      ];

      const getSizeInfo = (sizeType) => {
        switch (sizeType) {
          case 'small':
            return { bytes: Math.floor(Math.random() * 50000) + 10000, desc: 'small' };
          case 'medium':
            return { bytes: Math.floor(Math.random() * 500000) + 100000, desc: 'medium' };
          case 'large':
            return { bytes: Math.floor(Math.random() * 5000000) + 1000000, desc: 'large' };
          default: // random
            const sizes = ['small', 'medium', 'large'];
            return getSizeInfo(sizes[Math.floor(Math.random() * sizes.length)]);
        }
      };

      let output = `Generating ${flags.count} binary files in /bin...\n\n`;
      let totalSize = 0;
      const generatedFiles = [];

      for (let i = 0; i < flags.count; i++) {
        const baseName = binaryNames[Math.floor(Math.random() * binaryNames.length)];
        const fileName = `${flags.prefix}_${baseName}_${i + 1}`;
        const sizeInfo = getSizeInfo(flags.size);
        const permissions = '755';
        const timestamp = new Date().toISOString();

        // Simulate file creation
        const fileInfo = {
          name: fileName,
          path: `/bin/${fileName}`,
          size: sizeInfo.bytes,
          permissions: permissions,
          type: 'executable',
          created: timestamp,
          description: `Mock ${baseName} utility`
        };

        generatedFiles.push(fileInfo);
        totalSize += sizeInfo.bytes;

        // Show progress
        const sizeStr =
          sizeInfo.bytes > 1024 * 1024
            ? `${(sizeInfo.bytes / (1024 * 1024)).toFixed(1)}MB`
            : `${Math.floor(sizeInfo.bytes / 1024)}KB`;

        output += `✅ ${fileName.padEnd(20)} ${sizeStr.padStart(8)} ${permissions} ${
          sizeInfo.desc
        }\n`;
      }

      // Summary
      const totalSizeStr =
        totalSize > 1024 * 1024
          ? `${(totalSize / (1024 * 1024)).toFixed(1)}MB`
          : `${Math.floor(totalSize / 1024)}KB`;

      output += `\n📊 Generation Summary:\n`;
      output += `   Files created: ${flags.count}\n`;
      output += `   Total size: ${totalSizeStr}\n`;
      output += `   Location: /bin/\n`;
      output += `   Prefix: ${flags.prefix}\n`;

      // Store in localStorage for persistence (simulate filesystem)
      try {
        const binData = {
          files: generatedFiles,
          generated: new Date().toISOString(),
          totalSize: totalSize
        };
        localStorage.setItem('fs_bin_generated', JSON.stringify(binData));
        output += `\n💾 Binary metadata saved to filesystem\n`;
      } catch (error) {
        output += `\n⚠️  Warning: Could not save to filesystem: ${error.message}\n`;
      }

      output += `\n💡 Use 'ls /bin' to see generated files\n`;
      output += `💡 Use 'file /bin/${flags.prefix}_*' to inspect file types\n`;

      return output;
    },
    'generate binary files for testing',
    'System'
  );
})();
