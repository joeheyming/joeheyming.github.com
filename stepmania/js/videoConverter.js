// Video Converter Module - Uses FFmpeg.wasm to convert AVI to browser-playable formats
// This allows playing AVI background videos from simfiles

class VideoConverter {
  constructor() {
    this.ffmpeg = null;
    this.loaded = false;
    this.loading = false;
    this.conversionCache = new Map();
    this.pendingConversions = new Map(); // Track in-progress conversions to avoid duplicates
    this.progressCallbacks = new Map(); // Track progress callbacks for each conversion
  }

  /**
   * Check if SharedArrayBuffer is available (required for FFmpeg.wasm)
   * @returns {boolean}
   */
  isSupported() {
    return typeof SharedArrayBuffer !== 'undefined';
  }

  /**
   * Check if a video URL is an AVI file (needs conversion to play in browser)
   * @param {string} url - Video URL
   * @returns {boolean}
   */
  isAviFile(url) {
    if (!url) return false;
    return url.toLowerCase().endsWith('.avi');
  }

  /**
   * Check if a video URL needs AND can be converted
   * @param {string} url - Video URL
   * @returns {boolean}
   */
  needsConversion(url) {
    if (!this.isAviFile(url)) return false;
    // Only attempt conversion if SharedArrayBuffer is available
    return this.isSupported();
  }

  /**
   * Check if video can be played (either natively or via conversion)
   * @param {string} url - Video URL
   * @returns {boolean}
   */
  canPlayVideo(url) {
    if (!url) return false;
    // AVI files can only play if conversion is possible
    if (this.isAviFile(url)) {
      return this.isSupported();
    }
    // Other formats (mp4, webm) can play natively
    return true;
  }

