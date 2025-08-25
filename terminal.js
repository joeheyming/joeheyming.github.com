// Enhanced Terminal for Heyming OS
class Terminal {
  constructor(windowId, osInstance) {
    this.windowId = windowId;
    this.os = osInstance;
    this.currentDirectory = '/home/user';
    this.commandHistory = [];
    this.historyIndex = -1;
    this.fileSystem = this.initializeFileSystem();

    // Initialize terminal after a brief delay
    setTimeout(() => this.initialize(), 100);
  }

  initializeFileSystem() {
    return {
      '/': {
        type: 'directory',
        contents: {
          home: {
            type: 'directory',
            contents: {
              user: {
                type: 'directory',
                contents: {
                  Desktop: { type: 'directory', contents: {} },
                  Documents: {
                    type: 'directory',
                    contents: {
                      'readme.txt': { type: 'file', content: 'Welcome to Heyming OS!' },
                      'secret.txt': { type: 'file', content: '🤫 You found the secret file!' }
                    }
                  },
                  Downloads: { type: 'directory', contents: {} },
                  Pictures: {
                    type: 'directory',
                    contents: {
                      'selfie.jpg': { type: 'file', content: '📸 A totally real selfie file' }
                    }
                  },
                  Music: {
                    type: 'directory',
                    contents: {
                      'never_gonna_give_you_up.mp3': {
                        type: 'file',
                        content: '🎵 Rick Astley - Never Gonna Give You Up'
                      }
                    }
                  },
                  Videos: { type: 'directory', contents: {} }
                }
              }
            }
          },
          bin: {
            type: 'directory',
            contents: {
              bash: { type: 'file', content: '#!/bin/bash' },
              ls: { type: 'file', content: '#!/bin/ls' }
            }
          },
          etc: {
            type: 'directory',
            contents: {
              passwd: { type: 'file', content: 'user:x:1000:1000:User:/home/user:/bin/bash' },
              hosts: { type: 'file', content: '127.0.0.1 localhost\n::1 localhost' }
            }
          }
        }
      }
    };
  }

  initialize() {
    const windowElement = document.getElementById(`window-${this.windowId}`);
    const terminalInput = windowElement.querySelector('.terminal-input');

    if (!terminalInput) return;

    terminalInput.focus();
    this.bindInputEvents(terminalInput);
  }

