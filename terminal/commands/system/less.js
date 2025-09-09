// less command - view file contents with paging and search
(function () {
  'use strict';

  // Less viewer implementation using terminal API
  function showLessViewer(terminal, content, filename, renderHtml = false) {
    const lines = content.split('\n');
    let currentLine = 0;
    const linesPerPage = 20;
    let searchTerm = '';
    let searchResults = [];
    let currentSearchIndex = -1;
    let lastSearchTerm = ''; // Remember last search for repeat searches

    // Add CSS styles using terminal API
    const style = terminal.addStyles(`
      .less-modal {
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
      .less-viewer {
        width: 90%;
        height: 80%;
        background: #000;
        color: #0f0;
        font-family: 'Courier New', monospace;
        border: 1px solid #333;
        display: flex;
        flex-direction: column;
      }
      .less-header {
        background: #333;
        padding: 5px 10px;
        display: flex;
        justify-content: space-between;
        font-size: 12px;
      }
      .less-content {
        flex: 1;
        padding: 10px;
        overflow: hidden;
        white-space: pre-wrap;
        font-family: 'Courier New', monospace;
        line-height: 1.2;
      }
      .less-footer {
        background: #333;
        padding: 5px 10px;
        font-size: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .less-search {
        display: flex;
        align-items: center;
      }
      .less-search input {
        background: #000;
        color: #0f0;
        border: 1px solid #333;
        padding: 2px 5px;
        margin-left: 5px;
        font-family: 'Courier New', monospace;
        font-size: 12px;
      }
      .less-highlight {
        background: #ff0;
        color: #000;
      }
    `);

    // Create modal content
    const modalContent = `
      <div class="less-viewer">
        <div class="less-header">
          <span class="less-filename">${filename ? filename : '(stdin)'}${
      renderHtml ? ' [HTML]' : ''
    }</span>
          <span class="less-position">lines 1-${Math.min(linesPerPage, lines.length)} of ${
      lines.length
    }</span>
        </div>
        <div class="less-content" id="less-content"></div>
        <div class="less-footer">
          <span class="less-help">Press 'h' for help, 'q' to quit, '/' to search</span>
          <span class="less-search" id="less-search" style="display: none;">
            <span>Search: </span>
            <input type="text" id="less-search-input" />
          </span>
        </div>
      </div>
    `;

    // Create modal using terminal API
    const modal = terminal.createModal({
      className: 'less-modal',
      content: modalContent,
      onKeyDown: handleKeyDown,
      onClose: () => {
        // Clean up styles when modal closes
        document.head.removeChild(style);
      }
    });

    const contentDiv = modal.element.querySelector('#less-content');
    const positionSpan = modal.element.querySelector('.less-position');
    const helpSpan = modal.element.querySelector('.less-help');
    const searchDiv = modal.element.querySelector('#less-search');
    const searchInput = modal.element.querySelector('#less-search-input');

    function updateDisplay() {
      const start = currentLine;
      const end = Math.min(start + linesPerPage, lines.length);
      const displayLines = lines.slice(start, end);

      if (renderHtml) {
        // For HTML content, render as HTML
        contentDiv.innerHTML = displayLines.join('\n');
      } else {
        // For text content, escape HTML and handle search highlighting
        let displayContent = displayLines.map((line) => terminal.escapeHtml(line)).join('\n');

        // Highlight search results
        if (searchTerm && searchResults.length > 0) {
          const escapedSearchTerm = terminal.escapeHtml(searchTerm);
          const highlightedTerm = `<span class="less-highlight">${escapedSearchTerm}</span>`;
          displayContent = displayContent.replace(
            new RegExp(escapedSearchTerm, 'gi'),
            highlightedTerm
          );
        }

        contentDiv.innerHTML = displayContent;
      }

      positionSpan.textContent = `lines ${start + 1}-${end} of ${lines.length}`;
    }

    function performSearch(term) {
      if (!term) return;

      searchTerm = term;
      lastSearchTerm = term;
      searchResults = [];

      // Find all matches
      lines.forEach((line, lineIndex) => {
        let index = 0;
        while ((index = line.toLowerCase().indexOf(term.toLowerCase(), index)) !== -1) {
          searchResults.push({ line: lineIndex, col: index });
          index++;
        }
      });

      if (searchResults.length === 0) {
        helpSpan.textContent = `Pattern not found: ${term}`;
        return;
      }

      // Find first match from current position
      let found = false;
      for (let i = 0; i < searchResults.length; i++) {
        const result = searchResults[i];
        if (result.line >= currentLine) {
          currentLine = Math.max(0, result.line - Math.floor(linesPerPage / 2));
          currentSearchIndex = i;
          found = true;
          break;
        }
      }

      if (!found && searchResults.length > 0) {
        // Wrap to beginning
        const result = searchResults[0];
        currentLine = Math.max(0, result.line - Math.floor(linesPerPage / 2));
        currentSearchIndex = 0;
        helpSpan.textContent = 'Search wrapped to beginning';
      } else {
        helpSpan.textContent = `Found: ${currentSearchIndex + 1}/${searchResults.length}`;
      }

      updateDisplay();
    }

    function nextSearch() {
      if (searchResults.length === 0) return;

      currentSearchIndex = (currentSearchIndex + 1) % searchResults.length;
      const result = searchResults[currentSearchIndex];
      currentLine = Math.max(0, result.line - Math.floor(linesPerPage / 2));
      helpSpan.textContent = `Found: ${currentSearchIndex + 1}/${searchResults.length}`;
      updateDisplay();
    }

    function prevSearch() {
      if (searchResults.length === 0) return;

      currentSearchIndex =
        currentSearchIndex <= 0 ? searchResults.length - 1 : currentSearchIndex - 1;
      const result = searchResults[currentSearchIndex];
      currentLine = Math.max(0, result.line - Math.floor(linesPerPage / 2));
      helpSpan.textContent = `Found: ${currentSearchIndex + 1}/${searchResults.length}`;
      updateDisplay();
    }

    function showHelp() {
      const helpContent = `Less Help:

Navigation:
  j, ↓, Enter    - Move down one line
  k, ↑           - Move up one line
  f, Space, PgDn - Move down one page
  b, PgUp        - Move up one page
  g, Home        - Go to beginning
  G, End         - Go to end

Search:
  /              - Search forward
  n              - Next search result
  N              - Previous search result

Other:
  h              - Show this help
  q              - Quit

Press any key to return to document...`;

      contentDiv.innerHTML = terminal.escapeHtml(helpContent);
      positionSpan.textContent = 'Help';

      // Wait for any key to return
      const helpHandler = (e) => {
        modal.element.removeEventListener('keydown', helpHandler);
        updateDisplay();
      };
      modal.element.addEventListener('keydown', helpHandler);
    }

    function closeViewer() {
      modal.close();
    }

    // Event handlers - this is the key function that handles all keyboard input
    function handleKeyDown(e) {
      const searchInput = modal.element.querySelector('#less-search-input');

      if (searchDiv.style.display !== 'none') {
        // In search mode
        if (e.key === 'Enter') {
          const inputValue = searchInput.value.trim();
          if (inputValue) {
            performSearch(inputValue);
          } else if (lastSearchTerm) {
            // Repeat last search
            performSearch(lastSearchTerm);
          }
          searchDiv.style.display = 'none';
          searchInput.blur(); // Remove focus from search input
          modal.focus(); // Return focus to modal
          e.preventDefault();
        } else if (e.key === 'Escape') {
          searchDiv.style.display = 'none';
          searchInput.blur(); // Remove focus from search input
          modal.focus(); // Return focus to modal
          e.preventDefault();
        }
        return; // Let other keys work normally in search input
      }

      e.preventDefault();

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
        case 'Enter':
          if (currentLine + linesPerPage < lines.length) {
            currentLine++;
            updateDisplay();
          }
          break;
        case 'k':
        case 'ArrowUp':
          if (currentLine > 0) {
            currentLine--;
            updateDisplay();
          }
          break;
        case 'f':
        case ' ':
        case 'PageDown':
          currentLine = Math.min(lines.length - linesPerPage, currentLine + linesPerPage);
          updateDisplay();
          break;
        case 'b':
        case 'PageUp':
          currentLine = Math.max(0, currentLine - linesPerPage);
          updateDisplay();
          break;
        case 'g':
        case 'Home':
          currentLine = 0;
          updateDisplay();
          break;
        case 'G':
        case 'End':
          currentLine = Math.max(0, lines.length - linesPerPage);
          updateDisplay();
          break;
        case '/':
          searchDiv.style.display = 'flex';
          searchInput.value = '';
          // Use setTimeout to ensure the input is visible before focusing
          setTimeout(() => searchInput.focus(), 10);
          break;
        case 'n':
          if (lastSearchTerm) {
            if (searchResults.length === 0) {
              performSearch(lastSearchTerm);
            } else {
              nextSearch();
            }
          }
          break;
        case 'N':
          if (lastSearchTerm) {
            if (searchResults.length === 0) {
              performSearch(lastSearchTerm);
            } else {
              prevSearch();
            }
          }
          break;
        case 'h':
          showHelp();
          break;
        case 'q':
          closeViewer();
          break;
      }
    }

    // Initial display
    updateDisplay();

    // Ensure modal has focus initially
    setTimeout(() => modal.focus(), 10);

    return ''; // Return empty string to avoid double output
  }

  registerCommand(
    'less',
    async (terminal, args) => {
      let filename = '';
      let renderHtml = false;
      let content = '';

      // Parse arguments
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--html') {
          renderHtml = true;
        } else if (arg === '--help' || arg === '-h') {
          return `less - view file contents with paging and search

Usage: less [options] [file]

Options:
  --html    Render content as HTML
  --help    Show this help message

Navigation:
  j/↓       Move down one line
  k/↑       Move up one line  
  f/Space   Move down one page
  b/PgUp    Move up one page
  g/Home    Go to beginning
  G/End     Go to end
  /         Search forward
  n         Next search result
  N         Previous search result
  h         Show help
  q         Quit

If no file is specified, reads from stdin (piped input).`;
        } else if (!filename) {
          filename = arg;
        }
      }

      try {
        if (filename) {
          // Read from file
          const filePath = terminal.resolvePath(filename);
          const file = await terminal.getFileSystemItem(filePath);

          if (!file) {
            return `less: ${filename}: No such file or directory`;
          }

          if (file.type !== 'file') {
            return `less: ${filename}: Is a directory`;
          }

          content = file.content || '';
        } else if (terminal.hasStdin) {
          // Read from stdin (piped input)
          content = terminal.stdin;
          filename = '(stdin)';
        } else {
          return 'less: missing filename (try "less --help")';
        }

        return showLessViewer(terminal, content, filename, renderHtml);
      } catch (error) {
        return `less: ${filename}: ${error.message}`;
      }
    },
    'view file contents with paging and search',
    'System'
  );
})();
