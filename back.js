/**
 * back.js - Site navigation for joeheyming.github.io
 *
 * Creates:
 * 1. A back button (top-left) for user navigation
 * 2. A site footer nav with links to main pages (SEO-friendly, no Shadow DOM)
 *
 * Note: We intentionally avoid Shadow DOM so Google can crawl the links.
 */

// Site pages for navigation (add new pages here)
const SITE_PAGES = [
  { href: '/', label: '🦄 Home', highlight: true },
  { href: '/wordle-finder/', label: 'Wordle' },
  { href: '/stepmania/', label: 'StepMania' },
  { href: '/calculator/', label: 'Calculator' },
  { href: '/terminal/', label: 'Terminal' },
  { href: '/doom/', label: 'Doom' },
  { href: '/notepad/', label: 'Notepad' },
  { href: '/nes/', label: 'NES' }
];

function createBackButton() {
  // if inside iframe, do nothing
  if (window.self !== window.top) return null;

  const currentPath = window.location.pathname.replace(/.*\.html$/, '');
  const href = currentPath.split('/').filter(Boolean).slice(0, -1).join('/') || '/';

  // Don't show on homepage
  if (currentPath === '/' || currentPath === '') return null;

  const container = document.createElement('div');
  container.id = 'site-back-button';
  container.innerHTML = `
    <a href="${href}" title="Back" style="
      position: fixed;
      top: 15px;
      left: 15px;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 50%;
      font-size: 18px;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.05);
      text-decoration: none;
      color: #374151;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      opacity: 0.7;
      transition: all 0.2s ease;
    ">←</a>
  `;

  // Add hover effect via JS since we can't use :hover with inline styles
  const link = container.querySelector('a');
  link.addEventListener('mouseenter', () => {
    link.style.opacity = '1';
    link.style.transform = 'translateY(-1px) scale(1.05)';
    link.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.08)';
  });
  link.addEventListener('mouseleave', () => {
    link.style.opacity = '0.7';
    link.style.transform = 'none';
    link.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.05)';
  });

  return container;
}

function createSiteNav() {
  // if inside iframe, do nothing
  if (window.self !== window.top) return null;

  // Hide footer on mobile devices
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
  if (isMobile) {
    return null;
  }

  // Don't add nav to homepage (it has its own navigation)
  const currentPath = window.location.pathname.replace(/.*\.html$/, '');
  if (currentPath === '/' || currentPath === '') return null;

  // Filter out current page from nav
  const navPages = SITE_PAGES.filter((page) => {
    const pagePath = page.href.replace(/\/$/, '') || '/';
    const current = currentPath.replace(/\/$/, '') || '/';
    return pagePath !== current;
  });

  const nav = document.createElement('nav');
  nav.id = 'site-footer-nav';
  nav.setAttribute('aria-label', 'Site navigation');

  // Build links HTML
  const linksHtml = navPages
    .map((page) => {
      const color = page.highlight ? '#a78bfa' : '#9ca3af';
      return `<a href="${page.href}" style="
      color: ${color};
      text-decoration: none;
      margin: 0 8px;
      transition: color 0.2s ease;
    ">${page.label}</a>`;
    })
    .join('');

  nav.innerHTML = `
    <div style="
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 100%);
      padding: 10px 16px;
      font-size: 13px;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 9998;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-top: 1px solid rgba(255,255,255,0.1);
    ">
      ${linksHtml}
    </div>
  `;

  // Add hover effects
  nav.querySelectorAll('a').forEach((link) => {
    const originalColor = link.style.color;
    link.addEventListener('mouseenter', () => {
      link.style.color = '#ffffff';
    });
    link.addEventListener('mouseleave', () => {
      link.style.color = originalColor;
    });
  });

  return nav;
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const backButton = createBackButton();
  if (backButton) {
    document.body.appendChild(backButton);
  }

  const siteNav = createSiteNav();
  if (siteNav) {
    document.body.appendChild(siteNav);
  }
});
