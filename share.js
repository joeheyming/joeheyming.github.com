// Share button web component + related-projects widget.
// Usage: <share-button label="📤 Share" theme="gradient"></share-button>
//
// ShareButtonElement used to live here, then this file was rewritten as the
// related-projects FAB only — every <share-button> on the site became an
// empty undefined custom element. StepMania's CLS reserve then held a blank
// 6.5rem hole in the toolbar. Restore the CE first; the widget IIFE follows.

class ShareButtonElement extends HTMLElement {
  static get observedAttributes() {
    return ['title', 'text', 'url', 'theme', 'label'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._urlGenerator = null;
    this._textGenerator = null;
    this._titleGenerator = null;
  }

  connectedCallback() {
    if (window.self !== window.top) {
      this.style.display = 'none';
      return;
    }
    this.render();
    this.bindEvents();
  }

  attributeChangedCallback() {
    if (this.shadowRoot.innerHTML) {
      this.render();
      this.bindEvents();
    }
  }

  set urlGenerator(fn) {
    this._urlGenerator = fn;
  }
  get urlGenerator() {
    return this._urlGenerator;
  }
  set textGenerator(fn) {
    this._textGenerator = fn;
  }
  get textGenerator() {
    return this._textGenerator;
  }
  set titleGenerator(fn) {
    this._titleGenerator = fn;
  }
  get titleGenerator() {
    return this._titleGenerator;
  }

  get shareTitle() {
    if (typeof this._titleGenerator === 'function') return this._titleGenerator();
    return this.getAttribute('title') || document.title;
  }

  get shareText() {
    if (typeof this._textGenerator === 'function') return this._textGenerator();
    return this.getAttribute('text') || '';
  }

  get shareUrl() {
    if (typeof this._urlGenerator === 'function') return this._urlGenerator();
    if (this.getAttribute('url')) return this.getAttribute('url');
    if (typeof window.buildSharedUrl === 'function') {
      return window.buildSharedUrl('share_button');
    }
    return window.location.href;
  }

  get theme() {
    const t = this.getAttribute('theme') || 'primary';
    return t === 'gradient' ? 'primary' : t;
  }

  get label() {
    return this.getAttribute('label') || '📤 Share';
  }

  extractIcon(label) {
    const emojiMatch = label.match(
      /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u
    );
    return emojiMatch ? emojiMatch[0] : label.charAt(0);
  }

  extractText(label) {
    const emojiMatch = label.match(
      /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u
    );
    if (emojiMatch) return label.replace(emojiMatch[0], '').trim();
    return label;
  }

  getThemeStyles() {
    const themes = {
      primary: `
        background: var(--accent-primary-bg);
        color: var(--text-on-accent);
        border: 1px solid var(--accent-primary-bg-hover);
      `,
      dark: `
        background: var(--surface-1);
        color: var(--accent-primary);
        border: 1px solid var(--accent-primary);
      `,
      light: `
        background: var(--surface-1);
        color: var(--accent-primary);
        border: 1px solid var(--accent-primary);
      `,
      glass: `
        background: var(--accent-primary-bg);
        color: var(--text-on-accent);
        border: 1px solid var(--accent-primary-bg-hover);
      `,
      retro: `
        background: var(--surface-2, #1a1a2e);
        color: var(--success, #00ff00);
        border: 2px solid var(--success, #00ff00);
        font-family: var(--font-mono), 'Courier New', monospace;
      `,
      paper: `
        background: var(--accent-primary-bg);
        color: var(--text-on-accent);
        border: 1px solid var(--accent-primary-bg-hover);
      `
    };
    return themes[this.theme] || themes.primary;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        /* Reset the gradient-text trick (-webkit-background-clip: text +
           -webkit-text-fill-color: transparent) if an ancestor uses it.
           -webkit-text-fill-color is inherited and crosses the shadow
           boundary, so a <share-button> placed inside a gradient <h1>
           (periodic-speller) rendered as an accent-colored box with
           invisible label text. */
        :host {
          display: inline-block;
          -webkit-text-fill-color: currentColor;
        }
        .share-btn {
          ${this.getThemeStyles()}
          box-sizing: border-box;
          font-family: var(--font-ui), -apple-system, 'Segoe UI', Roboto, sans-serif;
          font-weight: 600;
          padding: 0.5rem 1.25rem;
          border-radius: var(--radius, 0.75rem);
          transition: all 0.2s ease;
          transform: scale(1);
          cursor: pointer;
          font-size: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          height: 2.5rem;
          min-height: 2.5rem;
          white-space: nowrap;
        }
        .share-btn .icon-only { display: none; }
        @media (max-width: 640px) {
          .share-btn {
            padding: 0.5rem !important;
            min-width: 2.5rem !important;
            min-height: 2.5rem !important;
            justify-content: center !important;
          }
          .share-btn .text-label { display: none !important; }
          .share-btn .icon-only {
            display: inline-block !important;
            font-size: 1.25rem !important;
          }
        }
        @media (max-width: 768px) {
          .share-btn {
            padding: 0.4rem 0.9rem;
            font-size: 13px;
            min-height: 2.25rem;
            gap: 0.35rem;
          }
        }
        .share-btn:hover {
          transform: scale(1.04);
          filter: brightness(0.96);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }
        .share-btn:active { transform: scale(0.95); }
        .share-btn:focus-visible {
          outline: 2px solid var(--focus-ring-inner, #1a73e8);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px var(--focus-ring-outer, rgba(26, 115, 232, 0.25));
        }
        .tooltip {
          position: fixed;
          background: var(--surface-2, #1f2937);
          color: var(--text-1, #fff);
          font-size: 0.8rem;
          border-radius: var(--radius, 0.5rem);
          padding: 0.5rem 0.75rem;
          opacity: 0;
          visibility: hidden;
          transition: all 0.2s ease;
          pointer-events: none;
          white-space: nowrap;
          z-index: 10000;
          transform: translateX(-50%);
        }
        .tooltip.show { opacity: 1; visibility: visible; }
        .tooltip.success { background: var(--success, #10b981); color: #fff; }
        .tooltip.error { background: var(--danger, #ef4444); color: #fff; }
      </style>
      <button type="button" class="share-btn" id="share-btn" aria-label="Share this page">
        <span class="icon-only">${this.extractIcon(this.label)}</span>
        <span class="text-label">${this.extractText(this.label)}</span>
      </button>
      <div class="tooltip" id="tooltip" role="status"></div>
    `;
  }

  bindEvents() {
    const btn = this.shadowRoot.getElementById('share-btn');
    btn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.handleShare();
    });
  }

  async handleShare() {
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('share', 'share_button', window.location.pathname);
    }
    if (typeof window.trackConversion === 'function') {
      window.trackConversion('content_shared', 1);
    }

    const shareData = {
      title: this.shareTitle,
      text: this.shareText,
      url: this.shareUrl
    };

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    if (navigator.share && window.isSecureContext && isMobile) {
      try {
        await navigator.share(shareData);
        this.showTooltip('Shared!', 'success');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    await this.copyToClipboard();
  }

  async copyToClipboard() {
    const textToCopy = this.shareText ? `${this.shareText} ${this.shareUrl}` : this.shareUrl;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const input = document.createElement('input');
        input.value = textToCopy;
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      this.showTooltip('Link copied!', 'success');
    } catch (error) {
      console.error('Failed to copy:', error);
      this.showTooltip('Copy failed', 'error');
    }
  }

  showTooltip(message, type) {
    const tooltip = this.shadowRoot.getElementById('tooltip');
    const button = this.shadowRoot.getElementById('share-btn');
    if (!tooltip || !button) return;
    tooltip.textContent = message;
    tooltip.className = `tooltip ${type} show`;
    const rect = button.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top - 40}px`;
    setTimeout(() => tooltip.classList.remove('show'), 2000);
  }
}

if (!customElements.get('share-button')) {
  customElements.define('share-button', ShareButtonElement);
}
window.ShareButton = ShareButtonElement;

// Related Projects Component
// Include this script on project pages to suggest related projects

(function () {
  'use strict';

  // Capture our own <script> tag immediately. `document.currentScript` is
  // only defined during the synchronous execution of this file, so we read
  // its data attributes here before any async DOM work could shadow it.
  // Matches the convention used by /nav.js (`data-nav-size="compact"`).
  const scriptTag = document.currentScript;

  // Only run once
  if (window.relatedProjectsInitialized) return;
  window.relatedProjectsInitialized = true;

  // Don't show on the home page
  if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
    return;
  }

  // Generic opt-out for the one-click share FAB. A page that ships its own
  // dedicated share affordance (e.g. doom/share-button.js) can set
  // `data-share-fab="off"` on the share.js <script> tag to suppress the
  // generic floating button. The related-projects 🎯 panel still renders
  // so cross-app discovery is preserved. No page-specific allow-list lives
  // in this file.
  const shareFabSuppressed = scriptTag?.dataset.shareFab === 'off';

  // Kick off the registry fetch as early as possible, in parallel with the
  // DOMContentLoaded wait. Previously this was a synchronous XHR which
  // blocked DOMContentLoaded on every page that included share.js — that
  // delayed first paint and stretched the timeline so other shifts (font
  // swap, JS-rendered grids) more easily landed inside CLS's 5-second
  // measurement window. The widget itself is `position: fixed`, so deferring
  // its insertion until after the registry resolves never affects document
  // flow.
  async function loadAppsRegistry() {
    try {
      const res = await fetch('/apps-registry.json', { cache: 'default' });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[share.js] Could not load apps-registry.json', e);
      return [];
    }
  }

  const registryMapsPromise = loadAppsRegistry().then((registryApps) => {
    const projectRelationships = {};
    const projectMetadata = {};
    for (const app of registryApps) {
      projectMetadata[app.id] = {
        name: app.shortName || app.name,
        icon: app.icon || '📦',
        description: app.description || ''
      };
      if (app.related && app.related.length) {
        projectRelationships[app.id] = {
          category: app.shareCategory || app.category || 'utility',
          related: app.related
        };
      }
    }
    return { projectRelationships, projectMetadata };
  });

  // Get current project from URL
  function getCurrentProject() {
    const path = window.location.pathname;
    const segments = path.split('/').filter((s) => s);
    return segments[0] || null;
  }

  // Create related projects widget
  function createRelatedProjects(projectRelationships, projectMetadata) {
    const currentProject = getCurrentProject();
    if (!currentProject || !projectRelationships[currentProject]) {
      return null;
    }

    const relatedIds = projectRelationships[currentProject].related;
    if (!relatedIds || relatedIds.length === 0) {
      return null;
    }

    // Take first 3 related projects
    const relatedProjects = relatedIds.slice(0, 3).map((id) => ({
      id,
      ...projectMetadata[id]
    }));

    const container = document.createElement('div');
    container.className = 'related-projects-container';
    container.id = 'related-projects-widget';
    container.innerHTML = `
      <button class="related-projects-toggle" aria-label="View related projects" title="More projects like this">
        🎯
      </button>
      <div class="related-projects-panel" aria-hidden="true">
        <button class="related-projects-close" aria-label="Close suggestions" title="Close">
          ×
        </button>
        <div class="related-projects-header">
          <h3>🎯 You might also like</h3>
        </div>
        <div class="related-projects-grid">
          ${relatedProjects
            .map(
              (project) => `
            <a href="/${project.id}/" 
               class="related-project-card"
               data-event="related_project_click"
               data-event-category="Engagement"
               data-event-label="${project.name}">
              <div class="related-project-icon">${project.icon}</div>
              <div class="related-project-info">
                <div class="related-project-name">${project.name}</div>
                <div class="related-project-description">${project.description}</div>
              </div>
            </a>
          `
            )
            .join('')}
        </div>
        <div class="related-projects-footer">
          <a href="/" 
             data-event="view_all_from_related"
             data-event-category="Engagement"
             data-event-label="${currentProject}">
            View all projects →
          </a>
          <button class="share-btn-mini" id="share-url-btn-mini" title="Copy link to clipboard">
            🔗 Share
          </button>
          <button class="feedback-btn-mini" id="feedback-btn-mini" title="Send Feedback">
            💬 Feedback
          </button>
        </div>
      </div>
    `;

    // Toggle functionality
    const toggleBtn = container.querySelector('.related-projects-toggle');
    const panel = container.querySelector('.related-projects-panel');

    function closePanel() {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('related-panel-open');
      document.removeEventListener('click', closePanelFromOutside);
      document.removeEventListener('keydown', closePanelOnEscape);
    }

    function closePanelFromOutside(e) {
      if (!container.contains(e.target)) closePanel();
    }

    function closePanelOnEscape(e) {
      if (e.key !== 'Escape') return;
      closePanel();
      e.stopPropagation();
    }

    function openPanel() {
      panel.classList.add('open');
      panel.setAttribute('aria-hidden', 'false');
      // Signal canvas/WebGL apps to demote their surfaces — on mobile WebKit
      // accelerated canvases can composite above position:fixed UI regardless
      // of z-index (see untangle/ and similar full-bleed canvas pages).
      document.body.classList.add('related-panel-open');
      document.addEventListener('click', closePanelFromOutside);
      document.addEventListener('keydown', closePanelOnEscape);
    }

    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent triggering parent elements
      const isOpen = panel.classList.contains('open');

      if (isOpen) {
        closePanel();
      } else {
        openPanel();
        // Track opening
        if (window.trackEvent) {
          window.trackEvent('related_projects_opened', 'Engagement', currentProject);
        }
      }
    });

    // Close button functionality
    const closeBtn = container.querySelector('.related-projects-close');
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
    });

    // Prevent clicks inside panel from closing it
    panel.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Share button: copy current URL to clipboard
    const shareBtn = container.querySelector('#share-url-btn-mini');
    if (shareBtn) {
      shareBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Tag the URL so visitors who paste it land with `shared=1&share_source=related_widget`,
        // which `trackSharedLinkArrival` in analytics.js converts to `shared_link_arrival`.
        const url =
          typeof window.buildSharedUrl === 'function'
            ? window.buildSharedUrl('related_widget')
            : window.location.href;
        navigator.clipboard
          .writeText(url)
          .then(() => {
            const origText = shareBtn.innerHTML;
            shareBtn.innerHTML = '✓ Copied!';
            shareBtn.disabled = true;
            setTimeout(() => {
              shareBtn.innerHTML = origText;
              shareBtn.disabled = false;
            }, 1500);
          })
          .catch(() => {
            shareBtn.innerHTML = 'Copy failed';
            setTimeout(() => {
              shareBtn.innerHTML = '🔗 Share';
            }, 2000);
          });
        if (window.trackEvent) {
          window.trackEvent('share_url_click', 'Engagement', currentProject);
          // GA4-standard `share` event in parallel with the custom one so
          // GA4's built-in share reporting picks it up too. Label encodes
          // surface + page so the standard event is still triagable.
          window.trackEvent('share', 'related_widget', currentProject);
        }
        if (window.trackConversion) {
          window.trackConversion('content_shared', 1);
        }
      });
    }

    // Feedback button functionality
    const feedbackBtn = container.querySelector('#feedback-btn-mini');
    if (feedbackBtn) {
      feedbackBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Track feedback click
        if (window.trackEvent) {
          window.trackEvent('feedback_opened_from_related', 'Engagement', currentProject);
        }

        // Close the related-projects panel first so it doesn’t cover the modal
        closePanel();

        // Prefer existing feedback-button on the page; call openModal() directly
        const existingFeedback = document.querySelector('feedback-button');
        if (existingFeedback && typeof existingFeedback.openModal === 'function') {
          existingFeedback.openModal();
          return;
        }

        // Fallback: create an instance with trigger hidden (so modal can paint). Do not use display:none on host or the modal won’t show.
        if (typeof window.FeedbackButton !== 'undefined') {
          const tempFeedback = document.createElement('feedback-button');
          tempFeedback.setAttribute('label', '💬 Feedback');
          tempFeedback.setAttribute('theme', 'gradient');
          tempFeedback.setAttribute('hide-trigger', '');
          document.body.appendChild(tempFeedback);
          requestAnimationFrame(() => {
            if (typeof tempFeedback.openModal === 'function') {
              tempFeedback.openModal();
            }
          });
        } else {
          alert('Feedback feature is loading. Please try again in a moment.');
        }
      });
    }

    return container;
  }

