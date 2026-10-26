// Paths panel chrome — geometry and path ops stay in paths.js.
import { iconSvg } from './icons.js';
import { openPopupMenu } from './popup-menu.js';
import {
  WORK_PATH_NAME,
  nextPathName,
  pathLoadMode,
  pathRowActions,
  pathThumbLines,
  targetPath
} from './paths.js';

const PATH_THUMB_SIZE = 28;

function drawPathThumb(canvas, path, W, H) {
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return;
  const view = canvas.ownerDocument.defaultView;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = view?.getComputedStyle(canvas).color || '#fff';
  ctx.lineWidth = 1;
  for (const { points, closed } of pathThumbLines(path, W, H, PATH_THUMB_SIZE)) {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (closed) ctx.closePath();
    ctx.stroke();
  }
}

function startPathRename(rowEl, row, value, onRename) {
  const el = rowEl.querySelector('.path-name') ?? rowEl;
  if (el.querySelector('input.path-rename')) return;
  const input = el.ownerDocument.createElement('input');
  input.type = 'text';
  input.className = 'path-rename';
  input.setAttribute('aria-label', 'Path name');
  input.value = value;
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const text = input.value;
    el.textContent = row.name;
    if (commit) onRename?.(row.key, text);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();
}

/**
 * Fill the Paths panel: a row for the Work Path (when there is one) and each saved path, the
 * target aria-selected (a 28 px thumbnail then the name; Cmd / Ctrl-click the thumbnail calls
 * onLoadPath(key, pathLoadMode(e)); double-click renames, or saves the Work Path; right-click opens
 * pathRowActions; a click on the empty list calls onTarget(null)), then the footer: Fill Path, Stroke Path, Load as Selection, Make Work
 * Path from Selection, New Path, Delete Path.
 * @param {HTMLElement} container
 * @param {{ work: object | null, saved: Array<{ name: string }>, target: 'work' | number | null }} paths
 * @param {{ width: number, height: number, canMakeWorkPath: boolean, canPaint: boolean | (() => boolean), onTarget: (t: 'work' | number | null) => void,
 *   onFill: () => void, onStroke: () => void, onLoad: () => void,
 *   onLoadPath: (key: 'work' | number, mode: 'replace' | 'add' | 'subtract' | 'intersect') => void,
 *   onMakeWorkPath: () => void,
 *   onNew: () => void, onDelete: () => void, onDuplicate: (key: number) => void,
 *   onRename: (key: 'work' | number, name: string) => void }} opts
 */
export function renderPathsPanel(container, paths, opts) {
  const doc = container.ownerDocument;
  container.textContent = '';
  const list = doc.createElement('div');
  list.className = 'path-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Paths');
  const rows = [
    ...(paths.work ? [{ name: WORK_PATH_NAME, key: 'work' }] : []),
    ...paths.saved.map((p, i) => ({ name: p.name, key: i }))
  ];
  for (const row of rows) {
    const el = doc.createElement('div');
    el.className = `path-row${row.key === 'work' ? ' work' : ''}`;
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(row.key === paths.target));
    el.dataset.path = String(row.key);
    const thumb = doc.createElement('canvas');
    thumb.className = 'path-thumb';
    thumb.width = thumb.height = PATH_THUMB_SIZE;
    thumb.setAttribute('aria-hidden', 'true');
    // Cmd / Ctrl-click inside the thumbnail loads the path as a selection, keeping the target.
    thumb.addEventListener('click', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.stopPropagation();
      opts.onLoadPath?.(row.key, pathLoadMode(e));
    });
    const name = doc.createElement('span');
    name.className = 'path-name';
    name.textContent = row.name;
    el.append(thumb, name);
    el.addEventListener('click', () => opts.onTarget(row.key));
    el.addEventListener('dblclick', () => {
      const value = row.key === 'work' ? nextPathName(paths.saved) : row.name;
      startPathRename(el, row, value, opts.onRename);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      opts.onTarget(row.key);
      const canPaint =
        typeof opts.canPaint === 'function' ? opts.canPaint() : opts.canPaint !== false;
      const run = {
        load: () => opts.onLoad(),
        fill: () => opts.onFill(),
        stroke: () => opts.onStroke(),
        save: () => opts.onRename('work', nextPathName(paths.saved)),
        duplicate: () => opts.onDuplicate?.(row.key),
        // onTarget may have re-rendered the list; rename the row that is on screen now.
        rename: () => {
          const live = container.querySelector(`.path-row[data-path="${row.key}"]`) ?? el;
          startPathRename(live, row, row.name, opts.onRename);
        },
        delete: () => opts.onDelete()
      };
      const items = pathRowActions(row.key).map(({ action, label }) => ({
        label,
        disabled: !canPaint && (action === 'fill' || action === 'stroke'),
        run: run[action]
      }));
      openPopupMenu(doc.body, e.clientX, e.clientY, items);
    });
    list.appendChild(el);
  }
  // A click on the list outside every row deselects the path.
  list.addEventListener('click', (e) => {
    if (e.target === list) opts.onTarget(null);
  });
  container.appendChild(list);
  const W = opts.width,
    H = opts.height;
  for (const row of rows) {
    const thumb = list.querySelector(`.path-row[data-path="${row.key}"] .path-thumb`);
    drawPathThumb(thumb, row.key === 'work' ? paths.work : paths.saved[row.key], W, H);
  }
  const footer = doc.createElement('div');
  footer.className = 'layer-panel-footer';
  const none = !targetPath(paths);
  const buttons = [
    ['fill', 'paint-bucket', 'Fill path with foreground color', none, opts.onFill],
    ['stroke', 'circle', 'Stroke path with brush', none, opts.onStroke],
    ['load', 'square-dashed', 'Load path as a selection', none, opts.onLoad],
    [
      'work-path',
      'spline',
      'Make work path from selection',
      !opts.canMakeWorkPath,
      opts.onMakeWorkPath
    ],
    ['new', 'square-plus', 'Create new path', false, opts.onNew],
    ['delete', 'trash', 'Delete current path', none, opts.onDelete]
  ];
  for (const [action, icon, title, disabled, run] of buttons) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'layer-footer-btn';
    btn.dataset.action = action;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.appendChild(iconSvg(icon, 16, doc));
    btn.disabled = disabled;
    btn.addEventListener('click', () => run());
    footer.appendChild(btn);
  }
  container.appendChild(footer);
}
