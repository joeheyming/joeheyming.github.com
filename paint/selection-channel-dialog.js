// Select › Save Selection… and Load Selection… (PhotoCraft view_cmds save / load selection
// dialogs). The markup is #selection-channel-modal in index.html. Save picks New or an alpha
// channel, a Name for a new one, and how an existing channel takes the selection; Load picks an
// alpha channel and how it meets the current selection. OK hands the choice to onSave / onLoad.

import { LOAD_OPERATIONS, SAVE_OPERATIONS } from './channels.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {{ channels: () => Array<{ name: string }>,
 *   onSave: (p: { channel: number | 'new', name: string, operation: string }) => void,
 *   onLoad: (p: { channel: number, operation: string }) => void }} deps
 * @returns {{ openSave: () => void, openLoad: () => void }}
 */
export function initSelectionChannelDialog({ channels, onSave, onLoad }) {
  const modal = $('selection-channel-modal');
  if (!modal) return { openSave() {}, openLoad() {} };
  const title = $('selection-channel-title');
  const channelSel = $('selection-channel-channel');
  const nameRow = $('selection-channel-name-row');
  const nameInput = $('selection-channel-name');
  const opSel = $('selection-channel-op');
  let mode = 'save';

  const fillOps = (ops) => {
    opSel.textContent = '';
    for (const { value, label } of ops) opSel.add(new Option(label, value));
  };
  // A new channel is the selection itself: Name shows and Operation does not apply.
  const sync = () => {
    const fresh = mode === 'save' && channelSel.value === 'new';
    nameRow.hidden = !fresh;
    opSel.disabled = fresh;
  };
  channelSel.addEventListener('change', sync);

  const close = () => modal.classList.add('hidden');
  const confirm = () => {
    close();
    const operation = opSel.value;
    if (mode === 'save') {
      const channel = channelSel.value === 'new' ? 'new' : Number(channelSel.value);
      onSave({ channel, name: nameInput.value, operation });
    } else if (channelSel.value !== '') {
      onLoad({ channel: Number(channelSel.value), operation });
    }
  };
  $('selection-channel-ok')?.addEventListener('click', confirm);
  $('selection-channel-cancel')?.addEventListener('click', close);
  modal.addEventListener('keydown', (e) => {
    // The app's keydown handler would read Escape as Deselect.
    if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      confirm();
    }
  });

  const open = (which) => {
    mode = which;
    title.textContent = which === 'save' ? 'Save Selection' : 'Load Selection';
    channelSel.textContent = '';
    if (which === 'save') channelSel.add(new Option('New', 'new'));
    channels().forEach((c, i) => channelSel.add(new Option(c.name, String(i))));
    fillOps(which === 'save' ? SAVE_OPERATIONS : LOAD_OPERATIONS);
    nameInput.value = '';
    sync();
    modal.classList.remove('hidden');
    setTimeout(() => (which === 'save' ? nameInput : channelSel).focus(), 50);
  };
  return { openSave: () => open('save'), openLoad: () => open('load') };
}
