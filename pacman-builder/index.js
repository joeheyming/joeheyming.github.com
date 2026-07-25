import { TILE } from '../pacman/js/constants.js';
import {
  canonicalizeLevelData,
  decodeLevelData,
  encodeLevelData,
  validateLevelData
} from '../pacman/js/level-data.js';

const STORAGE_KEY = 'pacman-builder-draft-v1';
const MIN_SIZE = 5;
const MAX_SIZE = 50;
const HISTORY_LIMIT = 80;
const TELEPORT_COLORS = ['#2de2e6', '#ff70c9', '#ffb84d', '#8d7dff', '#54e37d', '#ff6678'];
const WALKABLE_TILES = new Set([
  TILE.FLOOR,
  TILE.GHOST_HOME,
  TILE.TELEPORT,
  TILE.POWER_PILL,
  TILE.PACMAN_START,
  TILE.FRUIT_SPAWN
]);
const RAMP_DELTAS = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 }
};
const LEVEL_TEMPLATES = {
  level0: 'The familiar arcade layout with tunnels, power pills, and four ghosts.',
  level1: 'A roomy original maze with a classic side tunnel.',
  level2: 'A tighter original maze with longer corridors and sharp turns.',
  level3: 'A lighter two-ghost layout for a more relaxed starting point.',
  level4: 'A dense original maze built for quick direction changes.',
  level5: 'A challenging original maze with narrow escape routes.',
  level6: 'Four compact islands connected by cycling teleports.',
  level7: 'A larger three-island gauntlet with all four ghosts.',
  elevated: 'A two-level starter with an upper platform and a north-facing ramp.'
};

const TILE_OPTIONS = [
  { value: TILE.VOID, label: 'Void / empty space' },
  { value: TILE.FLOOR, label: 'Floor / dot path' },
  { value: TILE.WALL, label: 'Wall' },
  { value: TILE.GHOST_HOME, label: 'Ghost home' },
  { value: TILE.TELEPORT, label: 'Teleport' },
  { value: TILE.POWER_PILL, label: 'Power pill' },
  { value: TILE.PACMAN_START, label: 'Pac-Man start' },
  { value: TILE.FRUIT_SPAWN, label: 'Fruit spawn' }
];
const ELEVATION_OPTIONS = [
  { value: 'ground', label: 'Ground', glyph: '0' },
  { value: 'upper', label: 'Upper', glyph: '1' },
  { value: 'ramp-n', label: 'Ramp north', glyph: '↑' },
  { value: 'ramp-e', label: 'Ramp east', glyph: '→' },
  { value: 'ramp-s', label: 'Ramp south', glyph: '↓' },
  { value: 'ramp-w', label: 'Ramp west', glyph: '←' }
];

const elements = {
  grid: document.querySelector('#grid'),
  palette: document.querySelector('#palette'),
  elevationPalette: document.querySelector('#elevationPalette'),
  tilesTab: document.querySelector('#tilesTab'),
  elevationTab: document.querySelector('#elevationTab'),
  selectedTileLabel: document.querySelector('#selectedTileLabel'),
  templateSelect: document.querySelector('#templateSelect'),
  templateDescription: document.querySelector('#templateDescription'),
  loadTemplateButton: document.querySelector('#loadTemplateButton'),
  widthInput: document.querySelector('#widthInput'),
  heightInput: document.querySelector('#heightInput'),
  ghostCount: document.querySelector('#ghostCount'),
  resizeButton: document.querySelector('#resizeButton'),
  clearButton: document.querySelector('#clearButton'),
  resetButton: document.querySelector('#resetButton'),
  undoButton: document.querySelector('#undoButton'),
  redoButton: document.querySelector('#redoButton'),
  playButton: document.querySelector('#playButton'),
  playtestOverlay: document.querySelector('#playtestOverlay'),
  playtestFrame: document.querySelector('#playtestFrame'),
  exitPlaytestButton: document.querySelector('#exitPlaytestButton'),
  changeViewButton: document.querySelector('#changeViewButton'),
  restartPlaytestButton: document.querySelector('#restartPlaytestButton'),
  addTeleportGroup: document.querySelector('#addTeleportGroup'),
  teleportGroups: document.querySelector('#teleportGroups'),
  teleportControls: document.querySelector('#teleportControls'),
  teleportMode: document.querySelector('#teleportMode'),
  deleteTeleportGroup: document.querySelector('#deleteTeleportGroup'),
  mapSize: document.querySelector('#mapSize'),
  saveState: document.querySelector('#saveState'),
  cursorPosition: document.querySelector('#cursorPosition'),
  validationBadge: document.querySelector('#validationBadge'),
  validationSummary: document.querySelector('#validationSummary'),
  validationList: document.querySelector('#validationList'),
  copyLinkButton: document.querySelector('#copyLinkButton'),
  downloadButton: document.querySelector('#downloadButton'),
  importButton: document.querySelector('#importButton'),
  fileInput: document.querySelector('#fileInput'),
  toast: document.querySelector('#toast')
};

