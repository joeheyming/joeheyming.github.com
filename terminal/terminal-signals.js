export class TerminalSignalMixin {
  onSignal(signalName, handler) {
    // Create a unique event listener for this terminal instance
    const eventType = `terminal-signal-${signalName}-${this.windowId || 'main'}`;

    // Store the handler and event type for cleanup
    if (!this.signalHandlers[signalName]) {
      this.signalHandlers[signalName] = [];
    }

    const eventHandler = (event) => {
      try {
        handler(event.detail.signalName, event.detail);
      } catch (error) {
        console.error(`Error in signal handler for ${signalName}:`, error);
      }
    };

    this.signalHandlers[signalName].push({
      handler: eventHandler,
      eventType: eventType
    });

    window.addEventListener(eventType, eventHandler);
  }

  // Remove a signal handler
  offSignal(signalName) {
    if (this.signalHandlers[signalName]) {
      // Remove all event listeners for this signal
      this.signalHandlers[signalName].forEach(({ handler, eventType }) => {
        window.removeEventListener(eventType, handler);
      });
      delete this.signalHandlers[signalName];
    }
  }

  // Send a signal to the current process (like kill() in Unix)
  sendSignal(signalName, data = {}) {
    const eventType = `terminal-signal-${signalName}-${this.windowId || 'main'}`;

    // Create and dispatch custom event
    const signalEvent = new CustomEvent(eventType, {
      detail: {
        signalName: signalName,
        timestamp: Date.now(),
        terminalId: this.windowId || 'main',
        ...data
      }
    });

    // Dispatch asynchronously to avoid issues with handlers modifying the signal registry
    setTimeout(() => {
      window.dispatchEvent(signalEvent);
    }, 0);
  }

  // Set the current running process (for signal targeting)
  setCurrentProcess(processInfo) {
    this.currentProcess = processInfo;
  }

  // Clear the current process
  clearCurrentProcess() {
    this.currentProcess = null;
    // Clear all signal handlers when process ends
    Object.keys(this.signalHandlers).forEach((signalName) => {
      this.offSignal(signalName);
    });
  }
}
