// Related Projects Component
// Include this script on project pages to suggest related projects

(function () {
  'use strict';

  // Only run once
  if (window.relatedProjectsInitialized) return;
  window.relatedProjectsInitialized = true;

  // Don't show on the home page
  if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
    return;
  }

  function loadAppsRegistryForShareSync() {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/apps-registry.json', false);
      xhr.send(null);
      const ok = xhr.status === 200 || xhr.status === 304 || xhr.status === 0;
      if (!ok) return [];
      const data = JSON.parse(xhr.responseText);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[share.js] Could not load apps-registry.json', e);
      return [];
    }
  }

  const registryApps = loadAppsRegistryForShareSync();
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

  // Get current project from URL
  function getCurrentProject() {
    const path = window.location.pathname;
    const segments = path.split('/').filter((s) => s);
    return segments[0] || null;
  }

  // Create related projects widget
  function createRelatedProjects() {
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
      <div class="related-projects-panel">
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

    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent triggering parent elements
      const isOpen = panel.classList.contains('open');

      if (isOpen) {
        panel.classList.remove('open');
      } else {
        panel.classList.add('open');
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
      panel.classList.remove('open');
    });

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
      if (panel.classList.contains('open') && !container.contains(e.target)) {
        panel.classList.remove('open');
      }
    });

    // Close panel on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) {
        panel.classList.remove('open');
        e.stopPropagation();
      }
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
        const url = window.location.href;
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
        panel.classList.remove('open');

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
  const style = document.createElement('style');
  style.textContent = `
    .related-projects-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
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
      border: none;
      background: linear-gradient(135deg, #8b5cf6, #7c3aed);
      color: white;
      font-size: 24px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      z-index: 9001;
    }

    .related-projects-toggle:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(139, 92, 246, 0.6);
    }

    .related-projects-toggle:active {
      transform: scale(1.05);
    }

    .related-projects-panel {
      position: absolute;
      bottom: 70px;
      right: 0;
      max-width: 360px;
      width: 360px;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(249, 250, 251, 0.98));
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
        backdrop-filter: blur(10px);
      border: 1px solid rgba(139, 92, 246, 0.2);
      opacity: 0;
      transform: translateY(10px) scale(0.95);
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .related-projects-panel.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    .related-projects-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 28px;
      height: 28px;
          border: none;
      background: rgba(139, 92, 246, 0.1);
      color: #7c3aed;
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
      background: rgba(139, 92, 246, 0.2);
      transform: scale(1.1);
    }

    .related-projects-header h3 {
      margin: 0 0 16px 0;
      font-size: 16px;
      font-weight: 700;
      color: #4c1d95;
      letter-spacing: -0.2px;
    }

    .related-projects-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 16px;
    }

    .related-project-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: white;
      border-radius: 10px;
      text-decoration: none;
      color: inherit;
      transition: all 0.2s ease;
      border: 1px solid rgba(139, 92, 246, 0.1);
    }

    .related-project-card:hover {
      transform: translateX(-4px);
      box-shadow: 0 4px 12px rgba(139, 92, 246, 0.2);
      border-color: rgba(139, 92, 246, 0.3);
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
      color: #1f2937;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .related-project-description {
      font-size: 12px;
      color: #6b7280;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .related-projects-footer {
      padding-top: 12px;
      border-top: 1px solid rgba(139, 92, 246, 0.1);
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .related-projects-footer a {
      display: inline-block;
      font-size: 13px;
      font-weight: 600;
      color: #7c3aed;
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 8px;
          transition: all 0.2s ease;
    }

    .related-projects-footer a:hover {
      background: rgba(139, 92, 246, 0.1);
      transform: translateX(2px);
    }

    .share-btn-mini,
    .feedback-btn-mini {
      display: inline-block;
      font-size: 13px;
      font-weight: 600;
      color: #8b5cf6;
      background: transparent;
      border: 1px solid rgba(139, 92, 246, 0.3);
      padding: 8px 16px;
      border-radius: 8px;
      transition: all 0.2s ease;
      cursor: pointer;
      text-align: center;
    }

    .share-btn-mini:hover:not(:disabled),
    .feedback-btn-mini:hover {
      background: rgba(139, 92, 246, 0.1);
      border-color: rgba(139, 92, 246, 0.5);
    }

    .share-btn-mini:disabled {
      cursor: default;
      opacity: 0.9;
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
        font-size: 11px;
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

  // Insert when DOM is ready
  function insertWidget() {
    const widget = createRelatedProjects();
    if (widget) {
      document.head.appendChild(style);
      document.body.appendChild(widget);
    }
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', insertWidget);
  } else {
    insertWidget();
  }
})();