let level = createStarterLevel();
let selectedTile = TILE.FLOOR;
let selectedToolCategory = 'tiles';
let selectedElevation = 'ground';
let selectedTeleportGroup = null;
let undoStack = [];
let redoStack = [];
let painting = false;
let paintSnapshot = null;
let lastPaintedKey = '';
let keyboardCursor = { x: 1, y: 1 };
let saveTimer;
let toastTimer;
let designStarted = false;
let playtestUrl = '';

function createStarterLevel() {
  const width = 11;
  const height = 9;
  const map = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1 ? TILE.WALL : TILE.FLOOR
    )
  );
  map[1][1] = TILE.POWER_PILL;
  map[1][width - 2] = TILE.POWER_PILL;
  map[4][4] = TILE.GHOST_HOME;
  map[4][6] = TILE.GHOST_HOME;
  map[5][5] = TILE.FRUIT_SPAWN;
  map[height - 2][5] = TILE.PACMAN_START;
  return {
    scale: 10,
    numGhosts: 2,
    map,
    heights: Array.from({ length: height }, () => Array(width).fill(0)),
    ramps: [],
    teleports: []
  };
}

function createElevatedStarterLevel() {
  const starter = createStarterLevel();
  for (let y = 2; y <= 5; y++) {
    for (let x = 3; x <= 7; x++) {
      starter.heights[y][x] = 1;
    }
  }
  starter.heights[5][3] = 1;
  starter.ramps.push({ x: 3, y: 6, dir: 'n' });
  return starter;
}

function cloneLevel(value = level) {
  const height = value.map.length;
  const width = value.map[0].length;
  const heights =
    Array.isArray(value.heights) && value.heights.length === height
      ? value.heights.map((row) =>
          Array.from({ length: width }, (_, x) => (row?.[x] === 1 ? 1 : 0))
        )
      : Array.from({ length: height }, () => Array(width).fill(0));
  return {
    scale: value.scale,
    numGhosts: value.numGhosts,
    map: value.map.map((row) => [...row]),
    heights,
    ramps: Array.isArray(value.ramps)
      ? value.ramps.map((ramp) => ({ x: ramp.x, y: ramp.y, dir: ramp.dir }))
      : [],
    teleports: value.teleports.map((group) => ({
      mode: group.mode,
      endpoints: group.endpoints.map((point) => ({ x: point.x, y: point.y }))
    }))
  };
}

function levelFingerprint(value = level) {
  return JSON.stringify(value);
}

function track(action) {
  if (typeof window.trackEvent === 'function') {
    window.trackEvent('pacman_builder_action', 'Pacman Builder', action);
  }
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  toastTimer = window.setTimeout(() => elements.toast.classList.remove('show'), 2600);
}

function commit(previous, action) {
  if (levelFingerprint(previous) === levelFingerprint()) return false;
  undoStack.push(previous);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
  if (!designStarted && action) {
    designStarted = true;
    track('design_started');
  }
  afterChange();
  return true;
}

function changeLevel(mutator, action) {
  const previous = cloneLevel();
  mutator();
  commit(previous, action);
}

function afterChange() {
  if (window.location.hash.startsWith('#level=')) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }
  syncSelection();
  render();
  scheduleAutosave();
}

function updateTemplateDescription() {
  elements.templateDescription.textContent =
    LEVEL_TEMPLATES[elements.templateSelect.value] ||
    'Choose a maze to use as your starting point.';
}

