// View › New Guide… and New Guide Layout… dialogs (PhotoCraft dialogs.rs new_guide,
// guide_layout_ui.rs), and the grid part of Preferences › Guides, Grid & Slices…. The markup is
// #new-guide-modal, #guide-layout-modal, and #grid-prefs-modal in index.html.
// OK checks the input with paint/guides.js and hands the result to onNewGuide / onLayout; a
// layout that does not fit shows its error and keeps the dialog open.

import { guideLayout, guidePosition } from './guides.js';
import { normalizeGrid } from './snap.js';

/**
 * The guideLayout params for the dialog's fields: an unticked Columns, Rows, or Margin group
 * counts as none, and an empty Width or Height means the columns share the space.
 */
export function guideLayoutParams(f) {
  const num = (v) => (v === '' || v == null ? 0 : Number(v));
  return {
    columns: f.useColumns ? num(f.columns) : 0,
    width: f.useColumns ? num(f.width) : 0,
    gutter: f.useColumns ? num(f.gutter) : 0,
    rows: f.useRows ? num(f.rows) : 0,
    height: f.useRows ? num(f.height) : 0,
    rowGutter: f.useRows ? num(f.rowGutter) : 0,
    margin: f.useMargin ? [f.top, f.left, f.bottom, f.right].map(num) : 0,
    centerColumns: !!f.center,
    clearExisting: !!f.clear
  };
}

function modalKeys(modal, close, confirm) {
  modal.addEventListener('keydown', (e) => {
    // The app's keydown handler would read Escape as Deselect.
    if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      confirm();
    }
  });
}

/**
 * @param {{
 *   state: any,
 *   W: () => number,
 *   H: () => number,
 *   onNewGuide: (vertical: boolean, pos: number) => void,
 *   onLayout: (guides: any) => void,
 *   onGrid?: (grid: { every: number, subdivisions: number }) => void,
 *   doc?: Document
 * }} deps
 */
export function initGuideDialogs({
  state,
  W,
  H,
  onNewGuide,
  onLayout,
  onGrid = () => {},
  doc = document
}) {
  const $ = (id) => doc.getElementById(id);

  const guideModal = $('new-guide-modal');
  const position = $('new-guide-position');
  const guideError = $('new-guide-error');
  const closeGuide = () => guideModal?.classList.add('hidden');
  const confirmGuide = () => {
    const vertical = $('new-guide-vertical').checked;
    const pos = guidePosition(position.value, vertical, W(), H());
    if (pos == null) {
      guideError.textContent = 'Enter a position in px or %.';
      return;
    }
    closeGuide();
    onNewGuide(vertical, pos);
  };
  if (guideModal) {
    $('new-guide-ok').addEventListener('click', confirmGuide);
    $('new-guide-cancel').addEventListener('click', closeGuide);
    modalKeys(guideModal, closeGuide, confirmGuide);
  }

  const layoutModal = $('guide-layout-modal');
  const layoutError = $('guide-layout-error');
  const val = (id) => $(`guide-layout-${id}`).value;
  const on = (id) => $(`guide-layout-${id}`).checked;
  const fields = () => ({
    useColumns: on('use-columns'),
    columns: val('columns'),
    width: val('width'),
    gutter: val('gutter'),
    useRows: on('use-rows'),
    rows: val('rows'),
    height: val('height'),
    rowGutter: val('row-gutter'),
    useMargin: on('use-margin'),
    top: val('margin-top'),
    left: val('margin-left'),
    bottom: val('margin-bottom'),
    right: val('margin-right'),
    center: on('center'),
    clear: on('clear')
  });
  const closeLayout = () => layoutModal?.classList.add('hidden');
  const confirmLayout = () => {
    let r;
    try {
      r = guideLayout(state.guides, W(), H(), guideLayoutParams(fields()));
    } catch (err) {
      layoutError.textContent = err.message;
      return;
    }
    closeLayout();
    onLayout(r.guides);
  };
  if (layoutModal) {
    $('guide-layout-ok').addEventListener('click', confirmLayout);
    $('guide-layout-cancel').addEventListener('click', closeLayout);
    modalKeys(layoutModal, closeLayout, confirmLayout);
  }

  // Preferences › Guides, Grid & Slices: the grid's spacing and subdivisions.
  const gridModal = $('grid-prefs-modal');
  const closeGrid = () => gridModal?.classList.add('hidden');
  const confirmGrid = () => {
    closeGrid();
    onGrid(
      normalizeGrid({
        every: Number($('grid-prefs-every').value),
        subdivisions: Number($('grid-prefs-subdivisions').value)
      })
    );
  };
  if (gridModal) {
    $('grid-prefs-ok').addEventListener('click', confirmGrid);
    $('grid-prefs-cancel').addEventListener('click', closeGrid);
    modalKeys(gridModal, closeGrid, confirmGrid);
  }

  return {
    openGrid() {
      if (!gridModal) return;
      const g = normalizeGrid(state.grid);
      $('grid-prefs-every').value = String(g.every);
      $('grid-prefs-subdivisions').value = String(g.subdivisions);
      gridModal.classList.remove('hidden');
      setTimeout(() => $('grid-prefs-every').focus(), 50);
    },
    openNewGuide() {
      if (!guideModal) return;
      guideError.textContent = '';
      guideModal.classList.remove('hidden');
      setTimeout(() => position.focus(), 50);
    },
    openLayout() {
      if (!layoutModal) return;
      layoutError.textContent = '';
      layoutModal.classList.remove('hidden');
      setTimeout(() => $('guide-layout-columns').focus(), 50);
    }
  };
}