  /**
   * Load FFmpeg.wasm library
   * @returns {Promise<boolean>}
   */
  async loadFFmpeg() {
    if (this.loaded) return true;
    if (this.loading) {
      // Wait for existing load to complete
      while (this.loading) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return this.loaded;
    }

    // Check for SharedArrayBuffer before attempting to load
    if (!this.isSupported()) {
      return false;
    }

    this.loading = true;

    // CDN fallbacks for ffmpeg-core.js
    const corePaths = [
      'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
      'https://esm.sh/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
    ];

    try {
      // Use @ffmpeg/ffmpeg 0.11.x which has simpler cross-origin handling
      const { createFFmpeg, fetchFile } = await import('https://esm.sh/@ffmpeg/ffmpeg@0.11.6');

      this.fetchFile = fetchFile;

      // Try each CDN until one works
      let loadError = null;
      for (const corePath of corePaths) {
        try {
          this.ffmpeg = createFFmpeg({
            log: false, // Suppress FFmpeg logs
            corePath: corePath
          });

          await this.ffmpeg.load();

          this.loaded = true;
          return true;
        } catch (cdnError) {
          loadError = cdnError;
          // Try next CDN
        }
      }

      // All CDNs failed
      throw loadError || new Error('All FFmpeg CDNs failed');
    } catch (error) {
      console.error('Failed to load FFmpeg.wasm:', error);
      this.loaded = false;
      return false;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Convert AVI video to MP4 format
   * @param {string} videoUrl - URL of the AVI video
   * @param {Function} onProgress - Progress callback (0-100)
   * @returns {Promise<string>} - Blob URL of converted video
   */
  /**
   * Normalize a URL for use as a cache key (decode URL encoding)
   * @param {string} url - URL to normalize
   * @returns {string} - Normalized URL
   */
  normalizeUrl(url) {
    try {
      return decodeURIComponent(url);
    } catch (e) {
      return url;
    }
  }

  async convertToMP4(videoUrl, onProgress = null) {
    // Normalize URL for consistent cache keys
    const normalizedUrl = this.normalizeUrl(videoUrl);

    // Check cache first (using normalized URL)
    if (this.conversionCache.has(normalizedUrl)) {
      // Report 100% immediately for cached conversions
      if (onProgress) onProgress(100);
      return this.conversionCache.get(normalizedUrl);
    }

    // Check if conversion is already in progress for this URL
    if (this.pendingConversions.has(normalizedUrl)) {
      // Add this callback to the list so it receives progress updates too
      if (onProgress) {
        const callbacks = this.progressCallbacks.get(normalizedUrl) || [];
        callbacks.push(onProgress);
        this.progressCallbacks.set(normalizedUrl, callbacks);
      }
      return this.pendingConversions.get(normalizedUrl);
    }

    // Ensure FFmpeg is loaded
    if (!(await this.loadFFmpeg())) {
      throw new Error('FFmpeg.wasm failed to load');
    }

    // Initialize progress callbacks array for this conversion
    this.progressCallbacks.set(normalizedUrl, onProgress ? [onProgress] : []);

    // Create a promise for this conversion and store it (use normalized URL as key)
    const conversionPromise = this._doConversion(videoUrl, normalizedUrl);
    this.pendingConversions.set(normalizedUrl, conversionPromise);

    try {
      const result = await conversionPromise;
      return result;
    } finally {
      this.pendingConversions.delete(normalizedUrl);
      this.progressCallbacks.delete(normalizedUrl);
    }
  }

  /**
   * Internal conversion method
   * @param {string} videoUrl - Original video URL (for fetching)
   * @param {string} cacheKey - Normalized URL (for caching)
   * @private
   */
  async _doConversion(videoUrl, cacheKey) {
    try {
      // Set up progress handler that calls all registered callbacks
      this.ffmpeg.setProgress(({ ratio }) => {
        const progress = Math.round(ratio * 100);
        const callbacks = this.progressCallbacks.get(cacheKey) || [];
        for (const callback of callbacks) {
          try {
            callback(progress);
          } catch (e) {
            // Ignore callback errors
          }
        }
      });

      // Fetch the AVI file through proxy if needed
      let videoData;
      if (videoUrl.includes('zenius-i-vanisher.com')) {
        // Use proxy for cross-origin videos
        const arrayBuffer = await window.proxyService.fetchBinaryWithProxy(videoUrl);
        videoData = new Uint8Array(arrayBuffer);
      } else {
        videoData = await this.fetchFile(videoUrl);
      }

      // Write input file to FFmpeg virtual filesystem (0.11.x API)
      this.ffmpeg.FS('writeFile', 'input.avi', videoData);

      // Convert AVI to MP4 (H.264/AAC) - widely supported
      await this.ffmpeg.run(
        '-i',
        'input.avi',
        '-c:v',
        'libx264', // H.264 video codec
        '-preset',
        'ultrafast', // Fast encoding
        '-crf',
        '28', // Quality (lower = better, 28 is reasonable for speed)
        '-c:a',
        'aac', // AAC audio codec
        '-b:a',
        '128k', // Audio bitrate
        '-movflags',
        '+faststart', // Enable streaming
        '-y', // Overwrite output
        'output.mp4'
      );

      // Check if output file exists
      let outputData;
      let outputFormat = 'video/mp4';
      try {
        outputData = this.ffmpeg.FS('readFile', 'output.mp4');
      } catch (readError) {
        throw new Error(
          'FFmpeg conversion produced no output. The input video codec may not be supported.'
        );
      }

      // Create blob URL
      const blob = new Blob([outputData.buffer], { type: outputFormat });
      const blobUrl = URL.createObjectURL(blob);

      // Cache the result (using normalized URL as key)
      this.conversionCache.set(cacheKey, blobUrl);

      // Clean up FFmpeg filesystem (0.11.x API) - wrap in try-catch to avoid breaking success
      try {
        this.ffmpeg.FS('unlink', 'input.avi');
      } catch (e) {
        // Ignore cleanup errors
      }
      try {
        this.ffmpeg.FS('unlink', 'output.mp4');
      } catch (e) {
        // Ignore cleanup errors
      }

      return blobUrl;
    } catch (error) {
      // Clean up input file if it exists
      try {
        this.ffmpeg.FS('unlink', 'input.avi');
      } catch (e) {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Get a playable video URL - converts if necessary
   * @param {string} videoUrl - Original video URL
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<string>} - Playable video URL
   */
  async getPlayableUrl(videoUrl, onProgress = null) {
    if (!this.needsConversion(videoUrl)) {
      return videoUrl;
    }

    try {
      return await this.convertToMP4(videoUrl, onProgress);
    } catch (error) {
      // Return original URL - caller will detect this and use background image
      return videoUrl;
    }
  }

  /**
   * Clear the conversion cache
   */
  clearCache() {
    // Revoke blob URLs to free memory
    for (const blobUrl of this.conversionCache.values()) {
      URL.revokeObjectURL(blobUrl);
    }
    this.conversionCache.clear();
  }
}

// Create global instance
const videoConverter = new VideoConverter();

// Make globally accessible
window.videoConverter = videoConverter;

// Export for module systems
export { VideoConverter, videoConverter };
