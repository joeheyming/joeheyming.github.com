// dirname - strip last path component (GNU-ish)
import { BasenameLib } from './basename-lib.js';

function dirnameHandler(terminal, args) {
  const parsed = BasenameLib.parseDirnameArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: BasenameLib.DIRNAME_HELP, stderr: '', exitCode: 0 };
  }
  if (parsed.version) {
    return { stdout: BasenameLib.DIRNAME_VERSION_LINE, stderr: '', exitCode: 0 };
  }

  const lines = [];
  for (const path of parsed.names) {
    const logical = terminal.resolvePath(path);
    lines.push(BasenameLib.dirnameCompute(logical));
  }
  if (parsed.zero) {
    return {
      stdout: lines.map((l) => l + '\0').join(''),
      stderr: '',
      exitCode: 0
    };
  }
  return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
}

export default {
  name: 'dirname',
  handler: dirnameHandler,
  description: 'strip filename from path',
  category: 'File System'
};
