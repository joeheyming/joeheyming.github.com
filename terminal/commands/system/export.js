// export command - set environment variables
(function () {
  'use strict';

  /**
   * Bash-style listing: `declare -x` lines (same as `export -p`).
   * @param {object} terminal
   * @param {string[]|null} names - if null, print all env keys (sorted); else only these names when set
   */
  function exportListMode(terminal, names) {
    const envVars = terminal.getAllEnv();
    let keys;
    if (names == null) {
      keys = Object.keys(envVars).sort();
    } else {
      keys = [];
      for (const n of names) {
        if (!n.match(/^[A-Za-z_][A-Za-z0-9_]*$/)) {
          return { stderr: `export: '${n}': not a valid identifier`, exitCode: 1 };
        }
        keys.push(n);
      }
    }
    const lines = [];
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(envVars, key)) {
        continue;
      }
      lines.push(ShellCore.formatDeclareXLine(key, envVars[key]));
    }
    return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
  }

  registerCommand(
    'export',
    (terminal, args) => {
      if (args.length === 0) {
        return exportListMode(terminal, null);
      }

      if (args[0] === '-p') {
        const rest = args.slice(1);
        if (rest.some((a) => a.includes('='))) {
          return { stderr: 'export: invalid option', exitCode: 1 };
        }
        return exportListMode(terminal, rest.length === 0 ? null : rest);
      }

      const stderrLines = [];
      const stdoutLines = [];

      for (const arg of args) {
        if (arg.includes('=')) {
          const [key, ...valueParts] = arg.split('=');
          const value = valueParts.join('=');

          if (!key.match(/^[A-Za-z_][A-Za-z0-9_]*$/)) {
            stderrLines.push(`export: '${key}': not a valid identifier`);
            continue;
          }

          const cleanValue = value.replace(/^["']|["']$/g, '');
          terminal.setEnv(key, cleanValue);
          stdoutLines.push(`export ${key}="${cleanValue}"`);
        } else {
          // Bash: `export NAME` succeeds whether or not NAME is set (mark for export; no separate export set in jsh).
        }
      }

      const stderr = stderrLines.join('\n');
      const stdout = stdoutLines.join('\n');
      return {
        stdout,
        stderr,
        exitCode: stderrLines.length > 0 ? 1 : 0
      };
    },
    'set environment variables',
    'System'
  );
})();
