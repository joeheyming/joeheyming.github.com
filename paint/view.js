// Paint — the document view (PhotoCraft canvas.rs ViewXform, view_cmds.rs, zoom_tool.rs).
//
// A view is { zoom, panX, panY, flip, rotation }: the canvas stack is translated by the pan,
// scaled by the zoom, then turned `rotation` degrees clockwise and mirrored (View › Flip
// Horizontal) about the document centre. View coordinates are CSS pixels from the stack's
// untransformed origin in #canvas-area. Everything here is pure.

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 16;
// PhotoCraft fit_view leaves a 20-point margin on each side.
const FIT_MARGIN = 40;
// A zoom rectangle smaller than this steps the zoom at the press point (zoom_tool.rs).
const MIN_ZOOM_RECT = 4;
export const ZOOM_STEP = 1.25;

export const SCREEN_MODES = ['standard', 'fullScreenWithMenuBar', 'fullScreen'];

export function clampZoom(z) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

/** The view part of the app state. */
export function viewOf(state) {
  return {
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    flip: !!state.viewFlip,
    rotation: state.viewRotation || 0
  };
}

/** Write a view back onto the app state. */
export function applyView(state, v) {
  state.zoom = v.zoom;
  state.panX = v.panX;
  state.panY = v.panY;
  state.viewFlip = v.flip;
  state.viewRotation = v.rotation;
}

// The rotate-and-mirror part, about the origin: mirror x first, then turn clockwise.
function turn(v, dx, dy) {
  const a = (v.rotation * Math.PI) / 180;
  const c = Math.cos(a),
    s = Math.sin(a);
  const fx = v.flip ? -dx : dx;
  return [fx * c - dy * s, fx * s + dy * c];
}

function unturn(v, rx, ry) {
  const a = (v.rotation * Math.PI) / 180;
  const c = Math.cos(a),
    s = Math.sin(a);
  const fx = rx * c + ry * s;
  return [v.flip ? -fx : fx, -rx * s + ry * c];
}

/** Document pixel (x, y) → view point. */
export function docToView(v, W, H, x, y) {
  const [rx, ry] = turn(v, x - W / 2, y - H / 2);
  return [v.panX + v.zoom * (W / 2 + rx), v.panY + v.zoom * (H / 2 + ry)];
}

/** View point → document pixel coordinates (the inverse of docToView). */
export function viewToDoc(v, W, H, vx, vy) {
  const [dx, dy] = unturn(v, (vx - v.panX) / v.zoom - W / 2, (vy - v.panY) / v.zoom - H / 2);
  return [W / 2 + dx, H / 2 + dy];
}

/** The stack's CSS transform for `v` (transform-origin 0 0). */
export function viewTransformCss(v, W, H) {
  let css = `translate(${v.panX}px,${v.panY}px) scale(${v.zoom})`;
  if (v.rotation || v.flip) {
    css += ` translate(${W / 2}px,${H / 2}px)`;
    if (v.rotation) css += ` rotate(${v.rotation}deg)`;
    if (v.flip) css += ' scale(-1,1)';
    css += ` translate(${-W / 2}px,${-H / 2}px)`;
  }
  return css;
}

/** `v` at `zoom` with document point `doc` under view point `at`. */
export function anchorView(v, W, H, doc, at, zoom) {
  const [rx, ry] = turn(v, doc[0] - W / 2, doc[1] - H / 2);
  return {
    ...v,
    zoom,
    panX: at[0] - zoom * (W / 2 + rx),
    panY: at[1] - zoom * (H / 2 + ry)
  };
}

/** Zoom to `zoom` (clamped) keeping the document point under view point (vx, vy) still. */
export function zoomAt(v, W, H, vx, vy, zoom) {
  return anchorView(v, W, H, viewToDoc(v, W, H, vx, vy), [vx, vy], clampZoom(zoom));
}

