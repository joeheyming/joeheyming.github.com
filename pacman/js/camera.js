/**
 * Camera Controller
 * Handles multiple camera modes like the original game
 * Based on Camera.cpp and Constants.h
 */

import * as THREE from 'three';
import { CAMERA_MODE, CAMERA_MODE_NAMES, CAMERA } from './constants.js';

export class CameraController {
  constructor(camera, scale, levelWidth, levelHeight) {
    this.camera = camera;
    this.scale = scale;
    this.levelWidth = levelWidth;
    this.levelHeight = levelHeight;
    this.currentMode = CAMERA_MODE.BIRDSEYE;

    // Zoom control
    this.zoomPercent = 1.0;
    this.zoomSpeed = CAMERA.ZOOM_SPEED;

    // Calculate level center
    this.levelCenter = new THREE.Vector3((levelWidth * scale) / 2, (levelHeight * scale) / 2, 0);

    // Calculate optimal distance - will be recalculated on resize
    this.updateOptimalDistance();

    // Smooth camera movement
    this.lerpFactor = 0.1;
    this.targetPosition = new THREE.Vector3();
    this.targetLookAt = new THREE.Vector3();
    this.targetUp = new THREE.Vector3(0, 1, 0);

    // For first person mode - track player rotation
    this.playerYaw = 0;
    this.playerPitch = 0;

    // Initialize camera
    this.updateBirdsEye();
    this.camera.position.copy(this.targetPosition);
    this.camera.lookAt(this.targetLookAt);
  }

  /**
   * Calculate optimal camera distance to fit entire map in view
   * Accounts for screen aspect ratio - on portrait screens, width is limiting factor
   */
  updateOptimalDistance() {
    const aspect = this.camera.aspect || window.innerWidth / window.innerHeight;
    const fovRad = (this.camera.fov * Math.PI) / 180;

    // Calculate the dimensions we need to fit
    const levelWidthUnits = this.levelWidth * this.scale;
    const levelHeightUnits = this.levelHeight * this.scale;

    // Account for viewing angle - the tilted view means we see the map at an angle
    const angleRad = (CAMERA.VIEWING_ANGLE * Math.PI) / 180;
    const effectiveHeight = levelHeightUnits * Math.cos(angleRad);

    // Calculate distance needed to fit height (vertical FOV)
    const distanceForHeight = effectiveHeight / (2 * Math.tan(fovRad / 2));

    // Calculate distance needed to fit width (using horizontal FOV derived from vertical + aspect)
    // Horizontal FOV = 2 * atan(aspect * tan(vFOV/2))
    const hFovRad = 2 * Math.atan(aspect * Math.tan(fovRad / 2));
    const distanceForWidth = levelWidthUnits / (2 * Math.tan(hFovRad / 2));

    // Use the larger distance to ensure entire map fits, plus margin
    this.optimalDistance = Math.max(distanceForHeight, distanceForWidth) + 50;
  }

  setLevelDimensions(width, height, scale) {
    this.levelWidth = width;
    this.levelHeight = height;
    this.scale = scale;
    this.levelCenter.set((width * scale) / 2, (height * scale) / 2, 0);
    this.updateOptimalDistance();
  }

  /**
   * Called when window resizes to recalculate optimal camera distance
   */
  onResize() {
    this.updateOptimalDistance();
  }

  setMode(mode) {
    this.currentMode = mode;
  }

  cycleMode() {
    this.currentMode = (this.currentMode + 1) % 3;
    return this.currentMode;
  }

  getModeName() {
    return CAMERA_MODE_NAMES[this.currentMode];
  }

  update(pacmanPosition, pacmanFacing, pacmanYaw = 0, pacmanPitch = 0) {
    this.playerYaw = pacmanYaw;
    this.playerPitch = pacmanPitch;

    switch (this.currentMode) {
      case CAMERA_MODE.BIRDSEYE:
        this.updateBirdsEye();
        break;
      case CAMERA_MODE.BIRDSEYE_FOLLOW:
        this.updateBirdsEyeFollow(pacmanPosition);
        break;
      case CAMERA_MODE.FPPOV:
        this.updateFirstPerson(pacmanPosition, pacmanFacing);
        break;
    }

    // Smoothly interpolate camera position
    this.camera.position.lerp(this.targetPosition, this.lerpFactor);

    // Update look-at
    this.camera.lookAt(this.targetLookAt);
    this.camera.up.copy(this.targetUp);
  }

