const viewport = document.querySelector('#achievement-tree');
const plane = document.querySelector('#tree-plane');
const nodeLayer = document.querySelector('#tree-nodes');
const connectorLayer = document.querySelector('#tree-connectors');
const regionLayer = document.querySelector('#app-regions');
const statusMessage = document.querySelector('#tree-status');
const resetButton = document.querySelector('#reset-view');
const progressCount = document.querySelector('#progress-count');
const progressFill = document.querySelector('#progress-fill');
const progressPercent = document.querySelector('#progress-percent');
const progressBar = document.querySelector('.progress-track');
const hoverCard = document.querySelector('#achievement-hover-card');
const hoverCardState = document.querySelector('#hover-card-state');
const hoverCardIcon = document.querySelector('#hover-card-icon');
const hoverCardApp = document.querySelector('#hover-card-app');
const hoverCardTitle = document.querySelector('#hover-card-title');
const hoverCardDescription = document.querySelector('#hover-card-description');
const hoverCardRequirement = document.querySelector('#hover-card-requirement');

const NODE_SIZE = 64;
const WORLD_PADDING = 120;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.4;
const APP_COLORS = ['#7ebc5a', '#d3a94d', '#6ba5bd', '#aa78bc', '#bf765c', '#7f91ce'];

let achievements = [];
let achievementById = new Map();
let unlockedIds = new Set();
let focusedId = null;
let activeCardNode = null;
let hasInspectedNode = false;
const inspectedNodeIds = new Set();
let worldWidth = 1;
let worldHeight = 1;
let transform = { x: 0, y: 0, scale: 1 };
let panState = null;

function achievementApi() {
  return window.heymingAchievements;
}

function normalizeUnlocked(value) {
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return new Set(value);
  if (value && typeof value === 'object') {
    return new Set(Object.keys(value).filter((id) => Boolean(value[id])));
  }
  return new Set();
}

