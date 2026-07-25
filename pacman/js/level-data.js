import { TILE } from './constants.js';

const VALID_TILES = new Set(Object.values(TILE));
const WALKABLE_TILES = new Set([
  TILE.FLOOR,
  TILE.GHOST_HOME,
  TILE.TELEPORT,
  TILE.POWER_PILL,
  TILE.PACMAN_START,
  TILE.FRUIT_SPAWN
]);
const SOURCE_RAMP_DELTAS = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 }
};
const RAMP_DIRECTION_CODES = ['n', 'e', 's', 'w'];

export class LevelValidationError extends Error {
  constructor(issues) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'LevelValidationError';
    this.issues = issues;
  }
}

function issue(code, message) {
  return { code, message };
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function edgeKey(first, second) {
  return [pointKey(first), pointKey(second)].sort().join('|');
}

function isCoordinate(value) {
  return (
    value &&
    Number.isInteger(value.x) &&
    Number.isInteger(value.y) &&
    (value.level === undefined || Number.isInteger(value.level))
  );
}

function sourceTeleportGroups(data) {
  if (!Array.isArray(data.teleports)) return [];

  const groups = [];
  const flatEndpoints = [];

  for (const entry of data.teleports) {
    if (Array.isArray(entry)) {
      if (entry.length === 2) {
        groups.push({ mode: 'pair', endpoints: entry });
      }
    } else if (entry && Array.isArray(entry.endpoints)) {
      const mode = entry.mode === 'pair' && entry.endpoints.length === 2 ? 'pair' : 'next';
      groups.push({ mode, endpoints: entry.endpoints });
    } else if (isCoordinate(entry)) {
      flatEndpoints.push(entry);
    }
  }

  if (groups.length === 0) {
    for (let index = 0; index + 1 < flatEndpoints.length; index += 2) {
      groups.push({
        mode: 'pair',
        endpoints: [flatEndpoints[index], flatEndpoints[index + 1]]
      });
    }
  }

  return groups;
}

function isWalkableSource(map, x, y) {
  return Boolean(map[y] && WALKABLE_TILES.has(map[y][x]));
}

function orderedPairEndpoints(endpoints, map) {
  if (endpoints.length !== 2) return null;
  const west = endpoints.find(
    (point) =>
      !isWalkableSource(map, point.x - 1, point.y) && isWalkableSource(map, point.x + 1, point.y)
  );
  const east = endpoints.find(
    (point) =>
      !isWalkableSource(map, point.x + 1, point.y) && isWalkableSource(map, point.x - 1, point.y)
  );
  if (west && east && west !== east) return [west, east];

  const north = endpoints.find(
    (point) =>
      !isWalkableSource(map, point.x, point.y - 1) && isWalkableSource(map, point.x, point.y + 1)
  );
  const south = endpoints.find(
    (point) =>
      !isWalkableSource(map, point.x, point.y + 1) && isWalkableSource(map, point.x, point.y - 1)
  );
  if (north && south && north !== south) return [north, south];
  return null;
}

function scanMap(map, tile) {
  const locations = [];
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] === tile) locations.push({ x, y, level: 0 });
    }
  }
  return locations;
}

function inBounds(point, width, height) {
  return point.x >= 0 && point.x < width && point.y >= 0 && point.y < height;
}

function sourceHeights(data, width, height) {
  if (!Array.isArray(data.heights)) {
    return Array.from({ length: height }, () => Array(width).fill(0));
  }
  return data.heights.map((row) => [...row]);
}

function sourceRamps(data) {
  return Array.isArray(data.ramps)
    ? data.ramps.map((ramp) => ({ x: ramp.x, y: ramp.y, dir: ramp.dir }))
    : [];
}

function rampDestination(ramp) {
  const delta = SOURCE_RAMP_DELTAS[ramp.dir];
  return delta ? { x: ramp.x + delta.x, y: ramp.y + delta.y } : null;
}

function isSpecialSourceLocation(x, y, map, pacmanStart, ghostHomes, groups) {
  if (pacmanStart && pacmanStart.x === x && pacmanStart.y === y) return true;
  if (ghostHomes.some((home) => home.x === x && home.y === y)) return true;
  if (map[y][x] === TILE.POWER_PILL || map[y][x] === TILE.FRUIT_SPAWN) return true;
  if (groups.some((group) => group.endpoints.some((point) => point.x === x && point.y === y))) {
    return true;
  }
  return ghostHomes.some((home) => Math.abs(x - home.x) <= 1 && Math.abs(y - home.y) <= 1);
}

