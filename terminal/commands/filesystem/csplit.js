// csplit — split a file by context (GNU-ish subset)
import { CsplitLib } from './csplit-lib.js';
import { SplitLib } from './split-lib.js';
import { VfsUtils } from '../../lib/vfs-utils.js';

/**
 * @param {Error} error
 * @param {string} arg
 * @returns {{ stderr: string, exitCode: number }}
 */
function csplitStderrFromError(error, arg) {
  const msg = error && error.message ? String(error.message) : String(error);
  if (msg.startsWith('Parent directory does not exist:')) {
    return {
      stderr: `csplit: ${arg}: No such file or directory`,
      exitCode: 1
    };
  }
  return { stderr: `csplit: ${arg}: ${msg}`, exitCode: 1 };
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

async function csplitHandler(terminal, args) {
  const parsed = CsplitLib.parseCsplitArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: CsplitLib.CSPLIT_HELP, stderr: '', exitCode: 0 };
  }
  if (parsed.version) {
    return { stdout: CsplitLib.CSPLIT_VERSION_LINE, stderr: '', exitCode: 0 };
  }

  const { prefix, digits, silent, keepFiles, elideEmpty, operands } = parsed;

  if (operands.length === 0) {
    return { stdout: '', stderr: 'csplit: missing operand\n', exitCode: 1 };
  }
  if (operands.length < 2) {
    return {
      stdout: '',
      stderr: `csplit: missing operand after '${operands[0]}'\nTry 'csplit --help' for more information.\n`,
      exitCode: 1
    };
  }

  const fileOperand = operands[0];
  const patternTokens = operands.slice(1);
  const exp = CsplitLib.expandCsplitPatternTokens(patternTokens);
  if (exp.ok === false) {
    return { stdout: '', stderr: exp.stderr, exitCode: exp.exitCode };
  }
  const atoms = exp.atoms;
  if (atoms.length === 0) {
    return {
      stdout: '',
      stderr: `csplit: missing operand after '${fileOperand}'\nTry 'csplit --help' for more information.\n`,
      exitCode: 1
    };
  }

  const stdinAvailable =
    terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
  const stdinText = stdinAvailable ? (terminal.stdin != null ? String(terminal.stdin) : '') : '';

  /** @type {Uint8Array} */
  let inputBytes;
  let isBinary = false;
  let inputText = '';

  if (fileOperand === '-') {
    if (!stdinAvailable) {
      return { stdout: '', stderr: 'csplit: missing operand\n', exitCode: 1 };
    }
    inputText = stdinText;
    inputBytes = new TextEncoder().encode(inputText);
    isBinary = false;
  } else {
    const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, fileOperand, 'csplit');
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

  /** @type {{ suffixMode: 'digit' | 'alpha' | 'hex', suffixWidth: number }} */
  const suffixCfg = { suffixMode: 'digit', suffixWidth: digits };
  const maxIdx = SplitLib.splitMaxSuffixIndex(suffixCfg);

  /** @type {string[]} */
  let piecesText;
  /** @type {Uint8Array[]} */
  let piecesBin;
  /** @type {number[]} */
  let sizes;

  if (isBinary) {
    const lineParts = SplitLib.splitLinesBytes(inputBytes);
    const comp = CsplitLib.csplitComputeBinaryPieces(lineParts, atoms);
    if (comp.ok === false) {
      return { stdout: '', stderr: comp.stderr, exitCode: comp.exitCode };
    }
    piecesBin = comp.pieces;
    sizes = comp.sizes;
  } else {
    const lines = SplitLib.splitLinesWithSeparators(inputText);
    const comp = CsplitLib.csplitComputeTextPieces(lines, atoms);
    if (comp.ok === false) {
      return { stdout: '', stderr: comp.stderr, exitCode: comp.exitCode };
    }
    piecesText = comp.pieces;
    sizes = comp.sizes;
  }

  /** @type {string[]} */
  const createdNames = [];

  async function writeOne(index, content) {
    const suf = SplitLib.splitGenerateSuffix(index, suffixCfg);
    if (suf == null) {
      return {
        ok: false,
        stderr: 'csplit: output file suffixes exhausted\n',
        exitCode: 1
      };
    }
    const name = prefix + suf;
    const outPath = terminal.resolvePath(name);
    const existing = await terminal.getFileSystemItem(outPath);
    if (existing && existing.type === 'directory') {
      return { ok: false, stderr: `csplit: ${name}: Is a directory\n`, exitCode: 1 };
    }
    try {
      await terminal.fileSystemDB.createFile(outPath, content, true);
    } catch (error) {
      const { stderr, exitCode } = csplitStderrFromError(error, name);
      return { ok: false, stderr: `${stderr}\n`, exitCode };
    }
    createdNames.push(name);
    return { ok: true };
  }

  async function removeCreated() {
    for (const name of createdNames) {
      const p = terminal.resolvePath(name);
      try {
        await terminal.fileSystemDB.unlink(p);
      } catch {
        /* ignore */
      }
    }
  }

  /** @type {number[]} */
  const outSizes = [];
  let outIdx = 0;
  const nPieces = isBinary ? piecesBin.length : piecesText.length;
  for (let p = 0; p < nPieces; p++) {
    const sz = sizes[p];
    if (elideEmpty && sz === 0) {
      continue;
    }
    if (outIdx > maxIdx) {
      if (!keepFiles) {
        await removeCreated();
      }
      return {
        stdout: '',
        stderr: 'csplit: output file suffixes exhausted\n',
        exitCode: 1
      };
    }
    const content = isBinary ? piecesBin[p] : piecesText[p];
    const w = await writeOne(outIdx, content);
    if (w.ok === false) {
      if (!keepFiles) {
        await removeCreated();
      }
      return { stdout: '', stderr: w.stderr, exitCode: w.exitCode };
    }
    outSizes.push(sz);
    outIdx++;
  }

  const stdout = CsplitLib.csplitFormatStdoutSizes(outSizes, silent);
  return { stdout, stderr: '', exitCode: 0 };
}

export default {
  name: 'csplit',
  handler: csplitHandler,
  description: 'split a file by line patterns (GNU-style PREFIX00, stdin, --)',
  category: 'File System'
};
