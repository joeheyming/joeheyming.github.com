// Generic Share Button Web Component
// Usage: <share-button title="Page Title" text="Share text" theme="gradient|dark|light"></share-button>
//
// For custom URL generation, set the urlGenerator property:
//   const btn = document.querySelector('share-button');
//   btn.urlGenerator = () => buildCustomUrl();

class ShareButtonElement extends HTMLElement {
  static get observedAttributes() {
    return ['title', 'text', 'url', 'theme', 'label', 'tracking-param'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._urlGenerator = null; // Custom URL generator function
  }

  connectedCallback() {
    // Don't render if we're in an iframe
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

  // Allow setting a custom URL generator function
  set urlGenerator(fn) {
    this._urlGenerator = fn;
  }

  get urlGenerator() {
    return this._urlGenerator;
  }

  // Allow setting a custom text generator function
  set textGenerator(fn) {
    this._textGenerator = fn;
  }

  get textGenerator() {
    return this._textGenerator;
  }

  // Allow setting a custom title generator function
  set titleGenerator(fn) {
    this._titleGenerator = fn;
  }

  get titleGenerator() {
    return this._titleGenerator;
  }

  get shareTitle() {
    if (this._titleGenerator && typeof this._titleGenerator === 'function') {
      return this._titleGenerator();
    }
    return this.getAttribute('title') || document.title;
  }

  get shareText() {
    if (this._textGenerator && typeof this._textGenerator === 'function') {
      return this._textGenerator();
    }
    return this.getAttribute('text') || '';
  }

  get shareUrl() {
    let url;
    // Use custom URL generator if provided
    if (this._urlGenerator && typeof this._urlGenerator === 'function') {
      url = this._urlGenerator();
    } else {
      url = this.getAttribute('url') || window.location.href;
    }
    // Add tracking parameter
    return this.addTrackingParam(url);
  }

  get trackingParam() {
    // Default tracking param is 'shared=1', can be customized via attribute
    return this.getAttribute('tracking-param') || 'shared=1';
  }

  addTrackingParam(url) {
    try {
      const urlObj = new URL(url);
      const [paramName, paramValue] = this.trackingParam.split('=');
      // Only add if not already present
      if (!urlObj.searchParams.has(paramName)) {
        urlObj.searchParams.set(paramName, paramValue || '1');
      }
      return urlObj.toString();
    } catch (e) {
      // If URL parsing fails, append manually
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}${this.trackingParam}`;
    }
  }

  get theme() {
    return this.getAttribute('theme') || 'gradient';
  }

  get label() {
    return this.getAttribute('label') || '📤 Share';
  }

  getThemeStyles() {
    const themes = {
      gradient: `
        background: linear-gradient(to right, #3b82f6, #10b981);
        color: white;
      `,
      dark: `
        background: rgba(0, 0, 0, 0.8);
        color: #10b981;
        border: 1px solid #10b981;
      `,
      light: `
        background: rgba(255, 255, 255, 0.9);
        color: #3b82f6;
        border: 1px solid #3b82f6;
      `,
      glass: `
        background: rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(10px);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.3);
      `,
      retro: `
        background: #1a1a2e;
        color: #00ff00;
        border: 2px solid #00ff00;
        font-family: 'Courier New', monospace;
      `
    };
    return themes[this.theme] || themes.gradient;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
        }
        
        .share-btn {
          ${this.getThemeStyles()}
          font-weight: bold;
          padding: 0.5rem 1.25rem;
          border-radius: 0.75rem;
          transition: all 0.2s ease;
          transform: scale(1);
          border: none;
          cursor: pointer;
          font-size: 14px;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          height: auto;
          min-height: 2.5rem;
          white-space: nowrap;
        }
        
        /* Mobile optimizations */
        @media (max-width: 768px) {
          .share-btn {
            padding: 0.4rem 0.9rem;
            font-size: 13px;
            min-height: 2.25rem;
            gap: 0.35rem;
          }
        }
        
        .share-btn:hover {
          transform: scale(1.05);
          filter: brightness(1.1);
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        }
        
        .share-btn:active {
          transform: scale(0.95);
        }
        
        .share-btn:focus {
          outline: 2px solid rgba(59, 130, 246, 0.5);
          outline-offset: 2px;
        }
        
        .tooltip {
          position: fixed;
          background: #1f2937;
          color: white;
          font-size: 0.8rem;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          opacity: 0;
          visibility: hidden;
          transition: all 0.2s ease;
          pointer-events: none;
          white-space: nowrap;
          z-index: 10000;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        
        .tooltip.show {
          opacity: 1;
          visibility: visible;
        }
        
        .tooltip.success {
          background: #10b981;
        }
        
        .tooltip.error {
          background: #ef4444;
        }
        
        .tooltip::after {
          content: '';
          position: absolute;
          top: 100%;
          left: 50%;
          margin-left: -5px;
          border-width: 5px;
          border-style: solid;
          border-color: inherit;
          border-left-color: transparent;
          border-right-color: transparent;
          border-bottom-color: transparent;
        }
        
        .tooltip.success::after {
          border-top-color: #10b981;
        }
        
        .tooltip.error::after {
          border-top-color: #ef4444;
        }
      </style>
      
      <button class="share-btn" id="share-btn" aria-label="Share this page">
        ${this.label}
      </button>
      
      <div class="tooltip" id="tooltip"></div>
    `;
  }

  bindEvents() {
    const btn = this.shadowRoot.getElementById('share-btn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleShare();
      });
    }
  }