async function loadTemplate() {
  const templateName = elements.templateSelect.value;
  if (!Object.hasOwn(LEVEL_TEMPLATES, templateName)) return;

  const originalLabel = elements.loadTemplateButton.textContent;
  elements.loadTemplateButton.disabled = true;
  elements.loadTemplateButton.textContent = 'Loading…';
  try {
    let template;
    if (templateName === 'elevated') {
      template = createElevatedStarterLevel();
    } else {
      const response = await fetch(`/pacman/levels/${templateName}.json`);
      if (!response.ok) throw new Error(`Template request failed with status ${response.status}.`);
      template = canonicalizeLevelData(await response.json());
    }
    const previous = cloneLevel();
    level = cloneLevel(template);
    selectedTeleportGroup = null;
    keyboardCursor = { x: 1, y: 1 };
    if (!commit(previous, `load_template:${templateName}`)) render();
    track(`template_loaded:${templateName}`);
    showToast('Template loaded. Every tile is ready to edit.');
  } catch (error) {
    console.error('Could not load Pac-Man template:', error);
    showToast('That template could not be loaded. Please try again.');
  } finally {
    elements.loadTemplateButton.disabled = false;
    elements.loadTemplateButton.textContent = originalLabel;
  }
}

function syncSelection() {
  if (selectedTeleportGroup !== null && !level.teleports[selectedTeleportGroup]) {
    selectedTeleportGroup = level.teleports.length > 0 ? level.teleports.length - 1 : null;
  }
}

function scheduleAutosave() {
  window.clearTimeout(saveTimer);
  elements.saveState.textContent = 'Saving…';
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(level));
      elements.saveState.textContent = 'Draft saved locally';
    } catch {
      elements.saveState.textContent = 'Could not autosave';
    }
  }, 250);
}

function restoreDraft() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return false;
    const draft = JSON.parse(stored);
    const width = Array.isArray(draft?.map?.[0]) ? draft.map[0].length : 0;
    const hasValidShape =
      width > 0 &&
      draft.map.every((row) => Array.isArray(row) && row.length === width) &&
      Array.isArray(draft.teleports) &&
      draft.teleports.every(
        (group) =>
          group &&
          (group.mode === 'pair' || group.mode === 'next') &&
          Array.isArray(group.endpoints)
      );
    if (!hasValidShape) return false;
    level = cloneLevel(draft);
    return true;
  } catch {
    showToast('The saved draft could not be read.');
    return false;
  }
}

function loadHashLevel() {
  const match = window.location.hash.match(/^#level=([A-Za-z0-9_-]+)$/u);
  if (!match) return false;
  try {
    level = decodeLevelData(match[1]);
    showToast('Shared level loaded.');
    track('load_share_link');
    return true;
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'The shared level could not be loaded.');
    return false;
  }
}

function renderPalette() {
  elements.palette.replaceChildren(
    ...TILE_OPTIONS.map((option) => {
      const button = document.createElement('button');
      const swatch = document.createElement('span');
      const label = document.createElement('span');
      button.type = 'button';
      button.className = 'tile-button';
      button.dataset.tile = String(option.value);
      button.setAttribute('aria-pressed', String(selectedTile === option.value));
      button.setAttribute('aria-label', `Paint ${option.label}`);
      swatch.className = 'tile-swatch';
      swatch.dataset.tile = String(option.value);
      swatch.setAttribute('aria-hidden', 'true');
      label.textContent = option.label;
      button.append(swatch, label);
      button.addEventListener('click', () => selectTile(option.value));
      return button;
    })
  );
  elements.elevationPalette.replaceChildren(
    ...ELEVATION_OPTIONS.map((option) => {
      const button = document.createElement('button');
      const swatch = document.createElement('span');
      const label = document.createElement('span');
      button.type = 'button';
      button.className = 'tile-button elevation-button';
      button.dataset.elevation = option.value;
      button.setAttribute('aria-pressed', String(selectedElevation === option.value));
      button.setAttribute('aria-label', `Paint ${option.label}`);
      swatch.className = 'elevation-swatch';
      swatch.dataset.elevation = option.value;
      swatch.setAttribute('aria-hidden', 'true');
      swatch.textContent = option.glyph;
      label.textContent = option.label;
      button.append(swatch, label);
      button.addEventListener('click', () => selectElevation(option.value));
      return button;
    })
  );
  const tilesSelected = selectedToolCategory === 'tiles';
  elements.tilesTab.classList.toggle('active', tilesSelected);
  elements.elevationTab.classList.toggle('active', !tilesSelected);
  elements.tilesTab.setAttribute('aria-selected', String(tilesSelected));
  elements.elevationTab.setAttribute('aria-selected', String(!tilesSelected));
  elements.palette.hidden = !tilesSelected;
  elements.elevationPalette.hidden = tilesSelected;
}

