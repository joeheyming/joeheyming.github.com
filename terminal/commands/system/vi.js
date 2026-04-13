// vi command - simple text editor

import { VfsUtils } from '../../lib/vfs-utils.js';

// Vi editor implementation using terminal API
function showViEditor(terminal, content, filename, filePath) {
  let currentFilePath = filePath;
  let displayName = filename;

  const lines = content.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    lines[0] = ''; // Ensure at least one empty line
  }

  let cursorRow = 0;
  let cursorCol = 0;
  let mode = 'normal'; // 'normal', 'insert', or 'search'
  let hasChanges = false;
  let commandBuffer = '';
  let pendingCommand = ''; // For multi-key commands like 'dd'
  let searchTerm = '';
  let searchResults = [];
  let currentSearchIndex = -1;
  let yankBuffer = ''; // For copy/paste operations
  let undoStack = []; // Snapshots before each change (undo pops)
  let redoStack = []; // Snapshots pushed on undo (redo pops)
  let maxUndoSteps = 50;
  /** Digits typed before `G` / `gg` (vim-style `42G`, `42gg`); cleared on Escape or most other keys. */
  let prefixDigits = '';

  const VI_DEFAULT_STATUS_HTML =
    '<span class="vi-status-hint">Keys: <kbd>i</kbd> insert · <kbd>ZZ</kbd> save+quit · <kbd>G</kbd>/<kbd>gg</kbd> line · <kbd>dd</kbd> del · <kbd>yy</kbd> yank · <kbd>p</kbd>/<kbd>P</kbd> paste · <kbd>u</kbd> undo · <kbd>Ctrl+R</kbd> redo · <kbd>:</kbd> ex</span>';

  // Create modal content (styles: terminal/style.css .vi-editor-modal)
  const modalContent = `
      <div class="vi-editor" role="dialog" aria-modal="true" aria-labelledby="vi-filename-label">
        <div class="vi-header">
          <span class="vi-filename" id="vi-filename-label">"${filename}" ${
    lines.length
  } lines</span>
          <span class="vi-mode">${mode.toUpperCase()}</span>
        </div>
        <div class="vi-content" id="vi-content"></div>
        <div class="vi-footer">
          <span class="vi-status" id="vi-status">${VI_DEFAULT_STATUS_HTML}</span>
          <span class="vi-position">${cursorRow + 1},${cursorCol + 1}</span>
        </div>
      </div>
    `;

  // Create modal using terminal API
  const modal = terminal.createModal({
    className: 'vi-editor-modal',
    content: modalContent,
    onKeyDown: handleKeyDown
  });

  const contentDiv = modal.element.querySelector('#vi-content');
  const statusSpan = modal.element.querySelector('#vi-status');
  const modeSpan = modal.element.querySelector('.vi-mode');
  const positionSpan = modal.element.querySelector('.vi-position');
  const filenameSpan = modal.element.querySelector('.vi-filename');

  // Helper functions for undo / redo (vim-style snapshot stacks)
  function snapshotState() {
    return {
      lines: lines.map((line) => line),
      cursorRow,
      cursorCol,
      hasChanges
    };
  }

  function saveState() {
    redoStack.length = 0;
    undoStack.push(snapshotState());
    if (undoStack.length > maxUndoSteps) {
      undoStack.shift();
    }
  }

  function undo() {
    if (undoStack.length === 0) {
      setStatus('Already at oldest change');
      return;
    }

    redoStack.push(snapshotState());
    if (redoStack.length > maxUndoSteps) {
      redoStack.shift();
    }

    const state = undoStack.pop();
    lines.length = 0;
    lines.push(...state.lines);
    cursorRow = state.cursorRow;
    cursorCol = state.cursorCol;
    hasChanges = state.hasChanges;
    setStatus('Undid 1 change');
    updateDisplay();
  }

  function redo() {
    if (redoStack.length === 0) {
      setStatus('Already at newest change');
      return;
    }

    undoStack.push(snapshotState());
    if (undoStack.length > maxUndoSteps) {
      undoStack.shift();
    }

    const state = redoStack.pop();
    lines.length = 0;
    lines.push(...state.lines);
    cursorRow = state.cursorRow;
    cursorCol = state.cursorCol;
    hasChanges = state.hasChanges;
    setStatus('Redid 1 change');
    updateDisplay();
  }

  function deleteLine(lineIndex) {
    if (lines.length <= 1) {
      // Don't delete the last line, just clear it
      yankBuffer = lines[lineIndex];
      lines[lineIndex] = '';
    } else {
      yankBuffer = lines[lineIndex];
      lines.splice(lineIndex, 1);
      if (cursorRow >= lines.length) {
        cursorRow = lines.length - 1;
      }
    }
    cursorCol = Math.min(cursorCol, lines[cursorRow].length);
    hasChanges = true;
  }

  function yankLine(lineIndex) {
    yankBuffer = lines[lineIndex];
    setStatus('1 line yanked');
  }

  function pasteLine() {
    if (!yankBuffer) {
      setStatus('Nothing to paste');
      return;
    }

    lines.splice(cursorRow + 1, 0, yankBuffer);
    cursorRow++;
    cursorCol = 0;
    hasChanges = true;
    setStatus('1 line pasted');
  }

  function updateDisplay() {
    // Ensure cursor is within bounds
    cursorRow = Math.max(0, Math.min(cursorRow, lines.length - 1));
    cursorCol = Math.max(0, Math.min(cursorCol, lines[cursorRow].length));

    // Build display with cursor - escape HTML to show raw text
    let displayContent = '';
    lines.forEach((line, rowIndex) => {
      if (rowIndex === cursorRow) {
        const beforeCursor = terminal.escapeHtml(line.substring(0, cursorCol));
        const atCursor = cursorCol < line.length ? terminal.escapeHtml(line[cursorCol]) : ' ';
        const afterCursor = terminal.escapeHtml(line.substring(cursorCol + 1));
        displayContent +=
          beforeCursor + `<span class="vi-cursor ${mode}">${atCursor}</span>` + afterCursor + '\n';
      } else {
        displayContent += terminal.escapeHtml(line) + '\n';
      }
    });

    contentDiv.innerHTML = displayContent;
    if (filenameSpan) {
      filenameSpan.textContent = `"${displayName}" ${lines.length} lines`;
    }
    modeSpan.textContent = mode.toUpperCase() + (hasChanges ? ' [+]' : '');
    positionSpan.textContent = `${cursorRow + 1},${cursorCol + 1}`;
  }

  function setStatus(message) {
    if (message === '') {
      statusSpan.innerHTML = VI_DEFAULT_STATUS_HTML;
      return;
    }
    statusSpan.textContent = message;
  }

  function performSearch(term, direction = 1) {
    if (!term) return;

    searchTerm = term;
    searchResults = [];

    // Find all matches
    lines.forEach((line, lineIndex) => {
      let index = 0;
      while ((index = line.indexOf(term, index)) !== -1) {
        searchResults.push({ line: lineIndex, col: index });
        index++;
      }
    });

    if (searchResults.length === 0) {
      setStatus(`Pattern not found: ${term}`);
      return;
    }

    // Find next match from current position
    let found = false;
    for (let i = 0; i < searchResults.length; i++) {
      const result = searchResults[i];
      if (direction > 0) {
        if (result.line > cursorRow || (result.line === cursorRow && result.col > cursorCol)) {
          cursorRow = result.line;
          cursorCol = result.col;
          currentSearchIndex = i;
          found = true;
          break;
        }
      } else {
        if (result.line < cursorRow || (result.line === cursorRow && result.col < cursorCol)) {
          cursorRow = result.line;
          cursorCol = result.col;
          currentSearchIndex = i;
          found = true;
        }
      }
    }

    if (!found) {
      // Wrap around
      if (direction > 0 && searchResults.length > 0) {
        const result = searchResults[0];
        cursorRow = result.line;
        cursorCol = result.col;
        currentSearchIndex = 0;
        setStatus('Search wrapped to beginning');
      } else if (direction < 0 && searchResults.length > 0) {
        const result = searchResults[searchResults.length - 1];
        cursorRow = result.line;
        cursorCol = result.col;
        currentSearchIndex = searchResults.length - 1;
        setStatus('Search wrapped to end');
      }
    } else {
      setStatus(`Found: ${currentSearchIndex + 1}/${searchResults.length}`);
    }

    updateDisplay();
  }

  function parseColonLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return { command: '', rest: '' };
    const m = /^(\S+)(?:\s+(.*))?$/.exec(trimmed);
    if (!m) return { command: '', rest: '' };
    return { command: m[1], rest: (m[2] || '').trim() };
  }

  /** Optional path after `:w` / `:wq`: trim; whole-arg single/double quotes stripped. */
  function parseViColonPathArg(rest) {
    if (!rest) return '';
    const t = rest.trim();
    if (t.length >= 2) {
      const q = t[0];
      if ((q === '"' || q === "'") && t[t.length - 1] === q) {
        return t.slice(1, -1);
      }
    }
    return t;
  }

  function displayNameFromResolvedPath(path) {
    const s = path.replace(/\/+$/, '');
    if (!s || s === '/') return '/';
    const idx = s.lastIndexOf('/');
    return idx === -1 ? s : s.slice(idx + 1) || '/';
  }

  /**
   * @param {string} [optionalPathOperand] remainder of `:w` / `:wq` line (may be empty)
   * @returns {Promise<boolean>} true if the buffer was written to disk
   */
  async function saveFile(optionalPathOperand) {
    const pathArg = optionalPathOperand ? parseViColonPathArg(optionalPathOperand) : '';
    const destPath = pathArg ? terminal.resolvePath(pathArg) : currentFilePath;
    try {
      const content = lines.join('\n');
      await terminal.fileSystemDB.createFile(destPath, content, true);
      hasChanges = false;
      currentFilePath = destPath;
      displayName = displayNameFromResolvedPath(destPath);
      setStatus(`"${displayName}" written`);
      updateDisplay();
      return true;
    } catch (error) {
      setStatus(`E212: Can't open file for writing (${error.message})`);
      updateDisplay();
      return false;
    }
  }

  function handleCommand(cmd) {
    const { command, rest } = parseColonLine(cmd);
    if (!command) return;

    switch (command) {
      case 'w':
      case 'w!':
      case 'write':
      case 'write!':
        // vim: w! / write! forces write; jsh has no read-only buffer (same as :w)
        void saveFile(rest);
        break;
      case 'q':
      case 'quit':
        if (hasChanges) {
          // Parity with vim E37 (browser vi has no separate error channel).
          setStatus('E37: No write since last change (add ! to override)');
        } else {
          closeEditor();
        }
        break;
      case 'wq':
      case 'wq!':
        void saveFile(rest).then((ok) => {
          if (ok) closeEditor();
        });
        break;
      case 'x':
      case 'exit':
      case 'xit':
        // Like nvi/vim :x / :exit / :xit — write if modified, then quit (no write if unchanged).
        if (hasChanges) {
          void saveFile().then((ok) => {
            if (ok) closeEditor();
          });
        } else {
          closeEditor();
        }
        break;
      case 'x!':
      case 'exit!':
      case 'xit!':
        // vim-style :x! / :exit! — same as :wq! here (force write then quit; jsh has no read-only buffer).
        void saveFile(rest).then((ok) => {
          if (ok) closeEditor();
        });
        break;
      case 'q!':
      case 'quit!':
        closeEditor();
        break;
      case '0':
        cursorRow = 0;
        cursorCol = 0;
        setStatus('Top of file');
        updateDisplay();
        break;
      default: {
        // Check if it's a line number
        const lineNum = parseInt(command);
        if (!isNaN(lineNum) && lineNum > 0) {
          cursorRow = Math.min(lineNum - 1, lines.length - 1);
          cursorCol = 0;
          setStatus(`Line ${cursorRow + 1}`);
          updateDisplay();
        } else {
          setStatus(`Unknown command: ${cmd}`);
        }
        break;
      }
    }
  }

  function closeEditor() {
    modal.close();
  }

  /** Move to line `n` (1-based); clamps to file bounds. */
  function gotoLineOneBased(n) {
    const line = Math.max(1, Math.min(n, lines.length));
    cursorRow = line - 1;
    cursorCol = Math.min(cursorCol, lines[cursorRow].length);
  }

  // Event handlers - this is the key function that handles all keyboard input
  function handleKeyDown(e) {
    e.preventDefault();

    if (mode === 'normal' && e.ctrlKey && !e.metaKey && (e.key === 'r' || e.key === 'R')) {
      prefixDigits = '';
      pendingCommand = '';
      redo();
      return;
    }

    if (mode === 'normal') {
      let replayNormalKey = true;
      while (replayNormalKey) {
        replayNormalKey = false;

        // Vim-style count prefix for G / gg (e.g. 42G, 42gg); leading 0 alone is still "start of line"
        if (
          !pendingCommand &&
          e.key.length === 1 &&
          e.key >= '0' &&
          e.key <= '9' &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          if (e.key === '0') {
            if (prefixDigits.length > 0) {
              prefixDigits += '0';
              setStatus(prefixDigits);
              updateDisplay();
              return;
            }
            // fall through: bare 0 → beginning of line (switch below)
          } else {
            prefixDigits += e.key;
            setStatus(prefixDigits);
            updateDisplay();
            return;
          }
        }

        // Handle pending multi-key commands first
        if (pendingCommand) {
          if (pendingCommand === 'd' && e.key === 'd') {
            // dd - delete line
            saveState();
            deleteLine(cursorRow);
            pendingCommand = '';
            prefixDigits = '';
            setStatus('1 line deleted');
            updateDisplay();
            return;
          } else if (pendingCommand === 'y' && e.key === 'y') {
            // yy - yank line
            yankLine(cursorRow);
            pendingCommand = '';
            prefixDigits = '';
            updateDisplay();
            return;
          } else if (pendingCommand === 'g' && e.key === 'g') {
            // gg — first line, or line N when prefix set (e.g. 42gg)
            if (prefixDigits) {
              const n = parseInt(prefixDigits, 10);
              if (!isNaN(n) && n > 0) {
                gotoLineOneBased(n);
                setStatus(`Line ${cursorRow + 1}`);
              }
              prefixDigits = '';
            } else {
              cursorRow = 0;
              cursorCol = 0;
              setStatus('Top of file');
            }
            pendingCommand = '';
            updateDisplay();
            return;
          } else if (pendingCommand === 'Z' && e.key === 'Z' && e.shiftKey) {
            // ZZ — write if modified, then quit (same as :x / nvi)
            pendingCommand = '';
            prefixDigits = '';
            if (hasChanges) {
              void saveFile().then((ok) => {
                if (ok) closeEditor();
              });
            } else {
              closeEditor();
            }
            updateDisplay();
            return;
          } else if (pendingCommand === 'g') {
            // g then something other than g — cancel gg and handle the key (e.g. g then h)
            pendingCommand = '';
            prefixDigits = '';
            replayNormalKey = true;
            continue;
          } else {
            // Invalid multi-key command, clear it
            pendingCommand = '';
            prefixDigits = '';
            setStatus('');
          }
        }

        break;
      }

      switch (e.key) {
        // Movement commands
        case 'h':
        case 'ArrowLeft':
          prefixDigits = '';
          cursorCol = Math.max(0, cursorCol - 1);
          break;
        case 'j':
        case 'ArrowDown':
          prefixDigits = '';
          cursorRow = Math.min(lines.length - 1, cursorRow + 1);
          break;
        case 'k':
        case 'ArrowUp':
          prefixDigits = '';
          cursorRow = Math.max(0, cursorRow - 1);
          break;
        case 'l':
        case 'ArrowRight':
          prefixDigits = '';
          cursorCol = Math.min(lines[cursorRow].length, cursorCol + 1);
          break;
        case '0':
          prefixDigits = '';
          cursorCol = 0;
          break;
        case '$':
          prefixDigits = '';
          cursorCol = lines[cursorRow].length;
          break;
        case 'G':
          if (prefixDigits) {
            const n = parseInt(prefixDigits, 10);
            if (!isNaN(n) && n > 0) {
              gotoLineOneBased(n);
              setStatus(`Line ${cursorRow + 1}`);
            }
            prefixDigits = '';
          } else {
            cursorRow = lines.length - 1;
            cursorCol = Math.min(cursorCol, lines[cursorRow].length);
            setStatus('Bottom of file');
          }
          break;

        // Insert mode commands
        case 'i':
          prefixDigits = '';
          saveState();
          mode = 'insert';
          setStatus('-- INSERT --');
          break;
        case 'I':
          prefixDigits = '';
          saveState();
          cursorCol = 0;
          mode = 'insert';
          setStatus('-- INSERT --');
          break;
        case 'a':
          prefixDigits = '';
          saveState();
          cursorCol = Math.min(cursorCol + 1, lines[cursorRow].length);
          mode = 'insert';
          setStatus('-- INSERT --');
          break;
        case 'A':
          prefixDigits = '';
          saveState();
          cursorCol = lines[cursorRow].length;
          mode = 'insert';
          setStatus('-- INSERT --');
          break;
        case 'o':
          prefixDigits = '';
          saveState();
          lines.splice(cursorRow + 1, 0, '');
          cursorRow++;
          cursorCol = 0;
          mode = 'insert';
          hasChanges = true;
          setStatus('-- INSERT --');
          break;
        case 'O':
          prefixDigits = '';
          saveState();
          lines.splice(cursorRow, 0, '');
          cursorCol = 0;
          mode = 'insert';
          hasChanges = true;
          setStatus('-- INSERT --');
          break;

        // Delete/change commands
        case 'x':
          prefixDigits = '';
          if (lines[cursorRow].length > 0) {
            saveState();
            lines[cursorRow] =
              lines[cursorRow].substring(0, cursorCol) + lines[cursorRow].substring(cursorCol + 1);
            hasChanges = true;
          }
          break;
        case 'X':
          prefixDigits = '';
          if (cursorCol > 0) {
            saveState();
            lines[cursorRow] =
              lines[cursorRow].substring(0, cursorCol - 1) + lines[cursorRow].substring(cursorCol);
            cursorCol--;
            hasChanges = true;
          }
          break;
        case 'd':
          prefixDigits = '';
          pendingCommand = 'd';
          setStatus('d');
          break;
        case 'y':
          prefixDigits = '';
          pendingCommand = 'y';
          setStatus('y');
          break;
        case 'g':
          pendingCommand = 'g';
          setStatus('g');
          break;
        case 'Z':
          prefixDigits = '';
          if (e.shiftKey) {
            pendingCommand = 'Z';
            setStatus('Z');
          }
          break;
        case 'p':
          prefixDigits = '';
          if (yankBuffer) {
            saveState();
            pasteLine();
          }
          break;
        case 'P':
          prefixDigits = '';
          if (yankBuffer) {
            saveState();
            lines.splice(cursorRow, 0, yankBuffer);
            setStatus('1 line pasted');
            hasChanges = true;
          }
          break;

        // Undo
        case 'u':
          prefixDigits = '';
          undo();
          break;

        // Search commands
        case '/':
          prefixDigits = '';
          // Create in-terminal search input
          terminal.createInputPrompt(modal, {
            prompt: '/',
            placeholder: 'Search pattern',
            onEnter: (value) => {
              if (value.trim()) {
                performSearch(value.trim());
              }
            },
            onEscape: () => {
              // Just close the input, return to normal mode
            }
          });
          break;
        case 'n':
          prefixDigits = '';
          if (searchTerm && searchResults.length > 0) {
            currentSearchIndex = (currentSearchIndex + 1) % searchResults.length;
            const result = searchResults[currentSearchIndex];
            cursorRow = result.line;
            cursorCol = result.col;
            setStatus(`Found: ${currentSearchIndex + 1}/${searchResults.length}`);
          }
          break;
        case 'N':
          prefixDigits = '';
          if (searchTerm && searchResults.length > 0) {
            currentSearchIndex =
              currentSearchIndex <= 0 ? searchResults.length - 1 : currentSearchIndex - 1;
            const result = searchResults[currentSearchIndex];
            cursorRow = result.line;
            cursorCol = result.col;
            setStatus(`Found: ${currentSearchIndex + 1}/${searchResults.length}`);
          }
          break;

        // Command mode
        case ':':
          prefixDigits = '';
          // Create in-terminal command input
          terminal.createInputPrompt(modal, {
            prompt: ':',
            placeholder:
              'Enter command (w/write, wq, q/quit, x/exit, q!/quit!, …) — or ZZ / NG / Ngg in normal mode',
            onEnter: (value) => {
              if (value.trim()) {
                handleCommand(value.trim());
              }
            },
            onEscape: () => {
              // Just close the input, return to normal mode
            }
          });
          break;

        // Clear pending commands on escape
        case 'Escape':
          pendingCommand = '';
          prefixDigits = '';
          setStatus('');
          break;
      }
    } else if (mode === 'insert') {
      switch (e.key) {
        case 'Escape':
          mode = 'normal';
          setStatus('');
          break;
        case 'Enter': {
          const currentLine = lines[cursorRow];
          const beforeCursor = currentLine.substring(0, cursorCol);
          const afterCursor = currentLine.substring(cursorCol);
          lines[cursorRow] = beforeCursor;
          lines.splice(cursorRow + 1, 0, afterCursor);
          cursorRow++;
          cursorCol = 0;
          hasChanges = true;
          break;
        }
        case 'Backspace':
          if (cursorCol > 0) {
            lines[cursorRow] =
              lines[cursorRow].substring(0, cursorCol - 1) + lines[cursorRow].substring(cursorCol);
            cursorCol--;
            hasChanges = true;
          } else if (cursorRow > 0) {
            // Join with previous line
            const prevLine = lines[cursorRow - 1];
            lines[cursorRow - 1] = prevLine + lines[cursorRow];
            lines.splice(cursorRow, 1);
            cursorRow--;
            cursorCol = prevLine.length;
            hasChanges = true;
          }
          break;
        case 'Delete':
          if (cursorCol < lines[cursorRow].length) {
            lines[cursorRow] =
              lines[cursorRow].substring(0, cursorCol) + lines[cursorRow].substring(cursorCol + 1);
            hasChanges = true;
          }
          break;
        default:
          if (e.key.length === 1) {
            lines[cursorRow] =
              lines[cursorRow].substring(0, cursorCol) +
              e.key +
              lines[cursorRow].substring(cursorCol);
            cursorCol++;
            hasChanges = true;
          }
      }
    }

    updateDisplay();
  }

  // Initial display
  updateDisplay();

  // Ensure modal has focus initially
  setTimeout(() => modal.focus(), 10);

  return ''; // Return empty string to avoid double output
}

