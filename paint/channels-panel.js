// Channels panel chrome — domain ops stay in channels.js.
import { iconSvg } from './icons.js';
import { COLOR_CHANNELS, channelRows, channelThumbPixels } from './channels.js';

const THUMB_SIZE = 28;

// A canvas.channel-thumb for a row, drawn when there is an image and a 2d context (jsdom has none).
function channelThumb(doc, img, row) {
  const canvas = doc.createElement('canvas');
  canvas.className = 'channel-thumb';
  canvas.width = canvas.height = THUMB_SIZE;
  const ctx = img ? canvas.getContext?.('2d') : null;
  if (ctx) {
    const t = channelThumbPixels(img, row, THUMB_SIZE);
    const out = ctx.createImageData(THUMB_SIZE, THUMB_SIZE);
    out.data.set(t.data);
    ctx.putImageData(out, 0, 0);
  }
  return canvas;
}

// channels_panel.rs rename_id: the row's label becomes a text field until Enter, blur, or Escape.
function startChannelRename(el, row, onRename) {
  if (el.querySelector('input.channel-rename')) return;
  const input = el.ownerDocument.createElement('input');
  input.type = 'text';
  input.className = 'channel-rename';
  input.setAttribute('aria-label', 'Channel name');
  input.value = row.name;
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const value = input.value;
    el.textContent = row.name;
    if (commit) onRename?.(row.index, value);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();
}

/** Overlay Color presets of the alpha row menu (channels_panel.rs overlay_colors). */
export const CHANNEL_OVERLAY_COLORS = [
  { label: 'Red', color: '#ff0000' },
  { label: 'Green', color: '#00c000' },
  { label: 'Blue', color: '#0050ff' },
  { label: 'Cyan', color: '#00d0e0' },
  { label: 'Magenta', color: '#e000c0' },
  { label: 'Yellow', color: '#f0d000' }
];

// channels_panel.rs indicates_items + overlay_colors: Color Indicates (✓ on the current one),
// then Overlay Color › and Overlay Opacity › submenus; each sends a partial channel.options.
function overlayMenuItems(channel, set) {
  const indicates = channel?.indicates === 'selected' ? 'selected' : 'masked';
  const check = (on, label) => (on ? `✓ ${label}` : label);
  return [
    {
      label: check(indicates === 'masked', 'Color Indicates Masked Areas'),
      run: () => set({ indicates: 'masked' })
    },
    {
      label: check(indicates === 'selected', 'Color Indicates Selected Areas'),
      run: () => set({ indicates: 'selected' })
    },
    {
      label: 'Overlay Color',
      submenu: CHANNEL_OVERLAY_COLORS.map(({ label, color }) => ({
        label,
        run: () => set({ color })
      }))
    },
    {
      label: 'Overlay Opacity',
      submenu: [25, 50, 75, 100].map((opacity) => ({
        label: `${opacity}%`,
        run: () => set({ opacity })
      }))
    }
  ];
}

let closeChannelMenu = null;