function selectTile(tile) {
  selectedToolCategory = 'tiles';
  selectedTile = tile;
  const option = TILE_OPTIONS.find((item) => item.value === tile);
  elements.selectedTileLabel.textContent = option?.label || 'Tile';
  renderPalette();
  if (tile === TILE.TELEPORT && selectedTeleportGroup === null) {
    showToast('Create or select a teleport group before painting endpoints.');
  }
}

function selectElevation(tool) {
  selectedToolCategory = 'elevation';
  selectedElevation = tool;
  const option = ELEVATION_OPTIONS.find((item) => item.value === tool);
  elements.selectedTileLabel.textContent = option?.label || 'Elevation';
  renderPalette();
}

function selectToolCategory(category) {
  selectedToolCategory = category;
  if (category === 'tiles') {
    const option = TILE_OPTIONS.find((item) => item.value === selectedTile);
    elements.selectedTileLabel.textContent = option?.label || 'Tile';
  } else {
    const option = ELEVATION_OPTIONS.find((item) => item.value === selectedElevation);
    elements.selectedTileLabel.textContent = option?.label || 'Elevation';
  }
  renderPalette();
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function teleportGroupAt(x, y) {
  return level.teleports.findIndex((group) =>
    group.endpoints.some((point) => point.x === x && point.y === y)
  );
}

function rampDestination(ramp) {
  const delta = RAMP_DELTAS[ramp.dir];
  return delta ? { x: ramp.x + delta.x, y: ramp.y + delta.y } : null;
}

function rampAtOrigin(x, y) {
  return level.ramps.find((ramp) => ramp.x === x && ramp.y === y);
}

function removeRampsTouching(...points) {
  const pointKeys = new Set(points.map(pointKey));
  const previousLength = level.ramps.length;
  level.ramps = level.ramps.filter((ramp) => {
    const destination = rampDestination(ramp);
    return (
      !pointKeys.has(pointKey(ramp)) && (!destination || !pointKeys.has(pointKey(destination)))
    );
  });
  return level.ramps.length !== previousLength;
}

function renderGrid() {
  const height = level.map.length;
  const width = level.map[0].length;
  const fragment = document.createDocumentFragment();
  elements.grid.style.setProperty('--columns', width);
  elements.grid.style.setProperty('--rows', height);

  level.map.forEach((row, y) => {
    row.forEach((tile, x) => {
      const cell = document.createElement('div');
      const groupIndex = tile === TILE.TELEPORT ? teleportGroupAt(x, y) : -1;
      const tileName = TILE_OPTIONS.find((option) => option.value === tile)?.label || 'Unknown';
      const cellHeight = level.heights[y][x];
      const ramp = rampAtOrigin(x, y);
      const elevationName = cellHeight === 1 ? 'upper level' : 'ground level';
      cell.className = 'cell';
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      cell.dataset.tile = String(tile);
      cell.dataset.height = String(cellHeight);
      if (cellHeight === 1) cell.classList.add('is-upper');
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute(
        'aria-label',
        `Column ${x + 1}, row ${y + 1}: ${tileName}, ${elevationName}${
          ramp ? `, ramp ${ramp.dir}` : ''
        }`
      );
      if (cellHeight === 1) {
        const marker = document.createElement('span');
        marker.className = 'upper-marker';
        marker.setAttribute('aria-hidden', 'true');
        marker.textContent = '▲';
        cell.append(marker);
      }
      if (ramp) {
        const marker = document.createElement('span');
        marker.className = 'ramp-marker';
        marker.dataset.direction = ramp.dir;
        marker.setAttribute('aria-hidden', 'true');
        marker.textContent = ELEVATION_OPTIONS.find(
          (option) => option.value === `ramp-${ramp.dir}`
        )?.glyph;
        cell.dataset.rampDir = ramp.dir;
        cell.append(marker);
      }
      if (groupIndex >= 0) {
        cell.style.setProperty(
          '--teleport-color',
          TELEPORT_COLORS[groupIndex % TELEPORT_COLORS.length]
        );
        cell.dataset.activeGroup = String(groupIndex === selectedTeleportGroup);
      }
      fragment.append(cell);
    });
  });
  elements.grid.replaceChildren(fragment);
}

function renderTeleportGroups() {
  const children = level.teleports.map((group, index) => {
    const button = document.createElement('button');
    const name = document.createElement('span');
    const count = document.createElement('b');
    button.type = 'button';
    button.className = 'teleport-group';
    button.setAttribute('aria-pressed', String(index === selectedTeleportGroup));
    button.style.borderLeftColor = TELEPORT_COLORS[index % TELEPORT_COLORS.length];
    name.textContent = `Group ${index + 1} · ${group.mode === 'pair' ? 'Pair' : 'Cycle'}`;
    count.textContent = `${group.endpoints.length} endpoint${
      group.endpoints.length === 1 ? '' : 's'
    }`;
    button.append(name, count);
    button.addEventListener('click', () => {
      selectedTeleportGroup = index;
      selectedToolCategory = 'tiles';
      selectedTile = TILE.TELEPORT;
      render();
    });
    return button;
  });
  elements.teleportGroups.replaceChildren(...children);
  const hasSelection = selectedTeleportGroup !== null && level.teleports[selectedTeleportGroup];
  elements.teleportControls.hidden = !hasSelection;
  if (hasSelection) elements.teleportMode.value = level.teleports[selectedTeleportGroup].mode;
}

function renderValidation() {
  const result = validateLevelData(level);
  const hasErrors = result.errors.length > 0;
  elements.validationBadge.className = `badge ${hasErrors ? 'invalid' : 'valid'}`;
  elements.validationBadge.textContent = hasErrors ? `${result.errors.length} error(s)` : 'Ready';
  elements.validationSummary.textContent = hasErrors
    ? 'Fix the errors below before sharing or playing.'
    : result.warnings.length > 0
    ? 'Playable, with a few suggestions.'
    : 'Everything looks good. Your maze is ready to play.';
  elements.validationList.replaceChildren(
    ...[...result.errors, ...result.warnings].map((item, index) => {
      const entry = document.createElement('li');
      const isWarning = index >= result.errors.length;
      entry.className = isWarning ? 'warning' : '';
      entry.textContent = `${isWarning ? 'Suggestion' : 'Error'}: ${item.message}`;
      return entry;
    })
  );
  elements.playButton.disabled = hasErrors;
  elements.copyLinkButton.disabled = hasErrors;
  elements.downloadButton.disabled = hasErrors;
}

function render() {
  const height = level.map.length;
  const width = level.map[0].length;
  elements.widthInput.value = String(width);
  elements.heightInput.value = String(height);
  elements.ghostCount.value = String(level.numGhosts);
  elements.mapSize.textContent = `${width} × ${height}`;
  elements.undoButton.disabled = undoStack.length === 0;
  elements.redoButton.disabled = redoStack.length === 0;
  renderPalette();
  renderGrid();
  renderTeleportGroups();
  renderValidation();
}

function removePointFromGroups(x, y, exceptGroup = null) {
  level.teleports.forEach((group, index) => {
    if (index !== exceptGroup) {
      group.endpoints = group.endpoints.filter((point) => point.x !== x || point.y !== y);
    }
  });
}

function paintElevation(x, y) {
  if (!level.map[y] || level.map[y][x] === undefined) return false;
  const point = { x, y };

  if (selectedElevation === 'ground') {
    const heightChanged = level.heights[y][x] !== 0;
    const rampsChanged = removeRampsTouching(point);
    level.heights[y][x] = 0;
    return heightChanged || rampsChanged;
  }

  if (selectedElevation === 'upper') {
    if (!WALKABLE_TILES.has(level.map[y][x])) {
      showToast('Upper elevation can only be painted on walkable tiles.');
      return false;
    }
    const heightChanged = level.heights[y][x] !== 1;
    const rampsChanged = removeRampsTouching(point);
    level.heights[y][x] = 1;
    return heightChanged || rampsChanged;
  }

  const direction = selectedElevation.replace('ramp-', '');
  const delta = RAMP_DELTAS[direction];
  if (!delta) return false;
  const destination = { x: x + delta.x, y: y + delta.y };
  if (
    !level.map[destination.y] ||
    level.map[destination.y][destination.x] === undefined ||
    !WALKABLE_TILES.has(level.map[y][x]) ||
    !WALKABLE_TILES.has(level.map[destination.y][destination.x])
  ) {
    showToast('A ramp needs two adjacent walkable tiles.');
    return false;
  }

  removeRampsTouching(point, destination);
  level.heights[y][x] = 0;
  level.heights[destination.y][destination.x] = 1;
  level.ramps.push({ x, y, dir: direction });
  return true;
}

function paintTile(x, y) {
  if (!level.map[y] || level.map[y][x] === undefined) return false;
  if (selectedToolCategory === 'elevation') return paintElevation(x, y);
  const oldTile = level.map[y][x];

  if (selectedTile === TILE.TELEPORT) {
    if (selectedTeleportGroup === null || !level.teleports[selectedTeleportGroup]) {
      showToast('Create or select a teleport group first.');
      return false;
    }
    const group = level.teleports[selectedTeleportGroup];
    if (group.endpoints.some((point) => point.x === x && point.y === y)) return false;
    if (group.mode === 'pair' && group.endpoints.length >= 2) {
      showToast('Pair groups can only have two endpoints.');
      return false;
    }
    removePointFromGroups(x, y, selectedTeleportGroup);
    group.endpoints.push({ x, y });
    level.map[y][x] = TILE.TELEPORT;
    return true;
  }

  if (oldTile === selectedTile) {
    if (selectedTile !== TILE.WALL && selectedTile !== TILE.VOID) return false;
    const heightChanged = level.heights[y][x] !== 0;
    const rampsChanged = removeRampsTouching({ x, y });
    level.heights[y][x] = 0;
    return heightChanged || rampsChanged;
  }
  if (selectedTile === TILE.PACMAN_START || selectedTile === TILE.FRUIT_SPAWN) {
    level.map.forEach((row, rowIndex) => {
      row.forEach((tile, columnIndex) => {
        if (tile === selectedTile) level.map[rowIndex][columnIndex] = TILE.FLOOR;
      });
    });
  }
  if (oldTile === TILE.TELEPORT) removePointFromGroups(x, y);
  level.map[y][x] = selectedTile;
  if (selectedTile === TILE.WALL || selectedTile === TILE.VOID) {
    level.heights[y][x] = 0;
    removeRampsTouching({ x, y });
  }
  return true;
}

function cellFromPointer(event) {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const cell = target?.closest('.cell');
  if (!cell || !elements.grid.contains(cell)) return null;
  return { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
}

function paintFromPointer(event) {
  const point = cellFromPointer(event);
  if (!point) return;
  const key = pointKey(point);
  if (key === lastPaintedKey) return;
  lastPaintedKey = key;
  if (paintTile(point.x, point.y)) {
    renderGrid();
    renderTeleportGroups();
    renderValidation();
  }
  elements.cursorPosition.textContent = `Column ${point.x + 1}, row ${point.y + 1}`;
}

function beginPainting(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  painting = true;
  lastPaintedKey = '';
  paintSnapshot = cloneLevel();
  elements.grid.setPointerCapture(event.pointerId);
  paintFromPointer(event);
}

function finishPainting(event) {
  if (!painting) return;
  painting = false;
  lastPaintedKey = '';
  if (elements.grid.hasPointerCapture(event.pointerId)) {
    elements.grid.releasePointerCapture(event.pointerId);
  }
  if (paintSnapshot) commit(paintSnapshot, 'paint');
  paintSnapshot = null;
}

function resizeMap() {
  const width = Math.max(
    MIN_SIZE,
    Math.min(MAX_SIZE, Number.parseInt(elements.widthInput.value, 10) || level.map[0].length)
  );
  const height = Math.max(
    MIN_SIZE,
    Math.min(MAX_SIZE, Number.parseInt(elements.heightInput.value, 10) || level.map.length)
  );
  if (width === level.map[0].length && height === level.map.length) return;
  changeLevel(() => {
    const nextMap = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => level.map[y]?.[x] ?? TILE.VOID)
    );
    const nextHeights = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => level.heights[y]?.[x] ?? 0)
    );
    level.map = nextMap;
    level.heights = nextHeights;
    level.ramps = level.ramps.filter((ramp) => {
      const destination = rampDestination(ramp);
      return (
        ramp.x < width &&
        ramp.y < height &&
        destination &&
        destination.x >= 0 &&
        destination.x < width &&
        destination.y >= 0 &&
        destination.y < height
      );
    });
    level.teleports.forEach((group) => {
      group.endpoints = group.endpoints.filter((point) => point.x < width && point.y < height);
    });
  }, 'resize');
  showToast(`Map resized to ${width} × ${height}.`);
}

