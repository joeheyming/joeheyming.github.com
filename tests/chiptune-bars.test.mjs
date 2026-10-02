import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSong, setBars, songBarCount, visibleBarCount } from '../play/chiptune/model.js';

describe('visibleBarCount', () => {
  it('fits about three bars in a desktop grid', () => {
    assert.equal(visibleBarCount(1007, 35), 3);
  });

  it('shows more bars as the container gets wider', () => {
    const narrow = visibleBarCount(640, 35);
    const wide = visibleBarCount(1400, 35);
    assert.ok(wide > narrow);
    assert.ok(narrow >= 1);
  });

  it('does not invent bars past the end of the song', () => {
    assert.equal(visibleBarCount(1600, 2), 2);
  });

  it('counts every arrangement slot', () => {
    const song = createSong();
    setBars(song, 1);
    song.arrangement = [0, 1, 0, 1, 0];
    assert.equal(songBarCount(song), 5);
  });
});