function findUnreachableCollectibles(data, groups, pacmanStart, ghostHomes, heights, ramps) {
  const map = data.map;
  const height = map.length;
  const width = map[0].length;
  const visited = new Set([pointKey(pacmanStart)]);
  const queue = [pacmanStart];
  const teleportDestinations = new Map();
  const rampEdges = new Set(
    ramps
      .map((ramp) => {
        const destination = rampDestination(ramp);
        return destination ? edgeKey(ramp, destination) : null;
      })
      .filter(Boolean)
  );

  for (const group of groups) {
    group.endpoints.forEach((endpoint, index) => {
      const destinations =
        group.mode === 'next'
          ? [group.endpoints[(index + 1) % group.endpoints.length]]
          : group.endpoints.filter((_, endpointIndex) => endpointIndex !== index);
      teleportDestinations.set(pointKey(endpoint), destinations);
    });
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const adjacent = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 }
    ];
    const neighbors = adjacent.filter(
      (neighbor) =>
        heights[current.y][current.x] === heights[neighbor.y]?.[neighbor.x] ||
        rampEdges.has(edgeKey(current, neighbor))
    );
    neighbors.push(...(teleportDestinations.get(pointKey(current)) || []));

    for (const neighbor of neighbors) {
      if (!inBounds(neighbor, width, height)) continue;
      if (!WALKABLE_TILES.has(map[neighbor.y][neighbor.x])) continue;
      const key = pointKey(neighbor);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(neighbor);
    }
  }

  const unreachable = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = map[y][x];
      const hasCollectible =
        tile === TILE.POWER_PILL ||
        (tile === TILE.FLOOR &&
          !isSpecialSourceLocation(x, y, map, pacmanStart, ghostHomes, groups));
      if (hasCollectible && !visited.has(`${x},${y}`)) unreachable.push({ x, y });
    }
  }
  return unreachable;
}