  bindInputEvents(input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleCommand(input);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateHistory(-1, input);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateHistory(1, input);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.handleTabCompletion(input);
      }
    });
  }

  handleCommand(input) {
    const command = input.value.trim();
    const currentLine = input.closest('.terminal-line');

    // Add command to history
    if (command && command !== this.commandHistory[this.commandHistory.length - 1]) {
      this.commandHistory.push(command);
    }
    this.historyIndex = -1;

    // Remove input from current line and show command
    currentLine.innerHTML = `<span class="terminal-prompt">user@heyming-os:${this.getShortPath()}$</span> ${command}`;

    // Process command and get output
    const output = this.processCommand(command);

    // Add output if any
    if (output) {
      this.addOutput(output);
    }

    // Add new input line
    this.addNewInputLine();
    this.scrollToBottom();
  }

  processCommand(command) {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (cmd === '') return '';

    // Handle built-in commands
    const builtinCommands = {
      help: () => this.helpCommand(),
      ls: () => this.lsCommand(args),
      pwd: () => this.pwdCommand(),
      whoami: () => 'user',
      date: () => new Date().toString(),
      clear: () => this.clearCommand(),
      echo: () => args.join(' '),
      cd: () => this.cdCommand(args),
      mkdir: () => this.mkdirCommand(args),
      touch: () => this.touchCommand(args),
      cat: () => this.catCommand(args),
      rm: () => this.rmCommand(args),
      cp: () => this.cpCommand(args),
      mv: () => this.mvCommand(args),
      grep: () => this.grepCommand(args),
      find: () => this.findCommand(args),

      // Easter eggs and fun commands
      npm: () => this.npmCommand(args),
      sudo: () => this.sudoCommand(args),
      hack: () => this.hackCommand(),
      matrix: () => this.matrixCommand(),
      sl: () => this.slCommand(),
      cowsay: () => this.cowsayCommand(args),
      fortune: () => this.fortuneCommand(),
      rick: () => this.rickCommand(args),
      coffee: () => this.coffeeCommand(),
      pizza: () => this.pizzaCommand(),
      joke: () => this.jokeCommand(),

      // System commands
      calculator: () => this.launchAppCommand('calculator'),
      notepad: () => this.launchAppCommand('notepad'),
      exit: () => 'Goodbye! (Window will close)',
      version: () => 'Heyming OS Terminal v2.0 - Now with 100% more jokes! 🎉',
      uptime: () => 'System has been running for ' + Math.floor(Math.random() * 100) + ' hours',
      ps: () => 'PID TTY TIME CMD\n1234 pts/0 00:00:01 terminal\n5678 pts/0 00:00:00 fake-process'
    };

    if (builtinCommands[cmd]) {
      return builtinCommands[cmd]();
    }

    return `bash: ${cmd}: command not found\nTry 'help' for available commands or 'sudo apt install ${cmd}' to pretend to install it! 😄`;
  }

  // Built-in command implementations
  helpCommand() {
    return `Available commands:
    
📁 File System:
  ls [dir]         - list directory contents
  cd [dir]         - change directory
  pwd              - print working directory
  mkdir <dir>      - create directory
  touch <file>     - create empty file
  cat <file>       - display file contents
  rm <file>        - remove file
  cp <src> <dst>   - copy file
  mv <src> <dst>   - move/rename file
  
🔍 Search:
  grep <pattern>   - search for pattern
  find <name>      - find files by name
  
📊 System:
  whoami           - display username
  date             - display current date/time
  uptime           - system uptime
  ps               - list processes
  version          - show terminal version
  
🚀 Apps:
  calculator       - launch calculator
  notepad          - launch notepad
  
🎪 Fun Stuff:
  npm install      - "install" packages with style
  sudo <cmd>       - try to run as admin (spoiler: you can't)
  hack             - become a movie hacker
  matrix           - enter the matrix
  cowsay <text>    - make a cow say something
  fortune          - get a random fortune
  rick             - get rick rolled
  coffee           - order coffee
  pizza            - order pizza
  joke             - hear a programming joke
  
💡 Pro Tips:
  - Use arrow keys to navigate command history
  - Tab completion works for commands
  - clear/Ctrl+L to clear screen`;
  }

  lsCommand(args) {
    const targetDir = args[0] || this.currentDirectory;
    const fullPath = this.resolvePath(targetDir);
    const item = this.getFileSystemItem(fullPath);

    if (!item || item.type !== 'directory') {
      return `ls: cannot access '${targetDir}': No such file or directory`;
    }

    const entries = Object.keys(item.contents);
    if (entries.length === 0) {
      return ''; // Empty directory
    }

    // Add color coding and formatting
    return entries
      .map((name) => {
        const entry = item.contents[name];
        if (entry.type === 'directory') {
          return `📁 ${name}`;
        } else {
          return `📄 ${name}`;
        }
      })
      .join('  ');
  }

  pwdCommand() {
    return this.currentDirectory;
  }

  cdCommand(args) {
    if (args.length === 0) {
      this.currentDirectory = '/home/user';
      return '';
    }

    const targetDir = args[0];
    const newPath = this.resolvePath(targetDir);
    const item = this.getFileSystemItem(newPath);

    if (!item) {
      return `cd: no such file or directory: ${targetDir}`;
    }

    if (item.type !== 'directory') {
      return `cd: not a directory: ${targetDir}`;
    }

    this.currentDirectory = newPath;
    return '';
  }

  catCommand(args) {
    if (args.length === 0) {
      return 'cat: missing file operand';
    }

    const filePath = this.resolvePath(args[0]);
    const item = this.getFileSystemItem(filePath);

    if (!item) {
      return `cat: ${args[0]}: No such file or directory`;
    }

    if (item.type !== 'file') {
      return `cat: ${args[0]}: Is a directory`;
    }

    return item.content || '[binary file]';
  }

  clearCommand() {
    // This needs special handling to actually clear the terminal
    setTimeout(() => {
      const windowElement = document.getElementById(`window-${this.windowId}`);
      const terminalContent = windowElement.querySelector('.terminal-content');
      terminalContent.innerHTML = `
        <div class="terminal-line">
          <span class="terminal-prompt">user@heyming-os:${this.getShortPath()}$</span> <input type="text" class="terminal-input" placeholder="Type a command...">
        </div>
      `;
      this.initialize();
    }, 100);
    return '';
  }

  // Easter egg commands
  npmCommand(args) {
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
  }

  sudoCommand(args) {
    const responses = [
      'Nice try! But this is a fake terminal, not real sudo 😏',
      'user is not in the sudoers file. This incident will be reported... to /dev/null',
      "Error: sudo is not installed. Try 'apt install sudo' (which also won't work)",
      'Permission denied. Have you tried asking nicely? Please? Pretty please?',
      "sudo: command not found (because you're not the boss of me)",
      'Access denied. This terminal runs on democracy, not dictatorship!'
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  hackCommand() {
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
  }

  matrixCommand() {
    return `🟢 Entering the Matrix...

01001000 01100101 01101100 01101100 01101111 
01001110 01100101 01101111
01010100 01101000 01100101 01110010 01100101 
01101001 01110011 00100000 01101110 01101111 
01110011 01110000 01101111 01101111 01101110

💊 You took the red pill! (Or was it the blue one?)
🕶️  Welcome to the desert of the real... terminal.`;
  }

  slCommand() {
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
  }

  cowsayCommand(args) {
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
  }

  fortuneCommand() {
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
  }

  rickCommand(args) {
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
  }

  coffeeCommand() {
    const responses = [
      '☕ Brewing coffee... Error: Coffee machine not found. Have you tried turning it off and on again?',
      '☕ Order placed! Your virtual coffee will arrive in 0 seconds. ⚡',
      "☕ HTTP 418: I'm a teapot. Cannot brew coffee.",
      '☕ Coffee.exe has stopped working. Please restart your Monday.',
      "☕ Insufficient privileges to access coffee. Try 'sudo coffee'.",
      '☕ Coffee successful! +10 productivity, +5 jitter, -3 sleep.'
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  pizzaCommand() {
    return `🍕 Pizza ordering system initialized...

📞 Calling Pizza Palace...
🛵 Delivery ETA: 30 minutes (or it's free!)
💰 Total: $12.99 (paid with fake money)

🍕 Your virtual pizza is on the way!
Toppings: Pepperoni, cheese, and a sprinkle of binary code.

⚠️  Warning: Virtual pizza provides no actual nutrition.`;
  }

  jokeCommand() {
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
  }

  launchAppCommand(appName) {
    this.os.launchApp(appName);
    return `Launching ${appName}...`;
  }

  // Helper methods
  resolvePath(path) {
    if (path.startsWith('/')) {
      return path;
    }

    if (path === '..') {
      const parts = this.currentDirectory.split('/').filter((p) => p);
      parts.pop();
      return '/' + parts.join('/');
    }

    if (path === '.') {
      return this.currentDirectory;
    }

    return this.currentDirectory === '/' ? `/${path}` : `${this.currentDirectory}/${path}`;
  }

  getFileSystemItem(path) {
    const parts = path.split('/').filter((p) => p);
    let current = this.fileSystem['/'];

    for (const part of parts) {
      if (current.type !== 'directory' || !current.contents[part]) {
        return null;
      }
      current = current.contents[part];
    }

    return current;
  }

  getShortPath() {
    if (this.currentDirectory === '/home/user') {
      return '~';
    }
    if (this.currentDirectory.startsWith('/home/user/')) {
      return '~' + this.currentDirectory.substring(10);
    }
    return this.currentDirectory;
  }

  navigateHistory(direction, input) {
    if (this.commandHistory.length === 0) return;

    if (direction === -1) {
      // Go back in history
      if (this.historyIndex === -1) {
        this.historyIndex = this.commandHistory.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex--;
      }
    } else {
      // Go forward in history
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
      } else {
        this.historyIndex = -1;
        input.value = '';
        return;
      }
    }

    input.value = this.commandHistory[this.historyIndex] || '';
  }

  handleTabCompletion(input) {
    const value = input.value;
    const parts = value.split(' ');
    const lastPart = parts[parts.length - 1];

    // Command completion
    if (parts.length === 1) {
      const commands = [
        'help',
        'ls',
        'cd',
        'pwd',
        'cat',
        'mkdir',
        'touch',
        'npm',
        'sudo',
        'hack',
        'matrix',
        'coffee',
        'pizza',
        'joke'
      ];
      const matches = commands.filter((cmd) => cmd.startsWith(lastPart));

      if (matches.length === 1) {
        input.value = matches[0] + ' ';
      }
    }
  }

  addOutput(output) {
    const windowElement = document.getElementById(`window-${this.windowId}`);
    const terminalContent = windowElement.querySelector('.terminal-content');

    const outputLines = output.split('\n');
    outputLines.forEach((line) => {
      const outputElement = document.createElement('div');
      outputElement.className = 'terminal-line';
      outputElement.textContent = line;
      terminalContent.appendChild(outputElement);
    });
  }

  addNewInputLine() {
    const windowElement = document.getElementById(`window-${this.windowId}`);
    const terminalContent = windowElement.querySelector('.terminal-content');

    const newLine = document.createElement('div');
    newLine.className = 'terminal-line';
    newLine.innerHTML = `<span class="terminal-prompt">user@heyming-os:${this.getShortPath()}$</span> <input type="text" class="terminal-input" placeholder="Type a command...">`;
    terminalContent.appendChild(newLine);

    const newInput = newLine.querySelector('.terminal-input');
    newInput.focus();
    this.bindInputEvents(newInput);
  }

  scrollToBottom() {
    const windowElement = document.getElementById(`window-${this.windowId}`);
    const terminalContent = windowElement.querySelector('.terminal-content');
    terminalContent.scrollTop = terminalContent.scrollHeight;
  }

  // File system manipulation methods (for mkdir, touch, etc.)
  mkdirCommand(args) {
    if (args.length === 0) {
      return 'mkdir: missing operand';
    }

    return `mkdir: '${args[0]}' - Directory creation is read-only in this demo! But nice try! 📁`;
  }

  touchCommand(args) {
    if (args.length === 0) {
      return 'touch: missing file operand';
    }

    return `touch: '${args[0]}' - File creation is read-only in this demo! But nice try! 📄`;
  }

  rmCommand(args) {
    if (args.length === 0) {
      return 'rm: missing operand';
    }

    if (args.includes('-rf') && (args.includes('/') || args.includes('*'))) {
      return `🚨 WHOA THERE! 🚨
rm -rf / is dangerous! Good thing this is a fake terminal!

💡 Fun fact: This command would delete everything on a real system.
🛡️  Always be careful with rm -rf in real life!
☕ Maybe have some coffee first: try 'coffee'`;
    }

    return `rm: cannot remove '${
      args[args.length - 1]
    }': Read-only file system (and this is just a demo!)`;
  }

  cpCommand(args) {
    if (args.length < 2) {
      return 'cp: missing destination file operand';
    }

    return `cp: '${args[0]}' -> '${args[1]}' - File operations are read-only in this demo!`;
  }

  mvCommand(args) {
    if (args.length < 2) {
      return 'mv: missing destination file operand';
    }

    return `mv: '${args[0]}' -> '${args[1]}' - File operations are read-only in this demo!`;
  }

  grepCommand(args) {
    if (args.length === 0) {
      return 'grep: missing pattern';
    }

    return `grep: searching for '${args[0]}' - Found 42 matches! (Just kidding, this is a demo)`;
  }

  findCommand(args) {
    if (args.length === 0) {
      return 'find: missing file name';
    }

    return `find: searching for '${args[0]}' - Check behind the couch! 🛋️ (This is a demo)`;
  }
}

// Export for use in os.js
window.Terminal = Terminal;