function clearMap() {
  changeLevel(() => {
    level.map = level.map.map((row) => row.map(() => TILE.VOID));
    level.heights = level.heights.map((row) => row.map(() => 0));
    level.ramps = [];
    level.teleports = [];
    selectedTeleportGroup = null;
  }, 'clear');
  showToast('Map cleared. Add a Pac-Man start when you are ready.');
}

function resetMap() {
  const previous = cloneLevel();
  level = createStarterLevel();
  selectedTeleportGroup = null;
  commit(previous, 'reset');
  showToast('Starter map restored.');
}

function undo() {
  const previous = undoStack.pop();
  if (!previous) return;
  redoStack.push(cloneLevel());
  level = previous;
  afterChange();
}

function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(cloneLevel());
  level = next;
  afterChange();
}

function addTeleportGroup() {
  changeLevel(() => {
    level.teleports.push({ mode: 'pair', endpoints: [] });
    selectedTeleportGroup = level.teleports.length - 1;
    selectedToolCategory = 'tiles';
    selectedTile = TILE.TELEPORT;
  }, 'add_teleport_group');
  showToast('Teleport group added. Paint two endpoints.');
}

function deleteTeleportGroup() {
  if (selectedTeleportGroup === null) return;
  changeLevel(() => {
    const [removed] = level.teleports.splice(selectedTeleportGroup, 1);
    removed.endpoints.forEach(({ x, y }) => {
      if (level.map[y]?.[x] === TILE.TELEPORT) level.map[y][x] = TILE.FLOOR;
    });
    selectedTeleportGroup =
      level.teleports.length === 0
        ? null
        : Math.min(selectedTeleportGroup, level.teleports.length - 1);
  }, 'delete_teleport_group');
  showToast('Teleport group deleted.');
}

