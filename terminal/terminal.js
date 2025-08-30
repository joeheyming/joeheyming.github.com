document.addEventListener('DOMContentLoaded', () => {
  const terminalOutput = document.getElementById('terminal-output');
  const terminalInput = document.getElementById('terminal-input');
  let commandHistory = [];
  let historyIndex = -1;
  let currentDirectory = '/home/user';
  let environment = {
    PATH: '/usr/bin:/bin:/usr/local/bin',
    USER: 'user',
    HOME: '/home/user',
    PWD: '/home/user'
  };

  let voicesLoaded = false;
  let voicesReadyCallback = null;

  function initializeVoices() {
    const synth = window.speechSynthesis;
    synth.onvoiceschanged = () => {
      voicesLoaded = true;
      if (voicesReadyCallback) {
        voicesReadyCallback();
        voicesReadyCallback = null;
      }
    };
  }

  // Terminal startup
  printWelcome();
  printPrompt();

  // Add click listener to focus terminal when clicking anywhere
  document.addEventListener('click', () => {
    terminalInput.focus();
  });

  terminalInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const input = terminalInput.value;
      terminalInput.value = '';
      addToHistory(input);
      processCommand(input);
      printPrompt();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      navigateHistory('up');
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      navigateHistory('down');
    } else if (event.key === 'Tab') {
      event.preventDefault();
      autoComplete();
    } else if (event.ctrlKey) {
      event.preventDefault();
      handleCtrlShortcuts(event);
    }
  });

  function handleCtrlShortcuts(event) {
    const input = terminalInput;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const value = input.value;

    switch (event.key) {
      case 'w': // Ctrl+W: Delete word backwards
        const beforeCursor = value.substring(0, start);
        // Find the last word boundary, handling multiple spaces
        let lastWordStart = beforeCursor.length;
        let foundSpace = false;

        for (let i = beforeCursor.length - 1; i >= 0; i--) {
          if (beforeCursor[i] === ' ') {
            if (!foundSpace) {
              foundSpace = true;
            }
          } else {
            if (foundSpace) {
              lastWordStart = i + 1;
              break;
            }
            lastWordStart = i;
          }
        }

        const newValue = value.substring(0, lastWordStart) + value.substring(end);
        input.value = newValue;
        input.setSelectionRange(lastWordStart, lastWordStart);
        break;

      case 'u': // Ctrl+U: Delete line backwards
        input.value = value.substring(end);
        input.setSelectionRange(0, 0);
        break;

      case 'k': // Ctrl+K: Delete line forwards
        input.value = value.substring(0, start);
        input.setSelectionRange(start, start);
        break;

      case 'a': // Ctrl+A: Move to beginning of line
        input.setSelectionRange(0, 0);
        break;

      case 'e': // Ctrl+E: Move to end of line
        input.setSelectionRange(value.length, value.length);
        break;

      case 'l': // Ctrl+L: Clear screen
        terminalOutput.innerHTML = '';
        break;

      case 'c': // Ctrl+C: Interrupt (clear current line)
        input.value = '';
        appendOutput('^C', 'interrupt');
        break;

      case 'd': // Ctrl+D: EOF (exit if line is empty)
        if (value.length === 0) {
          appendOutput('exit', 'exit');
          // Could implement actual exit functionality here
        }
        break;

      case 'r': // Ctrl+R: Reverse search
        let searchTerm = prompt('Enter search term:');
        if (searchTerm) {
          const foundCommand = commandHistory.reverse().find((cmd) => cmd.includes(searchTerm));
          if (foundCommand) {
            terminalInput.value = foundCommand;
          } else {
            appendOutput(`No matching command found for: ${searchTerm}`, 'error');
          }
          commandHistory.reverse(); // Restore original order
        }
        break;

      case 't': // Ctrl+T: Transpose characters
        if (start > 0 && start < value.length) {
          const before = value.substring(0, start - 1);
          const char1 = value.charAt(start - 1);
          const char2 = value.charAt(start);
          const after = value.substring(start + 1);
          input.value = before + char2 + char1 + after;
          input.setSelectionRange(start, start);
        }
        break;

      case 'h': // Ctrl+H: Backspace (same as Backspace)
        if (start > 0) {
          input.value = value.substring(0, start - 1) + value.substring(end);
          input.setSelectionRange(start - 1, start - 1);
        }
        break;

      case 'f': // Ctrl+F: Forward character
        if (end < value.length) {
          input.setSelectionRange(end + 1, end + 1);
        }
        break;

      case 'b': // Ctrl+B: Backward character
        if (start > 0) {
          input.setSelectionRange(start - 1, start - 1);
        }
        break;
    }
  }

  function printWelcome() {
    const welcome = `
╔══════════════════════════════════════════════════════════════╗
║                    Welcome to Heyming Terminal v2.0          ║
║                                                              ║
║  Type 'help' for available commands                          ║
║  Type 'matrix' for a special surprise!                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
        `;
    appendOutput(welcome, 'welcome');
  }

  function printPrompt() {
    const promptText = document.getElementById('prompt-text');
    promptText.innerHTML = `${environment.USER}@heyming-os:${currentDirectory}$ `;
    terminalInput.focus();
  }

  function appendOutput(text, className = '') {
    const output = document.createElement('div');
    output.className = `terminal-output ${className}`;
    output.innerHTML = text;
    terminalOutput.appendChild(output);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  function addToHistory(command) {
    if (command.trim()) {
      commandHistory.push(command);
      if (commandHistory.length > 50) commandHistory.shift();
    }
    historyIndex = commandHistory.length;
  }

  function navigateHistory(direction) {
    if (direction === 'up' && historyIndex > 0) {
      historyIndex--;
      terminalInput.value = commandHistory[historyIndex];
    } else if (direction === 'down' && historyIndex < commandHistory.length - 1) {
      historyIndex++;
      terminalInput.value = commandHistory[historyIndex];
    } else if (direction === 'down' && historyIndex === commandHistory.length - 1) {
      historyIndex++;
      terminalInput.value = '';
    }
  }

  function autoComplete() {
    const commands = [
      'help',
      'ls',
      'cd',
      'pwd',
      'cat',
      'echo',
      'touch',
      'matrix',
      'cowsay',
      'fortune',
      'neofetch',
      'ping',
      'top',
      'ps',
      'kill',
      'date',
      'whoami',
      'uname',
      'history',
      'clear'
    ];
    const input = terminalInput.value;
    const matches = commands.filter((cmd) => cmd.startsWith(input));

    if (matches.length === 1) {
      terminalInput.value = matches[0];
    } else if (matches.length > 1) {
      appendOutput(matches.join(' '), 'autocomplete');
    }
  }

  function processCommand(input) {
    const args = input.trim().split(' ');
    const command = args[0];
    const params = args.slice(1);

    // Add the command to output history
    const commandLine = document.createElement('div');
    commandLine.className = 'terminal-line';
    commandLine.innerHTML = `<span class="prompt">${environment.USER}@heyming-os:${currentDirectory}$</span> ${input}`;
    terminalOutput.appendChild(commandLine);

    switch (command) {
      case 'help':
        showHelp();
        break;
      case 'ls':
        listFiles(params);
        break;
      case 'cd':
        changeDirectory(params[0]);
        break;
      case 'pwd':
        appendOutput(currentDirectory, 'success');
        break;
      case 'cat':
        catFile(params[0]);
        break;
      case 'echo':
        appendOutput(params.join(' '), 'echo');
        break;
      case 'touch':
        touchFile(params[0]);
        break;
      case 'matrix':
        startMatrix();
        break;
      case 'cowsay':
        cowsay(params.join(' '));
        break;
      case 'fortune':
        showFortune();
        break;
      case 'neofetch':
        showNeofetch();
        break;
      case 'ping':
        pingHost(params[0]);
        break;
      case 'top':
        showTop();
        break;
      case 'ps':
        showProcesses();
        break;
      case 'kill':
        killProcess(params[0]);
        break;
      case 'date':
        appendOutput(new Date().toString(), 'date');
        break;
      case 'whoami':
        appendOutput(environment.USER, 'whoami');
        break;
      case 'uname':
        appendOutput('Linux heyming-os 5.15.0-generic #1 SMP PREEMPT', 'uname');
        break;
      case 'history':
        showHistory();
        break;
      case 'clear':
        terminalOutput.innerHTML = '';
        break;
      case 'hollywood':
        hollywood();
        break;
      case 'say':
        handleSayCommand(params);
        break;
      case '':
        break;
      default:
        appendOutput(`bash: ${command}: command not found`, 'error');
    }
  }

  function handleSayCommand(params) {
    if (params.includes('--list')) {
      listVoices();
      return;
    }
    if (params.includes('--help')) {
      showSayHelp();
      return;
    }
    const voiceIndex = params.indexOf('--voice');
    let voiceName = 'Google US English'; // Default voice
    if (voiceIndex !== -1 && params[voiceIndex + 1]) {
      voiceName = params[voiceIndex + 1];
      params.splice(voiceIndex, 2); // Remove --voice and its value
    }
    const text = params.join(' ');
    say(text, voiceName);
  }

  function listVoices() {
    if (!voicesLoaded) {
      voicesReadyCallback = listVoices;
      appendOutput('Loading voices, please try again.', 'error');
      return;
    }
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const voiceList = voices.map((voice) => voice.name).join('<br>');
    appendOutput(`Available voices:<br>${voiceList}`, 'info');
  }

  function showSayHelp() {
    const helpText = `
    say [text] - Speak the text with the default voice<br>
    say --voice [voiceName] [text] - Speak the text with the specified voice<br>
    say --list - List available voices<br>
    say --help - Show this help message
  `;
    appendOutput(helpText, 'info');
  }

  function say(text, voiceName) {
    appendOutput(text, 'say');
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const selectedVoice = voices.find((voice) => voice.name === voiceName);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    synth.speak(utterance);
  }

  function showHelp() {
    const help = `
Available commands:
  File System:
    ls [directory]     - List files and directories
    cd [directory]     - Change directory
    pwd               - Print working directory
    cat [file]        - Display file contents
    echo [text]       - Print text
    touch [file]      - Create empty file

  System:
    date              - Show current date/time
    whoami            - Show current user
    uname             - Show system information
    top               - Show running processes
    ps                - List processes
    kill [pid]        - Kill process

  Fun Commands:
    matrix            - Matrix rain effect
    say [text]        - Say something
    cowsay [text]     - ASCII cow says something
    fortune           - Get a fortune
    neofetch          - System info display
    ping [host]       - Ping a host
    history           - Show command history
    hollywood         - Start Hollywood terminal simulation

  Utilities:
    help              - Show this help
    clear             - Clear terminal
        `;
    appendOutput(help, 'help');
  }

  function listFiles(params) {
    const files = [
      { name: 'Documents', type: 'dir' },
      { name: 'Downloads', type: 'dir' },
      { name: 'Pictures', type: 'dir' },
      { name: 'readme.txt', type: 'file' },
      { name: 'config.json', type: 'file' },
      { name: 'script.sh', type: 'file' }
    ];

    let output = '';
    files.forEach((file) => {
      const color = file.type === 'dir' ? 'blue' : 'green';
      output += `<span style="color: ${color};">${file.name}</span>  `;
    });
    appendOutput(output, 'ls');
  }

  function changeDirectory(dir) {
    if (!dir || dir === '~') {
      currentDirectory = environment.HOME;
    } else if (dir === '..') {
      currentDirectory = currentDirectory.split('/').slice(0, -1).join('/') || '/';
    } else if (dir.startsWith('/')) {
      currentDirectory = dir;
    } else {
      currentDirectory += '/' + dir;
    }
    environment.PWD = currentDirectory;
  }

  function catFile(filename) {
    const files = {
      'readme.txt': 'Welcome to Heyming Terminal!\nThis is a fun terminal simulation.',
      'config.json': '{\n  "theme": "dark",\n  "user": "awesome"\n}',
      'script.sh': '#!/bin/bash\necho "Hello from bash!"'
    };

    if (files[filename]) {
      appendOutput(files[filename], 'cat');
    } else {
      appendOutput(`cat: ${filename}: No such file or directory`, 'error');
    }
  }

  function touchFile(filename) {
    appendOutput(`Created file: ${filename}`, 'success');
  }

  function startMatrix() {
    const matrixOutput = document.createElement('div');
    matrixOutput.className = 'matrix-container';
    matrixOutput.innerHTML = '<div class="matrix-text">Entering the Matrix...</div>';
    terminalOutput.appendChild(matrixOutput);

    setTimeout(() => {
      matrixOutput.innerHTML = '<div class="matrix-rain"></div>';
      createMatrixRain(matrixOutput.querySelector('.matrix-rain'));
    }, 2000);
  }

  function createMatrixRain(container) {
    const chars =
      '｢｣､ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+-=[]{}|;:,.<>?';
    const columns = Math.floor(container.offsetWidth / 20);
    const drops = [];

    // Initialize drops
    for (let i = 0; i < columns; i++) {
      drops[i] = 1;
    }

    function draw() {
      const html = [];
      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const style = `position: absolute; left: ${i * 20}px; top: ${
          drops[i] * 20
        }px; color: #0f0; font-family: monospace; font-size: 16px;`;
        html.push(`<span style="${style}">${char}</span>`);

        if (drops[i] * 20 > container.offsetHeight && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
      container.innerHTML = html.join('');
    }

    const interval = setInterval(draw, 100);

    // Stop after 10 seconds
    setTimeout(() => {
      clearInterval(interval);
      container.innerHTML = `
        <div style="text-align: center; color: #0f0; font-family: monospace; margin: 20px 0;">
          <span style="color: #0f0;">Wake up, Neo...</span><br>
          <span style="color: #0f0;">The Matrix has you...</span><br>
          <span style="color: #0f0;">Follow the white rabbit.</span><br>
          <span style="color: #0f0;">Knock, knock, Neo.</span>
        </div>
      `;
    }, 10000);
  }

  function cowsay(text) {
    const cow = `
 ${text}
        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||
        `;
    appendOutput(cow, 'cowsay');
  }

  function showFortune() {
    const fortunes = [
      'You will find a bug in your code today, but it will be easy to fix.',
      'A clean workspace leads to a clean mind.',
      'Your next commit will be perfect.',
      'The best code is no code at all.',
      'You will solve a complex problem with a simple solution.',
      'Your debugging skills will be tested today.'
    ];
    appendOutput(fortunes[Math.floor(Math.random() * fortunes.length)], 'fortune');
  }

  function showNeofetch() {
    const neofetch = `
user@heyming-os
----------------
OS: Heyming OS 2.0
Kernel: Linux 5.15.0-generic
Shell: bash 5.1.16
Terminal: Heyming Terminal
CPU: Intel i7-12700K
Memory: 16GB RAM
Disk: 1TB SSD
Uptime: 3 days, 7 hours
        `;
    appendOutput(neofetch, 'neofetch');
  }

  function pingHost(host) {
    if (!host) host = 'google.com';
    appendOutput(`PING ${host} (142.250.191.78) 56(84) bytes of data.`, 'ping');
    setTimeout(() => {
      appendOutput('64 bytes from 142.250.191.78: icmp_seq=1 ttl=113 time=15.2 ms', 'ping');
    }, 500);
    setTimeout(() => {
      appendOutput('64 bytes from 142.250.191.78: icmp_seq=2 ttl=113 time=14.8 ms', 'ping');
    }, 1000);
    setTimeout(() => {
      appendOutput('--- google.com ping statistics ---', 'ping');
      appendOutput('2 packets transmitted, 2 received, 0% packet loss, time 1001ms', 'ping');
    }, 1500);
  }

  function showTop() {
    const top = `
top - 14:30:15 up 3 days,  7:15,  1 user,  load average: 0.52, 0.58, 0.55
Tasks: 245 total,   1 running, 244 sleeping,   0 stopped,   0 zombie
%Cpu(s):  2.1 us,  1.2 sy,  0.0 ni, 96.5 id,  0.2 wa,  0.0 hi,  0.0 si,  0.0 st
MiB Mem :  16384.0 total,  10240.0 free,   2048.0 used,   4096.0 buff/cache
MiB Swap:   8192.0 total,   8192.0 free,      0.0 used.  13312.0 avail Mem

  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
 1234 user      20   0  1234567  12345  1234 S   2.1   0.1   0:15.23 terminal
 5678 user      20   0   987654   9876   987 S   1.8   0.1   0:12.45 browser
 9012 user      20   0   654321   6543   654 S   1.5   0.0   0:08.92 editor
        `;
    appendOutput(top, 'top');
  }

  function showProcesses() {
    const ps = `
  PID TTY          TIME CMD
 1234 pts/0    00:00:15 terminal
 5678 pts/0    00:00:12 browser
 9012 pts/0    00:00:08 editor
13456 pts/0    00:00:05 shell
        `;
    appendOutput(ps, 'ps');
  }

  function killProcess(pid) {
    if (!pid) {
      appendOutput(
        'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]',
        'error'
      );
      return;
    }
    appendOutput(`Process ${pid} killed`, 'success');
  }

  function showHistory() {
    let output = '';
    commandHistory.forEach((cmd, index) => {
      output += `${index + 1}  ${cmd}\n`;
    });
    appendOutput(output, 'history');
  }

  function hollywood() {
    appendOutput('🎬 Hollywood Terminal Simulation Starting...', 'hollywood');

    // Create a Hollywood-style display with multiple "monitoring" panels
    const hollywoodContainer = document.createElement('div');
    hollywoodContainer.className = 'hollywood-container';
    hollywoodContainer.innerHTML = `
      <div class="hollywood-header">
        <span style="color: #ff6b6b;">HOLLYWOOD TERMINAL</span> - <span style="color: #4ecdc4;">System Monitor v2.0</span>
      </div>
      <div class="hollywood-grid">
        <div class="hollywood-panel" id="panel1">
          <div class="panel-title">Network Traffic</div>
          <div class="panel-content" id="content1"></div>
        </div>
        <div class="hollywood-panel" id="panel2">
          <div class="panel-title">System Load</div>
          <div class="panel-content" id="content2"></div>
        </div>
        <div class="hollywood-panel" id="panel3">
          <div class="panel-title">Process Monitor</div>
          <div class="panel-content" id="content3"></div>
        </div>
        <div class="hollywood-panel" id="panel4">
          <div class="panel-title">Memory Usage</div>
          <div class="panel-content" id="content4"></div>
        </div>
      </div>
    `;
    terminalOutput.appendChild(hollywoodContainer);

    // Start the Hollywood effect
    startHollywoodEffect();
  }

  function startHollywoodEffect() {
    const panels = ['content1', 'content2', 'content3', 'content4'];
    const intervals = [];

    // Network traffic simulation
    const networkData = [
      'eth0: 1.2MB/s ↑ 856KB/s ↓',
      'wlan0: 2.1MB/s ↑ 1.3MB/s ↓',
      'lo: 45KB/s ↑ 45KB/s ↓',
      'docker0: 0B/s ↑ 0B/s ↓'
    ];

    // System load simulation
    const loadData = [
      'Load: 0.52, 0.58, 0.55',
      'CPU: 12% user, 8% system',
      'Tasks: 245 total, 1 running',
      'Uptime: 3d 7h 15m'
    ];

    // Process simulation
    const processData = [
      'PID 1234: terminal (2.1% CPU)',
      'PID 5678: browser (1.8% CPU)',
      'PID 9012: editor (1.5% CPU)',
      'PID 3456: shell (0.9% CPU)'
    ];

    // Memory simulation
    const memoryData = ['Total: 16GB', 'Used: 8.2GB (51%)', 'Free: 4.1GB', 'Cache: 3.7GB'];

    const dataSets = [networkData, loadData, processData, memoryData];

    panels.forEach((panelId, index) => {
      const panel = document.getElementById(panelId);
      const data = dataSets[index];
      let dataIndex = 0;

      const interval = setInterval(() => {
        // Add new data line
        const line = document.createElement('div');
        line.className = 'data-line';
        line.textContent = data[dataIndex];
        line.style.color = `hsl(${120 + index * 60}, 70%, 60%)`;

        panel.appendChild(line);

        // Keep only last 8 lines
        while (panel.children.length > 8) {
          panel.removeChild(panel.firstChild);
        }

        dataIndex = (dataIndex + 1) % data.length;
      }, 1000 + Math.random() * 2000);

      intervals.push(interval);
    });

    // Stop after 15 seconds
    setTimeout(() => {
      intervals.forEach((interval) => clearInterval(interval));
      appendOutput('🎬 Hollywood Terminal Simulation Complete!', 'hollywood');
    }, 15000);
  }

  // Save command history to session storage
  window.addEventListener('beforeunload', () => {
    sessionStorage.setItem('commandHistory', JSON.stringify(commandHistory));
  });

  // Load command history from session storage
  const savedHistory = sessionStorage.getItem('commandHistory');
  if (savedHistory) {
    commandHistory = JSON.parse(savedHistory);
    historyIndex = commandHistory.length;
  }
});
