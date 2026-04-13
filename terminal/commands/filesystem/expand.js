// expand — convert tabs to spaces (GNU-style subset: -i -t, - for stdin, symlink follow)
import { ExpandLib } from './expand-lib.js';
import { VfsUtils } from '../../lib/vfs-utils.js';

async function expandHandler(terminal, args) {
  const parsed = ExpandLib.parseExpandArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: ExpandLib.EXPAND_HELP, stderr: '', exitCode: 0 };
  }
  if (parsed.version) {
    return { stdout: ExpandLib.EXPAND_VERSION_LINE, stderr: '', exitCode: 0 };
  }

  const { operands, tabSpec, initialOnly } = parsed;
  const stdinAvailable =
    terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
  const stdinText = stdinAvailable ? (terminal.stdin != null ? String(terminal.stdin) : '') : '';

  if (operands.length === 0) {
    if (!stdinAvailable) {
      return { stdout: '', stderr: 'expand: missing operand\n', exitCode: 1 };
    }
    return {
      stdout: ExpandLib.expandExpandText(stdinText, tabSpec, initialOnly),
      stderr: '',
      exitCode: 0
    };
  }

  const chunks = [];
  const stderrLines = [];
  for (const op of operands) {
    if (op === '-') {
      chunks.push(ExpandLib.expandExpandText(stdinText, tabSpec, initialOnly));
      continue;
    }
    const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op, 'expand');
    if (res.ok === false) {
      stderrLines.push(res.stderr.trimEnd());
      continue;
    }
    const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
    const text = d.isBinary ? '[binary file]\n' : d.text;
    chunks.push(ExpandLib.expandExpandText(text, tabSpec, initialOnly));
  }

  const stdout = chunks.join('');
  const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
  const exitCode = stderrLines.length > 0 ? 1 : 0;
  return { stdout, stderr, exitCode };
}

export default {
  name: 'expand',
  handler: expandHandler,
  description: 'convert tabs to spaces (GNU-style -i/-t, multiple FILEs, - for stdin, --)',
  category: 'File System'
};
