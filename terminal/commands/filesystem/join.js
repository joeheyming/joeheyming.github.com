// join — join lines of two sorted files on a common field (GNU-style subset)
(function () {
  'use strict';

  registerCommand(
    'join',
    async (terminal, args) => {
      const parsed = ShellUtils.parseJoinArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.JOIN_HELP, stderr: '', exitCode: 0 };
      }

      const { joinField1, joinField2, delimChar, a1, a2, v1, v2, emptyStr } = parsed;
      const operands = parsed.operands;

      if (operands.length < 2) {
        return {
          stdout: '',
          stderr: `join: missing operand\nTry 'join --help' for more information.\n`,
          exitCode: 1
        };
      }
      if (operands.length > 2) {
        return {
          stdout: '',
          stderr: `join: extra operand '${operands[2]}'\nTry 'join --help' for more information.\n`,
          exitCode: 1
        };
      }

      const op1 = operands[0];
      const op2 = operands[1];
      if (op1 === '-' && op2 === '-') {
        return {
          stdout: '',
          stderr: 'join: only one input file may be stdin\n',
          exitCode: 1
        };
      }

      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      const stdinText = stdinAvailable
        ? terminal.stdin != null
          ? String(terminal.stdin)
          : ''
        : '';

      async function textForOperand(op, which) {
        if (op === '-') {
          if (!stdinAvailable) {
            return {
              err: `join: ${which === 1 ? 'file1' : 'file2'}: standard input: not supplied\n`
            };
          }
          return { text: stdinText };
        }
        const res = await ShellUtils.vfsFollowSymlinksToFile(terminal, op, 'join');
        if (!res.ok) {
          return { err: res.stderr.trimEnd() + '\n' };
        }
        const d = ShellUtils.fileItemUtf8ForDisplay(res.file);
        const text = d.isBinary ? '[binary file]' : d.text;
        return { text };
      }

      const t1 = await textForOperand(op1, 1);
      if (t1.err) {
        return { stdout: '', stderr: t1.err, exitCode: 1 };
      }
      const t2 = await textForOperand(op2, 2);
      if (t2.err) {
        return { stdout: '', stderr: t2.err, exitCode: 1 };
      }

      const lines1 = ShellUtils.pasteSplitLines(t1.text, false);
      const lines2 = ShellUtils.pasteSplitLines(t2.text, false);

      const rec1 = ShellUtils.joinBuildRecords(lines1, joinField1, delimChar);
      const rec2 = ShellUtils.joinBuildRecords(lines2, joinField2, delimChar);

      const outLines = ShellUtils.joinMergeRecords(rec1, rec2, {
        joinField1,
        joinField2,
        delimChar,
        a1,
        a2,
        v1,
        v2,
        emptyStr
      });

      const stdout = outLines.length ? outLines.join('\n') + '\n' : '';
      return { stdout, stderr: '', exitCode: 0 };
    },
    'Join lines of two sorted files on a common field',
    'Filesystem'
  );
})();
