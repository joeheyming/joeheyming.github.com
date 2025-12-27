/**
 * Minesweeper - Main Entry Point
 * Classic Windows-style Minesweeper
 * Part of Joe Heyming's Digital Playground
 */

import { Game } from './modules/game.js';

// Initialize game when DOM is ready
const game = new Game();

document.addEventListener('DOMContentLoaded', () => {
  game.init();
});

// Export game instance for HTML onclick handlers
window.game = game;
