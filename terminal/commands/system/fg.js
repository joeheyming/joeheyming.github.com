// fg — wait for a background job to complete (cooperative; A5)
import { registerCommand } from '../../commands.js';

function parseJobspec(s) {
  if (s == null) return null;
  if (s.startsWith('%')) {
    const n = parseInt(s.slice(1), 10);
    if (Number.isFinite(n)) return n;
  } else {
    const n = parseInt(s, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function fgHandler(terminal, args) {
  const argsArr = Array.isArray(args) ? args : [];
  if (argsArr.includes('--help') || argsArr.includes('-h')) {
    return { stdout: 'Usage: fg [%n|n]\n', stderr: '', exitCode: 0 };
  }
  const list = terminal.jobs || [];
  if (list.length === 0) {
    return { stdout: '', stderr: 'fg: no current job\n', exitCode: 1 };
  }
  let target = null;
  if (argsArr.length === 0) {
    // most recent Running job, else most recent of any state
    target = [...list].reverse().find((j) => j.state === 'Running') || list[list.length - 1];
  } else {
    const id = parseJobspec(argsArr[0]);
    if (id == null) {
      return { stdout: '', stderr: `fg: ${argsArr[0]}: no such job\n`, exitCode: 1 };
    }
    target = list.find((j) => j.jobId === id);
    if (!target) {
      return { stdout: '', stderr: `fg: ${argsArr[0]}: no such job\n`, exitCode: 1 };
    }
  }
  // Wait for the job's underlying promise (cooperative; no real SIGCONT).
  try {
    await target.promise;
  } catch (_) {
    /* errors already surfaced when job ran */
  }
  const code = target.exitCode != null ? target.exitCode : 0;
  return { stdout: target.command + '\n', stderr: '', exitCode: code };
}

registerCommand('fg', fgHandler, 'bring a background job to the foreground (wait)', 'System');

export default {
  name: 'fg',
  handler: fgHandler,
  description: 'bring a background job to the foreground (wait)',
  category: 'System'
};
