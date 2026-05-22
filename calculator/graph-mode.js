import { compileExpression } from './math-expr.js';

/** @typedef {{ xMin: number, xMax: number, yMin: number, yMax: number }} GraphBounds */

const DEFAULT_BOUNDS = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };

const CURVES = [
  { id: 'f', label: 'f(x)', color: '#38bdf8', defaultExpr: 'sin(x)' },
  { id: 'g', label: 'g(x)', color: '#fb923c', defaultExpr: 'cos(x)' }
];

/**
 * @param {HTMLElement} panel
 */
export function initGraphMode(panel) {
  const errorEl = panel.querySelector('#graph-error');
  const tooltipEl = panel.querySelector('#graph-tooltip');
  const canvas = /** @type {HTMLCanvasElement | null} */ (panel.querySelector('#graph-canvas'));
  const canvasWrap = canvas?.parentElement;
  const xMinInput = /** @type {HTMLInputElement | null} */ (panel.querySelector('#graph-x-min'));
  const xMaxInput = /** @type {HTMLInputElement | null} */ (panel.querySelector('#graph-x-max'));
  const yMinInput = /** @type {HTMLInputElement | null} */ (panel.querySelector('#graph-y-min'));
  const yMaxInput = /** @type {HTMLInputElement | null} */ (panel.querySelector('#graph-y-max'));

  if (
    !errorEl ||
    !tooltipEl ||
    !canvas ||
    !canvasWrap ||
    !xMinInput ||
    !xMaxInput ||
    !yMinInput ||
    !yMaxInput
  ) {
    return;
  }

  /** @type {GraphBounds} */
  let bounds = { ...DEFAULT_BOUNDS };
  let activePresetTarget = 'f';
  /** @type {{ x: number } | null} */
  let probe = null;

  const exprInputs = CURVES.map((curve) => {
    const input = /** @type {HTMLInputElement | null} */ (
      panel.querySelector(`#graph-expr-${curve.id}`)
    );
    if (input) {
      input.value = curve.defaultExpr;
    }
    return { curve, input };
  }).filter((row) => row.input);

  function syncClearButtons() {
    exprInputs.forEach(({ input }) => {
      const field = input?.closest('.graph-expr-field');
      field?.classList.toggle('graph-expr-field--has-value', Boolean(input?.value.trim()));
    });
  }

  syncClearButtons();

  panel.querySelectorAll('.graph-expr-clear').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-for');
      const input = id ? panel.querySelector(`#${id}`) : null;
      if (input instanceof HTMLInputElement) {
        input.value = '';
        input.focus();
        syncClearButtons();
        draw();
      }
    });
  });

  function readBoundsFromInputs() {
    const xMin = Number(xMinInput.value);
    const xMax = Number(xMaxInput.value);
    const yMin = Number(yMinInput.value);
    const yMax = Number(yMaxInput.value);
    if (
      !Number.isFinite(xMin) ||
      !Number.isFinite(xMax) ||
      !Number.isFinite(yMin) ||
      !Number.isFinite(yMax) ||
      xMax <= xMin ||
      yMax <= yMin
    ) {
      return false;
    }
    bounds = { xMin, xMax, yMin, yMax };
    return true;
  }

  function writeBoundsToInputs() {
    xMinInput.value = String(bounds.xMin);
    xMaxInput.value = String(bounds.xMax);
    yMinInput.value = String(bounds.yMin);
    yMaxInput.value = String(bounds.yMax);
  }

  writeBoundsToInputs();

  function setError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /**
   * @param {string} expr
   * @param {number} samples
   * @returns {{ xs: number[], ys: (number | null)[] } | { error: string } | null}
   */
  function sampleCurve(expr, samples) {
    const trimmed = expr.trim();
    if (!trimmed) {
      return null;
    }
    const compiled = compileExpression(trimmed);
    if ('error' in compiled) {
      return { error: compiled.error };
    }
    const xs = [];
    const ys = [];
    const { xMin, xMax } = bounds;
    const span = xMax - xMin;
    const ySpan = bounds.yMax - bounds.yMin;
    const yClip = bounds.yMin - ySpan * 4;
    const yClipMax = bounds.yMax + ySpan * 4;

    for (let i = 0; i <= samples; i += 1) {
      const x = xMin + (span * i) / samples;
      xs.push(x);
      try {
        const y = compiled.evaluate(x);
        if (!Number.isFinite(y) || y < yClip || y > yClipMax) {
          ys.push(null);
        } else {
          ys.push(y);
        }
      } catch {
        ys.push(null);
      }
    }
    return { xs, ys };
  }

  function draw() {
    setError('');
    if (!readBoundsFromInputs()) {
      setError('Invalid axis range');
      return;
    }

    resizeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const w = canvas.width;
    const h = canvas.height;
    const { xMin, xMax, yMin, yMax } = bounds;
    const xSpan = xMax - xMin;
    const ySpan = yMax - yMin;

    const toScreenX = (x) => ((x - xMin) / xSpan) * w;
    const toScreenY = (y) => h - ((y - yMin) / ySpan) * h;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    const gridX = niceStep(xSpan, 10);
    const gridY = niceStep(ySpan, 8);
    for (let gx = Math.ceil(xMin / gridX) * gridX; gx <= xMax; gx += gridX) {
      const px = toScreenX(gx);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
    for (let gy = Math.ceil(yMin / gridY) * gridY; gy <= yMax; gy += gridY) {
      const py = toScreenY(gy);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    if (yMin < 0 && yMax > 0) {
      const axisY = toScreenY(0);
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
      ctx.beginPath();
      ctx.moveTo(0, axisY);
      ctx.lineTo(w, axisY);
      ctx.stroke();
    }
    if (xMin < 0 && xMax > 0) {
      const axisX = toScreenX(0);
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
      ctx.beginPath();
      ctx.moveTo(axisX, 0);
      ctx.lineTo(axisX, h);
      ctx.stroke();
    }

    const samples = Math.min(800, Math.max(200, Math.floor(w / 2)));
    let firstError = '';

    for (const { curve, input } of exprInputs) {
      if (!input) {
        continue;
      }
      const data = sampleCurve(input.value, samples);
      if (!data) {
        continue;
      }
      if ('error' in data) {
        if (!firstError) {
          firstError = data.error;
        }
        continue;
      }

      ctx.strokeStyle = curve.color;
      ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let drawing = false;
      for (let i = 0; i < data.ys.length; i += 1) {
        const y = data.ys[i];
        if (y === null) {
          drawing = false;
          continue;
        }
        const px = toScreenX(data.xs[i]);
        const py = toScreenY(y);
        if (!drawing) {
          ctx.moveTo(px, py);
          drawing = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    }

    if (firstError) {
      setError(firstError);
    }

    if (probe) {
      drawProbeOverlay(ctx, w, h, toScreenX, toScreenY, probe.x);
    }
  }

  /**
   * @param {number} x
   * @returns {{ curve: (typeof CURVES)[number]; y: number }[]}
   */
  function evaluationsAtX(x) {
    /** @type {{ curve: (typeof CURVES)[number]; y: number }[]} */
    const hits = [];
    for (const { curve, input } of exprInputs) {
      if (!input?.value.trim()) {
        continue;
      }
      const compiled = compileExpression(input.value.trim());
      if ('error' in compiled) {
        continue;
      }
      try {
        const y = compiled.evaluate(x);
        if (Number.isFinite(y)) {
          hits.push({ curve, y });
        }
      } catch {
        /* skip */
      }
    }
    return hits;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   * @param {(x: number) => number} toScreenX
   * @param {(y: number) => number} toScreenY
   * @param {number} probeX
   */
  function drawProbeOverlay(ctx, w, h, toScreenX, toScreenY, probeX) {
    const px = toScreenX(probeX);
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
    ctx.lineWidth = 1 * dpr;
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const { curve, y } of evaluationsAtX(probeX)) {
      const py = toScreenY(y);
      ctx.fillStyle = curve.color;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(px, py, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function fitY() {
    if (!readBoundsFromInputs()) {
      return;
    }
    let yMin = Infinity;
    let yMax = -Infinity;
    const samples = 120;

    for (const { input } of exprInputs) {
      if (!input || !input.value.trim()) {
        continue;
      }
      const compiled = compileExpression(input.value.trim());
      if ('error' in compiled) {
        continue;
      }
      const { xMin, xMax } = bounds;
      const span = xMax - xMin;
      for (let i = 0; i <= samples; i += 1) {
        const x = xMin + (span * i) / samples;
        try {
          const y = compiled.evaluate(x);
          if (Number.isFinite(y)) {
            yMin = Math.min(yMin, y);
            yMax = Math.max(yMax, y);
          }
        } catch {
          /* skip */
        }
      }
    }

    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      return;
    }
    const pad = Math.max(0.5, (yMax - yMin) * 0.08) || 1;
    bounds.yMin = yMin - pad;
    bounds.yMax = yMax + pad;
    writeBoundsToInputs();
    draw();
  }

  exprInputs.forEach(({ input }) => {
    input.addEventListener('input', () => {
      syncClearButtons();
      draw();
    });
  });
  [xMinInput, xMaxInput, yMinInput, yMaxInput].forEach((el) => {
    el.addEventListener('change', draw);
  });

  panel.querySelectorAll('.graph-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const expr = btn.getAttribute('data-expr');
      const target = btn.getAttribute('data-target') || activePresetTarget;
      const row = exprInputs.find((r) => r.curve.id === target);
      if (expr && row?.input) {
        row.input.value = expr;
        syncClearButtons();
        draw();
      }
    });
  });

  panel.querySelector('#graph-reset-view')?.addEventListener('click', () => {
    bounds = { ...DEFAULT_BOUNDS };
    writeBoundsToInputs();
    draw();
  });

  panel.querySelector('#graph-fit-y')?.addEventListener('click', fitY);

  exprInputs.forEach(({ curve, input }) => {
    input.addEventListener('focus', () => {
      activePresetTarget = curve.id;
    });
  });

  /**
   * @param {number} n
   */
  function formatCoord(n) {
    if (!Number.isFinite(n)) {
      return '—';
    }
    const abs = Math.abs(n);
    if (abs >= 1e4 || (abs > 0 && abs < 1e-4)) {
      return n.toExponential(3);
    }
    return String(Number(n.toFixed(4)));
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   */
  function clientToMath(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    const x = bounds.xMin + fx * (bounds.xMax - bounds.xMin);
    const y = bounds.yMax - fy * (bounds.yMax - bounds.yMin);
    return { x, y };
  }

  /**
   * @param {PointerEvent} e
   */
  function updateProbe(e) {
    if (!readBoundsFromInputs()) {
      return;
    }
    const { x } = clientToMath(e.clientX, e.clientY);
    probe = { x };

    const lines = [
      `<span class="graph-tooltip-line" style="color:#e2e8f0">x = ${formatCoord(x)}</span>`
    ];
    for (const { curve, y } of evaluationsAtX(x)) {
      lines.push(
        `<span class="graph-tooltip-line" style="color:${curve.color}">${
          curve.label
        } = ${formatCoord(y)}</span>`
      );
    }
    tooltipEl.innerHTML = lines.join('');
    tooltipEl.hidden = false;

    const wrapRect = canvasWrap.getBoundingClientRect();
    const tipW = tooltipEl.offsetWidth || 140;
    const tipH = tooltipEl.offsetHeight || 48;
    let left = e.clientX - wrapRect.left + 14;
    let top = e.clientY - wrapRect.top - tipH / 2;
    left = Math.min(Math.max(8, left), wrapRect.width - tipW - 8);
    top = Math.min(Math.max(8, top), wrapRect.height - tipH - 8);
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;

    draw();
  }

  function hideProbe() {
    probe = null;
    tooltipEl.hidden = true;
    tooltipEl.innerHTML = '';
    draw();
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    updateProbe(e);
    if (!dragging) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const dx = ((e.clientX - lastX) / rect.width) * (bounds.xMax - bounds.xMin);
    const dy = ((e.clientY - lastY) / rect.height) * (bounds.yMax - bounds.yMin);
    bounds.xMin -= dx;
    bounds.xMax -= dx;
    bounds.yMin += dy;
    bounds.yMax += dy;
    lastX = e.clientX;
    lastY = e.clientY;
    writeBoundsToInputs();
    draw();
  });

  canvasWrap.addEventListener('pointerleave', hideProbe);

  const endDrag = (e) => {
    if (dragging) {
      dragging = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      const factor = e.deltaY < 0 ? 0.9 : 1.1;
      const xMid = bounds.xMin + fx * (bounds.xMax - bounds.xMin);
      const yMid = bounds.yMax - fy * (bounds.yMax - bounds.yMin);
      const xHalf = ((bounds.xMax - bounds.xMin) * factor) / 2;
      const yHalf = ((bounds.yMax - bounds.yMin) * factor) / 2;
      bounds.xMin = xMid - xHalf;
      bounds.xMax = xMid + xHalf;
      bounds.yMin = yMid - yHalf;
      bounds.yMax = yMid + yHalf;
      writeBoundsToInputs();
      draw();
    },
    { passive: false }
  );

  const resizeObserver = new ResizeObserver(() => draw());
  resizeObserver.observe(canvas);

  return { redraw: draw };
}

/**
 * @param {number} span
 * @param {number} targetLines
 */
function niceStep(span, targetLines) {
  const rough = span / targetLines;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  let nice = 1;
  if (norm > 5) {
    nice = 10;
  } else if (norm > 2) {
    nice = 5;
  } else if (norm > 1) {
    nice = 2;
  }
  return nice * pow;
}