  // Add styles
  //
  // Phase 3 of the brand pivot re-skinned the related-projects widget
  // for the new heyming-engineering palette: paper surfaces, blue
  // accents, no glass/gradients. Geometry preserved (positioning,
  // toggle size, slide animation).
  const style = document.createElement('style');
  style.textContent = `
    .related-projects-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9000;
      font-family: var(--font-ui), -apple-system, 'Segoe UI', Roboto, sans-serif;
    }

    /* Adjust position if there's another button in bottom-right (like info button) */
    body:has(.info-btn) .related-projects-container,
    body:has(#info-btn) .related-projects-container {
      bottom: 85px;
    }

    .related-projects-toggle {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 1px solid var(--accent-primary-bg-hover);
      background: var(--accent-primary-bg);
      color: var(--text-on-accent);
      font-size: 24px;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      z-index: 9001;
    }

    .related-projects-toggle:hover {
      transform: scale(1.05);
      background: var(--accent-primary-bg-hover);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    }

    .related-projects-toggle:active {
      transform: scale(1.02);
    }

    .related-projects-panel {
      position: absolute;
      bottom: 70px;
      right: 0;
      max-width: 360px;
      width: 360px;
      background: var(--surface-1);
      border-radius: var(--radius-lg);
      padding: 20px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      border: 1px solid var(--hairline-strong);
      opacity: 0;
      visibility: hidden;
      transform: translateY(10px) scale(0.95);
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .related-projects-panel.open {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    .related-projects-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 28px;
      height: 28px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-2);
      border-radius: 50%;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      padding: 0;
      font-weight: 300;
    }

    .related-projects-close:hover {
      background: var(--accent-primary-soft);
      color: var(--accent-primary-hover);
    }

    .related-projects-header h3 {
      margin: 0 0 16px 0;
      font-family: var(--font-display), Georgia, serif;
      font-size: 18px;
      font-weight: 700;
      color: var(--text-1);
      letter-spacing: -0.005em;
    }

    .related-projects-grid {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }

    .related-project-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      background: var(--surface-1);
      border-radius: var(--radius);
      text-decoration: none;
      color: inherit;
      transition: all 0.2s ease;
      border: 1px solid var(--hairline);
    }

    .related-project-card:hover {
      transform: translateX(-2px);
      background: var(--accent-primary-soft);
      border-color: var(--hairline-accent);
    }

    .related-project-icon {
      font-size: 32px;
      line-height: 1;
      flex-shrink: 0;
    }

    .related-project-info {
      flex: 1;
      min-width: 0;
    }

    .related-project-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-1);
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .related-project-description {
      font-size: 12px;
      color: var(--text-2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .related-projects-footer {
      padding-top: 12px;
      border-top: 1px solid var(--hairline);
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .related-projects-footer a {
      display: inline-block;
      font-size: 13px;
      font-weight: 600;
      color: var(--accent-primary);
      text-decoration: underline;
      text-underline-offset: 2px;
      padding: 6px 12px;
      border-radius: var(--radius);
      transition: all 0.2s ease;
    }

    .related-projects-footer a:hover {
      background: #fffacd;
      color: var(--accent-primary-hover);
    }

    .share-btn-mini,
    .feedback-btn-mini {
      display: inline-block;
      font-size: 13px;
      font-weight: 600;
      color: var(--accent-primary);
      background: var(--surface-1);
      border: 1px solid var(--hairline-strong);
      padding: 6px 12px;
      border-radius: var(--radius);
      transition: all 0.2s ease;
      cursor: pointer;
      text-align: center;
    }

    .share-btn-mini:hover:not(:disabled),
    .feedback-btn-mini:hover {
      background: var(--accent-primary-soft);
      border-color: var(--accent-primary);
    }

    .share-btn-mini:disabled {
      cursor: default;
      opacity: 0.9;
    }

    /* One-click share FAB — lives inside .related-projects-container so it
     * inherits the bottom-right anchor + the body:has(.info-btn) shift, and
     * stacks ABOVE the 🎯 toggle. Smaller than the toggle so visual weight
     * stays on the primary related-projects entry point. */
    .share-fab {
      position: absolute;
      bottom: 68px;
      right: 6px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 1px solid var(--hairline-strong);
      background: var(--surface-1);
      color: var(--accent-primary);
      font-size: 18px;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      transition: background var(--motion-hover, 180ms ease),
        border-color var(--motion-hover, 180ms ease),
        transform var(--motion-hover, 180ms ease);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9001;
    }
    .share-fab:hover {
      background: var(--accent-primary-soft);
      border-color: var(--accent-primary);
      transform: scale(1.05);
    }
    .share-fab:active {
      transform: scale(1.02);
    }
    .share-fab--success {
      background: var(--success, #22863a);
      color: #fff;
      border-color: var(--success, #22863a);
    }

    /* Mobile responsive */
    @media (max-width: 768px) {
      .related-projects-container {
        bottom: 80px;
        right: 12px;
      }

      .related-projects-toggle {
        width: 48px;
        height: 48px;
        font-size: 20px;
      }

      .share-fab {
        width: 38px;
        height: 38px;
        font-size: 16px;
        bottom: 58px;
        right: 5px;
      }

      .related-projects-panel {
        width: calc(100vw - 24px);
        right: 0;
        max-width: none;
        padding: 16px;
      }

      .related-projects-header h3 {
        font-size: 15px;
      }

      .related-project-icon {
        font-size: 28px;
      }

      .related-project-name {
        font-size: 13px;
      }

      .related-project-description {
        font-size: 13px;
      }
    }

    /* Print - hide widget */
    @media print {
      .related-projects-container {
        display: none !important;
      }
    }

    /* Hide on very small screens to avoid overlap */
    @media (max-height: 600px) {
      .related-projects-container {
        display: none;
      }
    }

    /* Small mobile adjustment */
    @media (max-width: 640px) {
      .related-projects-container {
        bottom: 12px;
        right: 12px;
      }
    }
  `;

