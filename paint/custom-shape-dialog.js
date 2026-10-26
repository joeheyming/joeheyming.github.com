// Edit › Define Custom Shape… name dialog (PhotoCraft canvas_tool_menu.rs, {"name": text}). The
// markup is #custom-shape-modal in index.html. open(defaultName, onOk) shows it with the name
// selected; OK runs onOk(name), Cancel and Escape do nothing.

/**
 * @param {{ doc?: Document }} [deps]
 * @returns {{ open: (name: string, onOk: (name: string) => void) => void }}
 */
export function initCustomShapeDialog({ doc = document } = {}) {
  const $ = (id) => doc.getElementById(id);
  const modal = $('custom-shape-modal');
  const input = /** @type {HTMLInputElement | null} */ ($('custom-shape-name'));
  if (!modal || !input) return { open() {} };

  let onOk = null;
  const close = () => {
    modal.classList.add('hidden');
    onOk = null;
  };
  const confirm = () => {
    const run = onOk;
    const name = input.value;
    close();
    run?.(name);
  };
  $('custom-shape-ok')?.addEventListener('click', confirm);
  $('custom-shape-cancel')?.addEventListener('click', close);
  modal.addEventListener('keydown', (e) => {
    // The app's keydown handler would read Escape as Deselect and letters as tool keys.
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      confirm();
    }
  });

  return {
    open(name, ok) {
      onOk = ok;
      input.value = name;
      modal.classList.remove('hidden');
      setTimeout(() => {
        input.focus();
        input.select();
      }, 50);
    }
  };
}
