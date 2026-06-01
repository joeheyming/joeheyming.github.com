// joe command - Joe's Own Editor (modeless, WordStar-style keybindings)

import { VfsUtils } from '../../lib/vfs-utils.js';

/**
 * Help banner shown at the top of the editor — toggled with ^KH.
 * Mirrors the layout of real joe's help screen but only lists keys we actually bind.
 */
const JOE_HELP_LINES = [
  '   Help Screen   turn off with ^KH    (^Y is ctrl-Y, etc.)',
  ' CURSOR             GO TO            BLOCK         DELETE      SEARCH         EXIT  ',
  ' ^B left  ^F right  ^U prev. screen  ^KB begin    ^D char     ^KF find text  ^KX save ',
  ' ^P up    ^N down   ^V next screen   ^KK end      ^Y line     ^L  find next  ^C  abort',
  ' ^A b.o.l ^E e.o.l  ^KU top of file  ^KC copy     ^J end-line                 FILE     ',
  '                    ^KV end of file  ^KM move     ^_ undo                    ^KD save ',
  '                    ^KL to line No.  ^KY delete   ^^ redo                    ^KQ quit '
];

/**
 * Open the joe editor over a buffer. The harness here mirrors vi.js (snapshot
 * undo, modal+input prompts, save semantics) so behavior stays consistent
 * across the two editors; only the keybindings and chrome differ.
 */