export function validateLevelData(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { errors: [issue('invalid_level', 'Level data must be an object.')], warnings };
  }
  if (!Array.isArray(data.map) || data.map.length === 0) {
    return { errors: [issue('empty_map', 'Map must have at least one row.')], warnings };
  }
  if (!Array.isArray(data.map[0]) || data.map[0].length === 0) {
    return { errors: [issue('empty_row', 'Map rows must contain at least one tile.')], warnings };
  }

  const height = data.map.length;
  const width = data.map[0].length;
  if (width > 50 || height > 50) {
    errors.push(issue('map_too_large', 'Custom maps cannot be larger than 50 by 50 tiles.'));
  }
  if (
    data.scale !== undefined &&
    (!Number.isFinite(data.scale) || data.scale < 1 || data.scale > 50)
  ) {
    errors.push(issue('invalid_scale', 'Tile scale must be a number from 1 to 50.'));
  }
  if (
    data.numGhosts !== undefined &&
    (!Number.isInteger(data.numGhosts) || data.numGhosts < 0 || data.numGhosts > 4)
  ) {
    errors.push(issue('invalid_ghost_count', 'Ghost count must be a whole number from 0 to 4.'));
  }
  for (let y = 0; y < height; y++) {
    const row = data.map[y];
    if (!Array.isArray(row) || row.length !== width) {
      errors.push(issue('ragged_map', `Map row ${y + 1} must contain exactly ${width} tiles.`));
      continue;
    }
    for (let x = 0; x < width; x++) {
      if (!VALID_TILES.has(row[x])) {
        errors.push(issue('invalid_tile', `Tile at (${x}, ${y}) has unsupported value ${row[x]}.`));
      }
    }
  }
  if (data.heights !== undefined) {
    if (!Array.isArray(data.heights) || data.heights.length !== height) {
      errors.push(issue('invalid_heights', 'Heights must have one row for every map row.'));
    } else {
      for (let y = 0; y < height; y++) {
        const row = data.heights[y];
        if (!Array.isArray(row) || row.length !== width) {
          errors.push(
            issue('invalid_heights', `Height row ${y + 1} must contain exactly ${width} values.`)
          );
          continue;
        }
        for (let x = 0; x < width; x++) {
          if (row[x] !== 0 && row[x] !== 1) {
            errors.push(
              issue('invalid_height', `Height at (${x}, ${y}) must be ground (0) or upper (1).`)
            );
          } else if (row[x] === 1 && !WALKABLE_TILES.has(data.map[y][x])) {
            errors.push(issue('height_on_unwalkable', `Upper tile (${x}, ${y}) must be walkable.`));
          }
        }
      }
    }
  }
  if (errors.length > 0) return { errors, warnings };

  const heights = sourceHeights(data, width, height);
  const ramps = sourceRamps(data);
  const rampOrigins = new Set();
  const rampEdges = new Set();
  ramps.forEach((ramp, index) => {
    if (
      !ramp ||
      !Number.isInteger(ramp.x) ||
      !Number.isInteger(ramp.y) ||
      !Object.hasOwn(SOURCE_RAMP_DELTAS, ramp.dir)
    ) {
      errors.push(issue('ramp_invalid', `Ramp ${index + 1} has invalid coordinates or direction.`));
      return;
    }
    const destination = rampDestination(ramp);
    if (
      !inBounds(ramp, width, height) ||
      !destination ||
      !inBounds(destination, width, height) ||
      !isWalkableSource(data.map, ramp.x, ramp.y) ||
      !isWalkableSource(data.map, destination.x, destination.y) ||
      heights[ramp.y][ramp.x] !== 0 ||
      heights[destination.y][destination.x] !== 1
    ) {
      errors.push(
        issue(
          'ramp_invalid',
          `Ramp ${index + 1} must run from walkable ground to an adjacent upper tile.`
        )
      );
      return;
    }
    const originKey = pointKey(ramp);
    const connectionKey = edgeKey(ramp, destination);
    if (rampOrigins.has(originKey) || rampEdges.has(connectionKey)) {
      errors.push(issue('ramp_overlap', `Ramp ${index + 1} overlaps another ramp.`));
      return;
    }
    rampOrigins.add(originKey);
    rampEdges.add(connectionKey);
  });
  if (errors.length > 0) return { errors, warnings };

  const starts = scanMap(data.map, TILE.PACMAN_START);
  const legacyStart = isCoordinate(data.pacmanStart) ? data.pacmanStart : null;
  const pacmanStart = starts[0] || legacyStart;
  if (starts.length > 1) {
    errors.push(issue('multiple_starts', 'Map must contain exactly one Pac-Man start tile.'));
  } else if (!pacmanStart) {
    errors.push(issue('missing_start', 'Map must contain one Pac-Man start tile.'));
  } else if (!inBounds(pacmanStart, width, height)) {
    errors.push(issue('start_out_of_bounds', 'Pac-Man start must be inside the map.'));
  }

  const ghostHomes = scanMap(data.map, TILE.GHOST_HOME);
  if (ghostHomes.length === 0 && Array.isArray(data.ghostHome)) {
    ghostHomes.push(...data.ghostHome.filter(isCoordinate));
  }
  const requestedGhosts = Number.isInteger(data.numGhosts) ? data.numGhosts : 4;
  if (ghostHomes.length === 0) {
    if (requestedGhosts > 0) {
      warnings.push(issue('missing_ghost_home', 'Add at least one ghost home to include a ghost.'));
    }
  } else {
    const hasGhostExit = ghostHomes.some((home) => {
      for (let x = Math.max(0, home.x - 2); x <= Math.min(width - 1, home.x + 2); x++) {
        if (data.map[home.y][x] !== TILE.GHOST_HOME) continue;
        const neighbors = [
          data.map[home.y - 1]?.[x],
          data.map[home.y + 1]?.[x],
          data.map[home.y]?.[x - 1],
          data.map[home.y]?.[x + 1]
        ];
        if (neighbors.includes(TILE.FLOOR)) return true;
      }
      return false;
    });
    if (!hasGhostExit) {
      warnings.push(
        issue(
          'risky_ghost_home',
          'Ghost homes should have a floor tile beside the home row so ghosts can exit.'
        )
      );
    }
  }
  if (requestedGhosts > ghostHomes.length) {
    warnings.push(
      issue(
        'ghost_count_limited',
        `Only ${ghostHomes.length} of ${requestedGhosts} requested ghosts can spawn without more homes.`
      )
    );
  }

  const fruitSpawns = scanMap(data.map, TILE.FRUIT_SPAWN);
  if (fruitSpawns.length > 1) {
    warnings.push(issue('multiple_fruit_spawns', 'Only the first fruit spawn tile will be used.'));
  }

  const groups = sourceTeleportGroups(data);
  const teleportTiles = scanMap(data.map, TILE.TELEPORT);
  const groupedEndpoints = new Set();
  groups.forEach((group, groupIndex) => {
    if (group.endpoints.length < 2) {
      errors.push(
        issue(
          'short_teleport_group',
          `Teleport group ${groupIndex + 1} needs at least two endpoints.`
        )
      );
    }
    if (group.mode === 'pair' && group.endpoints.length !== 2) {
      errors.push(
        issue('invalid_pair', `Pair teleport group ${groupIndex + 1} must have two endpoints.`)
      );
    }
    if (group.mode === 'pair' && group.endpoints.length === 2) {
      if (!orderedPairEndpoints(group.endpoints, data.map)) {
        errors.push(
          issue(
            'invalid_pair_placement',
            `Pair teleport group ${groupIndex + 1} must connect two tunnel edges.`
          )
        );
      }
    }
    group.endpoints.forEach((endpoint) => {
      if (!isCoordinate(endpoint) || !inBounds(endpoint, width, height)) {
        errors.push(
          issue(
            'teleport_out_of_bounds',
            `Teleport group ${groupIndex + 1} has an invalid endpoint.`
          )
        );
        return;
      }
      const key = pointKey(endpoint);
      if (groupedEndpoints.has(key)) {
        errors.push(
          issue('duplicate_teleport', `Teleport endpoint (${key}) belongs to two groups.`)
        );
      }
      groupedEndpoints.add(key);
      if (data.map[endpoint.y][endpoint.x] !== TILE.TELEPORT) {
        errors.push(
          issue(
            'teleport_tile_mismatch',
            `Teleport endpoint (${key}) must be painted as a teleport tile.`
          )
        );
      }
    });
  });
  for (const tile of teleportTiles) {
    if (!groupedEndpoints.has(pointKey(tile))) {
      errors.push(
        issue(
          'ungrouped_teleport',
          `Teleport tile (${tile.x},${tile.y}) must belong to a teleport group.`
        )
      );
    }
  }

  if (pacmanStart && errors.length === 0) {
    const unreachable = findUnreachableCollectibles(
      data,
      groups,
      pacmanStart,
      ghostHomes,
      heights,
      ramps
    );
    if (unreachable.length > 0) {
      errors.push(
        issue(
          'unreachable_collectibles',
          `${unreachable.length} collectible tile${
            unreachable.length === 1 ? ' is' : 's are'
          } unreachable from Pac-Man.`
        )
      );
    }
  }

  return { errors, warnings };
}

