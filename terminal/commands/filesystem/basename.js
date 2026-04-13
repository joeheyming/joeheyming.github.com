// basename - strip directory and optional suffix (GNU-ish)
import { BasenameLib } from './basename-lib.js';

function basenameHandler(terminal, args) {
  const parsed = BasenameLib.parseBasenameArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: BasenameLib.BASENAME_HELP, stderr: '', exitCode: 0 };
  }
  if (parsed.version) {
    return { stdout: BasenameLib.BASENAME_VERSION_LINE, stderr: '', exitCode: 0 };
  }

  const lines = [];
  for (const path of parsed.names) {
    const logical = terminal.resolvePath(path);
    lines.push(BasenameLib.basenameCompute(logical, parsed.suffix));
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
  name: 'basename',
  handler: basenameHandler,
  description: 'strip path to filename',
  category: 'File System'
};
