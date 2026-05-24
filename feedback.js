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
    // Contrast (verified, see BRAND.md contrast matrix):
    //   primary : white on #5B3CDC ≈ 6.7:1 (AA pass)
    //   dark    : violet text on near-black ≈ 5.0:1 (AA pass)
    //   light   : violet text on white ≈ 6.7:1 (AA pass)
    //   glass   : white on dark backdrop with hairline border;
    //             contrast depends on backdrop — pair carefully.
    const themes = {
      primary: `
        background: var(--accent-primary-bg, #5b3cdc);
        color: var(--text-on-accent, #fff);
        border: 1px solid rgba(255, 255, 255, 0.12);
      `,
      dark: `
        background: var(--surface-1, #15151b);
        color: var(--accent-primary, #7c5cff);
        border: 1px solid var(--accent-primary, #7c5cff);
      `,
      light: `
        background: #fff;
        color: var(--accent-primary-bg, #5b3cdc);
        border: 1px solid var(--accent-primary-bg, #5b3cdc);
      `,
      glass: `
        background: var(--surface-glass, rgba(21, 21, 27, 0.72));
        -webkit-backdrop-filter: blur(20px) saturate(160%);
        backdrop-filter: blur(20px) saturate(160%);
        color: var(--text-1, #f5f5f7);
        border: 1px solid var(--hairline, rgba(255, 255, 255, 0.14));
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
        :host {
          display: inline-block;
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
          transform: scale(1.05);
          filter: brightness(1.1);
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        }

        .feedback-btn:active {
          transform: scale(0.95);
        }

        .feedback-btn:focus-visible {
          outline: 2px solid var(--focus-ring-inner, #7c5cff);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px var(--focus-ring-outer, rgba(255, 255, 255, 0.65));
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
