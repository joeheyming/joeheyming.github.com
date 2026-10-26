// Edit › Fade… dialog (PhotoCraft edit.fade: Opacity 0..100, Mode). The markup is #fade-modal in
// index.html. Every edit calls onPreview({ opacity, mode }); OK calls onOk with the same, Cancel
// calls onCancel. The dialog opens at 100% Normal each time, like PhotoCraft's spec defaults.

import { FADE_MODES } from './fade.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {{
 *   onPreview: (p: { opacity: number, mode: string }) => void,
 *   onOk: (p: { opacity: number, mode: string }) => void,
 *   onCancel: () => void
 * }} deps
 * @returns {{ open: (label: string) => void }}
 */
export function initFadeDialog({ onPreview, onOk, onCancel }) {
  const modal = $('fade-modal');
  if (!modal) return { open() {} };
  const title = $('fade-title');
  const range = $('fade-opacity');
  const num = $('fade-opacity-num');
  const modeSel = $('fade-mode');
  if (!modeSel.options.length) {
    for (const { value, label } of FADE_MODES) modeSel.add(new Option(label, value));
  }

  const values = () => ({ opacity: Number(range.value), mode: modeSel.value });
  const close = () => modal.classList.add('hidden');
  const confirm = () => {
    close();
    onOk(values());
  };
  const cancel = () => {
    close();
    onCancel();
  };
  range.addEventListener('input', () => {
    num.value = range.value;
    onPreview(values());
  });
  num.addEventListener('input', () => {
    range.value = String(Math.max(0, Math.min(100, Number(num.value) || 0)));
    onPreview(values());
  });
  modeSel.addEventListener('change', () => onPreview(values()));
  $('fade-ok')?.addEventListener('click', confirm);
  $('fade-cancel')?.addEventListener('click', cancel);
  modal.addEventListener('keydown', (e) => {
    // The app's keydown handler would read Escape as Deselect.
    if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    if (e.key === 'Escape') cancel();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      confirm();
    }
  });

  return {
    open(label) {
      title.textContent = 'Fade';
      modal.setAttribute('aria-label', `Fade ${label}`);
      range.value = '100';
      num.value = '100';
      modeSel.value = 'source-over';
      modal.classList.remove('hidden');
      setTimeout(() => range.focus(), 50);
    }
  };
}
