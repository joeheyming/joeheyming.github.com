// Generic Feedback Button Web Component
// Usage: <feedback-button label="💬 Feedback" theme="gradient" max-length="500"></feedback-button>
//
// Tracks analytics event 'feedback_submitted' when feedback is sent

class FeedbackButtonElement extends HTMLElement {
  static get observedAttributes() {
    return ['label', 'theme', 'max-length', 'placeholder'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
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

  get label() {
    return this.getAttribute('label') || '💬 Feedback';
  }

  extractIcon(label) {
    // Extract emoji/icon from label (first character or emoji)
    const emojiMatch = label.match(
      /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u
    );
    return emojiMatch ? emojiMatch[0] : label.charAt(0);
  }

  extractText(label) {
    // Extract text part after emoji
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

  get maxLength() {
    const attr = this.getAttribute('max-length');
    return attr ? parseInt(attr, 10) : 500;
  }

  get placeholder() {
    return (
      this.getAttribute('placeholder') ||
      'Share your thoughts, report bugs, or suggest improvements...'
    );
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

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
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
        
        /* Mobile optimizations - icon only */
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
        
        /* Mobile optimizations */
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

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s ease;
          padding: 1rem;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }

        .modal-overlay.show {
          opacity: 1;
          visibility: visible;
        }

        .modal-content {
          background: #1f2937;
          border-radius: 0.75rem;
          padding: 1.5rem;
          max-width: 90%;
          width: 500px;
          min-width: 400px;
          max-height: 90vh;
          overflow-y: auto;
          overflow-x: hidden;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
          border: 2px solid #8b5cf6;
          transform: scale(0.9) translateY(20px);
          transition: transform 0.3s ease;
          position: relative;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }

        .modal-overlay.show .modal-content {
          transform: scale(1) translateY(0);
        }

        /* Mobile optimizations */
        @media (max-width: 640px) {
          .modal-overlay {
            padding: 0;
            align-items: flex-end;
          }

          .modal-content {
            width: 100%;
            max-width: 100%;
            max-height: 85vh;
            border-radius: 1rem 1rem 0 0;
            padding: 1.25rem;
            padding-bottom: max(1.25rem, env(safe-area-inset-bottom));
            transform: translateY(100%);
            margin: 0;
            min-width: 0;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: stretch;
          }

          .modal-overlay.show .modal-content {
            transform: translateY(0);
          }

          .modal-header {
            margin-bottom: 1rem;
          }

          .modal-title {
            font-size: 1.25rem;
          }

          .textarea-container {
            display: flex;
            flex-direction: column;
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
            padding: 0;
            margin: 0;
          }

          .feedback-textarea {
            min-height: 120px;
            font-size: 16px; /* Prevents zoom on iOS */
            padding: 0.875rem;
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
            margin: 0;
            display: block;
          }

          .modal-actions {
            flex-direction: column-reverse;
            gap: 0.75rem;
            width: 100%;
          }

          .modal-btn {
            width: 100%;
            padding: 1rem;
            font-size: 1rem;
            min-height: 44px; /* iOS touch target minimum */
            box-sizing: border-box;
          }

          .char-count {
            font-size: 0.8125rem;
            margin-bottom: 1rem;
          }

          .close-btn {
            min-width: 44px;
            min-height: 44px;
            padding: 0.5rem;
            font-size: 1.5rem;
          }
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }

        .modal-title {
          color: white;
          font-size: 1.5rem;
          font-weight: bold;
          margin: 0;
        }

        .close-btn {
          background: transparent;
          border: none;
          color: #9ca3af;
          font-size: 1.5rem;
          cursor: pointer;
          padding: 0.25rem 0.5rem;
          line-height: 1;
          transition: color 0.2s;
        }

        .close-btn:hover {
          color: white;
        }

        .feedback-textarea {
          width: 100%;
          min-height: 150px;
          padding: 1rem;
          border-radius: 0.5rem;
          border: 1px solid #4b5563;
          background: #374151;
          color: white;
          font-size: 1rem;
          font-family: inherit;
          resize: vertical;
          margin-bottom: 0.5rem;
          box-sizing: border-box;
          max-width: 100%;
          min-width: 0;
        }

        .feedback-textarea:focus {
          outline: none;
          border-color: #8b5cf6;
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
        }

        .char-count {
          text-align: right;
          color: #9ca3af;
          font-size: 0.875rem;
          margin-bottom: 1.5rem;
        }

        .textarea-container {
          display: flex;
          flex-direction: column;
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }

        .char-count.warning {
          color: #f59e0b;
        }

        .char-count.error {
          color: #ef4444;
        }

        .modal-actions {
          display: flex;
          gap: 1rem;
          justify-content: flex-end;
          width: 100%;
          box-sizing: border-box;
          min-width: 0;
        }

        .modal-btn {
          padding: 0.75rem 1.5rem;
          border-radius: 0.5rem;
          border: none;
          font-weight: 600;
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.2s;
        }

        .modal-btn-primary {
          background: #8b5cf6;
          color: white;
        }

        .modal-btn-primary:hover {
          background: #7c3aed;
        }

        .modal-btn-primary:disabled {
          background: #4b5563;
          cursor: not-allowed;
          opacity: 0.5;
        }

        .modal-btn-secondary {
          background: #4b5563;
          color: white;
        }

        .modal-btn-secondary:hover {
          background: #374151;
        }

        .success-message {
          color: #10b981;
          margin-top: 1rem;
          text-align: center;
          font-weight: 600;
        }
      </style>
      
      <button class="feedback-btn" id="feedback-btn" aria-label="Submit feedback">
        <span class="icon-only">${this.extractIcon(this.label)}</span>
        <span class="text-label">${this.extractText(this.label)}</span>
      </button>
      
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">💬 Share Feedback</h2>
            <button class="close-btn" id="close-btn" aria-label="Close">✕</button>
          </div>
          <div class="textarea-container">
            <textarea
              class="feedback-textarea"
              id="feedback-textarea"
              placeholder="${this.placeholder}"
              maxlength="${this.maxLength}"
            ></textarea>
            <div class="char-count" id="char-count">0 / ${this.maxLength}</div>
          </div>
          <div class="modal-actions">
            <button class="modal-btn modal-btn-secondary" id="cancel-btn">Cancel</button>
            <button class="modal-btn modal-btn-primary" id="submit-btn" disabled>Submit</button>
          </div>
          <div class="success-message" id="success-message" style="display: none;">
            ✓ Thank you for your feedback!
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const btn = this.shadowRoot.getElementById('feedback-btn');
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    const closeBtn = this.shadowRoot.getElementById('close-btn');
    const cancelBtn = this.shadowRoot.getElementById('cancel-btn');
    const submitBtn = this.shadowRoot.getElementById('submit-btn');
    const textarea = this.shadowRoot.getElementById('feedback-textarea');
    const charCount = this.shadowRoot.getElementById('char-count');

    // Open modal
    btn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openModal();
    });

    // Close modal
    const closeModal = () => {
      overlay.classList.remove('show');
      // Restore body scroll
      document.body.style.overflow = '';
      // Reset form after animation
      setTimeout(() => {
        textarea.value = '';
        this.updateCharCount();
        submitBtn.disabled = true;
        const successMsg = this.shadowRoot.getElementById('success-message');
        if (successMsg) successMsg.style.display = 'none';
      }, 300);
    };

    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    });

    // Handle textarea input
    textarea?.addEventListener('input', () => {
      this.updateCharCount();
      submitBtn.disabled = textarea.value.trim().length === 0;
    });

    // Prevent keyboard events from bubbling to parent (e.g., game controls)
    textarea?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      // Handle Enter key (Ctrl/Cmd + Enter to submit)
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!submitBtn.disabled) {
          this.submitFeedback();
        }
      }
    });

    textarea?.addEventListener('keyup', (e) => {
      e.stopPropagation();
    });

    // Prevent all keyboard events in the modal from bubbling
    overlay?.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });

    overlay?.addEventListener('keyup', (e) => {
      e.stopPropagation();
    });

    // Handle submit
    submitBtn?.addEventListener('click', () => {
      this.submitFeedback();
    });
  }

  updateCharCount() {
    const textarea = this.shadowRoot.getElementById('feedback-textarea');
    const charCount = this.shadowRoot.getElementById('char-count');
    if (!textarea || !charCount) return;

    const length = textarea.value.length;
    const maxLength = this.maxLength;
    const remaining = maxLength - length;

    charCount.textContent = `${length} / ${maxLength}`;
    charCount.className = 'char-count';

    if (remaining < 50) {
      charCount.classList.add('warning');
    }
    if (remaining < 10) {
      charCount.classList.add('error');
    }
  }

  openModal() {
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    const textarea = this.shadowRoot.getElementById('feedback-textarea');
    if (overlay) {
      overlay.classList.add('show');
      // Prevent body scroll when modal is open on mobile
      document.body.style.overflow = 'hidden';
      // Focus textarea after animation
      setTimeout(() => {
        textarea?.focus();
        // Scroll textarea into view on mobile to prevent keyboard covering it
        if (window.innerWidth <= 640) {
          setTimeout(() => {
            textarea?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      }, 100);
    }
  }

  submitFeedback() {
    const textarea = this.shadowRoot.getElementById('feedback-textarea');
    const submitBtn = this.shadowRoot.getElementById('submit-btn');
    const successMsg = this.shadowRoot.getElementById('success-message');

    if (!textarea || !submitBtn) return;

    const feedback = textarea.value.trim();
    if (feedback.length === 0) return;

    // Track analytics event
    if (typeof window.trackEvent === 'function') {
      const pageName = this.getPageName();
      // Track the feedback submission with character count
      window.trackEvent(
        'feedback_submitted',
        pageName,
        `Feedback (${feedback.length} chars)`,
        feedback.length
      );
    }

    // Show success message
    if (successMsg) {
      successMsg.style.display = 'block';
    }

    // Disable submit button
    submitBtn.disabled = true;

    // Close modal after a delay
    setTimeout(() => {
      const overlay = this.shadowRoot.getElementById('modal-overlay');
      overlay?.classList.remove('show');
      // Restore body scroll
      document.body.style.overflow = '';
      setTimeout(() => {
        textarea.value = '';
        this.updateCharCount();
        submitBtn.disabled = true;
        if (successMsg) successMsg.style.display = 'none';
      }, 300);
    }, 1500);
  }

  getPageName() {
    // Extract page name from URL path
    const path = window.location.pathname;
    const segments = path.split('/').filter((s) => s);
    return segments.length > 0 ? segments[segments.length - 1] : 'Home';
  }
}

// Register the web component
if (!customElements.get('feedback-button')) {
  customElements.define('feedback-button', FeedbackButtonElement);
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FeedbackButtonElement;
}

// Make globally accessible
window.FeedbackButton = FeedbackButtonElement;
