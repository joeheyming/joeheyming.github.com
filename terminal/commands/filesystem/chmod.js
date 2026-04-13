// chmod — jsh does not model Unix modes; accept invocations for script compatibility
import { ChmodLib } from './chmod-lib.js';

async function chmodHandler(terminal, args) {
  const parsed = ChmodLib.parseChmodArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: 1 };
  }
  if ('help' in parsed && parsed.help) {
    return { stdout: ChmodLib.CHMOD_HELP, stderr: '', exitCode: 0 };
  }
  const stderrLines = [];
  const files = 'files' in parsed ? parsed.files : [];
  for (const f of files) {
    const p = terminal.resolvePath(f);
    const item = await terminal.fileSystemDB.getItem(p);
    if (!item) {
      stderrLines.push(`chmod: cannot access '${f}': No such file or directory`);
    }
  }
  if (stderrLines.length > 0) {
    return { stdout: '', stderr: stderrLines.join('\n'), exitCode: 1 };
  }
  return { stdout: '', stderr: '', exitCode: 0 };
}

export default {
  name: 'chmod',
  handler: chmodHandler,
  description: 'change file mode bits (not applied in jsh)',
  category: 'File System'
};