function showJoeEditor(terminal, content, filename, filePath) {
  let currentFilePath = filePath;
  let displayName = filename;

  const lines = content.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    lines[0] = '';
  }

  let cursorRow = 0;
  let cursorCol = 0;
  let hasChanges = false;
  let helpVisible = true;
  /** When set to 'K', the next key dispatches the second half of a Ctrl-K command. */
  let pendingPrefix = '';
  /** Block selection — whole-line range, joe's "line block" style. null means no block. */
  let blockStart = null; // line index (0-based), inclusive
  let blockEnd = null; // line index (0-based), inclusive
  /** Yank buffer used for block copy / move. */
  let yankBuffer = [];

  const undoStack = [];
  const redoStack = [];
  const maxUndoSteps = 50;

  let searchTerm = '';
  let searchResults = [];
  let currentSearchIndex = -1;

  const JOE_DEFAULT_STATUS_HTML =
    '<span class="vi-status-hint">Keys: <kbd>^KH</kbd> help · <kbd>^KX</kbd> save+exit · ' +
    '<kbd>^KD</kbd> save · <kbd>^KQ</kbd> quit · <kbd>^C</kbd> abort · ' +
    '<kbd>^KF</kbd> find · <kbd>^KL</kbd> line# · <kbd>^_</kbd> undo · <kbd>^^</kbd> redo</span>';

  // Reuse vi's modal chrome (border, scrollbars, footer kbd styling) by tagging
  // the modal with both classes; .joe-editor-modal layers on the help banner.
  const modalContent = `
      <div class="joe-editor" role="dialog" aria-modal="true" aria-labelledby="joe-filename-label">
        <div class="joe-help" id="joe-help" aria-hidden="false"></div>
        <div class="vi-header">
          <span class="vi-filename" id="joe-filename-label">"${filename}" ${
    lines.length
  } lines</span>
          <span class="vi-mode joe-banner">JOE</span>
        </div>
        <div class="vi-content joe-content" id="joe-content"></div>
        <div class="vi-footer">
          <span class="vi-status" id="joe-status">${JOE_DEFAULT_STATUS_HTML}</span>
          <span class="vi-position" id="joe-position">${cursorRow + 1},${cursorCol + 1}</span>
        </div>
      </div>
    `;

  const modal = terminal.createModal({
    className: 'vi-editor-modal joe-editor-modal',
    content: modalContent,
    onKeyDown: handleKeyDown
  });

  // Joe-specific chrome (help banner colors, block highlight). Idempotent so
  // re-running joe in the same session doesn't append duplicate <style> tags.
  if (!document.querySelector('#joe-editor-styles')) {
    const styleEl = terminal.addStyles(`
      .joe-editor-modal .joe-editor {
        width: min(92vw, 1100px);
        height: min(85vh, 900px);
        min-height: 260px;
        background: var(--terminal-modal-bg, #000);
        border: 1px solid var(--terminal-rule-mid, rgba(0, 255, 80, 0.22));
        border-radius: 8px;
        box-shadow: 0 0 0 1px var(--terminal-glow, rgba(0, 255, 80, 0.08)),
          0 16px 48px var(--terminal-modal-shadow, rgba(0, 0, 0, 0.75));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: relative;
      }
      .joe-editor-modal .joe-help {
        flex-shrink: 0;
        padding: 6px 12px;
        border-bottom: 1px solid var(--terminal-rule-hairline, rgba(0, 255, 80, 0.2));
        background: var(--terminal-modal-footer-bg, rgba(0, 24, 0, 0.55));
        color: var(--terminal-text-dim-hi, rgba(0, 255, 80, 0.88));
        font-family: inherit;
        font-size: 11px;
        line-height: 1.35;
        white-space: pre;
        overflow-x: auto;
      }
      .joe-editor-modal .joe-help[aria-hidden="true"] {
        display: none;
      }
      .joe-editor-modal .joe-banner {
        letter-spacing: 0.08em;
        color: var(--terminal-text-bright, #b6f7b6);
      }
      .joe-editor-modal .joe-block-line {
        background: var(--terminal-modal-grad, rgba(0, 56, 0, 0.55));
      }
      .joe-editor-modal .joe-content {
        scrollbar-gutter: stable;
      }
    `);
    if (styleEl && styleEl instanceof HTMLElement) {
      styleEl.id = 'joe-editor-styles';
    }
  }

  const contentDiv = modal.element.querySelector('#joe-content');
  const helpDiv = modal.element.querySelector('#joe-help');
  const statusSpan = modal.element.querySelector('#joe-status');
  const positionSpan = modal.element.querySelector('#joe-position');
  const filenameSpan = modal.element.querySelector('#joe-filename-label');

  if (helpDiv) helpDiv.textContent = JOE_HELP_LINES.join('\n');

  // ---- Undo / redo (vim-style snapshot stacks; same shape as vi.js) ----

  function snapshotState() {
    return {
      lines: lines.map((line) => line),
      cursorRow,
      cursorCol,
      hasChanges,
      blockStart,
      blockEnd
    };
  }

  function saveState() {
    redoStack.length = 0;
    undoStack.push(snapshotState());
    if (undoStack.length > maxUndoSteps) undoStack.shift();
  }

  function applySnapshot(state) {
    lines.length = 0;
    lines.push(...state.lines);
    cursorRow = state.cursorRow;
    cursorCol = state.cursorCol;
    hasChanges = state.hasChanges;
    blockStart = state.blockStart;
    blockEnd = state.blockEnd;
  }

  function undo() {
    if (undoStack.length === 0) {
      setStatus('Nothing to undo');
      return;
    }
    redoStack.push(snapshotState());
    if (redoStack.length > maxUndoSteps) redoStack.shift();
    applySnapshot(undoStack.pop());
    setStatus('Undid 1 change');
    updateDisplay();
  }

  function redo() {
    if (redoStack.length === 0) {
      setStatus('Nothing to redo');
      return;
    }
    undoStack.push(snapshotState());
    if (undoStack.length > maxUndoSteps) undoStack.shift();
    applySnapshot(redoStack.pop());
    setStatus('Redid 1 change');
    updateDisplay();
  }

  // ---- Block helpers (whole-line ranges; joe's "line block" mode) ----

  function blockRange() {
    if (blockStart === null || blockEnd === null) return null;
    const lo = Math.min(blockStart, blockEnd);
    const hi = Math.max(blockStart, blockEnd);
    return { lo, hi };
  }

  function clearBlock() {
    blockStart = null;
    blockEnd = null;
  }

  // ---- Display ----

  function updateDisplay() {
    cursorRow = Math.max(0, Math.min(cursorRow, lines.length - 1));
    cursorCol = Math.max(0, Math.min(cursorCol, lines[cursorRow].length));

    const range = blockRange();
    let displayContent = '';
    lines.forEach((line, rowIndex) => {
      const inBlock = range && rowIndex >= range.lo && rowIndex <= range.hi;
      const blockOpen = inBlock ? '<span class="joe-block-line">' : '';
      const blockClose = inBlock ? '</span>' : '';

      if (rowIndex === cursorRow) {
        const beforeCursor = terminal.escapeHtml(line.substring(0, cursorCol));
        const atCursor = cursorCol < line.length ? terminal.escapeHtml(line[cursorCol]) : ' ';
        const afterCursor = terminal.escapeHtml(line.substring(cursorCol + 1));
        displayContent +=
          blockOpen +
          beforeCursor +
          `<span class="vi-cursor insert">${atCursor}</span>` +
          afterCursor +
          blockClose +
          '\n';
      } else {
        displayContent += blockOpen + terminal.escapeHtml(line) + blockClose + '\n';
      }
    });

    contentDiv.innerHTML = displayContent;
    if (filenameSpan) {
      filenameSpan.textContent = `"${displayName}" ${lines.length} lines${
        hasChanges ? ' [modified]' : ''
      }`;
    }
    if (positionSpan) positionSpan.textContent = `${cursorRow + 1},${cursorCol + 1}`;
    if (helpDiv) helpDiv.setAttribute('aria-hidden', helpVisible ? 'false' : 'true');

    scrollCursorIntoView();
  }

  function scrollCursorIntoView() {
    if (!contentDiv) return;
    const cur = contentDiv.querySelector('.vi-cursor');
    if (cur && typeof cur.scrollIntoView === 'function') {
      cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function setStatus(message) {
    if (!statusSpan) return;
    if (message === '' || message == null) {
      statusSpan.innerHTML = JOE_DEFAULT_STATUS_HTML;
      return;
    }
    statusSpan.textContent = message;
  }

  // ---- File save (matches vi's API: createFile(path, content, true)) ----

  function displayNameFromResolvedPath(path) {
    const s = path.replace(/\/+$/, '');
    if (!s || s === '/') return '/';
    const idx = s.lastIndexOf('/');
    return idx === -1 ? s : s.slice(idx + 1) || '/';
  }

  async function saveFile(optionalPath) {
    const destPath = optionalPath ? terminal.resolvePath(optionalPath) : currentFilePath;
    try {
      const text = lines.join('\n');
      await terminal.fileSystemDB.createFile(destPath, text, true);
      hasChanges = false;
      currentFilePath = destPath;
      displayName = displayNameFromResolvedPath(destPath);
      setStatus(`File "${displayName}" saved.`);
      updateDisplay();
      return true;
    } catch (error) {
      setStatus(`Couldn't save: ${error.message}`);
      updateDisplay();
      return false;
    }
  }

  function closeEditor() {
    modal.close();
  }

  // ---- Search ----

  function performSearch(term) {
    if (!term) return;
    searchTerm = term;
    searchResults = [];
    lines.forEach((line, lineIndex) => {
      let index = 0;
      while ((index = line.indexOf(term, index)) !== -1) {
        searchResults.push({ line: lineIndex, col: index });
        index++;
      }
    });

    if (searchResults.length === 0) {
      setStatus(`Not found: ${term}`);
      return;
    }

    let found = false;
    for (let i = 0; i < searchResults.length; i++) {
      const r = searchResults[i];
      if (r.line > cursorRow || (r.line === cursorRow && r.col > cursorCol)) {
        cursorRow = r.line;
        cursorCol = r.col;
        currentSearchIndex = i;
        found = true;
        break;
      }
    }
    if (!found) {
      const r = searchResults[0];
      cursorRow = r.line;
      cursorCol = r.col;
      currentSearchIndex = 0;
      setStatus(`Search wrapped — match 1/${searchResults.length}`);
    } else {
      setStatus(`Match ${currentSearchIndex + 1}/${searchResults.length}`);
    }
    updateDisplay();
  }

  function findNext() {
    if (!searchTerm || searchResults.length === 0) {
      setStatus('No previous search');
      return;
    }
    currentSearchIndex = (currentSearchIndex + 1) % searchResults.length;
    const r = searchResults[currentSearchIndex];
    cursorRow = r.line;
    cursorCol = r.col;
    setStatus(`Match ${currentSearchIndex + 1}/${searchResults.length}`);
    updateDisplay();
  }

  // ---- Editing primitives ----

  function insertChar(ch) {
    saveState();
    const line = lines[cursorRow];
    lines[cursorRow] = line.substring(0, cursorCol) + ch + line.substring(cursorCol);
    cursorCol++;
    hasChanges = true;
  }

  function insertNewline() {
    saveState();
    const line = lines[cursorRow];
    const before = line.substring(0, cursorCol);
    const after = line.substring(cursorCol);
    lines[cursorRow] = before;
    lines.splice(cursorRow + 1, 0, after);
    cursorRow++;
    cursorCol = 0;
    hasChanges = true;
  }

  function backspace() {
    if (cursorCol > 0) {
      saveState();
      const line = lines[cursorRow];
      lines[cursorRow] = line.substring(0, cursorCol - 1) + line.substring(cursorCol);
      cursorCol--;
      hasChanges = true;
    } else if (cursorRow > 0) {
      saveState();
      const prev = lines[cursorRow - 1];
      lines[cursorRow - 1] = prev + lines[cursorRow];
      lines.splice(cursorRow, 1);
      cursorRow--;
      cursorCol = prev.length;
      hasChanges = true;
    }
  }

  function deleteCharForward() {
    const line = lines[cursorRow];
    if (cursorCol < line.length) {
      saveState();
      lines[cursorRow] = line.substring(0, cursorCol) + line.substring(cursorCol + 1);
      hasChanges = true;
    } else if (cursorRow < lines.length - 1) {
      saveState();
      lines[cursorRow] = line + lines[cursorRow + 1];
      lines.splice(cursorRow + 1, 1);
      hasChanges = true;
    }
  }

  function deleteCurrentLine() {
    saveState();
    if (lines.length <= 1) {
      lines[0] = '';
      cursorCol = 0;
    } else {
      lines.splice(cursorRow, 1);
      if (cursorRow >= lines.length) cursorRow = lines.length - 1;
      cursorCol = Math.min(cursorCol, lines[cursorRow].length);
    }
    hasChanges = true;
  }

  function deleteToEndOfLine() {
    const line = lines[cursorRow];
    if (cursorCol < line.length) {
      saveState();
      lines[cursorRow] = line.substring(0, cursorCol);
      hasChanges = true;
    } else if (cursorRow < lines.length - 1) {
      // joe behavior: at EOL, ^J joins the next line
      saveState();
      lines[cursorRow] = line + lines[cursorRow + 1];
      lines.splice(cursorRow + 1, 1);
      hasChanges = true;
    }
  }

  // ---- Page movement ----

  function visibleRowCount() {
    if (!contentDiv) return 20;
    const probe = document.createElement('span');
    probe.textContent = 'M';
    probe.style.visibility = 'hidden';
    contentDiv.appendChild(probe);
    const rowH = probe.getBoundingClientRect().height || 18;
    contentDiv.removeChild(probe);
    const h = contentDiv.clientHeight || 360;
    return Math.max(1, Math.floor(h / rowH) - 1);
  }

  function pageUp() {
    cursorRow = Math.max(0, cursorRow - visibleRowCount());
    cursorCol = Math.min(cursorCol, lines[cursorRow].length);
  }
  function pageDown() {
    cursorRow = Math.min(lines.length - 1, cursorRow + visibleRowCount());
    cursorCol = Math.min(cursorCol, lines[cursorRow].length);
  }

  // ---- Block ops (whole-line) ----

  function copyBlockHere() {
    const range = blockRange();
    if (!range) {
      setStatus('No block marked (use ^KB / ^KK)');
      return;
    }
    const captured = lines.slice(range.lo, range.hi + 1);
    yankBuffer = captured;
    saveState();
    lines.splice(cursorRow + 1, 0, ...captured);
    cursorRow += captured.length;
    cursorCol = 0;
    hasChanges = true;
    clearBlock();
    setStatus(`${captured.length} line${captured.length === 1 ? '' : 's'} copied`);
  }

  function moveBlockHere() {
    const range = blockRange();
    if (!range) {
      setStatus('No block marked (use ^KB / ^KK)');
      return;
    }
    const captured = lines.slice(range.lo, range.hi + 1);
    yankBuffer = captured;
    saveState();
    // Compute insertion point after removal
    let insertAt = cursorRow + 1;
    if (cursorRow >= range.lo && cursorRow <= range.hi) {
      // Cursor is inside the block — drop block, then insert at original lo
      insertAt = range.lo;
    } else if (cursorRow > range.hi) {
      // Cursor past the block — shift insertion point back by removed count
      insertAt = cursorRow + 1 - captured.length;
    }
    lines.splice(range.lo, captured.length);
    lines.splice(insertAt, 0, ...captured);
    cursorRow = insertAt + captured.length - 1;
    cursorCol = Math.min(cursorCol, lines[cursorRow].length);
    if (lines.length === 0) lines.push('');
    hasChanges = true;
    clearBlock();
    setStatus(`${captured.length} line${captured.length === 1 ? '' : 's'} moved`);
  }

  function deleteBlock() {
    const range = blockRange();
    if (!range) {
      setStatus('No block marked (use ^KB / ^KK)');
      return;
    }
    const captured = lines.slice(range.lo, range.hi + 1);
    yankBuffer = captured;
    saveState();
    lines.splice(range.lo, captured.length);
    if (lines.length === 0) lines.push('');
    cursorRow = Math.min(range.lo, lines.length - 1);
    cursorCol = Math.min(cursorCol, lines[cursorRow].length);
    hasChanges = true;
    clearBlock();
    setStatus(`${captured.length} line${captured.length === 1 ? '' : 's'} deleted`);
  }

  // ---- Prompts (line input) ----

  function promptFor(prompt, onValue) {
    terminal.createInputPrompt(modal, {
      prompt,
      onEnter: (value) => {
        if (value && value.trim()) onValue(value);
      },
      onEscape: () => {
        setStatus('');
      }
    });
  }

  // ---- Ctrl-K dispatch ----

  function dispatchKPrefix(e) {
    pendingPrefix = '';
    const key = (e.key || '').toLowerCase();

    switch (key) {
      case 'h':
        helpVisible = !helpVisible;
        setStatus(helpVisible ? 'Help on' : 'Help off');
        break;
      case 'x':
        if (hasChanges) {
          void saveFile().then((ok) => {
            if (ok) closeEditor();
          });
        } else {
          closeEditor();
        }
        break;
      case 'd':
        promptFor(`Name of file to save (^C to abort): `, (value) => {
          void saveFile(value.trim());
        });
        return;
      case 's':
        void saveFile();
        break;
      case 'q':
        if (hasChanges) {
          promptFor(`Lose changes to this file (y,n)? `, (value) => {
            if (/^y(es)?$/i.test(value.trim())) closeEditor();
            else setStatus('');
          });
          return;
        }
        closeEditor();
        return;
      case 'f':
        promptFor('Find: ', (value) => performSearch(value));
        return;
      case 'l':
        promptFor('Line number: ', (value) => {
          const n = parseInt(value.trim(), 10);
          if (!Number.isNaN(n) && n > 0) {
            cursorRow = Math.min(n - 1, lines.length - 1);
            cursorCol = 0;
            setStatus(`Line ${cursorRow + 1}`);
            updateDisplay();
          } else {
            setStatus('Bad line number');
          }
        });
        return;
      case 'u':
        cursorRow = 0;
        cursorCol = 0;
        setStatus('Top of file');
        break;
      case 'v':
        cursorRow = lines.length - 1;
        cursorCol = lines[cursorRow].length;
        setStatus('End of file');
        break;
      case 'b':
        blockStart = cursorRow;
        if (blockEnd === null) blockEnd = cursorRow;
        setStatus(`Block begin = line ${cursorRow + 1}`);
        break;
      case 'k':
        blockEnd = cursorRow;
        if (blockStart === null) blockStart = cursorRow;
        setStatus(`Block end = line ${cursorRow + 1}`);
        break;
      case 'c':
        copyBlockHere();
        break;
      case 'm':
        moveBlockHere();
        break;
      case 'y':
        deleteBlock();
        break;
      default:
        setStatus(`^K${(e.key || '').toUpperCase()}: not bound`);
        break;
    }
    updateDisplay();
  }

  // ---- Top-level keydown ----

  function handleKeyDown(e) {
    // We never want browser default for editor keys (especially Ctrl-combinations).
    e.preventDefault();

    // A pending Ctrl-K prefix consumes the very next key, regardless of modifier
    // state — joe accepts both `^K X` (Ctrl held) and `^K` then `X` (Ctrl released).
    if (pendingPrefix === 'K') {
      if (e.key === 'Escape') {
        pendingPrefix = '';
        setStatus('');
        updateDisplay();
        return;
      }
      // Ignore bare modifier-only keydowns while waiting (e.g. user releases Ctrl).
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') {
        return;
      }
      dispatchKPrefix(e);
      return;
    }

    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
    const key = e.key;

    // Ctrl chord shortcuts (joe's core bindings)
    if (ctrl) {
      const k = (key || '').toLowerCase();
      switch (k) {
        case 'k':
          pendingPrefix = 'K';
          setStatus('^K');
          return;
        case 'b':
          cursorCol = Math.max(0, cursorCol - 1);
          updateDisplay();
          return;
        case 'f':
          cursorCol = Math.min(lines[cursorRow].length, cursorCol + 1);
          updateDisplay();
          return;
        case 'p':
          cursorRow = Math.max(0, cursorRow - 1);
          cursorCol = Math.min(cursorCol, lines[cursorRow].length);
          updateDisplay();
          return;
        case 'n':
          cursorRow = Math.min(lines.length - 1, cursorRow + 1);
          cursorCol = Math.min(cursorCol, lines[cursorRow].length);
          updateDisplay();
          return;
        case 'a':
          cursorCol = 0;
          updateDisplay();
          return;
        case 'e':
          cursorCol = lines[cursorRow].length;
          updateDisplay();
          return;
        case 'u':
          pageUp();
          updateDisplay();
          return;
        case 'v':
          pageDown();
          updateDisplay();
          return;
        case 'd':
          deleteCharForward();
          updateDisplay();
          return;
        case 'y':
          deleteCurrentLine();
          updateDisplay();
          return;
        case 'j':
          deleteToEndOfLine();
          updateDisplay();
          return;
        case 'l':
          findNext();
          return;
        case 'r':
          updateDisplay();
          setStatus('Refreshed');
          return;
        case 'z':
          // Common port behavior: also treat ^Z as undo since ^_ is awkward to type.
          undo();
          return;
        default:
          break;
      }
      // joe's canonical undo / redo keys.
      if (key === '_') {
        undo();
        return;
      }
      if (key === '^') {
        redo();
        return;
      }
      // Unknown ctrl chord — just clear status.
      setStatus('');
      updateDisplay();
      return;
    }

    // Plain keys (no Ctrl) — modeless editing.
    switch (key) {
      case 'ArrowLeft':
        cursorCol = Math.max(0, cursorCol - 1);
        break;
      case 'ArrowRight':
        cursorCol = Math.min(lines[cursorRow].length, cursorCol + 1);
        break;
      case 'ArrowUp':
        cursorRow = Math.max(0, cursorRow - 1);
        cursorCol = Math.min(cursorCol, lines[cursorRow].length);
        break;
      case 'ArrowDown':
        cursorRow = Math.min(lines.length - 1, cursorRow + 1);
        cursorCol = Math.min(cursorCol, lines[cursorRow].length);
        break;
      case 'Home':
        cursorCol = 0;
        break;
      case 'End':
        cursorCol = lines[cursorRow].length;
        break;
      case 'PageUp':
        pageUp();
        break;
      case 'PageDown':
        pageDown();
        break;
      case 'Backspace':
        backspace();
        break;
      case 'Delete':
        deleteCharForward();
        break;
      case 'Enter':
        insertNewline();
        break;
      case 'Tab':
        insertChar('\t');
        break;
      case 'Escape':
        // Cancel any pending block / status hint.
        setStatus('');
        break;
      default:
        if (key && key.length === 1 && !e.metaKey && !e.altKey) {
          insertChar(key);
        }
        break;
    }
    updateDisplay();
  }

  // SIGINT (Ctrl+C) — joe's "abort program". The modal harness already
  // intercepts ^C and routes it through here; warn before discarding changes.
  terminal.onSignal('SIGINT', () => {
    if (hasChanges) {
      promptFor('Lose changes to this file (y,n)? ', (value) => {
        if (/^y(es)?$/i.test(value.trim())) closeEditor();
        else setStatus('');
      });
    } else {
      closeEditor();
    }
  });

  updateDisplay();
  setTimeout(() => modal.focus(), 10);
  return '';
}

