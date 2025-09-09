// vi command - simple text editor
(function () {
  'use strict';

  // Vi editor implementation using terminal API
  function showViEditor(terminal, content, filename, filePath) {
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
    let undoStack = []; // For undo functionality
    let maxUndoSteps = 50;

    // Add CSS styles using terminal API
    const style = terminal.addStyles(`
      .vi-editor-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        z-index: 1000;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .vi-editor {
        width: 90%;
        height: 80%;
        background: #000;
        color: #0f0;
        font-family: 'Courier New', monospace;
        border: 1px solid #333;
        display: flex;
        flex-direction: column;
        position: relative;
      }
      .vi-header {
        background: #333;
        padding: 5px 10px;
        display: flex;
        justify-content: space-between;
        font-size: 12px;
      }
      .vi-content {
        flex: 1;
        padding: 10px;
        overflow: auto;
        white-space: pre;
        font-family: 'Courier New', monospace;
        line-height: 1.2;
      }
      .vi-footer {
        background: #333;
        padding: 5px 10px;
        font-size: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .vi-cursor {
        background: #0f0;
        color: #000;
      }
      .vi-cursor.insert {
        background: #ff0;
        color: #000;
      }
      .vi-cursor.normal {
        background: #0f0;
        color: #000;
      }
    `);

    // Create modal content
    const modalContent = `
      <div class="vi-editor">
        <div class="vi-header">
          <span class="vi-filename">"${filename}" ${lines.length} lines</span>
          <span class="vi-mode">${mode.toUpperCase()}</span>
        </div>
        <div class="vi-content" id="vi-content"></div>
        <div class="vi-footer">
          <span class="vi-status" id="vi-status">Commands: i=insert, dd=delete line, yy=copy, p=paste, u=undo, :=command mode</span>
          <span class="vi-position">${cursorRow + 1},${cursorCol + 1}</span>
        </div>
      </div>
    `;

    // Create modal using terminal API
    const modal = terminal.createModal({
      className: 'vi-editor-modal',
      content: modalContent,
      onKeyDown: handleKeyDown,
      onClose: () => {
        // Clean up styles when modal closes
        document.head.removeChild(style);
      }
    });

    const contentDiv = modal.element.querySelector('#vi-content');
    const statusSpan = modal.element.querySelector('#vi-status');
    const modeSpan = modal.element.querySelector('.vi-mode');
    const positionSpan = modal.element.querySelector('.vi-position');

    // Helper functions for undo system
    function saveState() {
      const state = {
        lines: lines.map((line) => line), // Deep copy
        cursorRow,
        cursorCol,
        hasChanges
      };
      undoStack.push(state);
      if (undoStack.length > maxUndoSteps) {
        undoStack.shift();
      }
    }

    function undo() {
      if (undoStack.length === 0) {
        setStatus('Already at oldest change');
        return;
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
            beforeCursor +
            `<span class="vi-cursor ${mode}">${atCursor}</span>` +
            afterCursor +
            '\n';
        } else {
          displayContent += terminal.escapeHtml(line) + '\n';
        }
      });

      contentDiv.innerHTML = displayContent;
      modeSpan.textContent = mode.toUpperCase() + (hasChanges ? ' [+]' : '');
      positionSpan.textContent = `${cursorRow + 1},${cursorCol + 1}`;
    }

    function setStatus(message) {
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

    async function saveFile() {
      try {
        const content = lines.join('\n');
        await terminal.fileSystemDB.createFile(filePath, content, true);
        hasChanges = false;
        setStatus(`"${filename}" written`);
        updateDisplay();
      } catch (error) {
        setStatus(`Error saving: ${error.message}`);
      }
    }

    function handleCommand(cmd) {
      const parts = cmd.split(' ');
      const command = parts[0];

      switch (command) {
        case 'w':
          saveFile();
          break;
        case 'q':
          if (hasChanges) {
            setStatus('No write since last change (use :q! to override)');
          } else {
            closeEditor();
          }
          break;
        case 'wq':
          saveFile().then(() => closeEditor());
          break;
        case 'q!':
          closeEditor();
          break;
        default:
          setStatus(`Unknown command: ${cmd}`);
      }
    }

    function closeEditor() {
      modal.close();
    }

    // Event handlers - this is the key function that handles all keyboard input
    function handleKeyDown(e) {
      e.preventDefault();

      if (mode === 'normal') {
        // Handle pending multi-key commands first
        if (pendingCommand) {
          if (pendingCommand === 'd' && e.key === 'd') {
            // dd - delete line
            saveState();
            deleteLine(cursorRow);
            pendingCommand = '';
            setStatus('1 line deleted');
            updateDisplay();
            return;
          } else if (pendingCommand === 'y' && e.key === 'y') {
            // yy - yank line
            yankLine(cursorRow);
            pendingCommand = '';
            updateDisplay();
            return;
          } else if (pendingCommand === 'g' && e.key === 'g') {
            // gg - go to first line
            cursorRow = 0;
            cursorCol = 0;
            pendingCommand = '';
            setStatus('Top of file');
            updateDisplay();
            return;
          } else {
            // Invalid multi-key command, clear it
            pendingCommand = '';
            setStatus('');
          }
        }

        switch (e.key) {
          // Movement commands
          case 'h':
          case 'ArrowLeft':
            cursorCol = Math.max(0, cursorCol - 1);
            break;
          case 'j':
          case 'ArrowDown':
            cursorRow = Math.min(lines.length - 1, cursorRow + 1);
            break;
          case 'k':
          case 'ArrowUp':
            cursorRow = Math.max(0, cursorRow - 1);
            break;
          case 'l':
          case 'ArrowRight':
            cursorCol = Math.min(lines[cursorRow].length, cursorCol + 1);
            break;
          case '0':
            cursorCol = 0;
            break;
          case '$':
            cursorCol = lines[cursorRow].length;
            break;
          case 'G':
            cursorRow = lines.length - 1;
            cursorCol = Math.min(cursorCol, lines[cursorRow].length);
            setStatus('Bottom of file');
            break;

          // Insert mode commands
          case 'i':
            saveState();
            mode = 'insert';
            setStatus('-- INSERT --');
            break;
          case 'I':
            saveState();
            cursorCol = 0;
            mode = 'insert';
            setStatus('-- INSERT --');
            break;
          case 'a':
            saveState();
            cursorCol = Math.min(cursorCol + 1, lines[cursorRow].length);
            mode = 'insert';
            setStatus('-- INSERT --');
            break;
          case 'A':
            saveState();
            cursorCol = lines[cursorRow].length;
            mode = 'insert';
            setStatus('-- INSERT --');
            break;
          case 'o':
            saveState();
            lines.splice(cursorRow + 1, 0, '');
            cursorRow++;
            cursorCol = 0;
            mode = 'insert';
            hasChanges = true;
            setStatus('-- INSERT --');
            break;
          case 'O':
            saveState();
            lines.splice(cursorRow, 0, '');
            cursorCol = 0;
            mode = 'insert';
            hasChanges = true;
            setStatus('-- INSERT --');
            break;

          // Delete/change commands
          case 'x':
            if (lines[cursorRow].length > 0) {
              saveState();
              lines[cursorRow] =
                lines[cursorRow].substring(0, cursorCol) +
                lines[cursorRow].substring(cursorCol + 1);
              hasChanges = true;
            }
            break;
          case 'X':
            if (cursorCol > 0) {
              saveState();
              lines[cursorRow] =
                lines[cursorRow].substring(0, cursorCol - 1) +
                lines[cursorRow].substring(cursorCol);
              cursorCol--;
              hasChanges = true;
            }
            break;
          case 'd':
            pendingCommand = 'd';
            setStatus('d');
            break;
          case 'y':
            pendingCommand = 'y';
            setStatus('y');
            break;
          case 'g':
            pendingCommand = 'g';
            setStatus('g');
            break;
          case 'p':
            if (yankBuffer) {
              saveState();
              pasteLine();
            }
            break;
          case 'P':
            if (yankBuffer) {
              saveState();
              lines.splice(cursorRow, 0, yankBuffer);
              setStatus('1 line pasted');
              hasChanges = true;
            }
            break;

          // Undo
          case 'u':
            undo();
            break;

          // Search commands
          case '/':
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
            if (searchTerm && searchResults.length > 0) {
              currentSearchIndex = (currentSearchIndex + 1) % searchResults.length;
              const result = searchResults[currentSearchIndex];
              cursorRow = result.line;
              cursorCol = result.col;
              setStatus(`Found: ${currentSearchIndex + 1}/${searchResults.length}`);
            }
            break;
          case 'N':
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
            // Create in-terminal command input
            terminal.createInputPrompt(modal, {
              prompt: ':',
              placeholder: 'Enter command (w, q, wq, q!)',
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
            setStatus('');
            break;
        }
      } else if (mode === 'insert') {
        switch (e.key) {
          case 'Escape':
            mode = 'normal';
            setStatus('');
            break;
          case 'Enter':
            const currentLine = lines[cursorRow];
            const beforeCursor = currentLine.substring(0, cursorCol);
            const afterCursor = currentLine.substring(cursorCol);
            lines[cursorRow] = beforeCursor;
            lines.splice(cursorRow + 1, 0, afterCursor);
            cursorRow++;
            cursorCol = 0;
            hasChanges = true;
            break;
          case 'Backspace':
            if (cursorCol > 0) {
              lines[cursorRow] =
                lines[cursorRow].substring(0, cursorCol - 1) +
                lines[cursorRow].substring(cursorCol);
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
                lines[cursorRow].substring(0, cursorCol) +
                lines[cursorRow].substring(cursorCol + 1);
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

  registerCommand(
    'vi',
    async (terminal, args) => {
      if (args.length === 0) {
        return 'vi: usage: vi <filename>';
      }

      if (args[0] === '--help' || args[0] === '-h') {
        return `vi - enhanced text editor

Usage: vi <filename>

Movement Commands:
  h,j,k,l or arrows - Move cursor left/down/up/right
  0                 - Move to beginning of line
  $                 - Move to end of line
  gg                - Go to first line
  G                 - Go to last line

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

Copy/Paste Commands:
  yy                - Yank (copy) line
  p                 - Paste line below cursor
  P                 - Paste line above cursor

Search Commands:
  /pattern          - Search forward for pattern
  n                 - Find next match
  N                 - Find previous match

File Commands:
  :w                - Save file
  :q                - Quit (if no changes)
  :wq               - Save and quit
  :q!               - Quit without saving

Insert Mode:
  Esc               - Return to normal mode
  Type normally     - Insert text`;
      }

      const filename = args[0];
      const filePath = terminal.resolvePath(filename);

      try {
        // Try to read existing file
        let content = '';
        const file = await terminal.getFileSystemItem(filePath);
        if (file && file.type === 'file') {
          content = file.content || '';
        }

        return showViEditor(terminal, content, filename, filePath);
      } catch (error) {
        return `vi: ${filename}: ${error.message}`;
      }
    },
    'simple text editor (vi <file>)',
    'System'
  );
})();
