/**
 * Heyming OS - Taskbar
 * Handles the bottom taskbar with running apps
 */

export class Taskbar {
  constructor(windowManager) {
    this.windowManager = windowManager;
    this.container = null;
  }

  /**
   * Initialize the taskbar (call after DOM ready)
   */
  init() {
    this.container = document.getElementById('running-apps');
  }

  /**
   * Create a taskbar button for a window
   */
  createButton(windowId, title) {
    if (!this.container) return;

    const button = document.createElement('button');
    button.className = 'taskbar-app active';
    button.setAttribute('data-window-id', windowId);
    button.innerHTML = `${this.windowManager.getAppIcon(title)} ${title}`;

    button.addEventListener('click', () => {
      const win = this.windowManager.getWindow(windowId);
      if (win) {
        if (win.minimized) {
          this.windowManager.restoreWindow(windowId);
        } else if (this.windowManager.activeWindow?.id === windowId) {
          this.windowManager.minimizeWindow(windowId);
        } else {
          this.windowManager.makeWindowActive(windowId);
        }
        this.update();
      }
    });

    this.container.appendChild(button);
  }

  /**
   * Remove a taskbar button
   */
  removeButton(windowId) {
    if (!this.container) return;

    const button = this.container.querySelector(`[data-window-id="${windowId}"]`);
    if (button) {
      button.remove();
    }
  }

  /**
   * Update all taskbar button states
   */
  update() {
    if (!this.container) return;

    const buttons = this.container.querySelectorAll('.taskbar-app');
    buttons.forEach((button) => {
      const windowId = parseInt(button.getAttribute('data-window-id'));
      const win = this.windowManager.getWindow(windowId);

      button.classList.remove('active');
      if (win && this.windowManager.activeWindow?.id === windowId && !win.minimized) {
        button.classList.add('active');
      }
    });
  }

  /**
   * Clear all taskbar buttons
   */
  clear() {
    if (!this.container) return;
    this.container.innerHTML = '';
  }
}