function appLabel(appId) {
  return appId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function setTransform() {
  plane.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  positionHoverCard(activeCardNode);
}

function resetView() {
  if (!achievements.length) return;

  const availableWidth = Math.max(1, viewport.clientWidth - 72);
  const availableHeight = Math.max(1, viewport.clientHeight - 72);
  const fitScale = Math.min(availableWidth / worldWidth, availableHeight / worldHeight, 1.15);

  transform.scale = Math.max(MIN_ZOOM, fitScale);
  transform.x = (viewport.clientWidth - worldWidth * transform.scale) / 2;
  transform.y = (viewport.clientHeight - worldHeight * transform.scale) / 2;
  setTransform();
}

function createConnector(from, to, stateClass = '') {
  const namespace = 'http://www.w3.org/2000/svg';
  const middleY = from.viewY + (to.viewY - from.viewY) / 2;
  const pathData = `M ${from.viewX} ${from.viewY} V ${middleY} H ${to.viewX} V ${to.viewY}`;

  const shadow = document.createElementNS(namespace, 'path');
  shadow.setAttribute('d', pathData);
  shadow.setAttribute('class', 'connector-shadow');

  const connector = document.createElementNS(namespace, 'path');
  connector.setAttribute('d', pathData);
  connector.setAttribute('class', `connector${stateClass ? ` ${stateClass}` : ''}`);
  connector.dataset.fromId = from.id;
  connector.dataset.toId = to.id;

  connectorLayer.append(shadow, connector);
}

function renderRegions() {
  const groups = new Map();

  achievements.forEach((achievement) => {
    const group = groups.get(achievement.appId) || [];
    group.push(achievement);
    groups.set(achievement.appId, group);
  });

  [...groups.entries()].forEach(([appId, group], index) => {
    const xs = group.map((achievement) => achievement.viewX);
    const ys = group.map((achievement) => achievement.viewY);
    const left = Math.min(...xs) - 76;
    const top = Math.min(...ys) - 66;
    const right = Math.max(...xs) + 76;
    const bottom = Math.max(...ys) + 66;
    const region = document.createElement('div');
    const label = document.createElement('span');

    region.className = 'app-region';
    region.style.left = `${left}px`;
    region.style.top = `${top}px`;
    region.style.width = `${right - left}px`;
    region.style.height = `${bottom - top}px`;
    region.style.setProperty('--region-color', APP_COLORS[index % APP_COLORS.length]);
    label.textContent = appLabel(appId);
    region.append(label);
    regionLayer.append(region);
  });
}

function track(eventName, label, value) {
  if (typeof window.trackEvent === 'function') {
    window.trackEvent(eventName, 'Achievements', label, value);
  }
}

function positionHoverCard(node) {
  if (!node || hoverCard.hidden) return;

  const viewportRect = viewport.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const gutter = 12;
  const cardWidth = hoverCard.offsetWidth;
  const cardHeight = hoverCard.offsetHeight;
  let left = nodeRect.right - viewportRect.left + gutter;

  if (left + cardWidth > viewportRect.width - gutter) {
    left = nodeRect.left - viewportRect.left - cardWidth - gutter;
  }

  left = Math.max(gutter, Math.min(left, viewportRect.width - cardWidth - gutter));
  const centeredTop = nodeRect.top - viewportRect.top + nodeRect.height / 2 - cardHeight / 2;
  const top = Math.max(gutter, Math.min(centeredTop, viewportRect.height - cardHeight - gutter));

  hoverCard.style.left = `${left}px`;
  hoverCard.style.top = `${top}px`;
}

function updateHoverCard(achievement) {
  const unlocked = unlockedIds.has(achievement.id);
  const prerequisite = achievement.requiresId ? achievementById.get(achievement.requiresId) : null;
  const prerequisiteMet = !achievement.requiresId || unlockedIds.has(achievement.requiresId);
  const available = !unlocked && achievement.tier === 2 && prerequisiteMet;

  if (unlocked) {
    hoverCardState.textContent = 'Achievement unlocked';
    hoverCardState.className = 'hover-card-state is-unlocked';
  } else if (available) {
    hoverCardState.textContent = 'Challenge available';
    hoverCardState.className = 'hover-card-state is-available';
  } else if (achievement.requiresId) {
    hoverCardState.textContent = 'Level 1 required';
    hoverCardState.className = 'hover-card-state is-locked';
  } else {
    hoverCardState.textContent = 'Achievement locked';
    hoverCardState.className = 'hover-card-state is-locked';
  }

  hoverCardIcon.textContent = achievement.icon;
  hoverCardApp.textContent = appLabel(achievement.appId);
  hoverCardTitle.textContent = achievement.title;
  hoverCardDescription.textContent = achievement.description;
  hoverCardRequirement.hidden = !prerequisite;
  if (prerequisite) {
    hoverCardRequirement.textContent = unlocked
      ? `Unlocked after: ${prerequisite.title}`
      : prerequisiteMet
      ? `Level 1 complete: ${prerequisite.title}`
      : `Requires: ${prerequisite.title}`;
  }
}

function showHoverCard(achievement, node) {
  activeCardNode = node;

  if (!inspectedNodeIds.has(achievement.id)) {
    inspectedNodeIds.add(achievement.id);
    track('achievement_node_inspected', achievement.id);
  }

  if (!hasInspectedNode) {
    hasInspectedNode = true;
    Promise.resolve(achievementApi()?.unlockForCurrentApp('first-action'))
      .then(refreshUnlocked)
      .catch(() => {});
  }

  updateHoverCard(achievement);
  hoverCard.hidden = false;
  positionHoverCard(node);
}

function hideHoverCard(node) {
  if (activeCardNode !== node || document.activeElement === node || node.matches(':hover')) {
    return;
  }

  hoverCard.hidden = true;
  activeCardNode = null;
}

function renderProgress() {
  const unlockedCount = achievements.filter((achievement) =>
    unlockedIds.has(achievement.id)
  ).length;
  const total = achievements.length;
  const percent = total ? Math.round((unlockedCount / total) * 100) : 0;

  progressCount.textContent = `${unlockedCount} / ${total}`;
  progressFill.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;
  progressBar.setAttribute('aria-valuemax', String(total));
  progressBar.setAttribute('aria-valuenow', String(unlockedCount));
  progressBar.setAttribute('aria-valuetext', `${unlockedCount} of ${total} unlocked`);
}

function renderUnlockState() {
  achievements.forEach((achievement) => {
    const node = document.querySelector(`[data-achievement-id="${CSS.escape(achievement.id)}"]`);
    const unlocked = unlockedIds.has(achievement.id);
    const available =
      !unlocked &&
      achievement.tier === 2 &&
      Boolean(achievement.requiresId && unlockedIds.has(achievement.requiresId));
    const stateLabel = unlocked ? 'unlocked' : available ? 'available' : 'locked';
    node?.classList.toggle('is-unlocked', unlocked);
    node?.classList.toggle('is-available', available);
    node?.setAttribute(
      'aria-label',
      `${achievement.title}, ${stateLabel}. ${achievement.description}`
    );
  });

  connectorLayer.replaceChildren();
  achievements.forEach((achievement) => {
    const parent = achievement.parentId ? achievementById.get(achievement.parentId) : undefined;
    if (parent) {
      const unlocked = unlockedIds.has(achievement.id);
      const available =
        !unlocked &&
        achievement.tier === 2 &&
        Boolean(achievement.requiresId && unlockedIds.has(achievement.requiresId));
      createConnector(
        parent,
        achievement,
        unlockedIds.has(parent.id) && unlocked ? 'is-unlocked' : available ? 'is-available' : ''
      );
    }
  });

  renderProgress();
  if (activeCardNode) {
    const active = achievementById.get(activeCardNode.dataset.achievementId);
    if (active) {
      updateHoverCard(active);
      positionHoverCard(activeCardNode);
    }
  }
}

async function refreshUnlocked() {
  const api = achievementApi();
  if (!api) return;

  unlockedIds = normalizeUnlocked(await Promise.resolve(api.getUnlocked()));
  renderUnlockState();
}

function directionalNeighbor(current, key) {
  const directions = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }
  };
  const direction = directions[key];
  let best = null;
  let bestScore = Infinity;

  achievements.forEach((candidate) => {
    if (candidate.id === current.id) return;
    const dx = candidate.viewX - current.viewX;
    const dy = candidate.viewY - current.viewY;
    const distance = Math.hypot(dx, dy);
    const alignment = (dx * direction.x + dy * direction.y) / distance;
    if (alignment < 0.35) return;

    const score = distance / (alignment * alignment);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  });

  return best;
}

