/**
 * Heyming OS - Taskbar
 * Handles the bottom taskbar with running apps
 */

const TW_COLORS = {
  'blue-400': '#60a5fa',
  'blue-500': '#3b82f6',
  'indigo-500': '#6366f1',
  'indigo-600': '#4f46e5',
  'teal-400': '#2dd4bf',
  'teal-500': '#14b8a6',
  'cyan-500': '#06b6d4',
  'gray-500': '#6b7280',
  'gray-700': '#374151',
  'amber-500': '#f59e0b',
  'yellow-500': '#eab308',
  'slate-600': '#475569',
  'emerald-500': '#10b981',
  'emerald-600': '#059669',
  'purple-500': '#a855f7',
  'violet-500': '#8b5cf6',
  'rose-500': '#f43f5e',
  'orange-500': '#f97316',
  'sky-500': '#0ea5e9',
  'pink-500': '#ec4899'
};

function taskbarGradientCss(token) {
  if (!token || typeof token !== 'string') return '';
  const from = token.match(/from-([a-z]+-\d+)/);
  const to = token.match(/to-([a-z]+-\d+)/);
  const a = from ? TW_COLORS[from[1]] : null;
  const b = to ? TW_COLORS[to[1]] : null;
  if (!a && !b) return '';
  return `linear-gradient(90deg, ${a || b}, ${b || a})`;
}

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

    const win = this.windowManager.getWindow(windowId);
    const icon = this.windowManager.getAppIconForWindow(win);
    const label = win?.title || title;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'taskbar-app active';
    button.setAttribute('data-window-id', String(windowId));
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', label);
    button.innerHTML = `${icon} ${label}`;

    const app =
      win?.app || (win?.appId && window.AppModule?.getAllApps?.().find((a) => a.id === win.appId));
    const gradient = taskbarGradientCss(app?.taskbarGradient);
    if (gradient) {
      button.style.backgroundImage = gradient;
      button.style.borderColor = 'transparent';
    }
    if (app?.taskbarText === 'text-white') {
      button.style.color = '#fff';
    } else if (app?.taskbarText === 'text-black') {
      button.style.color = '#111';
    }

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
      const windowId = parseInt(button.getAttribute('data-window-id'), 10);
      const win = this.windowManager.getWindow(windowId);
      const title = win?.title || button.textContent?.trim() || 'Window';

      button.classList.remove('active');
      const active = Boolean(
        win && this.windowManager.activeWindow?.id === windowId && !win.minimized
      );
      if (active) {
        button.classList.add('active');
      }
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (win?.minimized) {
        button.setAttribute('aria-label', `${title} (minimized)`);
      } else {
        button.setAttribute('aria-label', title);
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
