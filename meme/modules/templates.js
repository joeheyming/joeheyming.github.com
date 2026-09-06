// modules/templates.js
//
// Loads templates.json, renders the left-sidebar gallery, and exposes
// `selectTemplate(id)` to load a template's image and seed state.

import * as store from './state.js';

const TEMPLATES_JSON = './templates.json';
let templates = [];
let onSelectCb = null;

export async function init({ gridEl, searchEl, onSelect }) {
  onSelectCb = onSelect;
  const res = await fetch(TEMPLATES_JSON);
  templates = await res.json();
  // Pre-attach the relative image URL so callers don't have to know
  // about the templates/ directory layout.
  for (const t of templates) t.src = `templates/${t.file}`;
  renderGrid(gridEl, templates);

  if (searchEl) {
    searchEl.addEventListener('input', () => {
      const q = searchEl.value.trim().toLowerCase();
      const filtered = !q
        ? templates
        : templates.filter((t) => t.name.toLowerCase().includes(q) || t.id.includes(q));
      renderGrid(gridEl, filtered);
    });
  }

  store.subscribe(() => {
    const sel = store.get().template?.id;
    for (const card of gridEl.querySelectorAll('.tpl-card')) {
      card.classList.toggle('is-selected', card.dataset.id === sel);
    }
  });
}

function renderGrid(gridEl, list) {
  gridEl.innerHTML = '';
  if (list.length === 0) {
    gridEl.innerHTML =
      '<p class="hint" style="grid-column:1/-1;padding:8px;">No templates match that search.</p>';
    return;
  }
  for (const t of list) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tpl-card';
    card.dataset.id = t.id;
    card.setAttribute('role', 'option');
    card.title = t.name;
    card.innerHTML = `
      <img src="${t.src}" alt="${t.name}" loading="lazy" />
      <span class="tpl-card-label">${escapeHtml(t.name)}</span>
    `;
    card.addEventListener('click', () => selectTemplate(t.id));
    gridEl.appendChild(card);
  }
}

/**
 * Load a template by id.
 *
 * @param {string} id
 */
export function selectTemplate(id) {
  const t = templates.find((x) => x.id === id);
  if (!t) return;
  // Load image to discover natural size (templates.json claims it but
  // we trust the actual loaded pixels for canvas math).
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    store.setTemplate(
      { id: t.id, name: t.name, src: t.src, defaultBoxes: t.defaultBoxes, boxCount: t.boxCount },
      t.src,
      { w: img.naturalWidth, h: img.naturalHeight }
    );
    onSelectCb?.(img);
  };
  img.onerror = () => {
    console.warn('Template failed to load:', t.src);
  };
  img.src = t.src;
}

function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function loadCustomImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        store.setCustomImage(dataUrl, { w: img.naturalWidth, h: img.naturalHeight });
        resolve(img);
      };
      img.onerror = reject;
      img.src = dataUrl;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