function changeTeleportMode() {
  if (selectedTeleportGroup === null) return;
  changeLevel(() => {
    const group = level.teleports[selectedTeleportGroup];
    group.mode = elements.teleportMode.value === 'next' ? 'next' : 'pair';
    if (group.mode === 'pair' && group.endpoints.length > 2) {
      const removed = group.endpoints.splice(2);
      removed.forEach(({ x, y }) => {
        if (level.map[y]?.[x] === TILE.TELEPORT) level.map[y][x] = TILE.FLOOR;
      });
      showToast('Extra cycle endpoints were changed back to floor.');
    }
  }, 'change_teleport_mode');
}

function getCanonicalLevel() {
  const validation = validateLevelData(level);
  if (validation.errors.length > 0) {
    track(`validation_failure:${validation.errors[0].code}`);
    showToast('Fix validation errors first.');
    return null;
  }
  return canonicalizeLevelData(level);
}

async function copyShareLink() {
  const canonical = getCanonicalLevel();
  if (!canonical) return;
  const code = encodeLevelData(canonical);
  const url = `${window.location.origin}${window.location.pathname}#level=${code}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const input = document.createElement('textarea');
    input.value = url;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  window.history.replaceState(null, '', `#level=${code}`);
  track('copy_share_link');
  showToast('Share link copied.');
}

