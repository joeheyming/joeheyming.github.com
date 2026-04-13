// awk — pattern-directed scanning (jsh subset: BEGIN/END + {print ...}, -F, FILEs / stdin)
(function () {
  'use strict';

  registerCommand(
    'awk',
    async (terminal, args) => {
      const parsed = AwkLib.parseAwkArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: AwkLib.AWK_HELP, stderr: '', exitCode: 0 };
      }

      const pp = AwkLib.parseAwkFullProgram(parsed.program);
      if (pp.ok === false) {
        return { stdout: '', stderr: pp.stderr, exitCode: 2 };
      }

      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      const stdinText = stdinAvailable
        ? terminal.stdin != null
          ? String(terminal.stdin)
          : ''
        : '';

      const operands = parsed.fileOperands;
      const stderrLines = [];
      const chunks = [];
      let nr = 1;
      const sharedAwkArrays = Object.create(null);
      /** @type {{ $0: string, fields: string[], NR: number, NF: number, fieldSeparator?: string, RSTART?: number, RLENGTH?: number, awkArrays?: Record<string, Record<string, string>> }} */
      let endCtx = AwkLib.awkBeginCtx(parsed.fieldSeparator, sharedAwkArrays);

      if (pp.beginExprs) {
        const br = AwkLib.awkRunPrintOnce(
          pp.beginExprs,
          AwkLib.awkBeginCtx(parsed.fieldSeparator, sharedAwkArrays)
        );
        if (br.ok === false) {
          return { stdout: '', stderr: br.stderr, exitCode: 2 };
        }
        chunks.push(br.stdout);
      }

      const runOnText = (text) => {
        const r = AwkLib.awkRunPrintProgram(
          text,
          pp.mainExprs,
          parsed.fieldSeparator,
          nr,
          sharedAwkArrays
        );
        if (r.ok === false) {
          return r;
        }
        chunks.push(r.stdout);
        nr = r.nextNr;
        if (r.lastReadCtx !== null) {
          endCtx = r.lastReadCtx;
        }
        return { ok: /** @type {true} */ (true) };
      };

      const needStdinForMain = pp.mainExprs !== null;

      if (operands.length === 0) {
        if (!stdinAvailable && needStdinForMain) {
          return {
            stdout: '',
            stderr: 'awk: no input (use a pipe or specify file operands)\n',
            exitCode: 2
          };
        }
        const r = runOnText(stdinText);
        if (r.ok === false) {
          return { stdout: '', stderr: r.stderr, exitCode: 2 };
        }
      } else {
        for (const op of operands) {
          if (op === '-') {
            if (!stdinAvailable && needStdinForMain) {
              stderrLines.push('awk: -: No such file or directory');
              continue;
            }
            const r = runOnText(stdinText);
            if (r.ok === false) {
              return { stdout: '', stderr: r.stderr, exitCode: 2 };
            }
            continue;
          }
          const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op, 'awk');
          if (res.ok === false) {
            stderrLines.push(res.stderr.trimEnd());
            continue;
          }
          const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
          const text = d.isBinary ? '' : d.text;
          const r = runOnText(text);
          if (r.ok === false) {
            return { stdout: '', stderr: r.stderr, exitCode: 2 };
          }
        }
      }

      if (pp.endExprs) {
        const er = AwkLib.awkRunPrintOnce(pp.endExprs, endCtx);
        if (er.ok === false) {
          return { stdout: '', stderr: er.stderr, exitCode: 2 };
        }
        chunks.push(er.stdout);
      }

      const stdout = chunks.join('');
      const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
      const exitCode = stderrLines.length > 0 ? 1 : 0;
      return { stdout, stderr, exitCode };
    },
    'awk — BEGIN/END + {print ...} subset, -F, stdin or FILEs (see awk --help)',
    'File System'
  );
})();
