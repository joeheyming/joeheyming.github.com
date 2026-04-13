// join — join lines of two sorted files on a common field (GNU-style subset)
import { JoinLib } from './join-lib.js';
import { PasteLib } from './paste-lib.js';
import { VfsUtils } from '../../lib/vfs-utils.js';

async function joinHandler(terminal, args) {
  const parsed = JoinLib.parseJoinArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: JoinLib.JOIN_HELP, stderr: '', exitCode: 0 };
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
  const stdinText = stdinAvailable ? (terminal.stdin != null ? String(terminal.stdin) : '') : '';

  async function textForOperand(op, which) {
    if (op === '-') {
      if (!stdinAvailable) {
        return {
          err: `join: ${which === 1 ? 'file1' : 'file2'}: standard input: not supplied\n`
        };
      }
      return { text: stdinText };
    }
    const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op, 'join');
    if (res.ok === false) {
      return { err: res.stderr.trimEnd() + '\n' };
    }
    const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
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

  const lines1 = PasteLib.pasteSplitLines(t1.text, false);
  const lines2 = PasteLib.pasteSplitLines(t2.text, false);

  const rec1 = JoinLib.joinBuildRecords(lines1, joinField1, delimChar);
  const rec2 = JoinLib.joinBuildRecords(lines2, joinField2, delimChar);

  const outLines = JoinLib.joinMergeRecords(rec1, rec2, {
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
}

export default {
  name: 'join',
  handler: joinHandler,
  description: 'Join lines of two sorted files on a common field',
  category: 'Filesystem'
};