function downloadJson() {
  const canonical = getCanonicalLevel();
  if (!canonical) return;
  const blob = new Blob([`${JSON.stringify(canonical, null, 2)}\n`], {
    type: 'application/json'
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'pacman-custom-level.json';
  link.click();
  URL.revokeObjectURL(link.href);
  track('download_json');
  showToast('Level JSON downloaded.');
}

async function importJson(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const canonical = canonicalizeLevelData(parsed);
    const previous = cloneLevel();
    level = canonical;
    selectedTeleportGroup = null;
    commit(previous, 'import_json');
    track('import_json');
    showToast('Level imported.');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'That JSON file is not a valid level.');
  } finally {
    elements.fileInput.value = '';
  }
}

function openPlaytest() {
  const canonical = getCanonicalLevel();
  if (!canonical) return;
  playtestUrl = `/pacman/?custom=${encodeLevelData(canonical)}&debug=true&autostart=true`;
  elements.playtestFrame.src = playtestUrl;
  elements.playtestOverlay.hidden = false;
  document.body.classList.add('playtesting');
  elements.exitPlaytestButton.focus();
  track('playtest_start');
}

function closePlaytest() {
  if (elements.playtestOverlay.hidden) return;
  elements.playtestOverlay.hidden = true;
  elements.playtestFrame.src = 'about:blank';
  document.body.classList.remove('playtesting');
  elements.playButton.focus();
  track('playtest_exit');
}

