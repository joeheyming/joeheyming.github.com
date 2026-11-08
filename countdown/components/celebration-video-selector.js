/**
 * Celebration Video Selector Web Component
 * A dropdown for selecting which YouTube video plays during celebration
 */
import { localeService } from '../i18n/locale-service.js';
import { onClickOutside, selectMenuKeys } from './shared-styles.js';
import YouTubePlayer from './youtube-player.js';

class CelebrationVideoSelector extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open', delegatesFocus: true });
    this.isOpen = false;
    this._customOpen = false;
    this._highlighted = 0;
    this._selectedKey = 'CELEBRATION';
    this._customVideoId = null;
    this._ready = false;
    this._shadowBound = false;
    this._clickOutsideCleanup = null;
    this._releaseKeys = null;
  }

  static get observedAttributes() {
    return ['value', 'event-id'];
  }

  async connectedCallback() {
    if (this.tabIndex < 0) this.tabIndex = 0;
    await localeService.ready();
    this._ready = true;

    this.render();
    this.setupEventListeners();

    // Re-render when locale changes
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = localeService.subscribe(() => {
      const refocus = this.shadowRoot.activeElement && this.shadowRoot.activeElement.id;
      this.render();
      if (refocus && this.el(refocus)) this.el(refocus).focus();
    });
  }

  disconnectedCallback() {
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = null;
    if (this._clickOutsideCleanup) this._clickOutsideCleanup();
    this._clickOutsideCleanup = null;
    if (this._releaseKeys) this._releaseKeys();
    this._releaseKeys = null;
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

        @media (max-height: 700px) {
          .label {
            display: none;
          }

          .selector-button {
            padding: 6px 10px;
          }
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

        .dropdown-item.highlighted {
          background: rgba(245, 158, 11, 0.28);
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

        .custom-error {
          font-size: 0.75rem;
          color: #fca5a5;
          margin-top: 6px;
        }

        .custom-error:empty {
          display: none;
        }
      </style>

      <div class="label">
        <span class="label-icon" aria-hidden="true">🎬</span>
        <span id="label">${localeService.str('ui.celebrationVideo') || 'Celebration Video'}</span>
      </div>

      <div class="selector-container">
        <button class="selector-button" id="selectorBtn" role="combobox" aria-haspopup="listbox"
          aria-expanded="false" aria-controls="dropdown" aria-labelledby="label currentName">
          <span class="video-emoji" aria-hidden="true">${
            isCustom ? '🎥' : currentOption.emoji
          }</span>
          <div class="video-info">
            <div class="video-name" id="currentName">${
              isCustom ? 'Custom Video' : currentOption.label
            }</div>
            <div class="video-artist">${isCustom ? this._customVideoId : currentOption.artist}</div>
          </div>
          <span class="chevron" id="chevron" aria-hidden="true">▼</span>
        </button>
        <button class="custom-btn ${isCustom ? 'active' : ''}" id="customBtn"
          title="Use custom YouTube video" aria-label="Use custom YouTube video"
          aria-expanded="false" aria-controls="customInputContainer">
          <span aria-hidden="true">🔗</span>
        </button>
      </div>

      <div class="dropdown" id="dropdown" role="listbox" aria-labelledby="label">
        ${options
          .map(
            (opt, index) => `
          <div class="dropdown-item ${opt.key === this._selectedKey ? 'selected' : ''}"
               id="video-option-${index}"
               data-key="${opt.key}"
               role="option"
               aria-selected="${opt.key === this._selectedKey}">
            <span class="video-emoji" aria-hidden="true">${opt.emoji}</span>
            <div class="video-info">
              <div class="video-name">${opt.label}</div>
              <div class="video-artist">${opt.artist}</div>
            </div>
          </div>
        `
          )
          .join('')}
        <div class="dropdown-item ${isCustom ? 'selected' : ''}"
             id="video-option-custom"
             data-key="CUSTOM"
             role="option"
             aria-selected="${isCustom}">
          <span class="video-emoji" aria-hidden="true">🔗</span>
          <div class="video-info">
            <div class="video-name">Custom video…</div>
            <div class="video-artist">YouTube link or video ID</div>
          </div>
        </div>
      </div>

      <div class="custom-input-container" id="customInputContainer" role="group"
        aria-labelledby="customLabel">
        <label class="custom-input-label" id="customLabel" for="customInput">Enter YouTube Video ID or URL</label>
        <div class="custom-input-row">
          <input type="text"
                 class="custom-input"
                 id="customInput"
                 aria-describedby="customHelp customError"
                 placeholder="e.g., dQw4w9WgXcQ or full URL"
                 value="${this._customVideoId || ''}">
          <button class="apply-btn" id="applyBtn">Apply</button>
        </div>
        <div class="custom-error" id="customError" role="alert"></div>
        <div class="help-text" id="customHelp">
          Paste a YouTube URL like <code>youtube.com/watch?v=xxx</code> or just the video ID
        </div>
      </div>
    `;
    this.isOpen = false;
    this._customOpen = false;
  }

  el(id) {
    return this.shadowRoot.getElementById(id);
  }

  items() {
    return [...this.shadowRoot.querySelectorAll('#dropdown .dropdown-item')];
  }

  // Listeners live on the shadow root and the host, so a locale re-render
  // does not add a second copy.
  setupEventListeners() {
    if (!this._shadowBound) {
      this._shadowBound = true;
      this.shadowRoot.addEventListener('click', (event) => {
        const target = event.target;
        const item = target.closest('#dropdown .dropdown-item');
        if (item) {
          this.choose(this.items().indexOf(item));
        } else if (target.closest('#selectorBtn')) {
          this.isOpen ? this.closeList() : this.openList();
        } else if (target.closest('#customBtn')) {
          this._customOpen ? this.closeCustom() : this.openCustom();
        } else if (target.closest('#applyBtn')) {
          this.applyCustom();
        }
      });

      this.shadowRoot.addEventListener('keydown', (event) => {
        const inCustom = event.target.closest && event.target.closest('#customInputContainer');
        if (inCustom && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this.closeCustom();
          this.el('selectorBtn').focus();
          return;
        }
        if (event.target.id === 'customInput' && event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          this.applyCustom();
          return;
        }
        if (event.altKey && event.key === 'ArrowDown' && !this.isOpen && !inCustom) {
          event.preventDefault();
          this.openList();
        }
      });

      // OK on a remote clicks the focused host, not the control inside it.
      this.addEventListener('click', (event) => {
        if (event.composedPath()[0] !== this) return;
        if (this._customOpen && this.shadowRoot.activeElement === this.el('customInput')) {
          this.applyCustom();
        } else if (!this.isOpen) {
          this.openList();
        } else {
          this.choose(this._highlighted);
        }
      });

      this.addEventListener('focusout', () => {
        setTimeout(() => {
          if (this.shadowRoot.activeElement) return;
          if (this.isOpen) this.closeList();
        }, 0);
      });
    }

    if (this._clickOutsideCleanup) this._clickOutsideCleanup();
    this._clickOutsideCleanup = onClickOutside(this, () => {
      if (this.isOpen) this.closeList();
      if (this._customOpen) this.closeCustom();
    });
    if (this._releaseKeys) this._releaseKeys();
    this._releaseKeys = selectMenuKeys(this, {
      isOpen: () => this.isOpen,
      count: () => this.items().length,
      highlighted: () => this._highlighted,
      highlight: (index) => {
        this._highlighted = index;
        this._paintHighlight();
      },
      choose: (index) => this.choose(index),
      close: () => this.closeList()
    });
  }

  openList() {
    this.closeCustom();
    this.isOpen = true;
    this.el('dropdown').classList.add('open');
    this.el('chevron').classList.add('open');
    this.el('selectorBtn').setAttribute('aria-expanded', 'true');
    this._highlightSelected();
  }

  closeList() {
    this.isOpen = false;
    this.el('dropdown').classList.remove('open');
    this.el('chevron').classList.remove('open');
    const btn = this.el('selectorBtn');
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-activedescendant');
    this.updateDisplay();
  }

  openCustom() {
    if (this.isOpen) this.closeList();
    this._customOpen = true;
    this.el('customInputContainer').classList.add('open');
    this.el('customBtn').setAttribute('aria-expanded', 'true');
    this.el('customError').textContent = '';
    const input = this.el('customInput');
    input.focus();
    if (typeof input.select === 'function') input.select();
  }

  closeCustom() {
    this._customOpen = false;
    this.el('customInputContainer').classList.remove('open');
    this.el('customBtn').setAttribute('aria-expanded', 'false');
  }

  choose(index) {
    const item = this.items()[index];
    if (!item) {
      this.closeList();
      return;
    }
    const key = item.dataset.key;
    if (key === 'CUSTOM') {
      this.openCustom();
      return;
    }
    this._selectedKey = key;
    this._customVideoId = null;
    this.closeList();
    this._dispatchChange();
    this._savePreference();
  }

  applyCustom() {
    const input = this.el('customInput');
    const error = this.el('customError');
    const videoId = this._extractVideoId(input.value.trim());
    if (!videoId) {
      error.textContent = 'That is not a YouTube link or 11-character video ID.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    this._customVideoId = videoId;
    this._selectedKey = 'CUSTOM';
    this.closeCustom();
    this.updateDisplay();
    this._dispatchChange();
    this._savePreference();
    this.el('selectorBtn').focus();
  }

  _highlightSelected() {
    const items = this.items();
    const selected = items.findIndex((item) => item.classList.contains('selected'));
    this._highlighted = selected >= 0 ? selected : 0;
    this._paintHighlight();
  }

  // While open, aria-selected follows the highlight (APG select-only combobox).
  _paintHighlight() {
    const items = this.items();
    items.forEach((item, index) => {
      const active = index === this._highlighted;
      item.classList.toggle('highlighted', active);
      item.setAttribute('aria-selected', String(active));
    });
    const current = items[this._highlighted];
    if (current) this.el('selectorBtn').setAttribute('aria-activedescendant', current.id);
    if (current && typeof current.scrollIntoView === 'function') {
      current.scrollIntoView({ block: 'nearest' });
    }
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
      if (!this.isOpen) item.setAttribute('aria-selected', String(isSelected));
    });
  }
}

customElements.define('celebration-video-selector', CelebrationVideoSelector);
export default CelebrationVideoSelector;
