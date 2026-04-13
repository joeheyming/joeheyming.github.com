// unset command - remove environment variables

function unsetHandler(terminal, args) {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '-v' || a === '-f' || a === '-n') {
      i++;
      continue;
    }
    if (a === '--') {
      i++;
      break;
    }
    if (a.startsWith('-')) {
      const char = a.length > 1 ? a[1] : '?';
      return {
        stdout: '',
        stderr: `unset: invalid option -- '${char}'\nunset: usage: unset [-v] [name ...]`,
        exitCode: 2
      };
    }
    break;
  }
  const names = args.slice(i);

  if (names.length === 0) {
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  const stderrLines = [];
  const protectedVars = ['USER', 'HOME', 'SHELL', 'TERM', 'HOSTNAME'];

  for (const varName of names) {
    if (!varName.match(/^[A-Za-z_][A-Za-z0-9_]*$/)) {
      stderrLines.push(`unset: '${varName}': not a valid identifier`);
      continue;
    }

    if (protectedVars.includes(varName)) {
      stderrLines.push(`unset: ${varName}: cannot unset system variable`);
      continue;
    }

    terminal.setEnv(varName, undefined);
  }

  const stderr = stderrLines.join('\n');
  return {
    stdout: '',
    stderr,
    exitCode: stderrLines.length > 0 ? 1 : 0
  };
}

export default {
  name: 'unset',
  handler: unsetHandler,
  description: 'remove environment variables',
  category: 'System'
};
