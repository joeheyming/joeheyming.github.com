// echo command — GNU-style argv, -n / -e / -E, jsh $VAR expansion on joined operands
(function () {
  'use strict';

  registerCommand(
    'echo',
    async (terminal, args) => {
      const parsed = EchoLib.parseEchoArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: EchoLib.ECHO_HELP, stderr: '', exitCode: 0 };
      }
      if (parsed.version) {
        return { stdout: EchoLib.ECHO_VERSION_LINE, stderr: '', exitCode: 0 };
      }

      const joined = parsed.operands.join(' ');
      let text = terminal.expandVariables(joined);
      if (parsed.escapes) {
        text = EchoLib.echoApplyBackslashEscapes(text);
      }
      const out = parsed.noNewline ? text : text + '\n';
      return { stdout: out, stderr: '', exitCode: 0 };
    },
    'print strings (-n, -e/-E, --; GNU-style leading options; $VAR expansion)',
    'File System'
  );
})();
