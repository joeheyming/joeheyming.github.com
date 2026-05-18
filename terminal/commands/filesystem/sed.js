// sed — stream editor (GNU-style subset: literal s///, -n, -e, FILEs / stdin)
import { VfsUtils } from '../../lib/vfs-utils.js';
import { SedLib } from './sed-lib.js';

async function sedHandler(terminal, args) {
  const parsed = SedLib.parseSedArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: SedLib.SED_HELP, stderr: '', exitCode: 0 };
  }

  /** @type {Array<{ kind: 'delete', address?: any } | { kind: 'substitute', pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean, regex?: boolean, address?: any }>} */
  const specs = [];
  for (const sc of parsed.scripts) {
    // y/src/dst/ transliterate (B10) — pre-parsed so the existing s/// path
    // doesn't have to understand it.
    const yMatch = String(sc).trim().match(/^y(.)([\s\S]*)$/);
    if (yMatch) {
      const delim = yMatch[1];
      const parts = yMatch[2].split(delim);
      if (parts.length >= 3 && parts[0].length === parts[1].length) {
        const src = parts[0];
        const dst = parts[1];
        // Represent y/// as a regex-mode substitute that runs once per char.
        // For simplicity, do it inline by adding char-by-char specs.
        for (let k = 0; k < src.length; k++) {
          specs.push({
            kind: 'substitute',
            pattern: src[k].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            replacement: dst[k],
            global: true,
            printFlag: false,
            ignoreCase: false,
            regex: true
          });
        }
        continue;
      } else if (parts.length >= 3) {
        return {
          stdout: '',
          stderr: "sed: 'y' command source/dest must be same length\n",
          exitCode: 2
        };
      }
    }
    const pieces = SedLib.splitSedScriptIntoCommands(sc);
    if (pieces.ok === false) {
      return { stdout: '', stderr: pieces.stderr, exitCode: 2 };
    }
    for (const fragment of pieces.commands) {
      const p = SedLib.parseSedScript(fragment);
      if (p.ok === false) {
        return { stdout: '', stderr: p.stderr, exitCode: 2 };
      }
      // Propagate global -E to s/// specs (regex mode).
      const out = /** @type {any} */ (p);
      if (parsed.extended && out.kind === 'substitute') out.regex = true;
      specs.push(out);
    }
  }

  const stdinAvailable =
    terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
  const stdinText = stdinAvailable ? (terminal.stdin != null ? String(terminal.stdin) : '') : '';

  const operands = parsed.fileOperands;
  const stderrLines = [];
  const chunks = [];

  if (operands.length === 0) {
    if (!stdinAvailable) {
      return {
        stdout: '',
        stderr: 'sed: no input (use a pipe or specify file operands)\n',
        exitCode: 2
      };
    }
    chunks.push(SedLib.sedProcessContent(stdinText, specs, parsed.quiet));
  } else {
    for (const op of operands) {
      if (op === '-') {
        if (!stdinAvailable) {
          stderrLines.push('sed: -: No such file or directory');
          continue;
        }
        chunks.push(SedLib.sedProcessContent(stdinText, specs, parsed.quiet));
        continue;
      }
      const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op, 'sed');
      if (res.ok === false) {
        stderrLines.push(res.stderr.trimEnd());
        continue;
      }
      const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
      const text = d.isBinary ? '' : d.text;
      const processed = SedLib.sedProcessContent(text, specs, parsed.quiet);
      if (parsed.inPlace) {
        // Write back to the resolved file path (the symlink-followed path).
        try {
          await terminal.fileSystemDB.createFile(res.file.path, processed, true);
        } catch (err) {
          stderrLines.push(`sed: -i: ${op}: ${err.message}`);
        }
      } else {
        chunks.push(processed);
      }
    }
  }

  const stdout = parsed.inPlace ? '' : chunks.join('');
  const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
  const exitCode = stderrLines.length > 0 ? 1 : 0;
  return { stdout, stderr, exitCode };
}

export default {
  name: 'sed',
  handler: sedHandler,
  description:
    'stream editor (literal s///, d with optional line addresses, -n, -e, FILEs or stdin, --)',
  category: 'File System'
};
