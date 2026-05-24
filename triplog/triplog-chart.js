/**
 * Tiny SVG line-chart helper used by the trip viewer.
 *
 * No external chart library. Just enough to render an elevation or
 * pace profile inside the trip-view dialog: an area under a smooth
 * line, a couple of axis ticks, and min/max labels.
 *
 * The chart is built as a single SVG string so the caller can stamp
 * it into a container with `innerHTML = renderLineChart(...)`. The
 * SVG uses a `viewBox` so it scales fluidly to whatever width its
 * container ends up at on mobile.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Downsample an array of `{x, y}` points to roughly `targetCount`
 * samples by simple uniform stride. Always keeps the first and last
 * point so the chart starts and ends at the true endpoints.
 *
 * @template T
 * @param {T[]} points
 * @param {number} targetCount
 * @returns {T[]}
 */
export function downsample(points, targetCount) {
  if (points.length <= targetCount) {
    return points.slice();
  }
  const stride = Math.max(1, Math.floor(points.length / targetCount));
  /** @type {T[]} */
  const out = [];
  for (let i = 0; i < points.length; i += stride) {
    out.push(points[i]);
  }
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]);
  }
  return out;
}

/**
 * Render a stand-alone SVG element with a line + filled area chart.
 *
 * If `onHover` is provided, the chart also wires up pointer/touch
 * tracking: as the user drags across the chart, a vertical
 * crosshair + dot follows the nearest sample and the callback fires
 * with `(index, point)` (and `(null, null)` on leave). Callers use
 * this to drop a synced marker on the trip map.
 *
 * @template {{ x: number, y: number }} P
 * @param {object} opts
 * @param {P[]} opts.points              raw data, any X/Y units
 * @param {string} [opts.color]          stroke colour for the line
 * @param {string} [opts.fillColor]      fill colour for the area under the line
 * @param {number} [opts.width]          viewBox width
 * @param {number} [opts.height]         viewBox height
 * @param {string} [opts.title]          accessible label
 * @param {(v: number) => string} [opts.formatY] axis-label formatter for Y
 * @param {(v: number) => string} [opts.formatX] axis-label formatter for X
 * @param {(idx: number | null, p: P | null) => void} [opts.onHover]
 *        called as the user scrubs across the chart
 * @returns {SVGSVGElement}
 */
