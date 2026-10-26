// History panel — pure rendering, no state ownership

import { ADJUSTMENTS } from './adjustments.js';
import { deleteStatePlan } from './history-snapshots.js';
import { iconSvg } from './icons.js';
import { TOOLS } from './tools.js';

// Labels pushed by commands outside TOOLS and ADJUSTMENTS. Names are ICONS keys.
const COMMAND_ICONS = {
  Draw: 'brush',
  Open: 'folder-open',
  'Open from OS': 'folder-open',
  Upload: 'folder-open',
  Paste: 'copy',
  'Paste Into': 'copy',
  'Paste Outside': 'copy',
  Cut: 'scissors',
  Delete: 'trash',
  Clear: 'trash',
  Fill: 'paint-bucket',
  Stroke: 'square',
  'Fill Path': 'paint-bucket',
  'Stroke Path': 'circle',
  'Make Work Path': 'spline',
  'New Path': 'square-plus',
  'Delete Path': 'trash',
  'Save Path': 'square-plus',
  'Rename Path': 'type',
  'Duplicate Path': 'copy',
  'Save Selection': 'layer-mask',
  'New Channel': 'square-plus',
  'Delete Channel': 'trash',
  'Duplicate Channel': 'copy',
  'Rename Channel': 'type',
  'Channel Options': 'sliders-horizontal',
  'Apply Layer Comp': 'layers',
  'Delete Object': 'trash',
  'Delete Objects': 'trash',
  'New Guide': 'ruler',
  'Move Guide': 'ruler',
  'Delete Guide': 'trash',
  'Clear Guides': 'trash',
  'New Guide Layout': 'grid-3x3',
  Crop: 'crop',
  Trim: 'crop',
  Resize: 'scaling',
  'Image Size': 'scaling',
  'Resize Object': 'scaling',
  'Flip Horizontal': 'arrow-left-right',
  'Flip Vertical': 'arrow-left-right',
  'Rotate Canvas': 'rotate-cw',
  'Flip Canvas Horizontal': 'arrow-left-right',
  'Flip Canvas Vertical': 'arrow-left-right',
  Revert: 'clock',
  'Place Embedded': 'square-plus',
  'Delete All Empty Layers': 'trash',
  'Flatten All Masks': 'layer-mask',
  'Free Transform': 'maximize-2',
  'Transform Again': 'maximize-2',
  Warp: 'grid-3x3',
  'Field Blur': 'sliders-horizontal',
  'Iris Blur': 'sliders-horizontal',
  'Tilt-Shift': 'sliders-horizontal',
  'Spin Blur': 'sliders-horizontal',
  Liquify: 'sliders-horizontal',
  'Rotate 180°': 'rotate-cw',
  'Rotate 90° Clockwise': 'rotate-cw',
  'Rotate 90° Counter Clockwise': 'rotate-cw',
  Straighten: 'ruler',
  'Move Layer': 'move',
  'Move Object': 'move',
  'Move Objects': 'move',
  'New Layer': 'layers',
  'Layer Via Copy': 'layers',
  'Layer Via Cut': 'layers',
  'Layer From Background': 'layers',
  'Background From Layer': 'layers',
  'Delete Layer': 'trash',
  'Move Layer Up': 'layers',
  'Move Layer Down': 'layers',
  'Duplicate layer': 'copy',
  'Merge down': 'layers',
  'Merge Layers': 'layers',
  'Merge Visible': 'layers',
  'Delete Hidden Layers': 'trash',
  'New Group': 'folder',
  'Group Layers': 'folder',
  Arrange: 'layers',
  Reverse: 'layers',
  Align: 'align-edge-left',
  Distribute: 'distribute-horizontal',
  'Ungroup Layers': 'folder-open',
  'Duplicate Group': 'copy',
  'Delete Group': 'trash',
  'Create Clipping Mask': 'clip-below',
  'Release Clipping Mask': 'clip-below',
  'Lock Layers': 'lock',
  'Link Layers': 'link-2',
  'Unlink Layers': 'link-2',
  'Lock Transparent Pixels': 'lock',
  'Unlock Transparent Pixels': 'lock',
  'Layer Style': 'fx',
  'Fill Opacity': 'fx',
  'Paste Layer Style': 'fx',
  'Apply Style': 'fx',
  'Clear Layer Style': 'fx',
  'Hide All Effects': 'fx',
  Flatten: 'layers',
  'Convert to Smart Object': 'layers',
  'New Smart Object via Copy': 'copy',
  'Convert to Layers': 'layers',
  'Rasterize Smart Object': 'layers',
  'Edit Text': 'type',
  'New Type Layer': 'type',
  'Edit Type Layer': 'type',
  'Move Type': 'move',
  'Rasterize Type': 'type',
  'New Shape Layer': 'rectangle-horizontal',
  'Edit Shape': 'rectangle-horizontal',
  'Move Shape': 'move',
  'Rasterize Shape': 'rectangle-horizontal',
  'Unite Shapes': 'squares-subtract',
  'Subtract Front Shape': 'squares-subtract',
  'Intersect Shape Areas': 'squares-subtract',
  'Exclude Overlapping Shapes': 'squares-subtract',
  'Merge Shape Components': 'squares-subtract',
  'Add Vector Mask': 'layer-mask',
  'Delete Vector Mask': 'layer-mask',
  'Enable Vector Mask': 'layer-mask',
  'Disable Vector Mask': 'layer-mask',
  'Rasterize Vector Mask': 'layer-mask',
  'Rasterize Layer': 'layers',
  'Rasterize All Layers': 'layers',
  'Anti-Alias': 'type',
  'Change Text Orientation': 'type',
  'Paste Lorem Ipsum': 'type',
  'Convert to Paragraph Text': 'type',
  'Convert to Point Text': 'type',
  Character: 'type',
  Paragraph: 'type',
  'Add Layer Mask': 'layer-mask',
  'From Transparency': 'layer-mask',
  'Disable Layer Mask': 'layer-mask',
  'Enable Layer Mask': 'layer-mask',
  'Apply Layer Mask': 'layer-mask',
  'Delete Layer Mask': 'layer-mask',
  'Mask Properties': 'layer-mask',
  'New Adjustment Layer': 'sliders-horizontal',
  'Edit Adjustment Layer': 'sliders-horizontal',
  'New Color Fill Layer': 'paint-bucket',
  'New Gradient Fill Layer': 'gradient',
  'New Pattern Fill Layer': 'grid-3x3',
  'Edit Fill Layer': 'adjustment-layer',
  'Auto Tone': 'sliders-horizontal',
  'Auto Contrast': 'sliders-horizontal',
  'Auto Color': 'sliders-horizontal',
  Grayscale: 'sliders-horizontal',
  'RGB Color': 'sliders-horizontal',
  'Indexed Color': 'sliders-horizontal',
  Bitmap: 'sliders-horizontal',
  'Color Table': 'sliders-horizontal'
};

