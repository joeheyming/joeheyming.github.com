// top command - display running processes (interactive; simulated metrics)

function generateTopOutput(terminal) {
  try {
    const processes = terminal.os?.kernel?.processManager?.getAllProcesses() || [];

    const uptime = Math.floor(Date.now() / 1000 - (window.startTime || Date.now() / 1000));
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    let output = `top - ${new Date().toLocaleTimeString()} up ${hours}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}\n`;
    output += `Tasks: ${processes.length} total\n`;
    output += `Load average: ${(Math.random() * 2).toFixed(2)}, ${(Math.random() * 2).toFixed(
      2
    )}, ${(Math.random() * 2).toFixed(2)}\n\n`;

    output += `  PID USER      PR  NI    VIRT    RES    SHR S  %CPU %MEM     TIME+ COMMAND\n`;

    if (processes.length === 0) {
      const fakeProcesses = [
        {
          pid: 1,
          user: 'root',
          command: 'init',
          cpu: Math.random() * 0.5,
          mem: 0.1,
          time: '0:01.23',
          state: 'S'
        },
        {
          pid: 2,
          user: 'root',
          command: 'kthreadd',
          cpu: 0.0,
          mem: 0.0,
          time: '0:00.00',
          state: 'S'
        },
        {
          pid: terminal.process?.pid || 1337,
          user: terminal.env.USER,
          command: 'jsh',
          cpu: Math.random() * 2 + 0.5,
          mem: 2.3,
          time: '0:05.67',
          state: 'R'
        },
        {
          pid: 42,
          user: terminal.env.USER,
          command: 'heyming-os',
          cpu: Math.random() * 1 + 0.2,
          mem: 15.2,
          time: '1:23.45',
          state: 'S'
        }
      ];

      fakeProcesses.forEach((proc) => {
        output += `${proc.pid.toString().padStart(5)} ${proc.user.padEnd(8)} 20   0 ${(
          Math.random() * 100000
        )
          .toFixed(0)
          .padStart(8)} ${(Math.random() * 10000).toFixed(0).padStart(6)} ${(Math.random() * 1000)
          .toFixed(0)
          .padStart(6)} ${proc.state} ${proc.cpu.toFixed(1).padStart(5)} ${proc.mem
          .toFixed(1)
          .padStart(4)} ${proc.time.padStart(9)} ${proc.command}\n`;
      });
    } else {
      const sched = terminal.os?.kernel?.schedulerManager;
      processes.forEach((proc) => {
        // C25: use the scheduler's sampled per-pid CPU% when available;
        // fall back to a small randomised value so the column never looks
        // dead in environments where no sampling has run yet.
        let cpuVal = 0;
        if (sched && typeof sched.getCpuPercent === 'function') {
          cpuVal = sched.getCpuPercent(proc.pid);
        }
        if (!Number.isFinite(cpuVal) || cpuVal === 0) cpuVal = Math.random() * 0.5;
        const cpu = cpuVal.toFixed(1);
        const mem = (Math.random() * 10).toFixed(1);
        const totalCpuSec = Math.floor((proc.cpuTime || 0) / 1000);
        const time = `${Math.floor(totalCpuSec / 60)}:${(totalCpuSec % 60)
          .toString()
          .padStart(2, '0')}.${Math.floor(((proc.cpuTime || 0) % 1000) / 10)
          .toString()
          .padStart(2, '0')}`;

        output += `${proc.pid.toString().padStart(5)} ${(proc.uid === 0
          ? 'root'
          : terminal.env.USER
        ).padEnd(8)} 20   0 ${(Math.random() * 100000).toFixed(0).padStart(8)} ${(
          Math.random() * 10000
        )
          .toFixed(0)
          .padStart(6)} ${(Math.random() * 1000).toFixed(0).padStart(6)} ${
          proc.state || 'S'
        } ${cpu.padStart(5)} ${mem.padStart(4)} ${time.padStart(9)} ${proc.name}\n`;
      });
    }

    return { ok: true, text: output };
  } catch (error) {
    return { ok: false, message: `top: error accessing process information: ${error.message}` };
  }
}

function topHandler(terminal, args) {
  if (args.includes('-h') || args.includes('--help')) {
    return {
      stdout:
        'Usage: top\n\nInteractive process view (simulated CPU/memory; browser — not procfs).\n',
      stderr: '',
      exitCode: 0
    };
  }

  const firstFrame = generateTopOutput(terminal);
  if (firstFrame.ok === false) {
    return {
      stdout: '',
      stderr: `${firstFrame.message}\n`,
      exitCode: 1
    };
  }

  function topModalHtml(terminalInstance, bodyText) {
    const safe = terminalInstance.escapeHtml(bodyText);
    return `<div class="top-modal-inner" role="dialog" aria-modal="true" aria-labelledby="top-modal-title" aria-describedby="top-modal-subtitle" tabindex="-1">
          <header class="top-modal-header">
            <div class="top-modal-title" id="top-modal-title">top — process monitor</div>
            <div class="top-modal-subtitle" id="top-modal-subtitle">jsh · simulated CPU / memory · not procfs</div>
          </header>
          <div class="top-content" role="region" aria-label="Simulated process list">
            <pre class="top-output">${safe}</pre>
          </div>
          <p class="top-modal-refresh-hint" aria-live="polite">Auto-refresh every 3 seconds</p>
          <footer class="top-modal-footer" aria-label="Keyboard shortcuts">
            <kbd>q</kbd> quit
            <span class="top-modal-footer-sep" aria-hidden="true">·</span>
            <kbd>Esc</kbd> quit
            <span class="top-modal-footer-sep" aria-hidden="true">·</span>
            <kbd>r</kbd> refresh
            <span class="top-modal-footer-sep" aria-hidden="true">·</span>
            <kbd>Ctrl+C</kbd> interrupt
          </footer>
        </div>`;
  }

  terminal.setCurrentProcess({
    name: 'top',
    pid: Math.floor(Math.random() * 10000),
    command: 'top'
  });

  const modal = terminal.createModal({
    className: 'top-modal',
    title: 'top - Process Monitor',
    content: topModalHtml(terminal, firstFrame.text),
    focusSelector: '[role="dialog"]',
    onKeyDown: (e) => {
      if (e.key === 'q' || e.key === 'Q' || e.key === 'Escape') {
        modal.close();
      } else if (e.key === 'r' || e.key === 'R') {
        const frame = generateTopOutput(terminal);
        const body = frame.ok ? frame.text : frame.message;
        modal.update(topModalHtml(terminal, body));
      }
    }
  });

  const refreshInterval = setInterval(() => {
    if (modal.element.parentNode) {
      const frame = generateTopOutput(terminal);
      const body = frame.ok ? frame.text : frame.message;
      modal.update(topModalHtml(terminal, body));
    } else {
      clearInterval(refreshInterval);
    }
  }, 3000);

  terminal.onSignal('SIGINT', () => {
    clearInterval(refreshInterval);
    modal.close();
  });

  const originalClose = modal.close;
  modal.close = () => {
    clearInterval(refreshInterval);
    terminal.clearCurrentProcess();
    originalClose();
  };

  return { stdout: '', stderr: '', exitCode: 0 };
}

export default {
  name: 'top',
  handler: topHandler,
  description: 'display running processes (interactive)',
  category: 'System'
};