export function renderLineChart(opts) {
  const {
    points,
    color = '#1A73E8',
    fillColor = 'rgba(26, 115, 232, 0.15)',
    width = 320,
    height = 120,
    title = 'Chart',
    formatY = (v) => v.toFixed(0),
    formatX = (v) => v.toFixed(1),
    onHover
  } = opts;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'w-full h-full');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);

  if (points.length < 2) {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(width / 2));
    text.setAttribute('y', String(height / 2));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.style.fill = 'var(--text-3)';
    text.setAttribute('font-size', '12');
    text.textContent = 'Not enough data';
    svg.appendChild(text);
    return svg;
  }

  // Leave room on the left for Y-axis labels and on the bottom for X
  // labels. Padding is in viewBox units; preserveAspectRatio="none"
  // means they'll stretch with the chart — close enough for our needs.
  const padLeft = 36;
  const padRight = 8;
  const padTop = 8;
  const padBottom = 18;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  // Pad the Y range a bit so the line doesn't kiss the top/bottom edges.
  const ySpanRaw = maxY - minY;
  const ySpan = ySpanRaw === 0 ? 1 : ySpanRaw;
  const yPad = ySpan * 0.08;
  const yLo = minY - yPad;
  const yHi = maxY + yPad;
  const xSpan = maxX - minX || 1;

  /** @param {number} v */
  const xToSvg = (v) => padLeft + ((v - minX) / xSpan) * chartW;
  /** @param {number} v */
  const yToSvg = (v) => padTop + (1 - (v - yLo) / (yHi - yLo)) * chartH;

  // Build the line path. `M` for the first point, `L` for the rest.
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xToSvg(p.x).toFixed(1)} ${yToSvg(p.y).toFixed(1)}`)
    .join(' ');

  // Area path: same line, then close down to the baseline at the
  // bottom of the chart so the fill renders underneath the line.
  const areaPath =
    `${linePath} ` +
    `L ${xToSvg(points[points.length - 1].x).toFixed(1)} ${padTop + chartH} ` +
    `L ${xToSvg(points[0].x).toFixed(1)} ${padTop + chartH} Z`;

  const area = document.createElementNS(SVG_NS, 'path');
  area.setAttribute('d', areaPath);
  area.setAttribute('fill', fillColor);
  area.setAttribute('stroke', 'none');
  svg.appendChild(area);

  const line = document.createElementNS(SVG_NS, 'path');
  line.setAttribute('d', linePath);
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '2');
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');
  svg.appendChild(line);

  // Y axis: two labels, min and max, on the left edge.
  /** @param {number} val @param {number} y @param {string} anchor */
  const axisLabel = (val, y, anchor = 'end') => {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', anchor === 'end' ? String(padLeft - 4) : String(padLeft));
    t.setAttribute('y', String(y));
    t.setAttribute('text-anchor', anchor);
    t.setAttribute('dominant-baseline', 'middle');
    t.style.fill = 'var(--text-3)';
    t.setAttribute('font-size', '10');
    t.textContent = formatY(val);
    return t;
  };
  svg.appendChild(axisLabel(maxY, padTop + 4));
  svg.appendChild(axisLabel(minY, padTop + chartH - 4));

  // X axis: start and end labels at the bottom.
  /** @param {number} val @param {number} x @param {string} anchor */
  const xLabel = (val, x, anchor) => {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(height - 4));
    t.setAttribute('text-anchor', anchor);
    t.style.fill = 'var(--text-3)';
    t.setAttribute('font-size', '10');
    t.textContent = formatX(val);
    return t;
  };
  svg.appendChild(xLabel(minX, padLeft, 'start'));
  svg.appendChild(xLabel(maxX, padLeft + chartW, 'end'));

  if (onHover) {
    // Vertical crosshair + dot indicator that follow the pointer.
    // Both start hidden and become visible on the first move event.
    const crosshair = document.createElementNS(SVG_NS, 'line');
    crosshair.setAttribute('y1', String(padTop));
    crosshair.setAttribute('y2', String(padTop + chartH));
    crosshair.setAttribute('stroke', color);
    crosshair.setAttribute('stroke-width', '1');
    crosshair.setAttribute('stroke-dasharray', '3 3');
    crosshair.setAttribute('opacity', '0');
    crosshair.setAttribute('pointer-events', 'none');
    svg.appendChild(crosshair);

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', color);
    dot.style.stroke = 'var(--surface-1)';
    dot.setAttribute('stroke-width', '2');
    dot.setAttribute('opacity', '0');
    dot.setAttribute('pointer-events', 'none');
    svg.appendChild(dot);

    // Transparent overlay that captures the actual pointer events.
    // Sized to match the plottable area so the labels don't trigger
    // hover. Must be appended last so it sits on top.
    const overlay = document.createElementNS(SVG_NS, 'rect');
    overlay.setAttribute('x', String(padLeft));
    overlay.setAttribute('y', String(padTop));
    overlay.setAttribute('width', String(chartW));
    overlay.setAttribute('height', String(chartH));
    overlay.setAttribute('fill', 'transparent');
    overlay.style.cursor = 'crosshair';
    overlay.style.touchAction = 'none'; // let us own touch events
    svg.appendChild(overlay);

    /** @param {number} clientX */
    const clientXToIndex = (clientX) => {
      // The SVG uses preserveAspectRatio="none" so width in viewBox
      // units stretches to client width. Convert client X back to the
      // x-data domain, then find the nearest sample by X.
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return 0;
      const localX = clientX - rect.left;
      const viewBoxX = (localX / rect.width) * width;
      const norm = Math.min(1, Math.max(0, (viewBoxX - padLeft) / chartW));
      const dataX = minX + norm * xSpan;
      let bestIdx = 0;
      let bestDelta = Math.abs(points[0].x - dataX);
      for (let i = 1; i < points.length; i += 1) {
        const d = Math.abs(points[i].x - dataX);
        if (d < bestDelta) {
          bestDelta = d;
          bestIdx = i;
        }
      }
      return bestIdx;
    };

    /** @param {number | null} idx */
    const showAt = (idx) => {
      if (idx == null) {
        crosshair.setAttribute('opacity', '0');
        dot.setAttribute('opacity', '0');
        onHover(null, null);
        return;
      }
      const p = points[idx];
      const xs = xToSvg(p.x).toFixed(1);
      crosshair.setAttribute('x1', xs);
      crosshair.setAttribute('x2', xs);
      crosshair.setAttribute('opacity', '1');
      dot.setAttribute('cx', xs);
      dot.setAttribute('cy', yToSvg(p.y).toFixed(1));
      dot.setAttribute('opacity', '1');
      onHover(idx, p);
    };

    overlay.addEventListener('pointerdown', (e) => {
      overlay.setPointerCapture?.(e.pointerId);
      showAt(clientXToIndex(e.clientX));
    });
    overlay.addEventListener('pointermove', (e) => {
      // Only respond to hover (no buttons) or active drag — keeps
      // browsers without hover-capable pointers from feeling weird.
      if (e.pointerType === 'mouse' || e.buttons > 0) {
        showAt(clientXToIndex(e.clientX));
      }
    });
    overlay.addEventListener('pointerleave', () => showAt(null));
    overlay.addEventListener('pointercancel', () => showAt(null));
  }

  return svg;
}
