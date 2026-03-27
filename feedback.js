// Feedback button web component — opens the site feedback Google Form in a new tab.
// Usage: <feedback-button label="💬 Feedback" theme="gradient"></feedback-button>

const FEEDBACK_FORM_URL = 'https://forms.gle/yqS1KM8baXprCfPw9';

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
    return this.getAttribute('theme') || 'gradient';
  }

  getThemeStyles() {
    const themes = {
      gradient: `
        background: linear-gradient(to right, #8b5cf6, #3b82f6);
        color: white;
      `,
      dark: `
        background: rgba(0, 0, 0, 0.8);
        color: #8b5cf6;
        border: 1px solid #8b5cf6;
      `,
      light: `
        background: rgba(255, 255, 255, 0.9);
        color: #8b5cf6;
        border: 1px solid #8b5cf6;
      `,
      glass: `
        background: rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(10px);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.3);
      `
    };
    return themes[this.theme] || themes.gradient;
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

        .feedback-btn:focus {
          outline: 2px solid rgba(139, 92, 246, 0.5);
          outline-offset: 2px;
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