  /**
   * BIRDSEYE - Fixed overhead view of entire map
   * From Camera.cpp lines 62-67:
   * - Position at viewingDistance
   * - Rotate by viewingAngle (25 degrees) around X
   * - Center on map
   */
  updateBirdsEye() {
    const distance = this.optimalDistance * this.zoomPercent;
    const angleRad = (CAMERA.VIEWING_ANGLE * Math.PI) / 180;

    // Camera position: behind and above the center, tilted down
    // The camera looks at the center from a tilted angle
    this.targetPosition.set(
      this.levelCenter.x,
      this.levelCenter.y - distance * Math.sin(angleRad),
      distance * Math.cos(angleRad)
    );

    this.targetLookAt.copy(this.levelCenter);
    this.targetUp.set(0, 0, 1); // Z is up in our world
    this.lerpFactor = CAMERA.LERP_BIRDSEYE;
  }

  /**
   * BIRDSEYE_FOLLOW - Overhead view centered on Pacman
   * From Camera.cpp lines 68-73:
   * - Same tilt as BIRDSEYE
   * - Center on Pacman instead of map center
   */
  updateBirdsEyeFollow(pacmanPosition) {
    const distance = (this.optimalDistance * this.zoomPercent) / 2; // Closer zoom
    const angleRad = (CAMERA.VIEWING_ANGLE * Math.PI) / 180;

    // Camera above and behind Pacman at the viewing angle
    this.targetPosition.set(
      pacmanPosition.x,
      pacmanPosition.y - distance * Math.sin(angleRad),
      pacmanPosition.z + distance * Math.cos(angleRad)
    );

    this.targetLookAt.set(pacmanPosition.x, pacmanPosition.y, pacmanPosition.z);
    this.targetUp.set(0, 0, 1);
    this.lerpFactor = CAMERA.LERP_FOLLOW;
  }

  /**
   * FPPOV - First Person Point of View (Doom-style)
   * Camera controlled by mouse look, movement is relative to facing direction
   * W/S = forward/back, A/D = strafe left/right
   */
  updateFirstPerson(pacmanPosition, pacmanFacing) {
    // Camera at Pacman's eye level (slightly above center)
    // Increased height to avoid seeing Pac-Man's mouth geometry
    const eyeHeight = this.scale * 0.7;
    this.targetPosition.set(pacmanPosition.x, pacmanPosition.y, pacmanPosition.z + eyeHeight);

    // Look in the direction Pacman is facing (controlled by mouse)
    // Include pitch for looking up/down
    const lookDistance = 100;
    const pitchRad = (this.playerPitch * Math.PI) / 180;

    // Calculate look direction with pitch
    const horizontalDist = lookDistance * Math.cos(pitchRad);
    const verticalDist = lookDistance * Math.sin(pitchRad);

    const lookX = pacmanPosition.x + pacmanFacing.x * horizontalDist;
    const lookY = pacmanPosition.y + pacmanFacing.y * horizontalDist;
    const lookZ = pacmanPosition.z + eyeHeight + verticalDist;

    this.targetLookAt.set(lookX, lookY, lookZ);
    this.targetUp.set(0, 0, 1);
    this.lerpFactor = CAMERA.LERP_FPS;
  }

  // Zoom control
  zoomIn() {
    this.zoomPercent = Math.max(CAMERA.ZOOM_MIN, this.zoomPercent - this.zoomSpeed);
  }

  zoomOut() {
    this.zoomPercent = Math.min(CAMERA.ZOOM_MAX, this.zoomPercent + this.zoomSpeed);
  }

  zoom(delta) {
    this.zoomPercent = Math.max(
      CAMERA.ZOOM_MIN,
      Math.min(CAMERA.ZOOM_MAX, this.zoomPercent + delta * 0.01)
    );
  }

  // Reset camera to default
  reset() {
    this.zoomPercent = 1.0;
  }
}
