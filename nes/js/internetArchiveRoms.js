// Internet Archive NES ROM Collection
// Fetches ROMs directly from https://archive.org/download/nes-collection

class InternetArchiveRoms {
  constructor() {
    this.baseUrl = 'https://archive.org/download/nes-collection';
    this.romCache = null;
    this.cacheTimestamp = null;
    this.cacheExpiry = 30 * 60 * 1000; // 30 minutes

    console.log('Internet Archive ROMs initialized');
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

      console.log('Fetching ROM list from Internet Archive...');

      // Check proxy service
      if (
        !window.proxyService ||
        !window.proxyService.proxyOptions ||
        window.proxyService.proxyOptions.length === 0
      ) {
        throw new Error('Proxy service not available');
      }

      // Try proxies until one works
      let response = null;
      for (const proxyUrl of window.proxyService.proxyOptions) {
        try {
          const fetchUrl = `${proxyUrl}${encodeURIComponent(this.baseUrl)}`;
          console.log(`Trying proxy: ${proxyUrl}`);

          response = await fetch(fetchUrl);
          if (response.ok) {
            console.log(`✅ Proxy ${proxyUrl} succeeded`);
            break;
          }
        } catch (error) {
          console.log(`❌ Proxy ${proxyUrl} failed:`, error.message);
        }
      }

      if (!response || !response.ok) {
        throw new Error('All proxies failed');
      }

      const html = await response.text();
      const roms = this.parseRomList(html);

      // Cache results
      this.romCache = roms;
      this.cacheTimestamp = Date.now();

      console.log(`✅ Loaded ${roms.length} ROMs from Internet Archive`);
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
          description: `Classic NES game: ${romName}`,
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

  // Load ROM data
  async loadRom(rom) {
    try {
      if (!window.proxyService) {
        throw new Error('Proxy service not available');
      }

      console.log(`Loading ROM: ${rom.title}`);
      console.log(`Download URL: ${rom.downloadUrl}`);

      // Download ROM using proxy
      const romData = await window.proxyService.fetchRom(rom.downloadUrl);
      console.log(`✅ Downloaded ROM: ${romData.byteLength} bytes`);

      // Decompress if necessary
      return new Promise((resolve, reject) => {
        if (window.Nes && window.Nes.decompressIfNecessary) {
          window.Nes.decompressIfNecessary(
            rom.title + '.nes',
            romData,
            (error, decompressedData) => {
              if (error) {
                reject(new Error(`Decompression failed: ${error}`));
              } else {
                // Validate NES header
                if (window.validateNESHeader && !window.validateNESHeader(decompressedData)) {
                  reject(new Error('Invalid NES header'));
                } else {
                  console.log(`✅ ROM ready: ${rom.title}`);
                  resolve(decompressedData);
                }
              }
            }
          );
        } else {
          reject(new Error('NES decompression not available'));
        }
      });
    } catch (error) {
      console.error(`Error loading ROM ${rom.title}:`, error);
      throw new Error(`Failed to load ${rom.title}: ${error.message}`);
    }
  }
}

// Create global instance
window.internetArchiveRoms = new InternetArchiveRoms();

// Initialize when proxy is ready
setTimeout(() => {
  if (window.proxyService) {
    console.log('Internet Archive ROMs ready');
  }
}, 2000);
