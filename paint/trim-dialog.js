// Image › Trim… dialog. The markup is #trim-modal in index.html: Based On picks what counts as
// empty, and the Trim Away checkboxes pick which sides may move. OK hands
// { basedOn, sides: { top, bottom, left, right } } to onOk. The choices last for the session.

import { TRIM_BASED_ON, TRIM_SIDES } from './trim.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {{ onOk: (p: { basedOn: string, sides: Record<string, boolean> }) => void }} deps
 * @returns {{ open: () => void }}
 */
export function initTrimDialog({ onOk }) {
  const modal = $('trim-modal');
  if (!modal) return { open() {} };
  const basedSel = $('trim-based-on');
  if (!basedSel.options.length) {
    for (const { value, label } of TRIM_BASED_ON) basedSel.add(new Option(label, value));
  }
  const boxes = Object.fromEntries(TRIM_SIDES.map((k) => [k, $(`trim-${k}`)]));

  const close = () => modal.classList.add('hidden');
  const confirm = () => {
    close();
    const sides = Object.fromEntries(TRIM_SIDES.map((k) => [k, boxes[k].checked]));
    onOk({ basedOn: basedSel.value, sides });
  };
  $('trim-ok')?.addEventListener('click', confirm);
  $('trim-cancel')?.addEventListener('click', close);
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
    open() {
      modal.classList.remove('hidden');
      setTimeout(() => basedSel.focus(), 50);
    }
  };
}
