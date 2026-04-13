// history command - show or clear command history

const USAGE = `history: usage: history [-c] [-h | --help]

  -c, --clear   Clear all history (silent success)
  -h, --help    Show this help`;

function historyHandler(terminal, args) {
  let clearHistory = false;
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { stdout: `${USAGE}\n`, stderr: '', exitCode: 0 };
    }
    if (a === '-c' || a === '--clear') {
      clearHistory = true;
      i++;
      continue;
    }
    if (a.startsWith('-')) {
      return {
        stdout: '',
        stderr: `history: invalid option -- '${a.replace(/^-/, '')}'\n${USAGE}`,
        exitCode: 2
      };
    }
    break;
  }
  const rest = args.slice(i);
  if (rest.length > 0) {
    return {
      stdout: '',
      stderr: `history: extra operand '${rest[0]}'`,
      exitCode: 1
    };
  }

  if (clearHistory) {
    terminal.commandHistory = [];
    terminal.historyIndex = -1;
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  if (terminal.commandHistory.length === 0) {
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  const out = terminal.commandHistory
    .map((cmd, index) => `${(index + 1).toString().padStart(4)} ${cmd}`)
    .join('\n');
  return { stdout: out, stderr: '', exitCode: 0 };
}

export default {
  name: 'history',
  handler: historyHandler,
  description: 'show command history',
  category: 'System'
};
