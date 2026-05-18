// pstree — render the simulated process tree (C19)
import { registerCommand } from '../../commands.js';

const PSTREE_HELP = `Usage: pstree [-p] [pid]
Display the process tree rooted at pid (default: 1).

  -p          show PIDs alongside names
      --help  display this help

jsh:
  Reads from the simulated HeymingKernel ProcessManager. Children are taken
  from each process's children set; init (pid 1) reparents on exit.
`;

/**
 * Render the subtree rooted at `pid`.
 * @param {Map<number, any>} byPid
 * @param {number} pid
 * @param {string} prefix
 * @param {boolean} isLast
 * @param {boolean} showPids
 * @param {string[]} lines
 */
function render(byPid, pid, prefix, isLast, showPids, lines) {
  const proc = byPid.get(pid);
  if (!proc) return;
  const branch = prefix === '' ? '' : (isLast ? '└─' : '├─');
  const label = showPids ? `${proc.name}(${pid})` : proc.name;
  lines.push(prefix + branch + label);
  const kids = Array.from(proc.children || []).sort((a, b) => a - b);
  const nextPrefix = prefix + (prefix === '' ? '' : (isLast ? '  ' : '│ '));
  for (let i = 0; i < kids.length; i++) {
    render(byPid, kids[i], nextPrefix, i === kids.length - 1, showPids, lines);
  }
}

async function pstreeHandler(terminal, args) {
  const argsArr = Array.isArray(args) ? args : [];
  if (argsArr.includes('--help') || argsArr.includes('-h')) {
    return { stdout: PSTREE_HELP, stderr: '', exitCode: 0 };
  }
  const showPids = argsArr.includes('-p');
  let rootPid = 1;
  for (const a of argsArr) {
    if (a.startsWith('-')) continue;
    const n = parseInt(a, 10);
    if (Number.isFinite(n)) rootPid = n;
  }

  const pm = terminal.os?.kernel?.processManager;
  if (!pm) {
    return { stdout: '', stderr: 'pstree: process manager not available\n', exitCode: 1 };
  }
  const all = pm.getAllProcesses() || [];
  const byPid = new Map();
  for (const p of all) byPid.set(p.pid, p);
  if (!byPid.has(rootPid)) {
    return { stdout: '', stderr: `pstree: no such process: ${rootPid}\n`, exitCode: 1 };
  }
  const lines = [];
  render(byPid, rootPid, '', true, showPids, lines);
  return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
}

registerCommand('pstree', pstreeHandler, 'display the simulated process tree (-p)', 'System');

export default {
  name: 'pstree',
  handler: pstreeHandler,
  description: 'display the simulated process tree (-p)',
  category: 'System'
};
