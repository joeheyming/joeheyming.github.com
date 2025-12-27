/**
 * Minimap HUD for First Person mode
 * Shows a radar-style view of the area around the player
 */

import { MINIMAP } from './constants.js';

export class Minimap {
  constructor(canvasId = 'minimap') {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas?.getContext('2d');

    // Minimap settings from constants
    this.viewRadius = MINIMAP.VIEW_RADIUS;
    this.colors = MINIMAP.COLORS;
  }

  /**
   * Update the minimap display
   * @param {Level} level - The game level
   * @param {Pacman} pacman - The player
   * @param {Ghost[]} ghosts - Array of ghosts
   */
  update(level, pacman, ghosts) {
    if (!this.ctx || !level || !pacman) return;

    const ctx = this.ctx;
    const canvas = this.canvas;
    const size = canvas.width;
    const centerX = size / 2;
    const centerY = size / 2;
    const tileSize = size / (this.viewRadius * 2 + 1);

    // Clear canvas
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(0, 0, size, size);

    // Create circular clip
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    // Get player grid position
    const playerPos = pacman.getPosition();
    const playerGridX = level.worldToGrid(playerPos.x);
    const playerGridY = level.worldToGrid(playerPos.y);

    // Draw map tiles
    this.drawTiles(ctx, level, playerGridX, playerGridY, centerX, centerY, tileSize);

    // Draw dots and power pills
    this.drawDots(ctx, level, playerGridX, playerGridY, centerX, centerY, tileSize);
    this.drawPowerPills(ctx, level, playerGridX, playerGridY, centerX, centerY, tileSize);

    // Draw ghosts
    this.drawGhosts(ctx, level, ghosts, playerGridX, playerGridY, centerX, centerY, tileSize);

    // Draw player
    this.drawPlayer(ctx, pacman, centerX, centerY, tileSize);

    ctx.restore(); // Restore from clip
  }

  drawTiles(ctx, level, playerGridX, playerGridY, centerX, centerY, tileSize) {
    for (let dy = -this.viewRadius; dy <= this.viewRadius; dy++) {
      for (let dx = -this.viewRadius; dx <= this.viewRadius; dx++) {
        const mapX = playerGridX + dx;
        const mapY = playerGridY + dy;

        // Calculate screen position (centered on player)
        const screenX = centerX + dx * tileSize;
        const screenY = centerY - dy * tileSize; // Flip Y for screen coords

        // Check if in bounds
        if (mapX >= 0 && mapX < level.width && mapY >= 0 && mapY < level.height) {
          const tile = level.map[mapY][mapX];

          if (tile === 2) {
            ctx.fillStyle = this.colors.wall;
          } else if (tile === 4) {
            ctx.fillStyle = this.colors.teleport;
          } else if (tile === 5) {
            ctx.fillStyle = this.colors.powerPill;
          } else if (tile === 3) {
            ctx.fillStyle = this.colors.ghostHome;
          } else if (tile === 1 || tile === 6) {
            // Floor tiles and pacman start tiles look the same
            ctx.fillStyle = this.colors.floor;
          } else {
            ctx.fillStyle = this.colors.void;
          }
        } else {
          ctx.fillStyle = this.colors.void;
        }

        ctx.fillRect(screenX - tileSize / 2, screenY - tileSize / 2, tileSize, tileSize);
      }
    }
  }

  drawDots(ctx, level, playerGridX, playerGridY, centerX, centerY, tileSize) {
    ctx.fillStyle = this.colors.dot;

    level.dots.forEach((dot) => {
      if (!dot.visible) return; // Skip collected dots

      const dx = dot.userData.x - playerGridX;
      const dy = dot.userData.y - playerGridY;

      // Only draw if within view radius
      if (Math.abs(dx) <= this.viewRadius && Math.abs(dy) <= this.viewRadius) {
        const screenX = centerX + dx * tileSize;
        const screenY = centerY - dy * tileSize;

        // Draw small dot
        ctx.beginPath();
        ctx.arc(screenX, screenY, tileSize / 6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  drawPowerPills(ctx, level, playerGridX, playerGridY, centerX, centerY, tileSize) {
    ctx.fillStyle = this.colors.powerPill;

    level.powerPills.forEach((pill) => {
      if (!pill.visible) return; // Skip collected pills

      const dx = pill.userData.x - playerGridX;
      const dy = pill.userData.y - playerGridY;

      // Only draw if within view radius
      if (Math.abs(dx) <= this.viewRadius && Math.abs(dy) <= this.viewRadius) {
        const screenX = centerX + dx * tileSize;
        const screenY = centerY - dy * tileSize;

        // Draw larger pulsing power pill
        const pulseScale = 1 + Math.sin(Date.now() / 200) * 0.2;
        ctx.beginPath();
        ctx.arc(screenX, screenY, (tileSize / 3) * pulseScale, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  drawGhosts(ctx, level, ghosts, playerGridX, playerGridY, centerX, centerY, tileSize) {
    ghosts.forEach((ghost) => {
      const ghostPos = ghost.getPosition();
      const ghostGridX = level.worldToGrid(ghostPos.x);
      const ghostGridY = level.worldToGrid(ghostPos.y);

      const dx = ghostGridX - playerGridX;
      const dy = ghostGridY - playerGridY;

      // Only draw if within view radius
      if (Math.abs(dx) <= this.viewRadius && Math.abs(dy) <= this.viewRadius) {
        const screenX = centerX + dx * tileSize;
        const screenY = centerY - dy * tileSize;

        // Ghost color - red normally, cyan if scared
        ctx.fillStyle = ghost.isScared() ? this.colors.ghostScared : this.colors.ghost;
        ctx.beginPath();
        ctx.arc(screenX, screenY, tileSize / 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  drawPlayer(ctx, pacman, centerX, centerY, tileSize) {
    ctx.save();
    ctx.translate(centerX, centerY);

    // Rotate based on player yaw (convert to radians, adjust for screen coords)
    const yawRad = (-pacman.getYaw() * Math.PI) / 180;
    ctx.rotate(yawRad);

    // Draw player as yellow triangle pointing forward
    ctx.fillStyle = this.colors.player;
    ctx.beginPath();
    ctx.moveTo(0, -tileSize / 1.5); // Tip
    ctx.lineTo(-tileSize / 3, tileSize / 3);
    ctx.lineTo(tileSize / 3, tileSize / 3);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /**
   * Set the view radius (how many tiles to show around player)
   * @param {number} radius - Number of tiles
   */
  setViewRadius(radius) {
    this.viewRadius = Math.max(3, Math.min(15, radius));
  }
}
