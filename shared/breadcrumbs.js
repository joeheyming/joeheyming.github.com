/**
 * Shared breadcrumb chrome (same pattern as /watch/).
 *
 * Each crumb is either a clickable link or a plain non-link span for the
 * current page. Optional `onNavigate(href)` enables SPA-style clicks
 * (modifier keys / middle-click still use the real href). Without it,
 * links navigate normally — what multi-page apps like /play/ need.
 *
 * Also auto-mounts any `nav.app-breadcrumbs[data-crumbs]` whose
 * `data-crumbs` attribute is a JSON array of Crumb objects.
 *
 * @typedef {Object} Crumb
 * @property {string} label
 * @property {string} [href]   Omit for the current page.
 * @property {string} [emoji]  Optional emoji rendered before the label.
 */
(function (global) {
  'use strict';

  /**
   * @param {HTMLElement} container
   * @param {Crumb[]} crumbs
   * @param {(href: string) => void} [onNavigate]
   */
  function renderBreadcrumbs(container, crumbs, onNavigate) {
    if (!container) return;
    container.replaceChildren();

    if (crumbs.length > 1) {
      const parent = crumbs[crumbs.length - 2];
      const parentHref = parent?.href ?? '';
      const back = document.createElement('a');
      back.className = 'app-crumb-back';
      back.setAttribute('aria-label', `Back to ${parent?.label ?? 'previous page'}`);
      back.href = parentHref || './';
      back.textContent = '←';
      attachNav(back, parentHref, onNavigate);
      container.appendChild(back);
    }

    crumbs.forEach((crumb, idx) => {
      if (idx > 0) {
        const sep = document.createElement('span');
        sep.className = 'app-crumb-sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '›';
        container.appendChild(sep);
      }
      const labelText = crumb.emoji ? `${crumb.emoji} ${crumb.label}` : crumb.label;
      if (crumb.href !== undefined) {
        const a = document.createElement('a');
        a.className = 'app-crumb';
        a.href = crumb.href || './';
        a.textContent = labelText;
        attachNav(a, crumb.href, onNavigate);
        container.appendChild(a);
      } else {
        const span = document.createElement('span');
        span.className = 'app-crumb app-crumb--current';
        span.setAttribute('aria-current', 'page');
        span.textContent = labelText;
        container.appendChild(span);
      }
    });
  }

  /**
   * @param {HTMLAnchorElement} a
   * @param {string} href
   * @param {(href: string) => void} [onNavigate]
   */
  function attachNav(a, href, onNavigate) {
    if (typeof onNavigate !== 'function') return;
    a.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      onNavigate(href || '');
    });
  }

  function mountFromDataAttrs(root) {
    const scope = root || document;
    scope.querySelectorAll('nav.app-breadcrumbs[data-crumbs]').forEach((nav) => {
      const raw = nav.getAttribute('data-crumbs');
      if (!raw) return;
      try {
        const crumbs = JSON.parse(raw);
        if (Array.isArray(crumbs)) renderBreadcrumbs(nav, crumbs);
      } catch (err) {
        console.warn('[breadcrumbs] bad data-crumbs JSON', err);
      }
    });
  }

  function boot() {
    mountFromDataAttrs(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.renderBreadcrumbs = renderBreadcrumbs;
  global.mountBreadcrumbsFromDataAttrs = mountFromDataAttrs;
})(typeof window !== 'undefined' ? window : globalThis);
