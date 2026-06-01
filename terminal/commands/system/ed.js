// ed — the standard editor.
//
// "Ed is the standard editor."
//   — Patrick J. Lo Presti, "Ed is the Standard Text Editor", 1991
//
// A faithful, deliberately user-hostile line editor. No status line, no
// chrome, no prompt by default — `?` is the only feedback ed deigns to
// give you, unless you turn on H mode and ask very nicely.
//
// Implements a useful subset of ed(1):
//   addresses:  n  .  $  ,  ;  n,m  n;m  +N  -N  /pat/  ?pat?
//   commands:   a  i  c  d  p  n  =  s/pat/repl/[gN]  w  W  r  e  f  q  Q
//               H  h  P  empty-line (= +1p)

import { VfsUtils } from '../../lib/vfs-utils.js';

const ED_HELP_TEXT = `Usage: ed [FILE]
A line editor. There is no help inside the editor; that is the joke.

Inside ed:
  H            toggle verbose error mode (then a ? prints why)
  P            toggle the '*' command prompt
  q / Q        quit (warns once if buffer is modified) / quit anyway
  ,p           print the entire buffer
  3p           print line 3
  a            append: enter lines, finish with '.' on its own line
  s/old/new/g  substitute on the current line
  w [file]     write
  e file       open another file (replaces buffer)
  =            print current line number

ed is the standard editor.
`;

/**
 * @typedef {{
 *   lines: string[],
 *   current: number, // 1-based; 0 when buffer empty
 *   filename: string,
 *   filePath: string | null,
 *   modified: boolean,
 *   helpMode: boolean,
 *   promptOn: boolean,
 *   lastError: string,
 *   pendingQuit: boolean,
 * }} EdState
 */

/**
 * @typedef {{
 *   mode: 'a' | 'i' | 'c',
 *   collected: string[],
 *   from: number,
 *   to: number,
 * }} EdInputContext
 */

/**
 * Convert an ed-style substitution replacement string to a JS String.replace
 * replacement string. ed semantics:
 *   `&`   → the matched text
 *   `\&`  → literal '&'
 *   `\\`  → literal '\'
 * In JS `String.replace` we get matched text via `$&`, so we emit `$&` for `&`
 * and double `$$` to escape any literal `$` the user typed.
 */
function buildJsReplacementFromEd(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === '&' || next === '\\') {
        out += next;
        i++;
        continue;
      }
      // Unknown escape — pass through unchanged.
      out += c + next;
      i++;
      continue;
    }
    if (c === '&') {
      out += '$&';
      continue;
    }
    if (c === '$') {
      out += '$$';
      continue;
    }
    out += c;
  }
  return out;
}

