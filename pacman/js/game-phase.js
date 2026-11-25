// Shared phase check for the maze game and Pac-Infinite.
//
// The names are the same. The edges are not: the maze has an intro and a
// win screen, and Pac-Infinite returns to the start menu from game over.
// applyPhase refuses anything absent from the table for that game.

export const PACMAN_PHASES = ['start', 'intro', 'playing', 'paused', 'death', 'game_over', 'win'];

/** Maze (/pacman/). Debug mode skips the intro, so start, death, game over, and win may go straight to playing. */
export const MAZE_EDGES = {
  start: { intro: 'intro', playing: 'playing' },
  intro: { playing: 'playing' },
  playing: { paused: 'paused', death: 'death', win: 'win' },
  paused: { playing: 'playing' },
  death: { intro: 'intro', playing: 'playing', game_over: 'game_over' },
  game_over: { intro: 'intro', playing: 'playing' },
  win: { intro: 'intro', playing: 'playing' }
};

/** Pac-Infinite. Intro and win are names on the shared list and are not used. */
export const INFINITE_EDGES = {
  start: { playing: 'playing' },
  intro: {},
  playing: { paused: 'paused', death: 'death' },
  paused: { playing: 'playing' },
  death: { playing: 'playing', game_over: 'game_over' },
  game_over: { start: 'start' },
  win: {}
};

export function stepPhase(edges, from, to) {
  const row = edges[from];
  const next = row && row[to];
  return next || '';
}

export function applyPhase(host, edges, to) {
  const next = stepPhase(edges, host.state, to);
  if (!next) return false;
  host.state = next;
  return true;
}
