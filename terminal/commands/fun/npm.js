// npm command - "install" packages with style
(function () {
  'use strict';

  registerCommand('npm', (terminal, args) => {
    if (args[0] === 'install') {
      const packages = args.slice(1);
      if (packages.length === 0) {
        return '📦 npm install\n\nInstalling all dependencies from package.json...\n⚠️  Warning: This might take a while (like, the heat death of the universe)';
      }

      const jokes = [
        `📦 Installing ${packages.join(
          ', '
        )}...\n⬇️  Downloading 47,382 dependencies (only 47,381 are unnecessary)\n📁 Adding 2.3GB to node_modules\n🎉 Successfully installed! Your project now depends on the entire internet.`,
        `📦 npm WARN deprecated ${packages[0]}@1.0.0: This package was deprecated 5 minutes ago\n📦 Installing anyway because YOLO\n🔒 Found 247 security vulnerabilities (245 high, 2 critical)\n🎉 Installation complete! Good luck debugging this!`,
        `📦 Installing ${packages[0]}...\n🚀 Compiling native dependencies...\n☕ This is a good time for coffee...\n⏰ Still compiling...\n🎯 Almost there...\n💥 Installation failed! Try turning it off and on again.`
      ];

      return jokes[Math.floor(Math.random() * jokes.length)];
    }

    return `📦 npm - Node Package Manager (Fake Edition)\nUsage: npm install [package] - Install packages and regret life choices`;
  }, '"install" packages with style', 'Fun Stuff');
})();