function handleNodeKeydown(event, achievement) {
  if (!event.key.startsWith('Arrow')) return;
  const neighbor = directionalNeighbor(achievement, event.key);
  if (!neighbor) return;

  event.preventDefault();
  focusAchievement(neighbor);
}

function focusAchievement(achievement) {
  const target = document.querySelector(`[data-achievement-id="${CSS.escape(achievement.id)}"]`);
  target?.focus({ preventScroll: true });
}

function renderTree() {
  const minX = Math.min(...achievements.map((achievement) => achievement.x));
  const maxX = Math.max(...achievements.map((achievement) => achievement.x));
  const minY = Math.min(...achievements.map((achievement) => achievement.y));
  const maxY = Math.max(...achievements.map((achievement) => achievement.y));

  achievements = achievements.map((achievement) => ({
    ...achievement,
    viewX: achievement.x - minX + WORLD_PADDING,
    viewY: achievement.y - minY + WORLD_PADDING
  }));
  achievementById = new Map(achievements.map((achievement) => [achievement.id, achievement]));
  worldWidth = maxX - minX + WORLD_PADDING * 2;
  worldHeight = maxY - minY + WORLD_PADDING * 2;

  plane.style.width = `${worldWidth}px`;
  plane.style.height = `${worldHeight}px`;
  connectorLayer.setAttribute('width', String(worldWidth));
  connectorLayer.setAttribute('height', String(worldHeight));
  connectorLayer.setAttribute('viewBox', `0 0 ${worldWidth} ${worldHeight}`);

  renderRegions();

  achievements.forEach((achievement, index) => {
    const node = document.createElement('button');
    const level = achievement.tier ?? 1;
    node.type = 'button';
    node.className = 'achievement-node';
    node.dataset.achievementId = achievement.id;
    node.style.left = `${achievement.viewX}px`;
    node.style.top = `${achievement.viewY}px`;
    node.textContent = achievement.icon;
    node.setAttribute('role', 'treeitem');
    node.setAttribute('aria-level', String(level));
    node.setAttribute('aria-describedby', 'achievement-hover-card');
    node.tabIndex = index === 0 ? 0 : -1;
    node.addEventListener('pointerenter', () => showHoverCard(achievement, node));
    node.addEventListener('pointerleave', () => hideHoverCard(node));
    node.addEventListener('focus', () => {
      focusedId = achievement.id;
      document.querySelectorAll('.achievement-node').forEach((candidate) => {
        candidate.tabIndex = candidate === node ? 0 : -1;
      });
      showHoverCard(achievement, node);
    });
    node.addEventListener('blur', () => hideHoverCard(node));
    node.addEventListener('keydown', (event) => handleNodeKeydown(event, achievement));
    nodeLayer.append(node);
  });

  renderUnlockState();
  statusMessage.hidden = true;
  viewport.setAttribute('aria-busy', 'false');
  requestAnimationFrame(resetView);

  const unlockedCount = achievements.filter((achievement) =>
    unlockedIds.has(achievement.id)
  ).length;
  track('achievement_tree_viewed', `${unlockedCount}/${achievements.length}`, unlockedCount);
}

