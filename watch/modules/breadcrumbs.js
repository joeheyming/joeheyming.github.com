/**
 * Breadcrumb chrome for /watch/.
 *
 * Each crumb is either a clickable link (which calls `onNavigate(href)`
 * via the router instead of doing a hard navigation) or a plain
 * non-link span for the current page.
 *
 * The breadcrumb lives in the page header and gets rebuilt on every
 * route change — there's no per-crumb state to preserve.
 */

/**
 * @typedef {Object} Crumb
 * @property {string} label
 * @property {string} [href]     Search string ("?show=simpsons"). Omit for the current page.
 * @property {string} [emoji]    Optional emoji rendered before the label.
 */

/**
 * Replace the breadcrumb contents with a fresh trail.
 *
 * @param {HTMLElement} container
 * @param {Crumb[]} crumbs
 * @param {(href: string) => void} onNavigate   Called when a crumb link is clicked.
 */
export function renderBreadcrumbs(container, crumbs, onNavigate) {
  container.replaceChildren();
  // A leading "← Back" affordance gives the user a one-click way to
  // step up the breadcrumb. We don't show it on the root page (the
  // global /back.js button covers leaving the app entirely).
  if (crumbs.length > 1) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'tv-crumb-back';
    back.setAttribute('aria-label', 'Back');
    back.textContent = '←';
    back.addEventListener('click', (e) => {
      e.preventDefault();
      const parent = crumbs[crumbs.length - 2];
      if (parent?.href !== undefined) onNavigate(parent.href);
    });
    container.appendChild(back);
  }

  crumbs.forEach((crumb, idx) => {
    if (idx > 0) {
      const sep = document.createElement('span');
      sep.className = 'tv-crumb-sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '›';
      container.appendChild(sep);
    }
    const labelText = crumb.emoji ? `${crumb.emoji} ${crumb.label}` : crumb.label;
    if (crumb.href !== undefined) {
      const a = document.createElement('a');
      a.className = 'tv-crumb';
      a.href = crumb.href || './';
      a.textContent = labelText;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        onNavigate(crumb.href || '');
      });
      container.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.className = 'tv-crumb tv-crumb--current';
      span.setAttribute('aria-current', 'page');
      span.textContent = labelText;
      container.appendChild(span);
    }
  });
}
