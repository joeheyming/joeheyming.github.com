// Image › Analysis › Count Tool data (PhotoCraft crates/doc/src/analysis.rs CountGroup /
// Measurement, engine analysis_cmds.rs count.*): numbered markers in document px, in click
// order, kept in groups. state.count is { groups, active }; every helper returns a new object.
// Saved in .paintproj.

/** Photoshop's colours for new count groups, in order (analysis_cmds.rs GROUP_COLORS). */
export const COUNT_GROUP_COLORS = [
  '#ff0000',
  '#0099ff',
  '#00cc00',
  '#ff9900',
  '#cc00cc',
  '#ffff00'
];

/** No groups yet; the first marker creates Count Group 1. */
export function emptyCount() {
  return { groups: [], active: 0 };
}

/** Markers over every group (Measurement::count_total). */
export function countTotal(count) {
  return count.groups.reduce((n, g) => n + g.points.length, 0);
}

function newGroup(count) {
  const n = count.groups.length;
  return {
    name: `Count Group ${n + 1}`,
    color: COUNT_GROUP_COLORS[n % COUNT_GROUP_COLORS.length],
    markerSize: 1,
    labelSize: 8,
    visible: true,
    points: []
  };
}

// A copy with at least one group, so an edit always has a target.
function withGroup(count) {
  const groups = count.groups.map((g) => ({ ...g, points: [...g.points] }));
  if (!groups.length) return { groups: [newGroup(count)], active: 0 };
  return { groups, active: Math.min(count.active, groups.length - 1) };
}

/** count.add: a marker at (x, y) in the active group. */
export function addCountMarker(count, x, y) {
  const next = withGroup(count);
  next.groups[next.active].points.push([x, y]);
  return next;
}

/** The [group, index] of the visible marker nearest (x, y) within tol px, or null. */
export function nearestCountMarker(count, x, y, tol) {
  let best = null;
  count.groups.forEach((g, gi) => {
    if (!g.visible) return;
    g.points.forEach(([px, py], pi) => {
      const d = Math.hypot(px - x, py - y);
      if (d <= tol && (!best || d < best.d)) best = { d, at: [gi, pi] };
    });
  });
  return best?.at ?? null;
}

/** count.remove: later markers renumber down by one. */
export function removeCountMarker(count, g, i) {
  const next = withGroup(count);
  next.groups[g].points.splice(i, 1);
  return next;
}

/** count.move. */
export function moveCountMarker(count, g, i, to) {
  const next = withGroup(count);
  next.groups[g].points[i] = [to[0], to[1]];
  return next;
}

/** count.clear: the active group's markers (the options bar's Clear). The groups stay. */
export function clearCount(count) {
  if (!count.groups.length) return count;
  const next = withGroup(count);
  next.groups[next.active].points = [];
  return next;
}

/** count.setGroup color for the active group. */
export function setCountGroupColor(count, color) {
  const next = withGroup(count);
  next.groups[next.active].color = color;
  return next;
}

/** The active group's colour, or the colour the first group will get. */
export function activeCountColor(count) {
  return count.groups[count.active]?.color ?? COUNT_GROUP_COLORS[0];
}

/** A saved count as a fresh object; older .paintproj files and bad values open empty. */
export function normalizeCount(count) {
  if (!count || !Array.isArray(count.groups)) return emptyCount();
  const finite = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const groups = count.groups.map((g, i) => ({
    name: typeof g?.name === 'string' ? g.name : `Count Group ${i + 1}`,
    color: /^#[0-9a-f]{6}$/i.test(g?.color) ? g.color : COUNT_GROUP_COLORS[0],
    markerSize: Number.isFinite(g?.markerSize) ? g.markerSize : 1,
    labelSize: Number.isFinite(g?.labelSize) ? g.labelSize : 8,
    visible: g?.visible !== false,
    points: Array.isArray(g?.points) ? g.points.filter(finite).map(([x, y]) => [x, y]) : []
  }));
  const active = Number.isInteger(count.active) ? count.active : 0;
  return { groups, active: Math.max(0, Math.min(active, groups.length - 1)) };
}

/**
 * Each visible group's markers (analysis_ui.rs draw_overlay): a dot of radius 1 + markerSize and
 * its number in labelSize px to the upper right, both in screen px at `zoom`.
 */
export function drawCountMarkers(ov, count, zoom = 1) {
  const px = 1 / (zoom || 1);
  ov.save();
  ov.textAlign = 'left';
  ov.textBaseline = 'bottom';
  for (const g of count.groups) {
    if (!g.visible) continue;
    ov.fillStyle = g.color;
    ov.font = `${g.labelSize * px}px sans-serif`;
    g.points.forEach(([x, y], i) => {
      ov.beginPath();
      ov.arc(x, y, (1 + g.markerSize) * px, 0, Math.PI * 2);
      ov.fill();
      ov.fillText(String(i + 1), x + (2 + g.markerSize) * px, y - px);
    });
  }
  ov.restore();
}
