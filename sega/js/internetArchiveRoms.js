// Internet Archive Sega Genesis ROM Collection
// Fetches ROMs directly from https://archive.org/download/sega-genesis-romset-ultra-usa

// Helper to fetch ROMs through proxy with appropriate settings
async function fetchRom(url) {
  return window.proxyService.fetchBinaryWithProxy(url, {
    headers: { Accept: 'application/octet-stream,*/*' },
    timeout: 30000,
    maxRetries: 3
  });
}

class InternetArchiveRoms {
  constructor() {
    this.baseUrl = 'https://archive.org/download/sega-genesis-romset-ultra-usa';
    this.romCache = null;
    this.cacheTimestamp = null;
    this.cacheExpiry = 30 * 60 * 1000; // 30 minutes

    console.log('Sega Genesis Internet Archive ROMs initialized');
  }

  // Fetch ROM list from Internet Archive
  async fetchRomList() {
    try {
      // Check cache first
      if (
        this.romCache &&
        this.cacheTimestamp &&
        Date.now() - this.cacheTimestamp < this.cacheExpiry
      ) {
        console.log('Using cached ROM list');
        return this.romCache;
      }

      console.log('Fetching Sega Genesis ROM list from Internet Archive...');

      if (!window.proxyService) {
        throw new Error('Proxy service not available');
      }

      const html = await window.proxyService.fetchWithProxy(this.baseUrl, {
        skipDirect: true,
        timeout: 30000,
        maxRetries: 3,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      // Check if Internet Archive is temporarily offline
      if (
        html.includes('Temporarily Offline') ||
        html.includes('Internet Archive services are temporarily offline') ||
        html.includes('The Wayback Machine is temporarily offline')
      ) {
        throw new Error('Internet Archive is temporarily offline. Please try again later.');
      }

      const roms = this.parseRomList(html);

      // Cache results
      this.romCache = roms;
      this.cacheTimestamp = Date.now();

      console.log(`✅ Loaded ${roms.length} Sega Genesis ROMs from Internet Archive`);
      return roms;
    } catch (error) {
      console.error('Error fetching ROM list:', error);
      throw error;
    }
  }

  // Parse ROM list from Internet Archive HTML
  parseRomList(html) {
    const roms = [];

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Find all ZIP file links
      const zipLinks = doc.querySelectorAll('a[href$=".zip"]');
      console.log(`Found ${zipLinks.length} ZIP files`);

      zipLinks.forEach((link) => {
        const href = link.getAttribute('href');
        const filename = link.textContent.trim();

        if (!href || !filename || filename.length < 2) return;

        // Extract ROM name (remove .zip extension)
        const romName = filename.replace(/\.zip$/i, '').trim();

        // Skip duplicates
        if (roms.some((rom) => rom.name === romName)) return;

        // Generate download URL
        const downloadUrl = href.startsWith('http')
          ? href
          : `${this.baseUrl}/${encodeURIComponent(filename)}`;

        // Categorize by first letter
        const firstChar = romName.charAt(0).toUpperCase();
        const category = /[A-Z]/.test(firstChar) ? firstChar : '#';

        roms.push({
          name: romName,
          title: romName,
          downloadUrl: downloadUrl,
          category: category,
          description: `Classic Sega Genesis game: ${romName}`,
          size: 'Unknown'
        });
      });

      // Sort by name
      roms.sort((a, b) => a.name.localeCompare(b.name));

      console.log(`Parsed ${roms.length} ROMs`);
      return roms;
    } catch (error) {
      console.error('Error parsing ROM list:', error);
      return [];
    }
  }

  // Get all ROMs
  async getAllRoms() {
    return await this.fetchRomList();
  }

  // Get ROMs by category (A-Z, #)
  async getRomsByCategory(category) {
    const allRoms = await this.getAllRoms();

    if (!category || category === 'all') {
      return allRoms;
    }

    return allRoms.filter((rom) => rom.category === category.toUpperCase());
  }

  // Get available categories
  async getCategories() {
    const allRoms = await this.getAllRoms();
    const categories = new Set();

    allRoms.forEach((rom) => categories.add(rom.category));

    const sortedCategories = Array.from(categories).sort();

    return sortedCategories.map((name) => ({
      name,
      count: allRoms.filter((rom) => rom.category === name).length,
      path: name.toLowerCase()
    }));
  }

  // Search ROMs by name
  async searchRoms(query) {
    const allRoms = await this.getAllRoms();
    const lowerQuery = query.toLowerCase();

    return allRoms.filter((rom) => rom.name.toLowerCase().includes(lowerQuery));
  }

  // Load ROM data — returns raw Uint8Array (EmulatorJS handles zip decompression)
  async loadRom(rom) {
    try {
      if (!window.proxyService) {
        throw new Error('Proxy service not available');
      }

      console.log(`Loading ROM: ${rom.title}`);
      console.log(`Download URL: ${rom.downloadUrl}`);

      const romData = await fetchRom(rom.downloadUrl);
      console.log(`✅ Downloaded ROM: ${romData.byteLength} bytes`);

      return romData;
    } catch (error) {
      console.error(`Error loading ROM ${rom.title}:`, error);
      throw new Error(`Failed to load ${rom.title}: ${error.message}`);
    }
  }
}

// Create global instance
window.segaArchiveRoms = new InternetArchiveRoms();

// Initialize when proxy is ready
setTimeout(() => {
  if (window.proxyService) {
    console.log('Sega Genesis Internet Archive ROMs ready');
  }
}, 2000);
