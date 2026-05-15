// Helper to fetch ROMs through proxy with appropriate settings
async function fetchRom(url) {
  return window.proxyService.fetchBinaryWithProxy(url, {
    headers: { Accept: 'application/octet-stream,*/*' },
    timeout: 30000,
    maxRetries: 3
  });
}

// ROM Browser Web Component for NES Emulator
class RomBrowserElement extends HTMLElement {
  constructor() {
    super();
    this.allRoms = [];
    this.filteredRoms = [];
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.init();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          width: auto;
        }
        
        .rom-browser-container {
          display: flex;
          justify-content: space-between;
          width: 100%;
        }
        
        .rom-browser-btn {
          background: linear-gradient(to right, #3b82f6, #1d4ed8);
          color: white;
          font-weight: bold;
          padding: 0.5rem 1.5rem;
          border-radius: 0.75rem;
          transition: all 0.2s;
          transform: scale(1);
          border: none;
          cursor: pointer;
          font-size: 14px;
          height: 2.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1.2;
          margin: 0;
          white-space: nowrap;
        }
        
        .rom-browser-btn:hover {
          background: linear-gradient(to right, #2563eb, #1e40af);
          transform: scale(1.05);
        }
        
        .modal {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(8px);
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s ease;
        }
        
        .modal.show {
          opacity: 1;
          visibility: visible;
        }
        
        .modal-content {
          background: linear-gradient(to bottom right, rgba(30, 58, 138, 0.9), rgba(88, 28, 135, 0.9));
          backdrop-filter: blur(8px);
          border-radius: 1.5rem;
          max-width: 90rem;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          border: 1px solid rgba(59, 130, 246, 0.3);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }
        
        .modal-header {
          padding: 2rem 2rem 1rem;
        }
        
        .modal-title {
          font-size: 2rem;
          font-weight: bold;
          color: #00f5ff;
          margin-bottom: 0.5rem;
          text-align: center;
        }
        
        .modal-subtitle {
          color: #e5e7eb;
          text-align: center;
          font-size: 1rem;
        }
        
        .modal-body {
          flex: 1;
          overflow: hidden;
          padding: 0 2rem;
        }
        
        .modal-footer {
          padding: 1rem 2rem 2rem;
          display: flex;
          justify-content: center;
        }
        
        .close-btn {
          background: linear-gradient(to right, #ef4444, #dc2626);
          color: white;
          font-weight: bold;
          padding: 0.75rem 2rem;
          border-radius: 0.75rem;
          border: none;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .close-btn:hover {
          background: linear-gradient(to right, #dc2626, #b91c1c);
          transform: scale(1.05);
        }
        
        
        .content-area {
          height: 60vh;
          overflow-y: auto;
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 0.75rem;
          background: rgba(0, 0, 0, 0.2);
        }
        
        .loading {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 200px;
          color: #00f5ff;
          font-size: 1.25rem;
        }
        
        .error {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 200px;
          color: #ef4444;
          font-size: 1.25rem;
          text-align: center;
          padding: 1rem;
        }
        
        .rom-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1rem;
          padding: 1rem;
        }
        
        .rom-card {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 0.75rem;
          padding: 1rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .rom-card:hover {
          background: rgba(59, 130, 246, 0.1);
          border-color: #00f5ff;
          transform: translateY(-2px);
        }
        
        .rom-title {
          font-weight: bold;
          color: #00f5ff;
          margin-bottom: 0.5rem;
          font-size: 1.1rem;
        }
        
        .rom-info {
          color: #e5e7eb;
          font-size: 0.875rem;
          line-height: 1.4;
        }
        
        .rom-size {
          color: #9ca3af;
          font-size: 0.75rem;
          margin-top: 0.25rem;
        }
        
        
        .search-container {
          margin-bottom: 1rem;
          position: relative;
        }
        
        .search-input {
          width: 100%;
          padding: 0.75rem 1rem;
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 0.75rem;
          background: rgba(0, 0, 0, 0.3);
          color: white;
          font-size: 1rem;
        }
        
        .search-input::placeholder {
          color: #9ca3af;
        }
        
        .search-input:focus {
          outline: none;
          border-color: #00f5ff;
          box-shadow: 0 0 0 2px rgba(0, 245, 255, 0.2);
        }
      </style>
      
      <div class="rom-browser-container">
        <button class="rom-browser-btn" id="openBrowserBtn">
          🎮 Browse ROMs
        </button>
      </div>
      
      <div class="modal" id="browserModal">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">NES ROM Browser</h2>
            <p class="modal-subtitle">Browse and load NES ROMs from Internet Archive</p>
          </div>
          
          <div class="modal-body">
            <div class="search-container">
              <input type="text" class="search-input" id="searchInput" placeholder="Search ROMs...">
            </div>
            
            <div class="content-area" id="contentArea">
              <div class="loading">Loading ROM collection...</div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="close-btn" id="closeBrowserBtn">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  init() {
    const openBtn = this.shadowRoot.getElementById('openBrowserBtn');
    const closeBtn = this.shadowRoot.getElementById('closeBrowserBtn');
    const modal = this.shadowRoot.getElementById('browserModal');
    const searchInput = this.shadowRoot.getElementById('searchInput');

    openBtn.addEventListener('click', () => {
      this.openBrowser();
    });

    closeBtn.addEventListener('click', () => {
      this.closeBrowser();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeBrowser();
      }
    });

    searchInput.addEventListener('input', (e) => {
      this.handleSearch(e.target.value);
    });
  }

  async openBrowser() {
    const modal = this.shadowRoot.getElementById('browserModal');
    modal.classList.add('show');

    // Hide mobile controller when ROM browser is open
    const mobileController = document.getElementById('mobileController');
    if (mobileController) {
      mobileController.style.display = 'none';
    }

    // Clear search input and reset filtered ROMs
    const searchInput = this.shadowRoot.getElementById('searchInput');
    searchInput.value = '';

    if (this.allRoms.length === 0) {
      await this.loadAllRoms();
    } else {
      // ROMs are already loaded, reset filter and display them
      this.filteredRoms = [...this.allRoms];
      this.renderRoms(this.filteredRoms);
    }
  }

  closeBrowser() {
    const modal = this.shadowRoot.getElementById('browserModal');
    modal.classList.remove('show');

    // Show mobile controller again when ROM browser is closed
    if (typeof window.ensureMobileControllerVisible === 'function') {
      window.ensureMobileControllerVisible();
    }
  }

  async loadAllRoms() {
    const contentArea = this.shadowRoot.getElementById('contentArea');
    contentArea.innerHTML = '<div class="loading">Loading ROM collection...</div>';

    try {
      if (!window.internetArchiveRoms) {
        throw new Error('Internet Archive ROMs not available');
      }

      this.allRoms = await window.internetArchiveRoms.getAllRoms();
      this.filteredRoms = [...this.allRoms];

      if (this.allRoms.length === 0) {
        contentArea.innerHTML =
          '<div class="error">No ROMs found. Please check your connection and try again.</div>';
        return;
      }

      this.renderRoms(this.filteredRoms);
    } catch (error) {
      console.error('Error loading ROMs:', error);
      contentArea.innerHTML =
        '<div class="error">Failed to load ROMs from Internet Archive. Please try again.</div>';
    }
  }

  renderRoms(roms) {
    const contentArea = this.shadowRoot.getElementById('contentArea');

    const romGrid = document.createElement('div');
    romGrid.className = 'rom-grid';

    roms.forEach((rom) => {
      const romCard = document.createElement('div');
      romCard.className = 'rom-card';
      romCard.innerHTML = `
        <div class="rom-title">${rom.title}</div>
        <div class="rom-info">${rom.description}</div>
        <div class="rom-size">${rom.size}</div>
      `;

      romCard.addEventListener('click', () => {
        this.loadRom(rom);
      });

      romGrid.appendChild(romCard);
    });

    contentArea.innerHTML = '';
    contentArea.appendChild(romGrid);
  }

  async loadRom(rom) {
    try {
      console.log('Loading ROM:', rom.title);

      // Show loading state
      const contentArea = this.shadowRoot.getElementById('contentArea');
      const originalContent = contentArea.innerHTML;
      contentArea.innerHTML = `<div class="loading">Loading ${rom.title}...</div>`;

      // Download ROM data using proxy service directly (skip internetArchiveRoms decompression)
      if (window.proxyService) {
        console.log(`Download URL: ${rom.downloadUrl}`);

        // Download raw ROM data using proxy
        const rawRomData = await fetchRom(rom.downloadUrl);
        console.log(`✅ Downloaded ROM: ${rawRomData.byteLength || rawRomData.length} bytes`);

        console.log('Raw ROM data received:', {
          dataType: typeof rawRomData,
          dataLength: rawRomData ? rawRomData.byteLength || rawRomData.length : 'undefined',
          isArrayBuffer: rawRomData instanceof ArrayBuffer,
          isUint8Array: rawRomData instanceof Uint8Array
        });

        // Keep the Uint8Array as-is since NativeZipReader expects it
        let romDataBuffer = rawRomData;
        console.log('Using ROM data as-is:', {
          dataType: typeof rawRomData,
          isUint8Array: rawRomData instanceof Uint8Array,
          isArrayBuffer: rawRomData instanceof ArrayBuffer,
          length: rawRomData.length || rawRomData.byteLength
        });

        // Close the browser modal
        this.closeBrowser();

        // Load the ROM into the NES emulator using the app's callback
        if (window.Gui && window.Gui.App && window.Gui.App._loadRomCallback) {
          console.log(`Loading ROM: ${rom.title}`);

          // Create a clean filename with .zip extension since we're passing ZIP data
          const zipFileName =
            rom.title
              .replace(/[^a-zA-Z0-9\s\-_]/g, '')
              .replace(/\s+/g, ' ')
              .trim() + '.zip';

          window.Gui.App._loadRomCallback(zipFileName, romDataBuffer);
        } else {
          console.error('ROM loading callback not available:', {
            Gui: !!window.Gui,
            App: !!(window.Gui && window.Gui.App),
            callback: !!(window.Gui && window.Gui.App && window.Gui.App._loadRomCallback)
          });
          alert('NES emulator not ready. Please try again.');
        }
      } else {
        throw new Error("Couldn't reach the ROM source. Try again in a moment.");
      }
    } catch (error) {
      console.error('Error loading ROM:', error);
      alert('Failed to load ROM: ' + error.message);

      // Restore original content if available
      const contentArea = this.shadowRoot.getElementById('contentArea');
      if (contentArea && typeof originalContent !== 'undefined') {
        contentArea.innerHTML = originalContent;
      }
    }
  }

  handleSearch(query) {
    if (!query.trim()) {
      // If search is empty, show all ROMs
      this.filteredRoms = [...this.allRoms];
      this.renderRoms(this.filteredRoms);
      return;
    }

    console.log('Searching for:', query);

    // Filter ROMs based on search query
    const lowerQuery = query.toLowerCase();
    this.filteredRoms = this.allRoms.filter(
      (rom) =>
        rom.title.toLowerCase().includes(lowerQuery) || rom.name.toLowerCase().includes(lowerQuery)
    );

    this.renderRoms(this.filteredRoms);
  }
}

// Register the custom element
customElements.define('rom-browser', RomBrowserElement);

// Make it globally accessible
window.RomBrowserElement = RomBrowserElement;
