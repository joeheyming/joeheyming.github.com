/**
 * Netflix / Hulu-inspired streaming home used only for OG previews and
 * search-crawler renders. Humans never see this — {@link ./shows-view.js}
 * early-returns here when {@link ../preview-catalog.js#shouldUsePreviewCatalog}
 * is true.
 */

import { getPreviewHome } from '../preview-catalog.js';

/**
 * @param {HTMLElement} slot
 * @returns {{ unmount: () => void }}
 */
export function mountPreviewHome(slot) {
  const home = getPreviewHome();
  document.documentElement.classList.add('tv-stream-preview');

  const root = document.createElement('section');
  root.className = 'tv-stream-home';
  root.setAttribute('aria-label', 'Watch preview');

  // Top bar — wordmark only.
  const top = document.createElement('header');
  top.className = 'tv-stream-top';
  const brand = document.createElement('div');
  brand.className = 'tv-stream-brand';
  brand.innerHTML =
    '<span class="tv-stream-brand-emoji" aria-hidden="true">📺</span><span>Watch</span>';
  top.appendChild(brand);
  root.appendChild(top);

  // Hero billboard.
  const hero = document.createElement('div');
  hero.className = 'tv-stream-hero';
  hero.style.setProperty('--hero-accent', home.hero.accent);
  hero.dataset.hero = home.hero.id;

  const heroGlow = document.createElement('div');
  heroGlow.className = 'tv-stream-hero-glow';
  heroGlow.setAttribute('aria-hidden', 'true');
  heroGlow.textContent = home.hero.emoji;

  const heroBody = document.createElement('div');
  heroBody.className = 'tv-stream-hero-body';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'tv-stream-hero-eyebrow';
  eyebrow.textContent = home.hero.name;

  const headline = document.createElement('h1');
  headline.className = 'tv-stream-hero-headline';
  headline.textContent = home.hero.headline;

  const tagline = document.createElement('p');
  tagline.className = 'tv-stream-hero-tagline';
  tagline.textContent = home.hero.tagline;

  const cta = document.createElement('span');
  cta.className = 'tv-stream-hero-cta';
  cta.textContent = `▶ ${home.hero.cta}`;

  heroBody.appendChild(eyebrow);
  heroBody.appendChild(headline);
  heroBody.appendChild(tagline);
  heroBody.appendChild(cta);
  hero.appendChild(heroGlow);
  hero.appendChild(heroBody);
  root.appendChild(hero);

  // Horizontal rails.
  const railsWrap = document.createElement('div');
  railsWrap.className = 'tv-stream-rails';

  for (const rail of home.rails) {
    const section = document.createElement('section');
    section.className = 'tv-stream-rail';
    section.dataset.rail = rail.id;

    const label = document.createElement('h2');
    label.className = 'tv-stream-rail-title';
    label.textContent = rail.title;

    const track = document.createElement('div');
    track.className = 'tv-stream-rail-track';
    track.setAttribute('role', 'list');

    for (const item of rail.items) {
      const card = document.createElement('div');
      card.className = 'tv-stream-tile';
      card.setAttribute('role', 'listitem');
      card.dataset.tile = item.id;
      card.style.setProperty('--tile-accent', item.accent);

      const poster = document.createElement('div');
      poster.className = 'tv-stream-tile-poster';
      poster.setAttribute('aria-hidden', 'true');
      poster.textContent = item.emoji;

      const name = document.createElement('div');
      name.className = 'tv-stream-tile-name';
      name.textContent = item.shortName || item.name;

      card.appendChild(poster);
      card.appendChild(name);
      track.appendChild(card);
    }

    section.appendChild(label);
    section.appendChild(track);
    railsWrap.appendChild(section);
  }

  root.appendChild(railsWrap);
  slot.replaceChildren(root);

  return {
    unmount() {
      document.documentElement.classList.remove('tv-stream-preview');
      root.remove();
    }
  };
}