  // ─── One-click share FAB ────────────────────────────────────────────
  //
  // The existing "🔗 Share" button lives two clicks deep inside the 🎯
  // related-projects panel, so almost nobody finds it (only a couple of
  // `shared_link_arrival` events per month across the whole site pre-FAB).
  // This FAB sits next to the 🎯 toggle and shares in one click.
  // share_source tag is `share_fab` so GA can attribute arrivals.
  function createShareFab() {
    if (shareFabSuppressed) return null;
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'share-fab';
    fab.setAttribute('aria-label', 'Share this page');
    fab.setAttribute('title', 'Share');
    fab.innerHTML = '🔗';

    fab.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url =
        typeof window.buildSharedUrl === 'function'
          ? window.buildSharedUrl('share_fab')
          : window.location.href;

      if (window.trackEvent) {
        window.trackEvent('share_fab_click', 'Engagement', window.location.pathname);
        // GA4-standard `share` event in parallel — see comment in the
        // related-widget share handler above.
        window.trackEvent('share', 'share_fab', window.location.pathname);
      }
      if (window.trackConversion) {
        window.trackConversion('content_shared', 1);
      }

      if (navigator.share && window.isSecureContext) {
        try {
          await navigator.share({ url, title: document.title });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          // Fall through to clipboard.
        }
      }

      try {
        await navigator.clipboard.writeText(url);
        const original = fab.innerHTML;
        fab.innerHTML = '✓';
        fab.classList.add('share-fab--success');
        setTimeout(() => {
          fab.innerHTML = original;
          fab.classList.remove('share-fab--success');
        }, 1500);
      } catch (_) {
        const original = fab.innerHTML;
        fab.innerHTML = '✗';
        setTimeout(() => {
          fab.innerHTML = original;
        }, 1500);
      }
    });

    return fab;
  }

  // Insert when DOM is ready AND the registry has resolved. Both conditions
  // are awaited independently so neither blocks the other. The widget is
  // position: fixed, so inserting it slightly later than DOMContentLoaded
  // never causes a layout shift.
  function domReady() {
    if (document.readyState !== 'loading') return Promise.resolve();
    return new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }

  async function insertWidget() {
    const [{ projectRelationships, projectMetadata }] = await Promise.all([
      registryMapsPromise,
      domReady()
    ]);
    const widget = createRelatedProjects(projectRelationships, projectMetadata);
    if (widget) {
      document.head.appendChild(style);
      document.body.appendChild(widget);
      const fab = createShareFab();
      if (fab) widget.appendChild(fab);
    }
  }

  insertWidget();
})();
