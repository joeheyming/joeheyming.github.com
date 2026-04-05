// less command - view file contents with paging and search
(function () {
  'use strict';

  function dirnameVirtual(p) {
    if (p == null || p === '' || p === '/') {
      return '/';
    }
    const i = p.lastIndexOf('/');
    if (i <= 0) {
      return '/';
    }
    return p.slice(0, i) || '/';
  }

  /**
   * Follow symlink chain to a readable file (GNU less reads through symlinks).
   * @returns {Promise<{ ok: true, file: object } | { ok: false, stderr: string, exitCode: number }>}
   */
  async function resolveLessFile(terminal, operand) {
    let fullPath = terminal.resolvePath(operand);
    const visited = new Set();
    for (let depth = 0; depth < 32; depth++) {
      if (visited.has(fullPath)) {
        return {
          ok: false,
          stderr: `less: ${operand}: Too many levels of symbolic links`,
          exitCode: 1
        };
      }
      visited.add(fullPath);
      const file = await terminal.getFileSystemItem(fullPath);
      if (!file) {
        return {
          ok: false,
          stderr: `less: ${operand}: No such file or directory`,
          exitCode: 1
        };
      }
      if (file.type === 'symlink') {
        const raw = file.target;
        if (raw == null || String(raw).trim() === '') {
          return { ok: false, stderr: `less: ${operand}: Invalid argument`, exitCode: 1 };
        }
        const parent = dirnameVirtual(fullPath);
        fullPath = ShellUtils.resolveVirtualPath(String(raw).trim(), parent);
        continue;
      }
      if (file.type !== 'file') {
        return {
          ok: false,
          stderr: `less: ${operand}: Is a directory`,
          exitCode: 1
        };
      }
      return { ok: true, file };
    }
    return {
      ok: false,
      stderr: `less: ${operand}: Too many levels of symbolic links`,
      exitCode: 1
    };
  }

  // Less viewer implementation using terminal API
  function showLessViewer(
    terminal,
    content,
    filename,
    renderHtml = false,
    lineNumbers = false,
    chopLongLines = false,
    startSpec = null,
    ignoreCaseSearch = false,
    startupPattern = null,
    longPrompt = false,
    rawControlChars = false,
    quitAtEofMode = 'none'
  ) {
    const lines = content.split('\n');
    const lineNumWidth = Math.max(6, String(lines.length).length);
    const linesPerPage = ShellUtils.LESS_LINES_PER_PAGE;
    let currentLine = ShellUtils.lessInitialScrollLine(lines.length, linesPerPage, startSpec);

    let searchTerm = '';
    let searchResults = [];
    let currentSearchIndex = -1;
    let lastSearchTerm = ''; // Remember last search for repeat searches
    let viewingHelp = false;
    /** GNU **-e**: second forward at EOF quits; reset when scrolling up. */
    let eofQuitPrimed = false;
    /** GNU-style digit prefix before a movement key (e.g. `12j`, `5z`). */
    let scrollPrefixDigits = '';

    function isAtLastPage() {
      if (lines.length === 0) return true;
      return currentLine >= Math.max(0, lines.length - linesPerPage);
    }

    function consumeRepeatCount(defaultLines) {
      const n = ShellUtils.lessRepeatCountFromPrefix(defaultLines, scrollPrefixDigits);
      scrollPrefixDigits = '';
      return n;
    }

    function scrollPrefixClear() {
      scrollPrefixDigits = '';
    }

    function moveForwardByLines(n) {
      if (n <= 0) return;
      if (quitAtEofMode !== 'none' && isAtLastPage()) {
        if (quitAtEofMode === 'first') {
          closeViewer();
          return;
        }
        if (eofQuitPrimed) {
          closeViewer();
          return;
        }
        eofQuitPrimed = true;
        return;
      }
      if (quitAtEofMode === 'second') eofQuitPrimed = false;
      const maxStart = lines.length > 0 ? Math.max(0, lines.length - linesPerPage) : 0;
      currentLine = Math.min(maxStart, currentLine + n);
      updateDisplay();
    }

    function moveBackwardByLines(n) {
      if (n <= 0) return;
      if (quitAtEofMode === 'second') eofQuitPrimed = false;
      currentLine = Math.max(0, currentLine - n);
      updateDisplay();
    }

    const lessDefaultFooterHtml = (() => {
      let base =
        chopLongLines && !renderHtml
          ? 'Press <kbd>h</kbd> for help · <kbd>q</kbd> quit · <kbd>/</kbd> search · <kbd>←</kbd> <kbd>→</kbd> horizontal scroll'
          : 'Press <kbd>h</kbd> for help · <kbd>q</kbd> quit · <kbd>/</kbd> search';
      if (ignoreCaseSearch && !renderHtml) {
        base += ' <span class="less-footer-note">(ignore case)</span>';
      }
      if (rawControlChars && !renderHtml) {
        base += ' <span class="less-footer-note">(ANSI colors)</span>';
      }
      if (quitAtEofMode === 'first') {
        base += ' <span class="less-footer-note">(-E: forward at EOF quits)</span>';
      } else if (quitAtEofMode === 'second') {
        base += ' <span class="less-footer-note">(-e: forward twice at EOF to quit)</span>';
      }
      return base;
    })();

    // Create modal content (styles: terminal/style.css .less-modal)
    const modalContent = `
      <div class="less-viewer" role="dialog" aria-modal="true" aria-labelledby="less-filename-label">
        <div class="less-header">
          <span class="less-filename" id="less-filename-label">${filename ? filename : '(stdin)'}${
      renderHtml ? ' [HTML]' : ''
    }</span>
          <span class="less-position">lines 1-${Math.min(linesPerPage, lines.length)} of ${
      lines.length
    }</span>
        </div>
        <div class="less-content" id="less-content"></div>
        <div class="less-footer">
          <span class="less-help">${lessDefaultFooterHtml}</span>
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
      onKeyDown: handleKeyDown
    });

    const contentDiv = modal.element.querySelector('#less-content');
    if (chopLongLines && !renderHtml) {
      contentDiv.classList.add('less-content-chop');
    }
    const positionSpan = modal.element.querySelector('.less-position');
    const helpSpan = modal.element.querySelector('.less-help');
    const searchDiv = modal.element.querySelector('#less-search');
    const searchInput = modal.element.querySelector('#less-search-input');

    /**
     * GNU-style -p / --pattern: first line containing literal substring; same rules as / search.
     */
    function applyStartupPattern(term) {
      if (!term || renderHtml) return;

      searchTerm = term;
      lastSearchTerm = term;
      searchResults = [];

      lines.forEach((line, lineIndex) => {
        let index = 0;
        const plain = rawControlChars ? ShellUtils.lessStripAnsi(line) : line;
        const hay = ignoreCaseSearch ? plain.toLowerCase() : plain;
        const needle = ignoreCaseSearch ? term.toLowerCase() : term;
        while ((index = hay.indexOf(needle, index)) !== -1) {
          searchResults.push({ line: lineIndex, col: index });
          index++;
        }
      });

      if (searchResults.length === 0) {
        helpSpan.textContent = `Pattern not found: ${term}`;
        return;
      }

      const result = searchResults[0];
      currentLine = Math.max(0, result.line - Math.floor(linesPerPage / 2));
      currentSearchIndex = 0;
      helpSpan.textContent = ShellUtils.formatLessSearchMatchFooter(
        result,
        0,
        searchResults.length
      );
    }

    function updateDisplay() {
      const start = currentLine;
      const end = Math.min(start + linesPerPage, lines.length);
      const displayLines = lines.slice(start, end);

      if (renderHtml) {
        // For HTML content, render as HTML
        contentDiv.innerHTML = displayLines.join('\n');
      } else {
        // For text content: optional ANSI (-R), escape HTML, search highlighting
        let displayContent = displayLines
          .map((line, j) => {
            const globalIdx = start + j;
            let escaped;
            if (rawControlChars && !searchTerm) {
              escaped = ShellUtils.lessAnsiToHtml(line);
            } else if (rawControlChars && searchTerm) {
              escaped = terminal.escapeHtml(ShellUtils.lessStripAnsi(line));
            } else {
              escaped = terminal.escapeHtml(line);
            }
            if (lineNumbers) {
              const num = String(globalIdx + 1).padStart(lineNumWidth);
              escaped = `${num}  ${escaped}`;
            }
            return escaped;
          })
          .join('\n');

        // Highlight search results (case-sensitive unless -i / --ignore-case)
        if (searchTerm && searchResults.length > 0) {
          const escapedSearchTerm = terminal.escapeHtml(searchTerm);
          const highlightedTerm = `<span class="less-highlight">${escapedSearchTerm}</span>`;
          const flags = ignoreCaseSearch ? 'gi' : 'g';
          displayContent = displayContent.replace(
            new RegExp(escapedSearchTerm, flags),
            highlightedTerm
          );
        }

        contentDiv.innerHTML = displayContent;
      }

      let posText = `lines ${start + 1}-${end} of ${lines.length}`;
      if (longPrompt && lines.length > 0) {
        const pct = Math.min(100, Math.round(((start + 1) / lines.length) * 100));
        posText += ` (${pct}%)`;
      }
      positionSpan.textContent = posText;
    }

    function performSearch(term) {
      if (!term) return;

      searchTerm = term;
      lastSearchTerm = term;
      searchResults = [];

      // Find all matches (GNU less: case-sensitive unless -i)
      lines.forEach((line, lineIndex) => {
        let index = 0;
        const plain = rawControlChars ? ShellUtils.lessStripAnsi(line) : line;
        const hay = ignoreCaseSearch ? plain.toLowerCase() : plain;
        const needle = ignoreCaseSearch ? term.toLowerCase() : term;
        while ((index = hay.indexOf(needle, index)) !== -1) {
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
        helpSpan.textContent = ShellUtils.formatLessSearchMatchFooter(
          result,
          0,
          searchResults.length,
          'Search wrapped'
        );
      } else {
        helpSpan.textContent = ShellUtils.formatLessSearchMatchFooter(
          searchResults[currentSearchIndex],
          currentSearchIndex,
          searchResults.length
        );
      }

      updateDisplay();
    }

    /** GNU-style: digit prefix before **n** / **N** repeats that many match steps (wraps). */
    function advanceSearchForward(times) {
      if (searchResults.length === 0) return;
      const len = searchResults.length;
      const t = Math.max(1, times);
      currentSearchIndex = (currentSearchIndex + t) % len;
      const result = searchResults[currentSearchIndex];
      currentLine = Math.max(0, result.line - Math.floor(linesPerPage / 2));
      helpSpan.textContent = ShellUtils.formatLessSearchMatchFooter(
        result,
        currentSearchIndex,
        len
      );
      updateDisplay();
    }

    function advanceSearchBackward(times) {
      if (searchResults.length === 0) return;
      const len = searchResults.length;
      const t = Math.max(1, times);
      currentSearchIndex = (((currentSearchIndex - t) % len) + len) % len;
      const result = searchResults[currentSearchIndex];
      currentLine = Math.max(0, result.line - Math.floor(linesPerPage / 2));
      helpSpan.textContent = ShellUtils.formatLessSearchMatchFooter(
        result,
        currentSearchIndex,
        len
      );
      updateDisplay();
    }

    function showHelp() {
      const helpContent = `Less Help:

Navigation:
  j, e, ↓, Enter - Move down one line (GNU: e/j); type digits first for repeat (e.g. 12j)
  k, y, ↑        - Move up one line (GNU: y/k); digits + k/y for N lines
  f, z, Z, Space, PgDn - Move down N lines (default one window); e.g. 5z or 5f
  d, ^D          - Move down half a page (GNU); digits change line count
  b, w, W, PgUp  - Move up N lines (default one window)
  u, ^U          - Move up half a page (GNU); digits change line count
  g, Home        - Go to beginning; 5g / 5Home go to line 5 (1-based, GNU-style)
  G, End         - Go to end; 5G / 5End go to line 5

Search:
  /              - Search forward
  n              - Next search result (digits first repeat: e.g. 3n = third next match)
  N              - Previous search result (digits first repeat: e.g. 2N)
  Status line: Found: i/total at line L, col C (1-based). "Search wrapped" when search wraps.
  (Startup less -i or --ignore-case for case-insensitive search; default is case-sensitive.)

Other:
  h              - Show this help
  q              - Quit

Run less -N or --LINE-NUMBERS to show line numbers (also for -F stdout).
Run less -S or --chop-long-lines to avoid wrapping long lines (← → scroll in viewer).
Run less -m, -M, or --long-prompt for a percent in the status line (GNU-style long prompt; jsh).
Startup +N / +G (e.g. less +100 file) sets the initial scroll position (jsh; not for -F stdout).
Startup -p / --pattern=PATTERN jumps to the first line containing PATTERN (literal substring; use less -i for case-insensitive).
Run less -R or --RAW-CONTROL-CHARS to interpret ANSI color/style (SGR) in file text; search strips ANSI for matching.
Run less -E or --QUIT-AT-EOF to quit on the first forward key at end-of-file; -e / --quit-at-eof quits on the second.
Run less -x N, -# N, or --tabs=N for tab-stop width (GNU-style; default 8).

Press any key to return to document...`;

      viewingHelp = true;
      contentDiv.innerHTML = terminal.escapeHtml(helpContent);
      positionSpan.textContent = 'Help';
    }

    function moveForwardHalfPage() {
      const h = consumeRepeatCount(ShellUtils.lessHalfPageLineCount(linesPerPage));
      moveForwardByLines(h);
    }

    function moveBackwardHalfPage() {
      const h = consumeRepeatCount(ShellUtils.lessHalfPageLineCount(linesPerPage));
      moveBackwardByLines(h);
    }

    function closeViewer() {
      modal.close();
    }

    // Event handlers - this is the key function that handles all keyboard input
    function handleKeyDown(e) {
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

      // Help is shown: first key dismisses (do not run navigation/quit — listener order would make 'q' exit)
      if (viewingHelp) {
        viewingHelp = false;
        scrollPrefixClear();
        updateDisplay();
        e.preventDefault();
        return;
      }

      if (chopLongLines && !renderHtml && searchDiv.style.display === 'none') {
        if (e.key === 'ArrowLeft') {
          contentDiv.scrollLeft = Math.max(0, contentDiv.scrollLeft - 40);
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowRight') {
          contentDiv.scrollLeft += 40;
          e.preventDefault();
          return;
        }
      }

      if (
        e.key.length === 1 &&
        e.key >= '0' &&
        e.key <= '9' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        if (scrollPrefixDigits.length < 12) scrollPrefixDigits += e.key;
        return;
      }

      e.preventDefault();

      switch (e.key) {
        case 'j':
        case 'e':
        case 'ArrowDown':
        case 'Enter': {
          const n = consumeRepeatCount(1);
          moveForwardByLines(n);
          break;
        }
        case 'k':
        case 'y':
        case 'ArrowUp': {
          const n = consumeRepeatCount(1);
          moveBackwardByLines(n);
          break;
        }
        case 'f':
        case 'z':
        case 'Z':
        case ' ':
        case 'PageDown': {
          const n = consumeRepeatCount(linesPerPage);
          moveForwardByLines(n);
          break;
        }
        case 'd':
          moveForwardHalfPage();
          break;
        case 'u':
          moveBackwardHalfPage();
          break;
        case 'b':
        case 'w':
        case 'W':
        case 'PageUp': {
          const n = consumeRepeatCount(linesPerPage);
          moveBackwardByLines(n);
          break;
        }
        case 'g':
        case 'Home': {
          const prefix = scrollPrefixDigits;
          scrollPrefixDigits = '';
          if (quitAtEofMode === 'second') eofQuitPrimed = false;
          const target = ShellUtils.lessTargetLineOneBasedFromPrefix(prefix);
          if (target == null) {
            currentLine = 0;
          } else {
            currentLine = ShellUtils.lessScrollLineForTargetLineOneBased(
              lines.length,
              linesPerPage,
              target
            );
          }
          updateDisplay();
          break;
        }
        case 'G':
        case 'End': {
          const prefixG = scrollPrefixDigits;
          scrollPrefixDigits = '';
          if (quitAtEofMode === 'second') eofQuitPrimed = false;
          const targetG = ShellUtils.lessTargetLineOneBasedFromPrefix(prefixG);
          if (targetG == null) {
            currentLine = Math.max(0, lines.length - linesPerPage);
          } else {
            currentLine = ShellUtils.lessScrollLineForTargetLineOneBased(
              lines.length,
              linesPerPage,
              targetG
            );
          }
          updateDisplay();
          break;
        }
        case '/':
          scrollPrefixClear();
          searchDiv.style.display = 'flex';
          searchInput.value = '';
          // Use setTimeout to ensure the input is visible before focusing
          setTimeout(() => searchInput.focus(), 10);
          break;
        case 'n': {
          const nTimes = consumeRepeatCount(1);
          if (lastSearchTerm) {
            if (searchResults.length === 0) {
              performSearch(lastSearchTerm);
            } else {
              advanceSearchForward(nTimes);
            }
          } else {
            scrollPrefixClear();
          }
          break;
        }
        case 'N': {
          const nTimes = consumeRepeatCount(1);
          if (lastSearchTerm) {
            if (searchResults.length === 0) {
              performSearch(lastSearchTerm);
            } else {
              advanceSearchBackward(nTimes);
            }
          } else {
            scrollPrefixClear();
          }
          break;
        }
        case 'h':
          scrollPrefixClear();
          showHelp();
          break;
        case 'q':
          scrollPrefixClear();
          closeViewer();
          break;
        default:
          scrollPrefixClear();
          break;
      }
    }

    if (startupPattern && !renderHtml) {
      applyStartupPattern(startupPattern);
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
      const parsed = ShellUtils.parseLessArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return {
          stdout: ShellUtils.LESS_HELP,
          stderr: '',
          exitCode: 0
        };
      }
      if (parsed.version) {
        return {
          stdout: ShellUtils.LESS_VERSION_LINE,
          stderr: '',
          exitCode: 0
        };
      }

      const operand = parsed.operands[0];
      let filename = '';
      let content = '';

      try {
        if (operand != null && operand !== '-') {
          filename = operand;
          const resolved = await resolveLessFile(terminal, operand);
          if (!resolved.ok) {
            return {
              stdout: '',
              stderr: resolved.stderr,
              exitCode: resolved.exitCode
            };
          }
          const d = ShellUtils.fileItemUtf8ForDisplay(resolved.file);
          content = d.isBinary ? '[binary file]\n' : d.text;
        } else if (operand === '-') {
          content = terminal.stdin;
          filename = '(stdin)';
        } else if (terminal.stdinSupplied || terminal.hasStdin) {
          content = terminal.stdin;
          filename = '(stdin)';
        } else {
          return {
            stdout: '',
            stderr: 'less: missing operand (try "less --help")',
            exitCode: 1
          };
        }

        if (parsed.squeezeBlankLines && !parsed.html) {
          content = ShellUtils.lessSqueezeBlankLines(content);
        }

        if (!parsed.html) {
          content = ShellUtils.lessExpandTabsInText(content, parsed.tabStops);
        }

        if (
          parsed.quitIfOneScreen &&
          !parsed.html &&
          !parsed.pattern &&
          ShellUtils.lessContentFitsOneScreen(content)
        ) {
          const out = parsed.lineNumbers ? ShellUtils.lessFormatWithLineNumbers(content) : content;
          return { stdout: out, stderr: '', exitCode: 0 };
        }

        return showLessViewer(
          terminal,
          content,
          filename,
          parsed.html,
          parsed.lineNumbers && !parsed.html,
          parsed.chopLongLines && !parsed.html,
          parsed.startSpec,
          parsed.ignoreCase,
          parsed.pattern || null,
          parsed.longPrompt && !parsed.html,
          parsed.rawControlChars && !parsed.html,
          parsed.quitAtEofMode
        );
      } catch (error) {
        const label = filename || '(unknown)';
        return {
          stdout: '',
          stderr: `less: ${label}: ${error.message}`,
          exitCode: 1
        };
      }
    },
    'view file contents with paging and search',
    'System'
  );
})();
