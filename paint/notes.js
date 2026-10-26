// Note tool data (PhotoCraft crates/doc/src/analysis.rs Note, engine notes_cmds.rs notes.*):
// sticky notes pinned to the canvas. state.notes is an array of { x, y, author, color, text },
// the icon's top-left in document px; every helper returns a new array. Saved in .paintproj.
// Notes are not pixels; they show over the canvas while the Note tool is active.

/** Photoshop's default note colour (pale yellow, Note::default). */
export const NOTE_COLOR = '#ffff82';

// The note icon in screen px (analysis_ui.rs pointer Tool::Note hit box).
export const NOTE_ICON_W = 16;
export const NOTE_ICON_H = 20;

/** notes.add: a note at (x, y), rounded to whole px. Returns { notes, index }. */
export function addNote(notes, x, y, author = '', color = NOTE_COLOR, text = '') {
  const note = { x: Math.round(x), y: Math.round(y), author, color, text };
  return { notes: [...notes, note], index: notes.length };
}

/** notes.set: patch one note's text, author, colour, or position. */
export function setNote(notes, i, patch) {
  if (i < 0 || i >= notes.length) return notes;
  return notes.map((n, j) => (j === i ? { ...n, ...patch } : n));
}

/** notes.delete for one note. */
export function removeNote(notes, i) {
  return notes.filter((_, j) => j !== i);
}

/** The topmost note whose icon covers (x, y) at `zoom`, or -1. */
export function noteAt(notes, x, y, zoom = 1) {
  const z = Math.max(0.01, zoom || 1);
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (x >= n.x && x <= n.x + NOTE_ICON_W / z && y >= n.y && y <= n.y + NOTE_ICON_H / z) return i;
  }
  return -1;
}

/** The options bar's Notes list label: number, author, and the start of the text. */
export function noteLabel(note, i) {
  const text = note.text.length > 24 ? note.text.slice(0, 24) + '…' : note.text;
  return [`${i + 1}`, note.author, text].filter(Boolean).join(' · ');
}

/** Notes from a .paintproj (older files have none). */
export function normalizeNotes(notes) {
  if (!Array.isArray(notes)) return [];
  const str = (v) => (typeof v === 'string' ? v : '');
  return notes
    .filter((n) => n && Number.isFinite(n.x) && Number.isFinite(n.y))
    .map((n) => ({
      x: n.x,
      y: n.y,
      author: str(n.author),
      color: /^#[0-9a-f]{6}$/i.test(n.color) ? n.color : NOTE_COLOR,
      text: str(n.text)
    }));
}

/** Each note's icon at its top-left in its colour, the selected one outlined in the accent. */
export function drawNoteMarkers(ov, notes, zoom = 1, selected = -1) {
  const px = 1 / (zoom || 1);
  const w = NOTE_ICON_W * px,
    h = NOTE_ICON_H * px;
  ov.save();
  notes.forEach((n, i) => {
    ov.fillStyle = n.color;
    ov.fillRect(n.x, n.y, w, h);
    ov.strokeStyle = i === selected ? '#378ef0' : '#000';
    ov.lineWidth = (i === selected ? 2 : 1) * px;
    ov.strokeRect(n.x, n.y, w, h);
  });
  ov.restore();
}
