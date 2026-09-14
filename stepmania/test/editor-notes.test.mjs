import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toggleNote,
  placeHold,
  removeNote,
  findNoteIndex
} from '../../stepmania-editor/editorNotes.js';

describe('editorNotes', () => {
  it('toggles a tap on and off', () => {
    let notes = [];
    notes = toggleNote(notes, 0, 0, {});
    assert.equal(notes.length, 1);
    notes = toggleNote(notes, 0, 0, {});
    assert.equal(notes.length, 0);
  });

  it('places a hold with duration', () => {
    const notes = placeHold([], 0, 2, 1, 2);
    assert.equal(notes[0][1], 1);
    assert.equal(notes[0][2].Type, 2);
    assert.equal(notes[0][2].Duration, 96);
  });

  it('removes by beat and column', () => {
    let notes = toggleNote([], 1, 2, { Type: 'M' });
    assert.equal(findNoteIndex(notes, 1, 2) >= 0, true);
    notes = removeNote(notes, 1, 2);
    assert.equal(notes.length, 0);
  });
});