async function joeHandler(terminal, args) {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'joe: missing operand',
      exitCode: 1
    };
  }

  if (args[0] === '--help' || args[0] === '-h') {
    return {
      stdout: `joe - Joe's Own Editor (modeless, WordStar-style)

Usage: joe <filename>

Joe is modeless — just type to insert text. Two-key commands start with ^K
(Ctrl-K), then the second key. Toggle the help banner with ^KH.

Cursor:
  ^B / ^F      Left / right one character
  ^P / ^N      Up / down one line
  ^A / ^E      Beginning / end of line
  ^U / ^V      Page up / page down
  Arrows, Home, End, PgUp, PgDn  Standard

Goto:
  ^KU          Top of file
  ^KV          End of file
  ^KL          Goto line number (prompts)

Edit:
  Backspace    Delete char before cursor
  Delete / ^D  Delete char under cursor
  ^Y           Delete current line
  ^J           Delete to end of line (joins next line at EOL)
  ^_           Undo  (also ^Z)
  ^^           Redo

Block (whole-line ranges):
  ^KB          Mark block begin at current line
  ^KK          Mark block end at current line
  ^KC          Copy block below cursor
  ^KM          Move block to cursor
  ^KY          Delete block

Search:
  ^KF          Find text (prompts)
  ^L           Find next

File:
  ^KS          Save
  ^KD          Save as (prompts)
  ^KX          Save and exit
  ^KQ          Quit (prompts if modified)
  ^C           Abort (prompts if modified)
  ^KH          Toggle help banner
  ^R           Refresh display`,
      stderr: '',
      exitCode: 0
    };
  }

  const filename = args[0];
  const filePath = terminal.resolvePath(filename);

  try {
    let content = '';
    const file = await terminal.getFileSystemItem(filePath);
    if (file && file.type === 'directory') {
      return {
        stdout: '',
        stderr: `joe: ${filename}: Is a directory`,
        exitCode: 1
      };
    }
    if (file && file.type === 'file') {
      const d = VfsUtils.fileItemUtf8ForDisplay(file);
      content = d.isBinary ? '' : d.text;
    }

    return showJoeEditor(terminal, content, filename, filePath);
  } catch (error) {
    return {
      stdout: '',
      stderr: `joe: ${filename}: ${error.message}`,
      exitCode: 1
    };
  }
}

export default {
  name: 'joe',
  handler: joeHandler,
  description: "Joe's Own Editor — modeless text editor (joe <file>)",
  category: 'System'
};
