// matrix command - enter the matrix
(function () {
  'use strict';

  const matrixCommand = {
    handler: (terminal, args) => {
      if (terminal.isStandalone) {
        // Standalone mode - create animated matrix effect
        matrixCommand.startMatrix(terminal);
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
        matrixCommand.createMatrixRain(matrixContainer.querySelector('.matrix-rain'));
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
  };

  registerCommand('matrix', matrixCommand.handler, 'enter the matrix', 'Fun Stuff');
})();
