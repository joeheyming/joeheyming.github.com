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
  // global /back.js button covers leaving the app entirely). It's a
  // real <a> (not a <button>) so Cmd-click / middle-click open the
  // parent crumb in a new tab.
  if (crumbs.length > 1) {
    const parent = crumbs[crumbs.length - 2];
    const parentHref = parent?.href ?? '';
    const back = document.createElement('a');
    back.className = 'tv-crumb-back';
    back.setAttribute('aria-label', `Back to ${parent?.label ?? 'previous page'}`);
    back.href = parentHref || './';
    back.textContent = '←';
    attachSpaNav(back, parentHref, onNavigate);
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
      attachSpaNav(a, crumb.href, onNavigate);
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

/**
 * Wire SPA navigation onto a real <a> while preserving every
 * native "open this somewhere else" affordance: Cmd/Ctrl-click,
 * Shift-click, middle-click, and right-click → "open in new tab"
 * all bypass `onNavigate` and let the browser follow the href.
 *
 * @param {HTMLAnchorElement} a
 * @param {string} href                       Search-string fragment ("?show=simpsons") or "".
 * @param {(href: string) => void} onNavigate
 */
function attachSpaNav(a, href, onNavigate) {
  a.addEventListener('click', (e) => {
    // Modifier keys or non-primary button = user wants the browser's
    // native behaviour (new tab / new window / save link / etc.).
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate(href || '');
  });
}