export function normalizeLevelData(data) {
  const validation = validateLevelData(data);
  if (validation.errors.length > 0) throw new LevelValidationError(validation.errors);

  const sourceMap = data.map.map((row) => [...row]);
  const height = sourceMap.length;
  const width = sourceMap[0].length;
  const elevations = sourceHeights(data, width, height);
  const flipPoint = (point) => ({
    x: point.x,
    y: height - 1 - point.y,
    level: elevations[point.y]?.[point.x] ?? point.level ?? 0
  });
  const sourceGroups = sourceTeleportGroups(data);
  const teleportGroups = sourceGroups.map((group) => ({
    mode: group.mode,
    endpoints: group.endpoints.map(flipPoint)
  }));
  const map = [...sourceMap].reverse();
  const heights = [...elevations].reverse();
  const ramps = sourceRamps(data).map((ramp) => ({
    x: ramp.x,
    y: height - 1 - ramp.y,
    dir: ramp.dir
  }));
  const mapStarts = scanMap(sourceMap, TILE.PACMAN_START);
  const sourcePacmanStart = mapStarts[0] || data.pacmanStart;
  const sourceGhostHomes = scanMap(sourceMap, TILE.GHOST_HOME);
  const sourcePowerPills = scanMap(sourceMap, TILE.POWER_PILL);
  const sourceFruitSpawns = scanMap(sourceMap, TILE.FRUIT_SPAWN);

  return {
    scale: Number.isFinite(data.scale) && data.scale > 0 ? data.scale : 10,
    numGhosts:
      Number.isInteger(data.numGhosts) && data.numGhosts >= 0 ? Math.min(data.numGhosts, 4) : 4,
    width,
    height,
    map,
    heights,
    ramps,
    pacmanStart: flipPoint(sourcePacmanStart),
    ghostHome: (sourceGhostHomes.length > 0 ? sourceGhostHomes : data.ghostHome || []).map(
      flipPoint
    ),
    powerPillLocations: (sourcePowerPills.length > 0
      ? sourcePowerPills
      : data.powerPills || []
    ).map(flipPoint),
    teleports: teleportGroups
      .filter((group) => group.mode === 'pair')
      .map((group) => group.endpoints),
    teleportGroups,
    fruitSpawn: sourceFruitSpawns.length > 0 ? flipPoint(sourceFruitSpawns[0]) : null,
    warnings: validation.warnings
  };
}

