export class TerminalHistoryMixin {
  navigateHistory(direction, input) {
    if (this.commandHistory.length === 0) return;

    if (direction === -1) {
      // Go back in history
      if (this.historyIndex === -1) {
        this.historyIndex = this.commandHistory.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex--;
      }
    } else {
      // Go forward in history
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
      } else {
        this.historyIndex = -1;
        input.value = '';
        return;
      }
    }

    const historyCommand = this.commandHistory[this.historyIndex] || '';

    // Check if this is a multi-line heredoc command
    if (historyCommand.includes('\n')) {
      // For heredocs, only show the first line (the heredoc start command)
      const lines = historyCommand.split('\n');
      input.value = lines[0];
    } else {
      input.value = historyCommand;
    }
  }
  saveCommandHistory() {
    try {
      sessionStorage.setItem('heymingTerminalHistory', JSON.stringify(this.commandHistory));
    } catch (e) {
      // Ignore storage errors
    }
  }

  loadCommandHistory() {
    try {
      const savedHistory = sessionStorage.getItem('heymingTerminalHistory');
      if (savedHistory) {
        this.commandHistory = JSON.parse(savedHistory);
        this.historyIndex = this.commandHistory.length;
      }
    } catch (e) {
      // Ignore storage errors
    }
  }
}