  async handleShare() {
    // Track analytics if available
    if (typeof window.trackEvent === 'function') {
      const pageName = this.getPageName();
      window.trackEvent('share_button_click', pageName, 'Share Button');
    }

    const shareData = {
      title: this.shareTitle,
      text: this.shareText,
      url: this.shareUrl
    };

    // Try native Web Share API first (mobile-friendly)
    if (navigator.share && this.canUseNativeShare()) {
      try {
        await navigator.share(shareData);
        this.showTooltip('Shared successfully!', 'success');
        return;
      } catch (err) {
        // User cancelled or share failed, fall through to clipboard
        if (err.name !== 'AbortError') {
          console.log('Native share failed, falling back to clipboard');
        } else {
          return; // User cancelled
        }
      }
    }

    // Fallback to clipboard
    await this.copyToClipboard();
  }

  canUseNativeShare() {
    // Check if we're on mobile or if user prefers native share
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    return isMobile;
  }

  async copyToClipboard() {
    const textToCopy = this.shareText ? `${this.shareText} ${this.shareUrl}` : this.shareUrl;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        // Fallback for older browsers
        const input = document.createElement('input');
        input.value = textToCopy;
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      this.showTooltip('Link copied to clipboard!', 'success');
    } catch (error) {
      console.error('Failed to copy:', error);
      this.showTooltip('Failed to copy link', 'error');
    }
  }

  getPageName() {
    // Extract page name from URL path
    const path = window.location.pathname;
    const segments = path.split('/').filter((s) => s);
    return segments.length > 0 ? segments[segments.length - 1] : 'Home';
  }

  showTooltip(message, type = 'success') {
    const tooltip = this.shadowRoot.getElementById('tooltip');
    const button = this.shadowRoot.getElementById('share-btn');

    if (!tooltip || !button) return;

    // Update tooltip content and class
    tooltip.textContent = message;
    tooltip.className = `tooltip ${type}`;

    // Position tooltip above the button
    const rect = button.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top - 40}px`;
    tooltip.style.transform = 'translateX(-50%)';

    // Show tooltip
    tooltip.classList.add('show');

    // Hide tooltip after 2 seconds
    setTimeout(() => {
      tooltip.classList.remove('show');
    }, 2000);
  }
}

// Register the web component
if (!customElements.get('share-button')) {
  customElements.define('share-button', ShareButtonElement);
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ShareButtonElement;
}

// Make globally accessible
window.ShareButton = ShareButtonElement;