function restartPlaytest() {
  if (!playtestUrl) return;
  elements.playtestFrame.src = 'about:blank';
  window.requestAnimationFrame(() => {
    elements.playtestFrame.src = playtestUrl;
  });
  track('playtest_restart');
}

function changePlaytestView() {
  const playtestWindow = elements.playtestFrame.contentWindow;
  const game = playtestWindow ? Reflect.get(playtestWindow, 'game') : null;
  if (!game?.controls) {
    showToast('The playtest is still loading.');
    return;
  }
  game.controls.cycleCamera();
  track('playtest_change_view');
}

function handleGridKeyboard(event) {
  const width = level.map[0].length;
  const height = level.map.length;
  const moves = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  };
  if (moves[event.key]) {
    event.preventDefault();
    keyboardCursor.x = Math.max(0, Math.min(width - 1, keyboardCursor.x + moves[event.key][0]));
    keyboardCursor.y = Math.max(0, Math.min(height - 1, keyboardCursor.y + moves[event.key][1]));
    elements.cursorPosition.textContent = `Column ${keyboardCursor.x + 1}, row ${
      keyboardCursor.y + 1
    }`;
  } else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    changeLevel(() => paintTile(keyboardCursor.x, keyboardCursor.y), 'keyboard_paint');
  }
}

function handleShortcut(event) {
  if (event.key === 'Escape' && !elements.playtestOverlay.hidden) {
    event.preventDefault();
    closePlaytest();
    return;
  }
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
  event.preventDefault();
  if (event.shiftKey) redo();
  else undo();
}

function bindEvents() {
  elements.templateSelect.addEventListener('change', updateTemplateDescription);
  elements.loadTemplateButton.addEventListener('click', loadTemplate);
  elements.tilesTab.addEventListener('click', () => selectToolCategory('tiles'));
  elements.elevationTab.addEventListener('click', () => selectToolCategory('elevation'));
  elements.grid.addEventListener('pointerdown', beginPainting);
  elements.grid.addEventListener('pointermove', (event) => {
    const point = cellFromPointer(event);
    if (point) {
      elements.cursorPosition.textContent = `Column ${point.x + 1}, row ${point.y + 1}`;
    }
    if (painting) paintFromPointer(event);
  });
  elements.grid.addEventListener('pointerup', finishPainting);
  elements.grid.addEventListener('pointercancel', finishPainting);
  elements.grid.addEventListener('keydown', handleGridKeyboard);
  elements.resizeButton.addEventListener('click', resizeMap);
  elements.clearButton.addEventListener('click', clearMap);
  elements.resetButton.addEventListener('click', resetMap);
  elements.undoButton.addEventListener('click', undo);
  elements.redoButton.addEventListener('click', redo);
  elements.playButton.addEventListener('click', openPlaytest);
  elements.exitPlaytestButton.addEventListener('click', closePlaytest);
  elements.changeViewButton.addEventListener('click', changePlaytestView);
  elements.restartPlaytestButton.addEventListener('click', restartPlaytest);
  elements.addTeleportGroup.addEventListener('click', addTeleportGroup);
  elements.deleteTeleportGroup.addEventListener('click', deleteTeleportGroup);
  elements.teleportMode.addEventListener('change', changeTeleportMode);
  elements.ghostCount.addEventListener('change', () => {
    changeLevel(() => {
      level.numGhosts = Math.max(0, Math.min(4, Number(elements.ghostCount.value)));
    }, 'change_ghost_count');
  });
  elements.copyLinkButton.addEventListener('click', copyShareLink);
  elements.downloadButton.addEventListener('click', downloadJson);
  elements.importButton.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', () => importJson(elements.fileInput.files?.[0]));
  window.addEventListener('keydown', handleShortcut);
}

function initialize() {
  const loadedFromHash = loadHashLevel();
  if (!loadedFromHash) restoreDraft();
  bindEvents();
  render();
  scheduleAutosave();
  track('opened');
}

initialize();
