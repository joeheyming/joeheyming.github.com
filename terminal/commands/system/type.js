// type command — bash-like command description (no source dump; see ShellUtils.parseTypeArgv)
(function () {
  'use strict';

  /** @param {{ aliases?: Record<string, string> }} terminal */
  function describeCommand(terminal, cmdName, showAll) {
    const lines = [];
    const aliases = terminal.aliases || {};
    const hasAlias = Object.prototype.hasOwnProperty.call(aliases, cmdName);
    const hasReg =
      typeof window !== 'undefined' &&
      window.commandRegistry &&
      typeof window.commandRegistry.has === 'function' &&
      window.commandRegistry.has(cmdName);

    if (hasAlias) {
      const body = ShellUtils.escapeTypeAliasBody(aliases[cmdName]);
      lines.push(`${cmdName} is aliased to \`${body}\``);
    }
    if (hasReg) {
      lines.push(`${cmdName} is /bin/${cmdName}`);
    }

    if (!showAll) {
      if (hasAlias) {
        return { lines: [lines[0]], found: true };
      }
      if (hasReg) {
        return { lines: [lines[lines.length - 1]], found: true };
      }
      return { lines: [], found: false };
    }

    return { lines, found: lines.length > 0 };
  }

  registerCommand(
    'type',
    (terminal, args) => {
      const parsed = ShellUtils.parseTypeArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.TYPE_HELP, stderr: '', exitCode: 0 };
      }

      const stdoutLines = [];
      const stderrLines = [];

      for (const cmdName of parsed.names) {
        const { lines, found } = describeCommand(terminal, cmdName, parsed.showAll);
        if (!found) {
          stderrLines.push(`type: ${cmdName}: not found`);
        } else {
          stdoutLines.push(...lines);
        }
      }

      return {
        stdout: stdoutLines.join('\n'),
        stderr: stderrLines.join('\n'),
        exitCode: stderrLines.length > 0 ? 1 : 0
      };
    },
    'display how a name would be interpreted as a command (-a, --help, --)',
    'System'
  );
})();
