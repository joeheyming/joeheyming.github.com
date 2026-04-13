// split — split a file into pieces (GNU-ish subset)
(function () {
  'use strict';

  /**
   * @param {Error} error
   * @param {string} arg — user-facing path/name
   * @returns {{ stderr: string, exitCode: number }}
   */
  function splitStderrFromError(error, arg) {
    const msg = error && error.message ? String(error.message) : String(error);
    if (msg.startsWith('Parent directory does not exist:')) {
      return {
        stderr: `split: ${arg}: No such file or directory`,
        exitCode: 1
      };
    }
    return { stderr: `split: ${arg}: ${msg}`, exitCode: 1 };
  }

  /**
   * @param {object} file — FileSystemDB file item
   * @returns {{ bytes: Uint8Array, isBinary: boolean }}
   */
  function fileToBytes(file) {
    if (file.contentBytes != null) {
      const raw = file.contentBytes;
      const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      return { bytes: new Uint8Array(buf), isBinary: true };
    }
    const text = file.content ?? '';
    return { bytes: new TextEncoder().encode(text), isBinary: false };
  }

  registerCommand(
    'split',
    async (terminal, args) => {
      const parsed = SplitLib.parseSplitArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: SplitLib.SPLIT_HELP, stderr: '', exitCode: 0 };
      }
      if (parsed.version) {
        return { stdout: SplitLib.SPLIT_VERSION_LINE, stderr: '', exitCode: 0 };
      }

      const {
        byteMode,
        linesPerChunk,
        bytesPerChunk,
        suffixWidth,
        additionalSuffix,
        suffixMode,
        operands
      } = parsed;

      const suffixCfg = { suffixMode, suffixWidth };

      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      const stdinText = stdinAvailable
        ? terminal.stdin != null
          ? String(terminal.stdin)
          : ''
        : '';

      if (operands.length > 2) {
        return {
          stdout: '',
          stderr: `split: extra operand '${operands[2]}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }

      const inputOperand = operands[0];
      const prefixArg = operands.length >= 2 ? operands[1] : 'x';

      /** @type {Uint8Array} */
      let inputBytes;
      let isBinary = false;
      let inputText = '';

      if (inputOperand == null || inputOperand === '-') {
        if (!stdinAvailable) {
          return { stdout: '', stderr: 'split: missing operand\n', exitCode: 1 };
        }
        inputText = stdinText;
        inputBytes = new TextEncoder().encode(inputText);
        isBinary = false;
      } else {
        const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, inputOperand, 'split');
        if (res.ok === false) {
          return { stdout: '', stderr: res.stderr.trimEnd() + '\n', exitCode: 1 };
        }
        const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
        const fb = fileToBytes(res.file);
        inputBytes = fb.bytes;
        isBinary = d.isBinary || fb.isBinary;
        if (!d.isBinary) {
          inputText = d.text;
        }
      }

      async function writeOne(index, content) {
        const suf = SplitLib.splitGenerateSuffix(index, suffixCfg);
        if (suf == null) {
          return {
            ok: false,
            stderr: 'split: output file suffixes exhausted\n',
            exitCode: 1
          };
        }
        const name = prefixArg + suf + additionalSuffix;
        const outPath = terminal.resolvePath(name);
        const existing = await terminal.getFileSystemItem(outPath);
        if (existing && existing.type === 'directory') {
          return { ok: false, stderr: `split: ${name}: Is a directory\n`, exitCode: 1 };
        }
        try {
          await terminal.fileSystemDB.createFile(outPath, content, true);
        } catch (error) {
          const { stderr, exitCode } = splitStderrFromError(error, name);
          return { ok: false, stderr: `${stderr}\n`, exitCode };
        }
        return { ok: true };
      }

      if (byteMode) {
        const chunkSize = bytesPerChunk;
        const u8 = inputBytes;
        if (u8.length === 0) {
          const w = await writeOne(0, new Uint8Array(0));
          if (w.ok === false) {
            return { stdout: '', stderr: w.stderr, exitCode: w.exitCode };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        let idx = 0;
        for (let offset = 0; offset < u8.length; offset += chunkSize) {
          const chunk = u8.subarray(offset, Math.min(offset + chunkSize, u8.length));
          const w = await writeOne(idx, chunk);
          if (w.ok === false) {
            return { stdout: '', stderr: w.stderr, exitCode: w.exitCode };
          }
          idx++;
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      /** @type {(string|Uint8Array)[]} */
      let lineParts;
      if (isBinary) {
        lineParts = SplitLib.splitLinesBytes(inputBytes);
      } else {
        lineParts = SplitLib.splitLinesWithSeparators(inputText);
      }

      if (lineParts.length === 0) {
        const empty = isBinary ? new Uint8Array(0) : '';
        const w = await writeOne(0, empty);
        if (w.ok === false) {
          return { stdout: '', stderr: w.stderr, exitCode: w.exitCode };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      let idx = 0;
      for (let i = 0; i < lineParts.length; i += linesPerChunk) {
        const slice = lineParts.slice(i, i + linesPerChunk);
        let content;
        if (isBinary) {
          const total = slice.reduce((s, /** @type {Uint8Array} */ l) => s + l.length, 0);
          const buf = new Uint8Array(total);
          let o = 0;
          for (const l of slice) {
            buf.set(/** @type {Uint8Array} */ (l), o);
            o += l.length;
          }
          content = buf;
        } else {
          content = slice.join('');
        }
        const w = await writeOne(idx, content);
        if (w.ok === false) {
          return { stdout: '', stderr: w.stderr, exitCode: w.exitCode };
        }
        idx++;
      }

      return { stdout: '', stderr: '', exitCode: 0 };
    },
    'split a file into pieces (GNU-style -l/-b, PREFIXaa, stdin, --)',
    'File System'
  );
})();
