class BackButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    // if inside iframe, do nothing
    if (window.self !== window.top) {
      return;
    }

    this.render();
  }

  render() {
    // if path is /a/b/c/index.html go to /a/b/
    // if path is /a/b/c/ go to /a/b/
    // if path is /a/b/c go to /a/b/
    const currentPath = window.location.pathname.replace(/.*\.html$/, '');
    const href = currentPath.split('/').filter(Boolean).slice(0, -1).join('/') || '/';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          top: 15px;
          left: 15px;
          z-index: 9999;
          opacity: 0.7;
          transition: opacity 0.3s ease;
        }
        
        :host(:hover) {
          opacity: 1;
        }
        
        :host(.hidden) {
          opacity: 0;
          pointer-events: none;
        }
        
        a {
          position: relative;
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
          box-shadow: 
            0 2px 8px rgba(0, 0, 0, 0.1),
            0 1px 3px rgba(0, 0, 0, 0.05);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          outline: none;
          padding: 0;
          text-decoration: none;
          color: #374151;
          text-align: center;
          font-weight: 500;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1;
          vertical-align: middle;
        }

        a:hover {
          transform: translateY(-1px) scale(1.05);
          background: linear-gradient(135deg, #ffffff 0%, #f1f3f4 100%);
          box-shadow: 
            0 4px 12px rgba(0, 0, 0, 0.15),
            0 2px 6px rgba(0, 0, 0, 0.08);
          border-color: rgba(0, 0, 0, 0.12);
        }

        a:active {
          transform: translateY(0) scale(0.98);
          transition-duration: 0.1s;
        }
      </style>
      <a href="${href}" title="Back">←</a>
    `;
  }
}

// Define the custom element
customElements.define('back-button', BackButton);

document.addEventListener('DOMContentLoaded', () => {
  const backButton = document.createElement('back-button');
  document.body.appendChild(backButton);
});