export function canonicalizeLevelData(data) {
  const normalized = normalizeLevelData(data);
  const sourceGroups = sourceTeleportGroups(data);
  return {
    scale: normalized.scale,
    numGhosts: normalized.numGhosts,
    map: data.map.map((row) => [...row]),
    heights: sourceHeights(data, normalized.width, normalized.height),
    ramps: sourceRamps(data),
    teleports: sourceGroups.map((group) => ({
      mode: group.mode,
      endpoints: (orderedPairEndpoints(group.endpoints, data.map) || group.endpoints).map(
        (point) => ({ x: point.x, y: point.y })
      )
    }))
  };
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value))
    throw new Error('Custom level code is not valid base64url.');
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeLevelData(data) {
  const canonical = canonicalizeLevelData(data);
  const hasElevation =
    canonical.ramps.length > 0 || canonical.heights.some((row) => row.some((value) => value === 1));
  const payload = {
    v: hasElevation ? 2 : 1,
    s: canonical.scale,
    g: canonical.numGhosts,
    m: canonical.map.map((row) => row.join('')),
    t: canonical.teleports.map((group) => ({
      m: group.mode === 'pair' ? 'p' : 'n',
      e: group.endpoints.map((point) => [point.x, point.y])
    }))
  };
  if (hasElevation) {
    payload.h = canonical.heights.map((row) => row.join(''));
    payload.r = canonical.ramps.map((ramp) => [
      ramp.x,
      ramp.y,
      RAMP_DIRECTION_CODES.indexOf(ramp.dir)
    ]);
  }
  return encodeBase64Url(JSON.stringify(payload));
}

export function decodeLevelData(code) {
  if (typeof code !== 'string' || code.length > 10_000) {
    throw new LevelValidationError([
      issue('invalid_code_size', 'Custom level code is missing or too large.')
    ]);
  }
  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(code));
  } catch (error) {
    throw new LevelValidationError([
      issue('invalid_code', `Could not read the custom level code: ${error.message}`)
    ]);
  }
  if ((payload?.v !== 1 && payload?.v !== 2) || !Array.isArray(payload.m)) {
    throw new LevelValidationError([issue('unsupported_code', 'Unsupported custom level format.')]);
  }

  const data = {
    scale: payload.s,
    numGhosts: payload.g,
    map: payload.m.map((row) => [...row].map((tile) => Number.parseInt(tile, 10))),
    heights:
      payload.v === 2 && Array.isArray(payload.h)
        ? payload.h.map((row) => [...row].map((height) => Number.parseInt(height, 10)))
        : undefined,
    ramps:
      payload.v === 2 && Array.isArray(payload.r)
        ? payload.r.map(([x, y, direction]) => ({
            x,
            y,
            dir: RAMP_DIRECTION_CODES[direction]
          }))
        : [],
    teleports: Array.isArray(payload.t)
      ? payload.t.map((group) => ({
          mode: group.m === 'p' ? 'pair' : 'next',
          endpoints: Array.isArray(group.e) ? group.e.map(([x, y]) => ({ x, y })) : []
        }))
      : []
  };
  return canonicalizeLevelData(data);
}
