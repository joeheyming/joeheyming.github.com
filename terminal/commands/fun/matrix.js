// matrix command - enter the matrix
(function () {
  'use strict';

  const matrixCommand = {
    handler: (terminal, args) => {
      // Always create full-screen matrix rain effect
      matrixCommand.startMatrix(terminal);
      return ''; // Don't return output since we're using modal
    },

    // Matrix effect methods
    startMatrix: (terminal) => {
      // Set current process info
      terminal.setCurrentProcess({
        name: 'matrix',
        pid: Math.floor(Math.random() * 10000),
        command: 'matrix'
      });

      // Create matrix modal
      const modal = terminal.createModal({
        className: 'matrix-modal',
        title: 'The Matrix',
        content:
          '<div class="matrix-container"><div class="matrix-text">Entering the Matrix...</div></div>',
        onKeyDown: (e) => {
          // Keep 'q' and Escape for convenience (Ctrl+C handled automatically by modal system)
          if (e.key === 'q' || e.key === 'Q' || e.key === 'Escape') {
            modal.close();
            // Don't call clearCurrentProcess() here - modal.close() handles it
          }
        }
      });

      // Add CSS for matrix modal
      const matrixStyles = `
        .matrix-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: #000;
          color: #0f0;
          font-family: 'Courier New', monospace;
          z-index: 1000;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .matrix-container {
          flex: 1;
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .matrix-text {
          font-size: 24px;
          text-align: center;
          text-shadow: 0 0 10px #0f0;
          animation: matrix-glow 2s ease-in-out infinite alternate;
        }
        @keyframes matrix-glow {
          0% { text-shadow: 0 0 10px #0f0; }
          100% { text-shadow: 0 0 20px #0f0, 0 0 30px #0f0; }
        }
        .matrix-rain {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
        }
        .matrix-char {
          position: absolute;
          font-family: 'Courier New', monospace;
          font-size: 16px;
          text-shadow: 0 0 5px #0f0;
          animation: matrix-fall linear infinite;
        }
        @keyframes matrix-fall {
          0% { transform: translateY(-20px); opacity: 1; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
      `;

      terminal.addStyles(matrixStyles);

      // Register signal handler for SIGINT (Ctrl+C) after modal is created
      terminal.onSignal('SIGINT', () => {
        // Clean up matrix process
        if (matrixCommand.matrixInterval) {
          clearInterval(matrixCommand.matrixInterval);
          matrixCommand.matrixInterval = null;
        }
        modal.close();
        // Don't call clearCurrentProcess() here - let modal.close() handle it
      });

      // Start the matrix rain effect after 2 seconds
      setTimeout(() => {
        const container = modal.element.querySelector('.matrix-container');
        if (container) {
          matrixCommand.createMatrixRain(container);
        }
      }, 2000);

      // Clean up when modal closes
      const originalClose = modal.close;
      modal.close = () => {
        // Stop any running animations
        if (matrixCommand.matrixInterval) {
          clearInterval(matrixCommand.matrixInterval);
          matrixCommand.matrixInterval = null;
        }
        // Clear signal handlers
        terminal.clearCurrentProcess();
        originalClose();
      };
    },

    matrixInterval: null,

    createMatrixRain: (container) => {
      const chars =
        '｢｣､ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+-=[]{}|;:,.<>?';

      // Clear container and set up for rain
      container.innerHTML = '<div class="matrix-rain"></div>';
      const rainContainer = container.querySelector('.matrix-rain');

      const columns = Math.floor(window.innerWidth / 20);
      const drops = [];

      // Initialize drops
      for (let i = 0; i < columns; i++) {
        drops[i] = Math.floor(Math.random() * -100); // Start at different heights
      }

      function draw() {
        // Clear old characters that have fallen off screen
        const oldChars = rainContainer.querySelectorAll('.matrix-char');
        oldChars.forEach((char) => {
          const top = parseInt(char.style.top);
          if (top > window.innerHeight) {
            char.remove();
          }
        });

        // Add new characters
        for (let i = 0; i < drops.length; i++) {
          if (Math.random() > 0.98) {
            // Randomly start new drops
            const char = chars[Math.floor(Math.random() * chars.length)];
            const charElement = document.createElement('div');
            charElement.className = 'matrix-char';
            charElement.textContent = char;
            charElement.style.left = i * 20 + 'px';
            charElement.style.top = '-20px';
            charElement.style.color = Math.random() > 0.9 ? '#fff' : '#0f0'; // Occasional white chars
            charElement.style.animationDuration = Math.random() * 3 + 2 + 's'; // Varying speeds
            rainContainer.appendChild(charElement);
          }
        }
      }

      // Start the rain
      matrixCommand.matrixInterval = setInterval(draw, 100);

      // Show message after some time
      setTimeout(() => {
        container.innerHTML = `
          <div style="text-align: center; color: #0f0; font-family: 'Courier New', monospace; margin: 20px; text-shadow: 0 0 10px #0f0;">
            <div style="font-size: 24px; margin-bottom: 20px; animation: matrix-glow 2s ease-in-out infinite alternate;">Wake up, Neo...</div>
            <div style="font-size: 18px; margin-bottom: 15px;">The Matrix has you...</div>
            <div style="font-size: 18px; margin-bottom: 15px;">Follow the white rabbit 🐰</div>
            <div style="font-size: 18px; margin-bottom: 15px;">Knock, knock, Neo.</div>
            <div style="font-size: 16px; margin-top: 30px; color: #0a0;">
              💊 You took the red pill! Welcome to the desert of the real.
            </div>
            <div style="font-size: 14px; margin-top: 30px; color: #080;">
              Press 'q', Escape, or Ctrl+C to exit the Matrix
            </div>
          </div>
        `;
        if (matrixCommand.matrixInterval) {
          clearInterval(matrixCommand.matrixInterval);
          matrixCommand.matrixInterval = null;
        }
      }, 15000);
    }
  };

  registerCommand('matrix', matrixCommand.handler, 'enter the matrix', 'Fun Stuff');
})();
