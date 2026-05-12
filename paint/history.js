// History panel — pure rendering, no state ownership

const HISTORY_ICONS = {
  'Pencil': '✏️', 'Brush': '🖌️', 'Eraser': '⬜', 'Spray': '💨',
  'Fill': '🪣', 'Text': 'T', 'Line': '╱', 'Rect': '▭', 'Ellipse': '⬭',
  'Select': '⬚', 'Lasso': '🔗', 'Magic Wand': '🪄',
  'Clear': '🗑️', 'Open': '📂', 'Upload': '📂', 'Paste': '📋',
  'Cut': '✂️', 'Delete': '🗑️',
};

function getHistoryIcon(label) {
  return HISTORY_ICONS[label] ?? '◆';
}

function makeHistoryItem(label, type) {
  const el = document.createElement('div');
  el.className = 'history-item' +
    (type === 'current' ? ' current' : '') +
    (type === 'future'  ? ' future'  : '');
  el.innerHTML =
    `<span class="history-icon">${getHistoryIcon(label)}</span><span>${label}</span>`;
  return el;
}

// Renders into `container` given the current undo/redo stacks.
// onUndoJump(n) / onRedoJump(n) are called when a history item is clicked.
export function renderHistoryPanel(container, undoStack, redoStack, onUndoJump, onRedoJump) {
  const N = undoStack.length;
  const R = redoStack.length;
  const list = document.createElement('div');
  list.className = 'history-list';

  // Future (redo) items — top, dimmed; redoStack[0]=oldest, [R-1]=most recently undone
  for (let i = 0; i < R; i++) {
    const label = redoStack[i].label ?? 'Draw';
    const el = makeHistoryItem(label, 'future');
    const redosNeeded = R - i;
    el.addEventListener('click', () => onRedoJump(redosNeeded));
    list.appendChild(el);
  }

  // Current state
  const currentLabel = N > 0 ? (undoStack[N - 1].label ?? 'Draw') : 'Open';
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

  container.innerHTML = '';
  container.appendChild(list);
  container.querySelector('.history-item.current')?.scrollIntoView({ block: 'nearest' });
}
