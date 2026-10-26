// In-app confirm / alert (no window.confirm / window.alert — those block Playwright).
// Markup: #confirm-modal in index.html. openConfirm asks OK/Cancel; openAlert is OK-only.

/**
 * @param {{ doc?: Document }} [deps]
 * @returns {{
 *   openConfirm: (message: string, onOk: () => void, onCancel?: () => void) => void,
 *   openAlert: (message: string, onOk?: () => void) => void
 * }}
 */
export function initConfirmDialog({ doc = document } = {}) {
  const $ = (id) => doc.getElementById(id);
  const modal = $('confirm-modal');
  if (!modal) {
    return {
      openConfirm(_message, onOk) {
        onOk?.();
      },
      openAlert(_message, onOk) {
        onOk?.();
      }
    };
  }

  let onOk = null;
  let onCancel = null;
  const close = (accepted) => {
    modal.classList.add('hidden');
    const ok = onOk;
    const cancel = onCancel;
    onOk = null;
    onCancel = null;
    if (accepted) ok?.();
    else cancel?.();
  };
  const accept = () => close(true);
  const dismiss = () => close(false);

  $('confirm-ok')?.addEventListener('click', accept);
  $('confirm-cancel')?.addEventListener('click', dismiss);
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    if (e.key === 'Escape') dismiss();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      accept();
    }
  });

  function show(message, { okLabel = 'OK', cancelLabel = 'Cancel', showCancel = true } = {}) {
    $('confirm-message').textContent = message;
    const okBtn = $('confirm-ok');
    const cancelBtn = $('confirm-cancel');
    if (okBtn) okBtn.textContent = okLabel;
    if (cancelBtn) {
      cancelBtn.textContent = cancelLabel;
      cancelBtn.hidden = !showCancel;
    }
    modal.classList.remove('hidden');
    setTimeout(() => (showCancel ? cancelBtn : okBtn)?.focus(), 50);
  }

  return {
    openConfirm(message, ok, cancel) {
      onOk = ok;
      onCancel = cancel ?? null;
      show(message, { showCancel: true });
    },
    openAlert(message, ok) {
      onOk = ok ?? null;
      onCancel = null;
      show(message, { showCancel: false });
    }
  };
}
