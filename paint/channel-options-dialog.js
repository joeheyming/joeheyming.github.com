// Channels panel › Channel Options… (PhotoCraft channel_options_ui.rs fields / body / params). The
// markup is #channel-options-modal in index.html: Name, Color Indicates (Masked / Selected Areas),
// Color, and Opacity %. OK hands { name, indicates, color, opacity } to onApply with the index.

import { CHANNEL_OPTION_DEFAULTS } from './channels.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {{ channels: () => Array<{ name: string, indicates?: string, color?: string,
 *   opacity?: number }>,
 *   onApply: (index: number, options: { name: string, indicates: string, color: string,
 *   opacity: number }) => void }} deps
 * @returns {{ open: (index: number) => void }}
 */
export function initChannelOptionsDialog({ channels, onApply }) {
  const modal = $('channel-options-modal');
  if (!modal) return { open() {} };
  const nameInput = $('channel-options-name');
  const indicatesSel = $('channel-options-indicates');
  const colorInput = $('channel-options-color');
  const opacityInput = $('channel-options-opacity');
  let index = -1;

  const close = () => modal.classList.add('hidden');
  const confirm = () => {
    close();
    const opacity = Math.min(100, Math.max(0, Math.round(Number(opacityInput.value) || 0)));
    onApply(index, {
      name: nameInput.value,
      indicates: indicatesSel.value,
      color: colorInput.value,
      opacity
    });
  };
  $('channel-options-ok')?.addEventListener('click', confirm);
  $('channel-options-cancel')?.addEventListener('click', close);
  modal.addEventListener('keydown', (e) => {
    // The app's keydown handler would read Escape as Deselect.
    if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      confirm();
    }
  });

  const open = (i) => {
    const channel = channels()[i];
    if (!channel) return;
    index = i;
    nameInput.value = channel.name;
    indicatesSel.value = channel.indicates ?? CHANNEL_OPTION_DEFAULTS.indicates;
    colorInput.value = channel.color ?? CHANNEL_OPTION_DEFAULTS.color;
    opacityInput.value = String(channel.opacity ?? CHANNEL_OPTION_DEFAULTS.opacity);
    modal.classList.remove('hidden');
    setTimeout(() => nameInput.focus(), 50);
  };
  return { open };
}