// Neutral stroke icon for a label nothing else claims.
export const FALLBACK_HISTORY_ICON = 'diamond';

const HISTORY_ICONS = new Map();
for (const def of Object.values(ADJUSTMENTS)) HISTORY_ICONS.set(def.label, 'sliders-horizontal');
for (const tool of Object.values(TOOLS)) HISTORY_ICONS.set(tool.label, tool.icon);
for (const [label, name] of Object.entries(COMMAND_ICONS)) HISTORY_ICONS.set(label, name);

export function historyIconName(label) {
  // Edit › Fade rows are `Fade <step>` and take the faded step's icon.
  const faded = label?.startsWith('Fade ') ? HISTORY_ICONS.get(label.slice(5)) : null;
  return HISTORY_ICONS.get(label) ?? faded ?? FALLBACK_HISTORY_ICON;
}

export function makeHistoryItem(label, type) {
  const el = document.createElement('div');
  el.className =
    'history-item' + (type === 'current' ? ' current' : '') + (type === 'future' ? ' future' : '');
  const icon = document.createElement('span');
  icon.className = 'history-icon';
  icon.appendChild(iconSvg(historyIconName(label), 14));
  const text = document.createElement('span');
  text.textContent = label;
  el.append(icon, text);
  return el;
}

function makeSnapshotItem(name) {
  const el = document.createElement('div');
  el.className = 'history-snapshot';
  const icon = document.createElement('span');
  icon.className = 'history-icon';
  icon.appendChild(iconSvg('scan', 14));
  const text = document.createElement('span');
  text.textContent = name;
  el.append(icon, text);
  return el;
}

function footerButton(action, icon, title, disabled, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'layer-footer-btn';
  btn.dataset.action = action;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.disabled = disabled;
  btn.appendChild(iconSvg(icon, 16));
  btn.addEventListener('click', () => onClick?.());
  return btn;
}

// Renders into `container` given the current undo/redo stacks.
// onUndoJump(n) / onRedoJump(n) are called when a history item is clicked; extra carries
// { snapshots, onSnapshot(i), onDeleteState(), onNewSnapshot() } for the snapshot rows and footer.
export function renderHistoryPanel(
  container,
  undoStack,
  redoStack,
  onUndoJump,
  onRedoJump,
  extra = {}
) {
  const N = undoStack.length;
  const R = redoStack.length;
  const list = document.createElement('div');
  list.className = 'history-list';

  // Snapshots — above the states (panels.rs history())
  (extra.snapshots ?? []).forEach((snap, i) => {
    const el = makeSnapshotItem(snap.name);
    el.addEventListener('click', () => extra.onSnapshot?.(i));
    list.appendChild(el);
  });

  // Future (redo) items — top, dimmed; redoStack[0]=oldest, [R-1]=most recently undone
  for (let i = 0; i < R; i++) {
    const label = redoStack[i].label ?? 'Draw';
    const el = makeHistoryItem(label, 'future');
    const redosNeeded = R - i;
    el.addEventListener('click', () => onRedoJump(redosNeeded));
    list.appendChild(el);
  }

  // Current state
  const currentLabel = N > 0 ? undoStack[N - 1].label ?? 'Draw' : 'Open';
  list.appendChild(makeHistoryItem(currentLabel, 'current'));

  // Past states — newest first; undoStack[N-2] is 1 undo away
  for (let i = N - 2; i >= 0; i--) {
    const label = undoStack[i].label ?? 'Draw';
    const el = makeHistoryItem(label, 'past');
    const undosNeeded = N - 1 - i;
    el.addEventListener('click', () => onUndoJump(undosNeeded));
    list.appendChild(el);
  }

  // Open (initial state) — only when there are undoable entries
  if (N > 0) {
    const el = makeHistoryItem('Open', 'past');
    el.addEventListener('click', () => onUndoJump(N));
    list.appendChild(el);
  }

  const footer = document.createElement('div');
  footer.className = 'history-footer';
  footer.append(
    footerButton('snapshot', 'scan', 'Create new snapshot', false, extra.onNewSnapshot),
    footerButton(
      'delete',
      'trash',
      'Delete current state',
      !deleteStatePlan(N, R),
      extra.onDeleteState
    )
  );

  container.innerHTML = '';
  container.append(list, footer);
  container.querySelector('.history-item.current')?.scrollIntoView({ block: 'nearest' });
}