// channels_panel.rs resp.context_menu: a popup of { label, run } items at the pointer. Picking an
// item, Escape, or a press outside closes it.
function openChannelMenu(doc, x, y, items) {
  closeChannelMenu?.();
  const menu = doc.createElement('div');
  menu.className = 'channel-menu layer-popup-menu';
  menu.setAttribute('role', 'menu');
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const close = () => {
    menu.remove();
    doc.removeEventListener('pointerdown', onOutside, true);
    doc.removeEventListener('keydown', onKey, true);
    if (closeChannelMenu === close) closeChannelMenu = null;
  };
  const onOutside = (e) => {
    if (!menu.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  // An item with a submenu keeps the menu open and lists its items in a nested menu below it.
  const addItems = (parent, list) => {
    for (const item of list) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'action-menu-item';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = item.label;
      parent.appendChild(btn);
      if (item.submenu) {
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-expanded', 'false');
        let sub = null;
        btn.addEventListener('click', () => {
          if (sub) {
            sub.remove();
            sub = null;
          } else {
            sub = doc.createElement('div');
            sub.className = 'channel-submenu';
            sub.setAttribute('role', 'menu');
            sub.setAttribute('aria-label', item.label);
            addItems(sub, item.submenu);
            btn.after(sub);
          }
          btn.setAttribute('aria-expanded', String(!!sub));
        });
        continue;
      }
      btn.addEventListener('click', () => {
        close();
        item.run();
      });
    }
  };
  addItems(menu, items);
  doc.body.appendChild(menu);
  doc.addEventListener('pointerdown', onOutside, true);
  doc.addEventListener('keydown', onKey, true);
  closeChannelMenu = close;
  return menu;
}

/**
 * Fill the Channels panel: one row per channelRows entry (the target is aria-selected), then
 * the footer: Load Channel as Selection, Save Selection as Channel, Create New Channel, Delete
 * Channel. Each row shows eye, thumbnail (channelThumbPixels of opts.image), name. A row click
 * targets it; the footer acts on the targeted alpha channel. Double-clicking an alpha thumbnail
 * sends onOptions; double-clicking elsewhere on an alpha row opens an inline name field: Enter or blur sends onRename, Escape cancels.
 * Right-clicking a row opens its menu: alpha rows list Duplicate Channel, Delete Channel, Rename
 * Channel…, Channel Options… (onOptions), Color Indicates Masked / Selected Areas, Overlay Color ›,
 * Overlay Opacity › (each onSetOptions with a partial options object), New Channel…; the composite and color rows list
 * Duplicate Channel (onDuplicateColor with the row name) and New Channel…. Every row has an eye: color rows send onToggleVisible,
 * alpha rows onToggleAlpha; neither changes the target.
 * @param {HTMLElement} container
 * @param {Array<{ name: string }>} channels
 * @param {{ target: number | null, canSave: boolean, onTarget: (i: number | null) => void,
 *   onLoad: (i: number) => void, onSave: () => void, onNew: () => void, onDelete: (i: number) => void,
 *   onRename?: (i: number, name: string) => void, onDuplicate?: (i: number) => void,
 *   onDuplicateColor?: (name: string) => void, hidden?: boolean[],
 *   onToggleVisible?: (name: string) => void, onToggleAlpha?: (i: number) => void,
 *   onOptions?: (i: number) => void, onSetOptions?: (i: number, options: { indicates?: string,
 *   color?: string, opacity?: number }) => void,
 *   image?: { width: number, height: number, data: Uint8ClampedArray | Uint8Array } }} opts
 */
export function renderChannelsPanel(container, channels, opts) {
  const doc = container.ownerDocument;
  container.textContent = '';
  const list = doc.createElement('div');
  list.className = 'channel-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Channels');
  for (const row of channelRows(channels)) {
    const el = doc.createElement('div');
    el.className = `channel-row ${row.kind}`;
    el.tabIndex = 0;
    el.setAttribute('role', 'option');
    const target = row.kind === 'alpha' ? row.index === opts.target : opts.target == null;
    el.setAttribute('aria-selected', String(target));
    const label = doc.createElement('span');
    label.className = 'channel-name';
    label.textContent = row.name;
    el.appendChild(label);
    const thumbRow = row.kind === 'alpha' ? { ...row, data: channels[row.index].data } : row;
    const thumb = channelThumb(doc, opts.image, thumbRow);
    el.prepend(thumb);
    if (row.kind !== 'alpha') {
      const hidden = opts.hidden ?? [false, false, false];
      const k = COLOR_CHANNELS.indexOf(row.name);
      const visible = k === 0 ? !hidden.some(Boolean) : !hidden[k - 1];
      const eye = doc.createElement('button');
      eye.type = 'button';
      eye.className = 'channel-eye';
      eye.setAttribute('aria-pressed', String(visible));
      eye.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${row.name}`);
      eye.title = eye.getAttribute('aria-label');
      eye.appendChild(iconSvg(visible ? 'eye' : 'eye-off', 14, doc));
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onToggleVisible?.(row.name);
      });
      el.prepend(eye);
    }
    if (row.kind === 'alpha') {
      // channels_panel.rs on_thumb: double-clicking the thumbnail is Channel Options….
      thumb.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        opts.onOptions?.(row.index);
      });
      const shown = !!channels[row.index].shown;
      const eye = doc.createElement('button');
      eye.type = 'button';
      eye.className = 'channel-eye';
      eye.setAttribute('aria-pressed', String(shown));
      eye.setAttribute('aria-label', `${shown ? 'Hide' : 'Show'} ${row.name}`);
      eye.title = eye.getAttribute('aria-label');
      eye.appendChild(iconSvg(shown ? 'eye' : 'eye-off', 14, doc));
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onToggleAlpha?.(row.index);
      });
      el.prepend(eye);
      el.dataset.channel = String(row.index);
      el.addEventListener('dblclick', () => startChannelRename(label, row, opts.onRename));
    }
    el.addEventListener('click', () => opts.onTarget(row.kind === 'alpha' ? row.index : null));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const items = [];
      if (row.kind === 'alpha') {
        items.push(
          { label: 'Duplicate Channel', run: () => opts.onDuplicate?.(row.index) },
          { label: 'Delete Channel', run: () => opts.onDelete(row.index) },
          { label: 'Rename Channel…', run: () => startChannelRename(label, row, opts.onRename) },
          { label: 'Channel Options…', run: () => opts.onOptions?.(row.index) },
          ...overlayMenuItems(channels[row.index], (o) => opts.onSetOptions?.(row.index, o))
        );
      } else {
        items.push({ label: 'Duplicate Channel', run: () => opts.onDuplicateColor?.(row.name) });
      }
      items.push({ label: 'New Channel…', run: () => opts.onNew() });
      openChannelMenu(doc, e.clientX, e.clientY, items);
    });
    list.appendChild(el);
  }
  container.appendChild(list);
  const footer = doc.createElement('div');
  footer.className = 'layer-panel-footer';
  const alpha = opts.target != null && !!channels[opts.target];
  const buttons = [
    ['load', 'ellipse-dashed', 'Load channel as selection', !alpha, () => opts.onLoad(opts.target)],
    ['save', 'layer-mask', 'Save selection as channel', !opts.canSave, () => opts.onSave()],
    ['new', 'plus', 'Create new channel', false, () => opts.onNew()],
    ['delete', 'trash', 'Delete channel', !alpha, () => opts.onDelete(opts.target)]
  ];
  for (const [action, icon, title, disabled, run] of buttons) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'layer-footer-btn';
    btn.dataset.action = action;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.appendChild(iconSvg(icon, 16, doc));
    btn.disabled = disabled;
    btn.addEventListener('click', run);
    footer.appendChild(btn);
  }
  container.appendChild(footer);
}
