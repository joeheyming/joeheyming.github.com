// Fun/Easter Egg Commands for Heyming Terminal
(function () {
  'use strict';

  const funCommands = {
    npm: {
      handler: (terminal, args) => {
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
      },
      description: '"install" packages with style'
    },

    sudo: {
      handler: (terminal, args) => {
        const responses = [
          'Nice try! But this is a fake terminal, not real sudo 😏',
          'user is not in the sudoers file. This incident will be reported... to /dev/null',
          "Error: sudo is not installed. Try 'apt install sudo' (which also won't work)",
          'Permission denied. Have you tried asking nicely? Please? Pretty please?',
          "sudo: command not found (because you're not the boss of me)",
          'Access denied. This terminal runs on democracy, not dictatorship!'
        ];

        return responses[Math.floor(Math.random() * responses.length)];
      },
      description: "try to run as admin (spoiler: you can't)"
    },

    hack: {
      handler: (terminal, args) => {
        const hackSequence = [
          '🔍 Scanning for vulnerabilities...',
          '💻 Initiating hack sequence...',
          '🌐 Bypassing firewall...',
          '🔐 Cracking passwords...',
          '📡 Accessing mainframe...',
          '🎯 Target acquired...',
          '✨ HACK COMPLETE!',
          '',
          "🎬 Congratulations! You're now a movie hacker!",
          '💡 Pro tip: Real hacking involves way more reading documentation and way less dramatic typing.'
        ];

        return hackSequence.join('\n');
      },
      description: 'become a movie hacker'
    },

    matrix: {
      handler: (terminal, args) => {
        if (terminal.isStandalone) {
          // Standalone mode - create animated matrix effect
          funCommands.matrix.startMatrix(terminal);
          return '';
        } else {
          // OS mode - simple text version
          return `🟢 Entering the Matrix...

01001000 01100101 01101100 01101100 01101111 
01001110 01100101 01101111
01010100 01101000 01100101 01110010 01100101 
01101001 01110011 00100000 01101110 01101111 
01110011 01110000 01101111 01101111 01101110

💊 You took the red pill! (Or was it the blue one?)
🕶️  Welcome to the desert of the real... terminal.`;
        }
      },
      description: 'enter the matrix',

      // Matrix effect methods
      startMatrix: (terminal) => {
        if (!terminal.isStandalone) return;

        const terminalOutput = document.getElementById('terminal-output');
        const matrixContainer = document.createElement('div');
        matrixContainer.className = 'matrix-container';
        matrixContainer.innerHTML = '<div class="matrix-text">Entering the Matrix...</div>';
        terminalOutput.appendChild(matrixContainer);

        setTimeout(() => {
          matrixContainer.innerHTML = '<div class="matrix-rain"></div>';
          funCommands.matrix.createMatrixRain(matrixContainer.querySelector('.matrix-rain'));
        }, 2000);
      },

      createMatrixRain: (container) => {
        const chars =
          '｢｣､ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+-=[]{}|;:,.<>?';
        const terminalOutput = document.getElementById('terminal-output');
        const columns = Math.floor(terminalOutput.offsetWidth / 20);
        const drops = [];

        // Initialize drops
        for (let i = 0; i < columns; i++) {
          drops[i] = 1;
        }

        // Set container styles for matrix effect
        container.style.position = 'relative';
        container.style.height = '400px';
        container.style.background = '#000';
        container.style.overflow = 'hidden';

        function draw() {
          const html = [];
          for (let i = 0; i < drops.length; i++) {
            const char = chars[Math.floor(Math.random() * chars.length)];
            const style = `position: absolute; left: ${i * 20}px; top: ${
              drops[i] * 20
            }px; color: #0f0; font-family: monospace; font-size: 16px; text-shadow: 0 0 5px #0f0;`;
            html.push(`<span style="${style}">${char}</span>`);

            if (drops[i] * 20 > 400 && Math.random() > 0.975) {
              drops[i] = 0;
            }
            drops[i]++;
          }
          container.innerHTML = html.join('');
        }

        const interval = setInterval(draw, 100);

        // Stop after 10 seconds and show Matrix message
        setTimeout(() => {
          clearInterval(interval);
          container.innerHTML = `
            <div style="text-align: center; color: #0f0; font-family: monospace; margin: 20px 0; text-shadow: 0 0 10px #0f0;">
              <div style="font-size: 18px; margin-bottom: 10px;">Wake up, Neo...</div>
              <div style="font-size: 16px; margin-bottom: 8px;">The Matrix has you...</div>
              <div style="font-size: 16px; margin-bottom: 8px;">Follow the white rabbit.</div>
              <div style="font-size: 16px; margin-bottom: 8px;">Knock, knock, Neo.</div>
              <div style="font-size: 14px; margin-top: 20px; color: #0a0;">
                💊 You took the red pill! Welcome to the desert of the real.
              </div>
            </div>
          `;
        }, 10000);
      }
    },

    sl: {
      handler: (terminal, args) => {
        return `🚂 Choo choo! Did you mean 'ls'?
    
        ====        ________                ___________
    _D _|  |_______/        \\__I_I_____===__|_________|
     |(_)---  |   H\\________/ |   |        =|___ ___|      _________________
     /     |  |   H  |  |     |   |         ||_| |_||     _|                \\_____A
    |      |  |   H  |__--------------------| [___] |   =|                        |
    | ________|___H__/__|_____/[][]~\\_______|       |   -|                        |
    |/ |   |-----------I_____I [][] []  D   |=======|____|________________________|_
  __/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__|__________________________|_
   |/-=|___|=    ||    ||    ||    |_____/~\\___/          |_D__D__D_|  |_D__D__D_|
    \\_/      \\O=====O=====O=====O_/      \\_/               \\_/   \\_/    \\_/   \\_/

🎵 This train is bound for glory, this train! (The 'sl' easter egg lives on!)`;
      },
      description: 'steam locomotive (typo of ls)'
    },

    cowsay: {
      handler: (terminal, args) => {
        const message = args.join(' ') || 'Moo!';
        const messageLength = message.length;
        const topBorder = ' ' + '_'.repeat(messageLength + 2);
        const bottomBorder = ' ' + '-'.repeat(messageLength + 2);

        return `${topBorder}
< ${message} >
${bottomBorder}
        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||`;
      },
      description: 'make a cow say something'
    },

    fortune: {
      handler: (terminal, args) => {
        const fortunes = [
          'A computer program does what you tell it to do, not what you want it to do.',
          "There are only 10 types of people: those who understand binary and those who don't.",
          '99 bugs in the code, 99 bugs in the code. Take one down, patch it around, 127 bugs in the code.',
          'Programming is like sex: one mistake and you have to support it for the rest of your life.',
          "A user interface is like a joke. If you have to explain it, it's not that good.",
          'Real programmers count from 0.',
          'There are two hard things in computer science: cache invalidation and naming things.',
          'It works on my machine ¯\\_(ツ)_/¯',
          'DEBUGGING: Removing the needles from the haystack.',
          "Coffee: The programmer's way of turning caffeine into code."
        ];

        return '🔮 ' + fortunes[Math.floor(Math.random() * fortunes.length)];
      },
      description: 'get a random fortune'
    },

    rick: {
      handler: (terminal, args) => {
        const noVideo = args && args.includes('--no-video');

        if (!noVideo) {
          // Actually Rick Roll the user by opening the video
          setTimeout(() => {
            window.open('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '_blank');
          }, 1000);
        }

        const baseMessage = `🎵 Never gonna give you up, never gonna let you down!

🕺 You just got Rick Roll'd in a terminal!

Did you know? Rick Astley's "Never Gonna Give You Up" has been 
viewed over 1 billion times on YouTube. That's a lot of Rick Rolling!

🎤 "We're no strangers to love..."`;

        if (noVideo) {
          return `${baseMessage}

😌 Safe mode: No video opened this time!
🔗 But here's the URL anyway: https://www.youtube.com/watch?v=dQw4w9WgXcQ`;
        }

        return `${baseMessage}

🔗 Opening: https://www.youtube.com/watch?v=dQw4w9WgXcQ
⏰ Video will open in 3... 2... 1...

💡 Pro tip: You can also try 'rick --no-video' to avoid the actual Rick Roll!`;
      },
      description: 'get rick rolled'
    },

    coffee: {
      handler: (terminal, args) => {
        const responses = [
          '☕ Brewing coffee... Error: Coffee machine not found. Have you tried turning it off and on again?',
          '☕ Order placed! Your virtual coffee will arrive in 0 seconds. ⚡',
          "☕ HTTP 418: I'm a teapot. Cannot brew coffee.",
          '☕ Coffee.exe has stopped working. Please restart your Monday.',
          "☕ Insufficient privileges to access coffee. Try 'sudo coffee'.",
          '☕ Coffee successful! +10 productivity, +5 jitter, -3 sleep.'
        ];

        return responses[Math.floor(Math.random() * responses.length)];
      },
      description: 'order coffee'
    },

    pizza: {
      handler: (terminal, args) => {
        return `🍕 Pizza ordering system initialized...

📞 Calling Pizza Palace...
🛵 Delivery ETA: 30 minutes (or it's free!)
💰 Total: $12.99 (paid with fake money)

🍕 Your virtual pizza is on the way!
Toppings: Pepperoni, cheese, and a sprinkle of binary code.

⚠️  Warning: Virtual pizza provides no actual nutrition.`;
      },
      description: 'order pizza'
    },

    joke: {
      handler: (terminal, args) => {
        const jokes = [
          'Why do programmers prefer dark mode? Because light attracts bugs! 🐛',
          "How many programmers does it take to screw in a light bulb? None, that's a hardware problem.",
          "Why do Java developers wear glasses? Because they don't C#! 👓",
          "A SQL query walks into a bar, walks up to two tables and asks: 'Can I join you?'",
          "Why did the programmer quit his job? He didn't get arrays! 📊",
          'How do you comfort a JavaScript bug? You console it! 🤗',
          "Why don't programmers like nature? It has too many bugs! 🦗",
          "What's a programmer's favorite hangout place? Foo Bar! 🍺",
          'Why did the developer go broke? Because he used up all his cache! 💰',
          'What do you call a programmer from Finland? Nerdic! 🇫🇮'
        ];

        return '😂 ' + jokes[Math.floor(Math.random() * jokes.length)];
      },
      description: 'hear a programming joke'
    }
  };

  // Register all fun commands
  Object.entries(funCommands).forEach(([name, cmd]) => {
    registerCommand(name, cmd.handler, cmd.description, 'Fun Stuff');
  });
})();
