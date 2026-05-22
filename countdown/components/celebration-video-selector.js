/**
 * Celebration Video Selector Web Component
 * A dropdown for selecting which YouTube video plays during celebration
 */
import { localeService } from '../i18n/locale-service.js';
import YouTubePlayer from './youtube-player.js';

class CelebrationVideoSelector extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isOpen = false;
    this._selectedKey = 'CELEBRATION';
    this._customVideoId = null;
    this._ready = false;
  }

  static get observedAttributes() {
    return ['value', 'event-id'];
  }

  async connectedCallback() {
    await localeService.ready();
    this._ready = true;

    this.render();
    this.setupEventListeners();

    // Re-render when locale changes
    this._unsubscribe = localeService.subscribe(() => {
      this.render();
      this.setupEventListeners();
    });
  }

  disconnectedCallback() {
    if (this._unsubscribe) this._unsubscribe();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (!this._ready) return;

    if (name === 'value' && newValue !== oldValue) {
      this._setVideoByIdOrKey(newValue);
      this.updateDisplay();
    }
    if (name === 'event-id' && newValue !== oldValue) {
      // Set default video for event if no custom selection
      this._setDefaultForEvent(newValue);
    }
  }

  get value() {
    return this._customVideoId || YouTubePlayer.VIDEOS[this._selectedKey];
  }

  set value(videoIdOrKey) {
    this._setVideoByIdOrKey(videoIdOrKey);
    this.updateDisplay();
    this._dispatchChange();
  }

  get selectedKey() {
    return this._selectedKey;
  }

  _setVideoByIdOrKey(val) {
    // Check if it's a preset key
    if (YouTubePlayer.VIDEOS[val]) {
      this._selectedKey = val;
      this._customVideoId = null;
    } else if (val) {
      // It's a custom video ID
      this._customVideoId = val;
      this._selectedKey = 'CUSTOM';
    }
    this.setAttribute('value', val);
  }

  _setDefaultForEvent(eventId) {
    const defaultKey = YouTubePlayer.EVENT_DEFAULTS[eventId];
    if (defaultKey && !this._customVideoId) {
      this._selectedKey = defaultKey;
      this.updateDisplay();
      this._dispatchChange();
    }
  }

  _getVideoOptions() {
    const metadata = YouTubePlayer.VIDEO_METADATA;
    return Object.keys(metadata).map((key) => ({
      key,
      videoId: YouTubePlayer.VIDEOS[key],
      ...metadata[key]
    }));
  }

  _dispatchChange() {
    this.dispatchEvent(
      new CustomEvent('video-change', {
        detail: {
          videoId: this.value,
          key: this._selectedKey,
          isCustom: this._selectedKey === 'CUSTOM'
        },
        bubbles: true
      })
    );
  }

  render() {
    const options = this._getVideoOptions();
    const currentOption = options.find((o) => o.key === this._selectedKey) || options[0];
    const isCustom = this._selectedKey === 'CUSTOM';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: relative;
          font-family: 'Outfit', system-ui, sans-serif;
          z-index: 40;
        }

        .label {
          font-size: 0.85rem;
          color: #94a3b8;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .label-icon {
          font-size: 1rem;
        }

        .selector-container {
          display: flex;
          gap: 8px;
        }

        .selector-button {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          min-width: 0;
        }

        .selector-button:hover {
          background: rgba(15, 23, 42, 0.8);
          border-color: rgba(245, 158, 11, 0.4);
        }

        .selector-button:focus {
          outline: none;
          border-color: #f59e0b;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
        }

        .video-emoji {
          font-size: 1.1rem;
          flex-shrink: 0;
        }

        .video-info {
          flex: 1;
          text-align: left;
          min-width: 0;
          overflow: hidden;
        }

        .video-name {
          font-size: 0.85rem;
          font-weight: 500;
          color: #f8fafc;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .video-artist {
          font-size: 0.7rem;
          color: #94a3b8;
          margin-top: 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chevron {
          font-size: 0.65rem;
          color: #64748b;
          transition: transform 0.2s ease;
          flex-shrink: 0;
        }

        .chevron.open {
          transform: rotate(180deg);
        }

        .custom-btn {
          padding: 10px 12px;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 1rem;
          color: #94a3b8;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .custom-btn:hover {
          background: rgba(15, 23, 42, 0.8);
          border-color: rgba(245, 158, 11, 0.4);
          color: #f59e0b;
        }

        .custom-btn.active {
          background: rgba(245, 158, 11, 0.15);
          border-color: #f59e0b;
          color: #f59e0b;
        }

        .dropdown {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          background: rgba(15, 23, 42, 0.98);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 12px;
          backdrop-filter: blur(20px);
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
          display: none;
          overflow: hidden;
          max-height: 300px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: #f59e0b #1e293b;
        }

        .dropdown::-webkit-scrollbar {
          width: 8px;
        }

        .dropdown::-webkit-scrollbar-track {
          background: #1e293b;
          border-radius: 10px;
        }

        .dropdown::-webkit-scrollbar-thumb {
          background-color: #f59e0b;
          border-radius: 10px;
          border: 2px solid #1e293b;
        }

        .dropdown.open {
          display: block;
          animation: slideDown 0.15s ease;
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .dropdown-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          cursor: pointer;
          transition: background 0.15s ease;
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }

        .dropdown-item:last-child {
          border-bottom: none;
        }

        .dropdown-item:hover {
          background: rgba(245, 158, 11, 0.1);
        }

        .dropdown-item.selected {
          background: rgba(245, 158, 11, 0.15);
        }

        .custom-input-container {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          background: rgba(15, 23, 42, 0.98);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 12px;
          backdrop-filter: blur(20px);
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
          display: none;
          padding: 14px;
          animation: slideDown 0.15s ease;
        }

        .custom-input-container.open {
          display: block;
        }

        .custom-input-label {
          font-size: 0.75rem;
          color: #94a3b8;
          margin-bottom: 8px;
          display: block;
        }

        .custom-input-row {
          display: flex;
          gap: 8px;
        }

        .custom-input {
          flex: 1;
          padding: 10px 12px;
          background: rgba(30, 41, 59, 0.8);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 8px;
          color: #f8fafc;
          font-family: inherit;
          font-size: 0.85rem;
        }

        .custom-input:focus {
          outline: none;
          border-color: #f59e0b;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
        }

        .custom-input::placeholder {
          color: #64748b;
        }

        .apply-btn {
          padding: 10px 16px;
          background: linear-gradient(135deg, #f59e0b, #d97706);
          border: none;
          border-radius: 8px;
          color: #030712;
          font-family: inherit;
          font-weight: 600;
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .apply-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
        }

        .help-text {
          font-size: 0.7rem;
          color: #64748b;
          margin-top: 8px;
          line-height: 1.4;
        }

        .help-text code {
          background: rgba(30, 41, 59, 0.8);
          padding: 1px 4px;
          border-radius: 3px;
          font-family: monospace;
        }
      </style>

      <div class="label">
        <span class="label-icon">🎬</span>
        <span>${localeService.str('ui.celebrationVideo') || 'Celebration Video'}</span>
      </div>

      <div class="selector-container">
        <button class="selector-button" id="selectorBtn" aria-haspopup="listbox" aria-expanded="false">
          <span class="video-emoji">${isCustom ? '🎥' : currentOption.emoji}</span>
          <div class="video-info">
            <div class="video-name">${isCustom ? 'Custom Video' : currentOption.label}</div>
            <div class="video-artist">${isCustom ? this._customVideoId : currentOption.artist}</div>
          </div>
          <span class="chevron" id="chevron">▼</span>
        </button>
        <button class="custom-btn ${
          isCustom ? 'active' : ''
        }" id="customBtn" title="Use custom YouTube video">
          🔗
        </button>
      </div>

      <div class="dropdown" id="dropdown" role="listbox">
        ${options
          .map(
            (opt) => `
          <div class="dropdown-item ${opt.key === this._selectedKey ? 'selected' : ''}"
               data-key="${opt.key}"
               role="option"
               aria-selected="${opt.key === this._selectedKey}">
            <span class="video-emoji">${opt.emoji}</span>
            <div class="video-info">
              <div class="video-name">${opt.label}</div>
              <div class="video-artist">${opt.artist}</div>
            </div>
          </div>
        `
          )
          .join('')}
      </div>

      <div class="custom-input-container" id="customInputContainer">
        <label class="custom-input-label">Enter YouTube Video ID or URL</label>
        <div class="custom-input-row">
          <input type="text" 
                 class="custom-input" 
                 id="customInput" 
                 placeholder="e.g., dQw4w9WgXcQ or full URL"
                 value="${this._customVideoId || ''}">
          <button class="apply-btn" id="applyBtn">Apply</button>
        </div>
        <div class="help-text">
          Paste a YouTube URL like <code>youtube.com/watch?v=xxx</code> or just the video ID
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const btn = this.shadowRoot.getElementById('selectorBtn');
    const dropdown = this.shadowRoot.getElementById('dropdown');
    const chevron = this.shadowRoot.getElementById('chevron');
    const customBtn = this.shadowRoot.getElementById('customBtn');
    const customInputContainer = this.shadowRoot.getElementById('customInputContainer');
    const customInput = this.shadowRoot.getElementById('customInput');
    const applyBtn = this.shadowRoot.getElementById('applyBtn');

    let customOpen = false;

    const closeAll = () => {
      this.isOpen = false;
      customOpen = false;
      dropdown.classList.remove('open');
      chevron.classList.remove('open');
      customInputContainer.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    };

    btn.addEventListener('click', () => {
      customOpen = false;
      customInputContainer.classList.remove('open');
      this.isOpen = !this.isOpen;
      dropdown.classList.toggle('open', this.isOpen);
      chevron.classList.toggle('open', this.isOpen);
      btn.setAttribute('aria-expanded', this.isOpen);
    });

    customBtn.addEventListener('click', () => {
      this.isOpen = false;
      dropdown.classList.remove('open');
      chevron.classList.remove('open');
      customOpen = !customOpen;
      customInputContainer.classList.toggle('open', customOpen);
    });

    dropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (item) {
        const key = item.dataset.key;
        this._selectedKey = key;
        this._customVideoId = null;
        closeAll();
        this.updateDisplay();
        this._dispatchChange();
        this._savePreference();
      }
    });

    applyBtn.addEventListener('click', () => {
      const value = customInput.value.trim();
      if (value) {
        const videoId = this._extractVideoId(value);
        if (videoId) {
          this._customVideoId = videoId;
          this._selectedKey = 'CUSTOM';
          closeAll();
          this.updateDisplay();
          this._dispatchChange();
          this._savePreference();
        }
      }
    });

    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        applyBtn.click();
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!this.contains(e.target) && (this.isOpen || customOpen)) {
        closeAll();
      }
    });
  }

  _extractVideoId(input) {
    // Handle full YouTube URLs
    const urlPatterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/ // Just the ID
    ];

    for (const pattern of urlPatterns) {
      const match = input.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  _savePreference() {
    const pref = {
      key: this._selectedKey,
      customVideoId: this._customVideoId
    };
    localStorage.setItem('countdown-celebration-video', JSON.stringify(pref));
  }

  loadPreference() {
    try {
      const saved = localStorage.getItem('countdown-celebration-video');
      if (saved) {
        const pref = JSON.parse(saved);
        if (pref.customVideoId) {
          this._customVideoId = pref.customVideoId;
          this._selectedKey = 'CUSTOM';
        } else if (pref.key && YouTubePlayer.VIDEOS[pref.key]) {
          this._selectedKey = pref.key;
        }
        this.updateDisplay();
        return true;
      }
    } catch (e) {
      console.warn('Failed to load celebration video preference:', e);
    }
    return false;
  }

  updateDisplay() {
    if (!this._ready) return;

    const options = this._getVideoOptions();
    const currentOption = options.find((o) => o.key === this._selectedKey) || options[0];
    const isCustom = this._selectedKey === 'CUSTOM';

    const btn = this.shadowRoot.getElementById('selectorBtn');
    const customBtn = this.shadowRoot.getElementById('customBtn');

    if (btn) {
      const emoji = btn.querySelector('.video-emoji');
      const name = btn.querySelector('.video-name');
      const artist = btn.querySelector('.video-artist');

      if (emoji) emoji.textContent = isCustom ? '🎥' : currentOption.emoji;
      if (name) name.textContent = isCustom ? 'Custom Video' : currentOption.label;
      if (artist) artist.textContent = isCustom ? this._customVideoId : currentOption.artist;
    }

    if (customBtn) {
      customBtn.classList.toggle('active', isCustom);
    }

    // Update selected state in dropdown
    const items = this.shadowRoot.querySelectorAll('.dropdown-item');
    items.forEach((item) => {
      const isSelected = item.dataset.key === this._selectedKey;
      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-selected', isSelected);
    });
  }
}

customElements.define('celebration-video-selector', CelebrationVideoSelector);
export default CelebrationVideoSelector;