/** View › 100% / 200%: that zoom about the centre of the canvas area. */
export function zoomCentered(v, W, H, areaW, areaH, zoom) {
  return zoomAt(v, W, H, areaW / 2, areaH / 2, zoom);
}

/** The zoom that fits a w × h box in the area with PhotoCraft's margin; `cap` limits it. */
export function fitZoom(w, h, areaW, areaH, cap = Infinity) {
  const fit = Math.min((areaW - FIT_MARGIN) / Math.max(1, w), (areaH - FIT_MARGIN) / Math.max(1, h));
  return clampZoom(Math.min(fit, cap));
}

/** View › Fit on Screen: never past 100%, document centred (canvas.rs fit_view). */
export function fitOnScreen(v, W, H, areaW, areaH) {
  return anchorView(v, W, H, [W / 2, H / 2], [areaW / 2, areaH / 2], fitZoom(W, H, areaW, areaH, 1));
}

/**
 * View › Fit Layer(s) on Screen: zoom and centre on `b` ({ x0, y0, x1, y1 }, the selected
 * layers' pixel bounds); no 100% cap (view_cmds.rs fit_layers). A null `b` fits the document.
 */
export function fitBounds(v, W, H, b, areaW, areaH) {
  const r = b ?? { x0: 0, y0: 0, x1: W, y1: H };
  const zoom = fitZoom(r.x1 - r.x0, r.y1 - r.y0, areaW, areaH);
  return anchorView(v, W, H, [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2], [areaW / 2, areaH / 2], zoom);
}

/**
 * Zoom tool release (zoom_tool.rs zoom_to_rect): `from` is the press and `to` the release, in
 * view points. A drag zooms so the rectangle fills the area, its centre in the middle. A click
 * (a rectangle under 4 px) or ⌥ steps the zoom in or out at the press point.
 */
export function zoomToRect(v, W, H, from, to, areaW, areaH, out = false) {
  const rw = Math.abs(to[0] - from[0]),
    rh = Math.abs(to[1] - from[1]);
  if (out || rw < MIN_ZOOM_RECT || rh < MIN_ZOOM_RECT) {
    return zoomAt(v, W, H, from[0], from[1], v.zoom * (out ? 1 / ZOOM_STEP : ZOOM_STEP));
  }
  const k = Math.min(areaW / rw, areaH / rh);
  const c = viewToDoc(v, W, H, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  return anchorView(v, W, H, c, [areaW / 2, areaH / 2], clampZoom(v.zoom * k));
}

/** Degrees in (-180, 180]. */
export function normalizeAngle(deg) {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

/**
 * Rotate View drag: the turn from `start` degrees by the pointer's sweep about `center` (all
 * view points). Shift snaps to 15° steps.
 */
export function rotateViewAngle(start, center, from, to, snap = false) {
  const a0 = Math.atan2(from[1] - center[1], from[0] - center[0]);
  const a1 = Math.atan2(to[1] - center[1], to[0] - center[0]);
  const a = normalizeAngle(start + ((a1 - a0) * 180) / Math.PI);
  return snap ? normalizeAngle(Math.round(a / 15) * 15) : a;
}

/** The document centre in view points: the pivot Rotate View turns about. */
export function viewPivot(v, W, H) {
  return [v.panX + (v.zoom * W) / 2, v.panY + (v.zoom * H) / 2];
}

/** F: the next screen mode (Standard → Full Screen With Menu Bar → Full Screen → Standard). */
export function nextScreenMode(mode) {
  const i = SCREEN_MODES.indexOf(mode);
  return SCREEN_MODES[(i + 1) % SCREEN_MODES.length];
}

/**
 * The .paint-layout classes a screen mode sets: both full modes hide the tool column and dock;
 * Full Screen also hides the menu bar, document tab, and options bar.
 */
export function screenModeClasses(mode) {
  return {
    'screen-full-menu': mode === 'fullScreenWithMenuBar' || mode === 'fullScreen',
    'screen-full': mode === 'fullScreen'
  };
}
