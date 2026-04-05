/**
 * Heyming OS - Notification Service
 * Handles toast notifications
 */

import { Constants } from './constants.js';

export class NotificationService {
  constructor() {
    this.container = null;
    this.C = Constants;
  }

  /**
   * Initialize the notification service (call after DOM ready)
   */
  init() {
    this.container =
      document.getElementById('os-notification-region') || document.getElementById('os-desktop');
  }

  /**
   * Show a notification
   * @param {string} message - Notification text
   * @param {string} type - Notification type: 'info', 'success', 'error', 'warning', 'system'
   */
  show(message, type = 'info') {
    // Lazy init if not already done
    if (!this.container) {
      this.container =
        document.getElementById('os-notification-region') || document.getElementById('os-desktop');
    }
    if (!this.container) {
      console.warn('NotificationService: os-desktop element not found');
      return;
    }

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.setAttribute('role', 'status');

    const color = this.C.NOTIFICATION_COLORS[type] || this.C.NOTIFICATION_COLORS.info;
    notification.style.borderLeft = `4px solid ${color}`;
    notification.textContent = message;

    this.container.appendChild(notification);

    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, this.C.NOTIFICATION_DURATION);
  }

  /**
   * Convenience methods for different notification types
   */
  info(message) {
    this.show(message, 'info');
  }

  success(message) {
    this.show(message, 'success');
  }

  error(message) {
    this.show(message, 'error');
  }

  warning(message) {
    this.show(message, 'warning');
  }

  system(message) {
    this.show(message, 'system');
  }
}
