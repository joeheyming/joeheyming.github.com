// Feedback button web component — opens the site feedback Google Form in a new tab.
// Usage: <feedback-button label="💬 Feedback" theme="gradient"></feedback-button>

const FEEDBACK_FORM_URL = 'https://forms.gle/28x3g3jziZxDcHDi8';

class FeedbackButtonElement extends HTMLElement {
  static get observedAttributes() {
    return ['label', 'theme'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
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

  get label() {
    return this.getAttribute('label') || '💬 Feedback';
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
    if (emojiMatch) {
      return label.replace(emojiMatch[0], '').trim();
    }
    return label;
  }

  get theme() {
    // 'gradient' kept as an alias of 'primary' for backwards compatibility
    // with existing <feedback-button theme="gradient"> consumers.
    const t = this.getAttribute('theme') || 'primary';
    return t === 'gradient' ? 'primary' : t;
  }

  getThemeStyles() {
    // All themes read from brand.css tokens via var() so they update
    // automatically when the brand changes. Hex fallbacks make the
    // component still look right on pages that haven't loaded brand.css.
    //
    // Phase 3 of the brand pivot re-skinned for the new heyming-
    // engineering palette (paper-cream + Google '99 blue, no glass).
    //
    // Contrast (verified, see BRAND.md contrast matrix):
    //   primary : white on #1A73E8 ≈ 4.5:1 (AA body)
    //   dark    : retained as a paper-cream variant — blue text on
    //             surface-1 (#FFFFFF) ≈ 4.5:1 (AA body)
    //   light   : same — kept as a darker-bordered light variant
    //   glass   : kept as a backwards-compat alias for primary; the
    //             new brand has no glass blur
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
      `
    };
    return themes[this.theme] || themes.primary;
  }

  openFeedbackForm() {
    window.open(FEEDBACK_FORM_URL, '_blank', 'noopener,noreferrer');
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        /* See the matching note in share.js: -webkit-text-fill-color is
           inherited and crosses the shadow boundary, so a gradient-text
           ancestor would blank out this button's label. */
        :host {
          display: inline-block;
          -webkit-text-fill-color: currentColor;
        }
        :host([hide-trigger]) {
          position: fixed;
          width: 0;
          height: 0;
          overflow: visible;
        }
        :host([hide-trigger]) .feedback-btn {
          display: none !important;
        }

        .feedback-btn {
          ${this.getThemeStyles()}
          font-family: var(--font-ui), -apple-system, 'Segoe UI', Roboto, sans-serif;
          font-weight: 600;
          padding: 0.5rem 1.25rem;
          border-radius: var(--radius);
          transition: all 0.2s ease;
          transform: scale(1);
          cursor: pointer;
          font-size: 14px;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          height: auto;
          min-height: 2.5rem;
          white-space: nowrap;
          position: relative;
        }

        .feedback-btn .icon-only {
          display: none;
        }

        @media (max-width: 640px) {
          .feedback-btn {
            padding: 0.5rem !important;
            min-width: 2.5rem !important;
            min-height: 2.5rem !important;
            justify-content: center !important;
          }

          .feedback-btn .text-label {
            display: none !important;
          }

          .feedback-btn .icon-only {
            display: inline-block !important;
            font-size: 1.25rem !important;
          }
        }

        @media (max-width: 768px) {
          .feedback-btn {
            padding: 0.4rem 0.9rem;
            font-size: 13px;
            min-height: 2.25rem;
            gap: 0.35rem;
          }
        }

        .feedback-btn:hover {
          transform: scale(1.04);
          filter: brightness(0.96);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }

        .feedback-btn:active {
          transform: scale(0.95);
        }

        .feedback-btn:focus-visible {
          outline: 2px solid var(--focus-ring-inner);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px var(--focus-ring-outer);
        }
      </style>

      <button type="button" class="feedback-btn" id="feedback-btn" aria-label="Open feedback form in a new tab">
        <span class="icon-only">${this.extractIcon(this.label)}</span>
        <span class="text-label">${this.extractText(this.label)}</span>
      </button>
    `;
  }

  bindEvents() {
    const btn = this.shadowRoot.getElementById('feedback-btn');
    btn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openFeedbackForm();
    });
  }

  /** Opens the feedback form (used by related-projects and programmatic triggers). */
  openModal() {
    this.openFeedbackForm();
  }
}

if (!customElements.get('feedback-button')) {
  customElements.define('feedback-button', FeedbackButtonElement);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FeedbackButtonElement;
}

window.FeedbackButton = FeedbackButtonElement;
