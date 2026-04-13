// which command — locate a command (see BuiltinsLib.parseWhichArgv)
(function () {
  'use strict';

  registerCommand(
    'which',
    (terminal, args) => {
      const parsed = BuiltinsLib.parseWhichArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: BuiltinsLib.WHICH_HELP, stderr: '', exitCode: 0 };
      }

      const pathDisplay =
        terminal.env && terminal.env.PATH != null && terminal.env.PATH !== ''
          ? terminal.env.PATH
          : '(none)';

      const stdoutLines = [];
      const stderrLines = [];
      const aliases = terminal.aliases || {};

      for (const cmdName of parsed.names) {
        const hasAlias = Object.prototype.hasOwnProperty.call(aliases, cmdName);
        const hasReg =
          typeof window !== 'undefined' &&
          window.commandRegistry &&
          typeof window.commandRegistry.has === 'function' &&
          window.commandRegistry.has(cmdName);

        const lines = [];
        if (hasAlias) {
          lines.push(`${cmdName}: aliased to ${aliases[cmdName]}`);
        }
        if (hasReg) {
          lines.push(`/bin/${cmdName}`);
        }

        if (!parsed.showAll) {
          if (hasAlias) {
            stdoutLines.push(lines[0]);
          } else if (hasReg) {
            stdoutLines.push(lines[lines.length - 1]);
          } else {
            stderrLines.push(`which: no ${cmdName} in (${pathDisplay})`);
          }
        } else if (hasAlias || hasReg) {
          stdoutLines.push(...lines);
        } else {
          stderrLines.push(`which: no ${cmdName} in (${pathDisplay})`);
        }
      }

      return {
        stdout: stdoutLines.join('\n'),
        stderr: stderrLines.join('\n'),
        exitCode: stderrLines.length > 0 ? 1 : 0
      };
    },
    'locate a command (-a, --help, --)',
    'System'
  );
})();