function showEdEditor(terminal, content, filename, filePath) {
  /** @type {EdState} */
  const state = {
    lines:
      content === ''
        ? []
        : content.split('\n').filter((s, i, arr) => !(i === arr.length - 1 && s === '')),
    current: 0,
    filename,
    filePath,
    modified: false,
    helpMode: false,
    promptOn: false,
    lastError: '',
    pendingQuit: false
  };
  state.current = state.lines.length === 0 ? 0 : state.lines.length;

  /** @type {EdInputContext | null} */
  let inputCtx = null;

  // Minimal modal — black box, no header, no footer, scrollback fills it.
  const modalContent = `
    <div class="ed-screen" role="dialog" aria-modal="true" aria-label="ed">
      <div class="ed-output" id="ed-output"></div>
    </div>
  `;

  const modal = terminal.createModal({
    className: 'ed-modal',
    content: modalContent,
    onKeyDown: () => {
      /* All input goes through the inline input prompt below. */
    }
  });

  // Inject ed's own minimal styling once per session.
  if (!document.querySelector('#ed-editor-styles')) {
    const styleEl = terminal.addStyles(`
      .ed-modal {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 12px;
        background: var(--terminal-modal-scrim, rgba(0, 0, 0, 0.92));
        font-family: 'Hack', ui-monospace, 'Courier New', Courier, monospace;
        font-size: 13px;
        line-height: 1.35;
      }
      .ed-modal .ed-screen {
        width: min(92vw, 1100px);
        height: min(85vh, 900px);
        background: #000;
        border: 1px solid var(--terminal-rule-mid, rgba(0, 255, 80, 0.22));
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: relative;
      }
      .ed-modal .ed-output {
        flex: 1 1 auto;
        min-height: 0;
        padding: 12px 14px 8px;
        overflow-y: auto;
        white-space: pre-wrap;
        color: var(--terminal-text-soft, #c8ffc8);
      }
      .ed-modal .ed-output > div { white-space: pre-wrap; }
      .ed-modal .ed-output > div.ed-error { color: var(--terminal-text-bright, #ffd0d0); }
      .ed-modal .ed-output > div.ed-echo { color: var(--terminal-text-dim-strong, rgba(0, 255, 80, 0.78)); }
    `);
    if (styleEl && styleEl instanceof HTMLElement) styleEl.id = 'ed-editor-styles';
  }

  const outputDiv = modal.element.querySelector('#ed-output');

  /** Append a row to the scrollback. `cls` is an optional class for styling. */
  function emit(text, cls) {
    const row = document.createElement('div');
    if (cls) row.className = cls;
    row.textContent = text;
    outputDiv.appendChild(row);
    outputDiv.scrollTop = outputDiv.scrollHeight;
  }

  function emitError(message) {
    state.lastError = message;
    state.pendingQuit = false;
    if (state.helpMode) {
      emit('?', 'ed-error');
      emit(message, 'ed-error');
    } else {
      emit('?', 'ed-error');
    }
  }

  // --- Address parser ---

  /**
   * Parse a single address starting at `pos` of `s`. Returns { addr, next } or null.
   * @param {string} s
   * @param {number} pos
   * @returns {{ addr: number | null, next: number } | null} addr null on empty.
   */
  function parseSingleAddr(s, pos) {
    let i = pos;
    while (i < s.length && s[i] === ' ') i++;
    if (i >= s.length) return { addr: null, next: i };

    let base = null;
    const c = s[i];
    if (c === '.') {
      base = state.current;
      i++;
    } else if (c === '$') {
      base = state.lines.length;
      i++;
    } else if (c >= '0' && c <= '9') {
      let n = 0;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') {
        n = n * 10 + (s.charCodeAt(i) - 48);
        i++;
      }
      base = n;
    } else if (c === '/' || c === '?') {
      const delim = c;
      i++;
      let pat = '';
      while (i < s.length && s[i] !== delim) {
        if (s[i] === '\\' && i + 1 < s.length) {
          pat += s[i] + s[i + 1];
          i += 2;
        } else {
          pat += s[i++];
        }
      }
      if (i < s.length && s[i] === delim) i++;
      const found = searchRegex(pat, c === '/');
      if (found === null) return null;
      base = found;
    } else if (c === '+' || c === '-') {
      base = state.current;
    } else {
      return { addr: null, next: i };
    }

    // Apply +N / -N modifiers.
    while (i < s.length && (s[i] === '+' || s[i] === '-')) {
      const sign = s[i] === '+' ? 1 : -1;
      i++;
      let n = 0;
      let hasDigit = false;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') {
        n = n * 10 + (s.charCodeAt(i) - 48);
        i++;
        hasDigit = true;
      }
      base = (base ?? 0) + sign * (hasDigit ? n : 1);
    }

    return { addr: base, next: i };
  }

  /**
   * Parse leading address(es) of a command. Returns { from, to, next }.
   * `from`/`to` can be null when no address was given.
   */
  function parseAddrs(s, pos) {
    let i = pos;
    while (i < s.length && s[i] === ' ') i++;

    if (i < s.length && s[i] === ',') {
      i++;
      const second = parseSingleAddr(s, i);
      if (!second) return null;
      return { from: 1, to: second.addr ?? state.lines.length, next: second.next };
    }
    if (i < s.length && s[i] === ';') {
      i++;
      const second = parseSingleAddr(s, i);
      if (!second) return null;
      return { from: state.current, to: second.addr ?? state.lines.length, next: second.next };
    }

    const first = parseSingleAddr(s, i);
    if (!first) return null;

    if (first.addr === null) {
      return { from: null, to: null, next: first.next };
    }

    let next = first.next;
    let to = first.addr;
    let from = first.addr;
    while (next < s.length && s[next] === ' ') next++;
    if (next < s.length && (s[next] === ',' || s[next] === ';')) {
      const sep = s[next];
      next++;
      const second = parseSingleAddr(s, next);
      if (!second) return null;
      from = first.addr;
      to = second.addr ?? state.lines.length;
      if (sep === ';') state.current = first.addr;
      next = second.next;
    } else {
      to = first.addr;
    }
    return { from, to, next };
  }

  /** Forward (or backward) regex search starting AFTER current line. */
  function searchRegex(pat, forward) {
    if (state.lines.length === 0) return null;
    let re;
    try {
      re = new RegExp(pat);
    } catch (_e) {
      return null;
    }
    const n = state.lines.length;
    if (forward) {
      for (let off = 1; off <= n; off++) {
        const idx = (((state.current - 1 + off) % n) + n) % n;
        if (re.test(state.lines[idx])) return idx + 1;
      }
    } else {
      for (let off = 1; off <= n; off++) {
        const idx = (((state.current - 1 - off) % n) + n) % n;
        if (re.test(state.lines[idx])) return idx + 1;
      }
    }
    return null;
  }

  // --- Command execution ---

  function rangeOK(from, to) {
    if (from === null || to === null) return false;
    if (from < 1 || to < from || to > state.lines.length) return false;
    return true;
  }

  function doPrint(from, to, withNumbers) {
    if (state.lines.length === 0) {
      emitError('empty buffer');
      return;
    }
    if (!rangeOK(from, to)) {
      emitError('invalid address');
      return;
    }
    for (let n = from; n <= to; n++) {
      const line = state.lines[n - 1];
      emit(withNumbers ? `${n}\t${line}` : line);
    }
    state.current = to;
  }

  function doDelete(from, to) {
    if (!rangeOK(from, to)) {
      emitError('invalid address');
      return;
    }
    state.lines.splice(from - 1, to - from + 1);
    state.modified = true;
    state.current = Math.min(from, state.lines.length);
    if (state.current === 0 && state.lines.length > 0) state.current = 1;
  }

  function doSubstitute(from, to, body) {
    // body is everything after 's' — typically /pat/repl/flags
    if (!rangeOK(from, to)) {
      emitError('invalid address');
      return;
    }
    const m = /^(.)(.*)$/.exec(body);
    if (!m) {
      emitError('missing pattern delimiter');
      return;
    }
    const delim = m[1];
    const rest = m[2];
    const parts = [];
    let cur = '';
    let i = 0;
    while (i < rest.length && parts.length < 3) {
      const c = rest[i];
      if (c === '\\' && i + 1 < rest.length) {
        cur += c + rest[i + 1];
        i += 2;
        continue;
      }
      if (c === delim) {
        parts.push(cur);
        cur = '';
        i++;
        continue;
      }
      cur += c;
      i++;
    }
    if (parts.length < 2) {
      if (cur !== '') parts.push(cur);
      while (parts.length < 3) parts.push('');
    }
    const pat = parts[0];
    const repl = buildJsReplacementFromEd(parts[1] || '');
    const flags = parts[2] || '';
    let re;
    try {
      re = new RegExp(pat, flags.includes('g') ? 'g' : '');
    } catch (_e) {
      emitError('invalid pattern');
      return;
    }
    let any = false;
    for (let n = from; n <= to; n++) {
      const before = state.lines[n - 1];
      if (!re.test(before)) continue;
      // Reset lastIndex if global, then run replace.
      re.lastIndex = 0;
      state.lines[n - 1] = before.replace(re, repl);
      any = true;
      state.current = n;
    }
    if (!any) emitError('no match');
    else state.modified = true;
  }

  async function doWrite(from, to, target, append) {
    const path = target ? terminal.resolvePath(target) : state.filePath;
    if (!path) {
      emitError('no current filename');
      return;
    }
    const text = state.lines.slice(from - 1, to).join('\n') + (state.lines.length ? '\n' : '');
    let finalText = text;
    if (append) {
      try {
        const existing = await terminal.getFileSystemItem(path);
        if (existing && existing.type === 'file') {
          const d = VfsUtils.fileItemUtf8ForDisplay(existing);
          if (!d.isBinary) finalText = d.text + text;
        }
      } catch (_e) {
        /* fall through to plain write */
      }
    }
    try {
      await terminal.fileSystemDB.createFile(path, finalText, true);
      state.modified = false;
      state.filePath = path;
      if (target) state.filename = target;
      // Real ed prints the byte count after a write.
      emit(String(new Blob([finalText]).size));
    } catch (err) {
      emitError(`cannot write file: ${err.message}`);
    }
  }

  async function doRead(target) {
    const path = target ? terminal.resolvePath(target) : state.filePath;
    if (!path) {
      emitError('no current filename');
      return;
    }
    try {
      const item = await terminal.getFileSystemItem(path);
      if (!item || item.type !== 'file') {
        emitError(`cannot read file: ${target || path}`);
        return;
      }
      const d = VfsUtils.fileItemUtf8ForDisplay(item);
      if (d.isBinary) {
        emitError('binary file');
        return;
      }
      const text = d.text;
      const newLines =
        text === ''
          ? []
          : text.split('\n').filter((s, i, arr) => !(i === arr.length - 1 && s === ''));
      const insertAt = state.current;
      state.lines.splice(insertAt, 0, ...newLines);
      state.modified = true;
      state.current = insertAt + newLines.length;
      emit(String(new Blob([text]).size));
    } catch (err) {
      emitError(`cannot read file: ${err.message}`);
    }
  }

  async function doEdit(target) {
    if (state.modified && !state.pendingQuit) {
      state.pendingQuit = true;
      emitError('warning: file modified');
      return;
    }
    const path = target ? terminal.resolvePath(target) : state.filePath;
    if (!path) {
      emitError('no current filename');
      return;
    }
    try {
      const item = await terminal.getFileSystemItem(path);
      if (!item) {
        emitError(`cannot open file: ${target || path}`);
        return;
      }
      if (item.type !== 'file') {
        emitError('is a directory');
        return;
      }
      const d = VfsUtils.fileItemUtf8ForDisplay(item);
      const text = d.isBinary ? '' : d.text;
      state.lines =
        text === ''
          ? []
          : text.split('\n').filter((s, i, arr) => !(i === arr.length - 1 && s === ''));
      state.current = state.lines.length;
      state.filePath = path;
      if (target) state.filename = target;
      state.modified = false;
      state.pendingQuit = false;
      emit(String(new Blob([text]).size));
    } catch (err) {
      emitError(`cannot open file: ${err.message}`);
    }
  }

  function applyInputCtx() {
    if (!inputCtx) return;
    const { mode, collected, from, to } = inputCtx;
    if (mode === 'a') {
      const at = state.current;
      state.lines.splice(at, 0, ...collected);
      state.current = at + collected.length;
    } else if (mode === 'i') {
      const at = Math.max(0, state.current - 1);
      state.lines.splice(at, 0, ...collected);
      state.current = at + collected.length;
    } else if (mode === 'c') {
      if (rangeOK(from, to)) {
        state.lines.splice(from - 1, to - from + 1, ...collected);
        state.current = from + collected.length - 1;
        if (state.current < 1 && state.lines.length > 0) state.current = 1;
      }
    }
    if (collected.length > 0) state.modified = true;
    inputCtx = null;
  }

  /** Process a single line in cmd mode. Returns true if ed should keep running. */
  function processCommandLine(raw) {
    state.pendingQuit = state.pendingQuit && raw.trim() === 'q';

    if (raw.trim() === '') {
      // Empty line in ed = +1p.
      const next = state.current + 1;
      if (next < 1 || next > state.lines.length) {
        emitError('invalid address');
        return true;
      }
      state.current = next;
      emit(state.lines[next - 1]);
      return true;
    }

    const addrs = parseAddrs(raw, 0);
    if (!addrs) {
      emitError('invalid address');
      return true;
    }
    let { from, to, next } = addrs;
    if (from !== null && to === null) to = from;

    while (next < raw.length && raw[next] === ' ') next++;
    const cmdChar = next < raw.length ? raw[next] : '';
    const tail = next < raw.length ? raw.slice(next + 1) : '';

    switch (cmdChar) {
      case 'p':
      case '':
        if (from === null) {
          from = state.current;
          to = state.current;
        }
        if (from === null || from < 1) {
          emitError('invalid address');
          return true;
        }
        doPrint(from, to ?? from, false);
        return true;
      case 'n':
        if (from === null) {
          from = state.current;
          to = state.current;
        }
        doPrint(from, to ?? from, true);
        return true;
      case 'd':
        if (from === null) {
          from = state.current;
          to = state.current;
        }
        doDelete(from, to ?? from);
        return true;
      case 'a': {
        const at = from ?? state.current;
        state.current = at;
        inputCtx = { mode: 'a', collected: [], from: at, to: at };
        return true;
      }
      case 'i': {
        const at = from ?? state.current;
        if (state.lines.length === 0) {
          inputCtx = { mode: 'a', collected: [], from: 0, to: 0 };
          state.current = 0;
        } else {
          if (at < 1) {
            emitError('invalid address');
            return true;
          }
          state.current = at;
          inputCtx = { mode: 'i', collected: [], from: at, to: at };
        }
        return true;
      }
      case 'c':
        if (from === null) {
          from = state.current;
          to = state.current;
        }
        if (!rangeOK(from, to ?? from)) {
          emitError('invalid address');
          return true;
        }
        inputCtx = { mode: 'c', collected: [], from, to: to ?? from };
        return true;
      case 's': {
        const f = from ?? state.current;
        const t = to ?? f;
        doSubstitute(f, t, tail);
        return true;
      }
      case '=': {
        const n = from === null ? state.lines.length : to ?? from;
        emit(String(n));
        return true;
      }
      case 'w': {
        const isAppend = false;
        const target = tail.trim();
        const f = from ?? 1;
        const t = to ?? state.lines.length;
        void doWrite(f, t, target, isAppend);
        return true;
      }
      case 'W': {
        const target = tail.trim();
        const f = from ?? 1;
        const t = to ?? state.lines.length;
        void doWrite(f, t, target, true);
        return true;
      }
      case 'r':
        void doRead(tail.trim());
        return true;
      case 'e':
        void doEdit(tail.trim());
        return true;
      case 'f':
        if (tail.trim()) {
          state.filename = tail.trim();
          state.filePath = terminal.resolvePath(state.filename);
        } else {
          emit(state.filename || '');
        }
        return true;
      case 'q':
        if (state.modified && !state.pendingQuit) {
          state.pendingQuit = true;
          emitError('warning: file modified');
          return true;
        }
        return false;
      case 'Q':
        return false;
      case 'H':
        state.helpMode = !state.helpMode;
        if (state.helpMode && state.lastError) emit(state.lastError, 'ed-error');
        return true;
      case 'h':
        if (state.lastError) emit(state.lastError, 'ed-error');
        else emit('');
        return true;
      case 'P':
        state.promptOn = !state.promptOn;
        return true;
      default:
        emitError(`unknown command: ${cmdChar}`);
        return true;
    }
  }

  function nextPromptStr() {
    return state.promptOn ? '*' : '';
  }

  function loop() {
    terminal.createInputPrompt(modal, {
      prompt: nextPromptStr(),
      onEnter: (line) => {
        const echoPrefix = nextPromptStr();
        if (echoPrefix) emit(echoPrefix + line, 'ed-echo');
        else if (inputCtx) emit(line, 'ed-echo');

        if (inputCtx) {
          if (line === '.') {
            applyInputCtx();
          } else {
            inputCtx.collected.push(line);
          }
          loop();
          return;
        }

        const keepGoing = processCommandLine(line);
        if (!keepGoing) {
          modal.close();
          return;
        }
        loop();
      },
      onEscape: () => {
        // Cancel pending input mode but stay in ed.
        inputCtx = null;
        loop();
      }
    });
  }

  // Initial output: byte count of the loaded buffer (real ed does this when given a file).
  if (state.lines.length > 0) {
    const initialText = state.lines.join('\n') + '\n';
    emit(String(new Blob([initialText]).size));
  }

  // SIGINT inside ed cancels pending input or quits if dirty (else closes).
  terminal.onSignal('SIGINT', () => {
    if (inputCtx) {
      inputCtx = null;
      emitError('interrupted');
      loop();
      return;
    }
    if (state.modified && !state.pendingQuit) {
      state.pendingQuit = true;
      emitError('warning: file modified');
      return;
    }
    modal.close();
  });

  setTimeout(() => loop(), 0);
  return '';
}

async function edHandler(terminal, args) {
  if (args[0] === '--help') {
    return { stdout: ED_HELP_TEXT, stderr: '', exitCode: 0 };
  }

  let filename = '';
  let filePath = null;
  let initialContent = '';

  if (args.length > 0) {
    filename = args[0];
    filePath = terminal.resolvePath(filename);
    try {
      const item = await terminal.getFileSystemItem(filePath);
      if (item && item.type === 'directory') {
        return { stdout: '', stderr: `ed: ${filename}: Is a directory`, exitCode: 1 };
      }
      if (item && item.type === 'file') {
        const d = VfsUtils.fileItemUtf8ForDisplay(item);
        initialContent = d.isBinary ? '' : d.text;
      }
    } catch (err) {
      return { stdout: '', stderr: `ed: ${filename}: ${err.message}`, exitCode: 1 };
    }
  }

  return showEdEditor(terminal, initialContent, filename, filePath);
}

export default {
  name: 'ed',
  handler: edHandler,
  description: 'the standard editor (line-mode; type H to find out why ed printed ?)',
  category: 'System'
};
