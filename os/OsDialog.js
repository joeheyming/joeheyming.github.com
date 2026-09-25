/**
 * In-OS prompt / confirm (replaces window.prompt / window.confirm on the desktop).
 */

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {{ title: string, defaultValue?: string, confirmLabel?: string, label?: string, document?: Document }} opts
 * @returns {Promise<string | null>}
 */
export function promptName(opts) {
  const doc = opts.document || (typeof document !== 'undefined' ? document : null);
  if (!doc) return Promise.resolve(null);

  return new Promise((resolve) => {
    const overlay = doc.createElement('div');
    overlay.className = 'os-prompt-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'os-prompt-title');

    const title = escapeHtml(opts.title || 'Name');
    const label = escapeHtml(opts.label || opts.title || 'Name');
    const confirmLabel = escapeHtml(opts.confirmLabel || 'OK');
    const value = opts.defaultValue == null ? '' : String(opts.defaultValue);

    overlay.innerHTML =
      `<div class="os-prompt-panel">` +
      `<h3 id="os-prompt-title" class="os-prompt-title">${title}</h3>` +
      `<label class="os-prompt-label" for="os-prompt-input">${label}</label>` +
      `<input id="os-prompt-input" class="os-prompt-input" type="text" value="${escapeHtml(
        value
      )}" />` +
      `<div class="os-prompt-actions">` +
      `<button type="button" class="os-prompt-cancel">Cancel</button>` +
      `<button type="button" class="os-prompt-ok">${confirmLabel}</button>` +
      `</div></div>`;

    const input = /** @type {HTMLInputElement} */ (overlay.querySelector('.os-prompt-input'));
    const finish = (result) => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('.os-prompt-cancel')?.addEventListener('click', () => finish(null));
    overlay.querySelector('.os-prompt-ok')?.addEventListener('click', () => {
      const next = input.value.trim();
      finish(next ? next : null);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = input.value.trim();
        finish(next ? next : null);
      }
    });

    doc.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

/**
 * @param {{ title?: string, message: string, confirmLabel?: string, document?: Document }} opts
 * @returns {Promise<boolean>}
 */
export function confirmAction(opts) {
  const doc = opts.document || (typeof document !== 'undefined' ? document : null);
  if (!doc) return Promise.resolve(false);

  return new Promise((resolve) => {
    const overlay = doc.createElement('div');
    overlay.className = 'os-prompt-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'os-confirm-title');

    const title = escapeHtml(opts.title || 'Confirm');
    const message = escapeHtml(opts.message || '');
    const confirmLabel = escapeHtml(opts.confirmLabel || 'OK');

    overlay.innerHTML =
      `<div class="os-prompt-panel">` +
      `<h3 id="os-confirm-title" class="os-prompt-title">${title}</h3>` +
      `<p class="os-prompt-message">${message}</p>` +
      `<div class="os-prompt-actions">` +
      `<button type="button" class="os-prompt-cancel">Cancel</button>` +
      `<button type="button" class="os-prompt-ok">${confirmLabel}</button>` +
      `</div></div>`;

    const finish = (result) => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('.os-prompt-cancel')?.addEventListener('click', () => finish(false));
    overlay.querySelector('.os-prompt-ok')?.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
    });

    doc.body.appendChild(overlay);
    /** @type {HTMLButtonElement | null} */ (overlay.querySelector('.os-prompt-ok'))?.focus();
  });
}

export const OsDialog = { promptName, confirmAction };