async function viHandler(terminal, args) {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'vi: missing operand',
      exitCode: 1
    };
  }

  if (args[0] === '--help' || args[0] === '-h') {
    return {
      stdout: `vi - enhanced text editor

Usage: vi <filename>

Movement Commands:
  h,j,k,l or arrows - Move cursor left/down/up/right
  0                 - Move to beginning of line
  $                 - Move to end of line
  gg                - Go to first line
  NG, Ngg           - Go to line N (1-based; digits then G or gg; e.g. 42G, 42gg)
  G                 - Go to last line (no leading count)

Insert Mode Commands:
  i                 - Insert before cursor
  I                 - Insert at beginning of line
  a                 - Insert after cursor
  A                 - Insert at end of line
  o                 - Open new line below
  O                 - Open new line above

Delete/Edit Commands:
  x                 - Delete character under cursor
  X                 - Delete character before cursor
  dd                - Delete entire line
  u                 - Undo last change
  Ctrl+R            - Redo last undone change (vim-style)

Copy/Paste Commands:
  yy                - Yank (copy) line
  p                 - Paste line below cursor
  P                 - Paste line above cursor

Search Commands:
  /pattern          - Search forward for pattern
  n                 - Find next match
  N                 - Find previous match

File Commands:
  :w [path]         - Save file (optional path: "Save as" and set active file)
  :write [path]     - Same as :w (vim long form)
  :w! [path]        - Force write (same as :w in jsh; no read-only buffer)
  :write! [path]    - Same as :w!
  :q                - Quit (if no changes)
  :quit             - Same as :q
  :wq [path]        - Save (optional path) and quit
  :wq! [path]       - Save and quit (force; same as :wq here)
  :x                - Write if modified, then quit (same as :wq when dirty)
  :exit / :xit      - Same as :x (vim long forms)
  :x! [path]        - Write and quit (same as :wq!; optional path like :w)
  :exit! / :xit!    - Same as :x!
  :q!               - Quit without saving
  :quit!            - Same as :q!
  ZZ                - Write if modified, then quit (normal mode; same as :x)
  :0                - Go to first line
  :<number>         - Go to specific line number

Insert Mode:
  Esc               - Return to normal mode
  Type normally     - Insert text`,
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
        stderr: `vi: ${filename}: Is a directory`,
        exitCode: 1
      };
    }
    if (file && file.type === 'file') {
      const d = VfsUtils.fileItemUtf8ForDisplay(file);
      content = d.isBinary ? '' : d.text;
    }

    return showViEditor(terminal, content, filename, filePath);
  } catch (error) {
    return {
      stdout: '',
      stderr: `vi: ${filename}: ${error.message}`,
      exitCode: 1
    };
  }
}

export default {
  name: 'vi',
  handler: viHandler,
  description: 'simple text editor (vi <file>)',
  category: 'System'
};