function validAchievement(item) {
  return (
    item &&
    typeof item.id === 'string' &&
    typeof item.appId === 'string' &&
    typeof item.title === 'string' &&
    typeof item.description === 'string' &&
    typeof item.icon === 'string' &&
    (item.tier === undefined || item.tier === 1 || item.tier === 2) &&
    (item.requiresId === undefined ||
      item.requiresId === null ||
      typeof item.requiresId === 'string') &&
    Number.isFinite(item.x) &&
    Number.isFinite(item.y)
  );
}

async function initialize() {
  try {
    const response = await fetch('/achievements-catalog.json');
    if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);

    const catalog = await response.json();
    if (!catalog || !Array.isArray(catalog.achievements)) {
      throw new Error('Achievement catalog has an invalid shape');
    }

    achievements = catalog.achievements.filter(validAchievement);
    if (!achievements.length) throw new Error('Achievement catalog is empty');

    const api = achievementApi();
    if (api?.ready) await api.ready;
    if (api) {
      unlockedIds = normalizeUnlocked(await Promise.resolve(api.getUnlocked()));
      api.subscribe(() => {
        refreshUnlocked().catch(() => {});
      });
    }

    renderTree();
  } catch (error) {
    console.error('Unable to load achievement tree:', error);
    statusMessage.textContent = 'The achievement tree could not be loaded. Please try again later.';
    viewport.setAttribute('aria-busy', 'false');
  }
}

viewport.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('.achievement-node')) return;
  panState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: transform.x,
    originY: transform.y
  };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('is-panning');
});

viewport.addEventListener('pointermove', (event) => {
  if (!panState || panState.pointerId !== event.pointerId) return;
  transform.x = panState.originX + event.clientX - panState.startX;
  transform.y = panState.originY + event.clientY - panState.startY;
  setTransform();
});

function endPan(event) {
  if (!panState || panState.pointerId !== event.pointerId) return;
  panState = null;
  viewport.classList.remove('is-panning');
}

viewport.addEventListener('pointerup', endPan);
viewport.addEventListener('pointercancel', endPan);

viewport.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const bounds = viewport.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const worldX = (pointerX - transform.x) / transform.scale;
    const worldY = (pointerY - transform.y) / transform.scale;
    const zoomFactor = Math.exp(-event.deltaY * 0.0012);
    const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transform.scale * zoomFactor));

    transform.scale = nextScale;
    transform.x = pointerX - worldX * nextScale;
    transform.y = pointerY - worldY * nextScale;
    setTransform();
  },
  { passive: false }
);

viewport.addEventListener('keydown', (event) => {
  if (!event.key.startsWith('Arrow') || event.target !== viewport || !achievements.length) return;
  event.preventDefault();
  const start = focusedId ? achievementById.get(focusedId) : achievements[0];
  const target = focusedId ? directionalNeighbor(start, event.key) || start : start;
  focusAchievement(target);
});

resetButton.addEventListener('click', resetView);
window.addEventListener('resize', resetView);

initialize();
