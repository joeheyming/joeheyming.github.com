/**
 * Heyming OS - Icon Utility
 * Provides MIME-type based icon mapping for files
 */

export const Icons = {
  // MIME type to icon mapping
  mimeIcons: {
    // Text
    'text/plain': '📄',
    'text/markdown': '📝',
    'text/html': '🌐',
    'text/css': '🎨',
    'text/csv': '📊',
    'text/x-python': '🐍',
    'text/x-shellscript': '⚙️',

    // Application
    'application/json': '📋',
    'application/pdf': '📕',
    'application/javascript': '📜',
    'application/xml': '📋',

    // Images
    'image/svg+xml': '🎨',

    // Special
    'inode/directory': '📁'
  },

  /**
   * Get an emoji icon for a MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} Emoji icon
   */
  getIcon(mimeType) {
    if (!mimeType) return '📄';

    // Check exact match first
    if (this.mimeIcons[mimeType]) return this.mimeIcons[mimeType];

    // Check by MIME type category
    if (mimeType.startsWith('text/x-python')) return '🐍';
    if (mimeType.startsWith('text/x-shell')) return '⚙️';
    if (mimeType.startsWith('text/')) return '📜';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('font/')) return '🔤';

    // YouTube links
    if (mimeType === 'application/x-youtube') return '📺';

    // Application subtypes
    if (mimeType.includes('word')) return '📘';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📙';
    if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('compressed'))
      return '📦';

    return '📄';
  },

  /**
   * Get icon for a filename (uses FileSystemDB to get MIME type)
   * @param {string} filename - File name or path
   * @returns {string} Emoji icon
   */
  getIconForFile(filename) {
    // Access FileSystemDB via window since it may be loaded separately
    const mimeType = window.FileSystemDB?.getMimeType(filename) || 'application/octet-stream';
    return this.getIcon(mimeType);
  },

  /**
   * Get icon for a file item object
   * @param {Object} item - File item with type, path, and optional mimeType
   * @returns {string} Emoji icon
   */
  getIconForItem(item) {
    if (item.type === 'directory') return '📁';
    const mimeType = item.mimeType || window.FileSystemDB?.getMimeType(item.path);
    return this.getIcon(mimeType);
  }
};
