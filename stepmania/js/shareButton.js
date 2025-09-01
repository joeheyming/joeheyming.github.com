// Share Button Web Component
class ShareButtonElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.bindEvents();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        
        .share-btn {
          background: linear-gradient(to right, #3b82f6, #10b981);
          color: white;
          font-weight: bold;
          padding: 0.5rem 1.5rem;
          border-radius: 0.75rem;
          transition: all 0.2s;
          transform: scale(1);
          border: none;
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .share-btn:hover {
          background: linear-gradient(to right, #2563eb, #059669);
          transform: scale(1.05);
        }
        
        .share-btn:active {
          transform: scale(0.95);
        }
        
        .tooltip {
          position: absolute;
          background: black;
          color: white;
          font-size: 0.75rem;
          border-radius: 0.25rem;
          padding: 0.25rem 0.5rem;
          opacity: 0;
          visibility: hidden;
          transition: all 0.2s ease;
          pointer-events: none;
          white-space: nowrap;
          z-index: 1000;
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
      </style>
      
      <button class="share-btn" id="share-btn">
        Share
      </button>
      
      <div class="tooltip" id="tooltip">URL copied to clipboard!</div>
    `;
  }

  bindEvents() {
    this.shadowRoot.getElementById('share-btn').addEventListener('click', () => {
      this.shareCurrentURL();
    });
  }

  async shareCurrentURL() {
    const searchParams = new URLSearchParams(window.location.search);
    const song = searchParams.get('song');
    const difficulty = searchParams.get('difficulty');
    const zenius = searchParams.get('zenius');

    let url;
    if (zenius) {
      // Share Zenius URL
      url = `${window.location.origin}${window.location.pathname}?zenius=${encodeURIComponent(
        zenius
      )}&difficulty=${difficulty || 0}`;
    } else if (song && difficulty) {
      // Share regular song URL
      url = `${window.location.origin}${window.location.pathname}?song=${encodeURIComponent(
        song
      )}&difficulty=${difficulty}`;
    } else {
      // Share current URL
      url = window.location.href;
    }

    try {
      await this.copyToClipboard(url);
      this.showTooltip('URL copied to clipboard!', 'success');
    } catch (error) {
      console.error('Failed to copy URL:', error);
      this.showTooltip('Failed to copy URL', 'error');
    }
  }

  async copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        console.log('Text copied to clipboard!');
      } catch (err) {
        console.error('Failed to copy text: ', err);
        throw err;
      }
    } else {
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      const success = document.execCommand('copy', true, text);
      document.body.removeChild(input);

      if (!success) {
        throw new Error('Failed to copy text');
      }
    }
  }

  showTooltip(message, type = 'success') {
    const tooltip = this.shadowRoot.getElementById('tooltip');
    const button = this.shadowRoot.getElementById('share-btn');

    // Update tooltip content and class
    tooltip.textContent = message;
    tooltip.className = `tooltip ${type}`;

    // Position tooltip above the button
    const rect = button.getBoundingClientRect();
    tooltip.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
    tooltip.style.top = `${rect.top + window.scrollY - 30}px`;

    // Show tooltip
    tooltip.classList.add('show');

    // Hide tooltip after 2 seconds
    setTimeout(() => {
      tooltip.classList.remove('show');
    }, 2000);
  }
}

// Register the web component
customElements.define('share-button', ShareButtonElement);

// Make globally accessible for backward compatibility
window.ShareButton = ShareButtonElement;
