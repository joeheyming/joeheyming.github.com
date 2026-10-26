// The "Rasterize?" prompt (PhotoCraft rasterize_prompt.rs): a pixel tool on a type layer asks
// "This type layer must be rasterized before proceeding. … Rasterize the type?" instead of
// painting. The markup is #rasterize-modal in index.html. open(message, onOk) shows it; OK runs
// onOk (Layer › Rasterize › Type), Cancel does nothing.

/**
 * @param {{ doc?: Document }} [deps]
 * @returns {{ open: (message: string, onOk: () => void) => void }}
 */
export function initRasterizePrompt({ doc = document } = {}) {
  const $ = (id) => doc.getElementById(id);
  const modal = $('rasterize-modal');
  if (!modal) return { open() {} };

  let onOk = null;
  const close = () => {
    modal.classList.add('hidden');
    onOk = null;
  };
  const confirm = () => {
    const run = onOk;
    close();
    run?.();
  };
  $('rasterize-ok')?.addEventListener('click', confirm);
  $('rasterize-cancel')?.addEventListener('click', close);
  modal.addEventListener('keydown', (e) => {
    // The app's keydown handler would read Escape as Deselect.
    if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      confirm();
    }
  });

  return {
    open(message, ok) {
      onOk = ok;
      $('rasterize-message').textContent = message;
      modal.classList.remove('hidden');
      setTimeout(() => $('rasterize-ok')?.focus(), 50);
    }
  };
}
