// cut — print selected parts of lines (GNU-like subset)
import { CutLib } from './cut-lib.js';
import { VfsUtils } from '../../lib/vfs-utils.js';

const textDecoder = new TextDecoder('utf-8', { fatal: false });

function cutLineBytes(line, listStr, complement) {
  const enc = new TextEncoder().encode(line);
  const len = enc.length;
  const parsed = CutLib.parseCutListString(listStr);
  if (parsed.ok === false) {
    return { ok: false, stderr: parsed.stderr };
  }
  const parts = parsed.parts;
  if (!complement) {
    const out = [];
    for (const p of parts) {
      const to = p.to === Infinity ? len : p.to;
      for (let k = p.from; k <= to; k++) {
        if (k >= 1 && k <= len) {
          out.push(enc[k - 1]);
        }
      }
    }
    return { ok: true, text: textDecoder.decode(new Uint8Array(out)) };
  }
  const selected = new Set();
  for (const p of parts) {
    const to = p.to === Infinity ? len : p.to;
    for (let k = p.from; k <= to; k++) {
      if (k >= 1 && k <= len) {
        selected.add(k);
      }
    }
  }
  const out = [];
  for (let k = 1; k <= len; k++) {
    if (!selected.has(k)) {
      out.push(enc[k - 1]);
    }
  }
  return { ok: true, text: textDecoder.decode(new Uint8Array(out)) };
}

function cutLineChars(line, listStr, complement) {
  const chars = Array.from(line);
  const len = chars.length;
  const parsed = CutLib.parseCutListString(listStr);
  if (parsed.ok === false) {
    return { ok: false, stderr: parsed.stderr };
  }
  const parts = parsed.parts;
  if (!complement) {
    let out = '';
    for (const p of parts) {
      const to = p.to === Infinity ? len : p.to;
      for (let k = p.from; k <= to; k++) {
        if (k >= 1 && k <= len) {
          out += chars[k - 1];
        }
      }
    }
    return { ok: true, text: out };
  }
  const selected = new Set();
  for (const p of parts) {
    const to = p.to === Infinity ? len : p.to;
    for (let k = p.from; k <= to; k++) {
      if (k >= 1 && k <= len) {
        selected.add(k);
      }
    }
  }
  let out = '';
  for (let k = 1; k <= len; k++) {
    if (!selected.has(k)) {
      out += chars[k - 1];
    }
  }
  return { ok: true, text: out };
}

function cutLineFields(line, listStr, delim, suppress, complement, outDelim) {
  const parsed = CutLib.parseCutListString(listStr);
  if (parsed.ok === false) {
    return { ok: false, stderr: parsed.stderr };
  }
  const parts = parsed.parts;
  const sep = outDelim != null ? outDelim : delim;
  const hasDelim = delim !== '' && line.includes(delim);
  if (!hasDelim) {
    if (suppress) {
      return { ok: true, text: '' };
    }
    return { ok: true, text: line };
  }
  const fields = line.split(delim);
  const nf = fields.length;
  if (!complement) {
    const idxs = [];
    for (const p of parts) {
      const to = p.to === Infinity ? nf : p.to;
      for (let k = p.from; k <= to; k++) {
        if (k >= 1 && k <= nf) {
          idxs.push(k);
        }
      }
    }
    const pieces = idxs.map((i) => fields[i - 1] ?? '');
    return { ok: true, text: pieces.join(sep) };
  }
  const selected = new Set();
  for (const p of parts) {
    const to = p.to === Infinity ? nf : p.to;
    for (let k = p.from; k <= to; k++) {
      if (k >= 1 && k <= nf) {
        selected.add(k);
      }
    }
  }
  const idxs = [];
  for (let k = 1; k <= nf; k++) {
    if (!selected.has(k)) {
      idxs.push(k);
    }
  }
  const pieces = idxs.map((i) => fields[i - 1] ?? '');
  return { ok: true, text: pieces.join(sep) };
}

function cutTextContent(content, mode, listStr, delim, suppress, complement, outDelim) {
  const endsWithNl = content.endsWith('\n');
  const lines = content.split('\n');
  const outLines = [];
  for (const line of lines) {
    let r;
    if (mode === 'b') {
      r = cutLineBytes(line, listStr, complement);
    } else if (mode === 'c') {
      r = cutLineChars(line, listStr, complement);
    } else {
      r = cutLineFields(line, listStr, delim, suppress, complement, outDelim);
    }
    if (r.ok === false) {
      return { ok: false, stderr: r.stderr };
    }
    outLines.push(r.text);
  }
  let text = outLines.join('\n');
  if (endsWithNl) {
    text += '\n';
  }
  return { ok: true, text };
}

async function cutHandler(terminal, args) {
  const parsed = CutLib.parseCutArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: CutLib.CUT_HELP, stderr: '', exitCode: 0 };
  }

  const {
    mode,
    listStr,
    delim,
    suppressOnlyDelimited: suppress,
    complement,
    outputDelimiter
  } = parsed;
  const operands = parsed.operands;

  const stdinAvailable =
    terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
  const stdinText = stdinAvailable ? (terminal.stdin != null ? String(terminal.stdin) : '') : '';

  if (operands.length === 0) {
    if (!stdinAvailable) {
      return { stdout: '', stderr: 'cut: missing operand\n', exitCode: 1 };
    }
    const r = cutTextContent(
      stdinText,
      mode,
      listStr,
      delim,
      suppress,
      complement,
      outputDelimiter
    );
    if (r.ok === false) {
      return { stdout: '', stderr: r.stderr, exitCode: 1 };
    }
    return { stdout: r.text, stderr: '', exitCode: 0 };
  }

  const sections = [];
  const stderrLines = [];
  const showHeaders = operands.length > 1;

  for (const op of operands) {
    let label = op;
    let content = '';
    if (op === '-') {
      label = 'standard input';
      content = stdinText;
    } else {
      const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op, 'cut');
      if (res.ok === false) {
        stderrLines.push(res.stderr.trimEnd());
        continue;
      }
      const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
      content = d.isBinary ? '' : d.text;
    }
    const r = cutTextContent(content, mode, listStr, delim, suppress, complement, outputDelimiter);
    if (r.ok === false) {
      stderrLines.push(r.stderr.trimEnd());
      continue;
    }
    const slice = r.text;
    if (showHeaders) {
      sections.push(`==> ${label} <==\n${slice}`);
    } else {
      sections.push(slice);
    }
  }

  const stdout = sections.join('\n');
  const stderr = stderrLines.length > 0 ? stderrLines.join('\n') + '\n' : '';
  const exitCode = stderrLines.length > 0 ? 1 : 0;
  return { stdout, stderr, exitCode };
}

export default {
  name: 'cut',
  handler: cutHandler,
  description: 'remove sections from lines (-b/-c/-f, GNU-like)',
  category: 'File System'
};
