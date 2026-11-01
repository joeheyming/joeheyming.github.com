// Shared Internet Archive client + ROM File helpers for the /emulator/ shell.
//
// Used by launch.js deep links and <rom-browser> so both wrap IA bytes into
// a File with the same filename / MIME rules libretro expects. Loaded before
// rom-browser.js and launch.js.
//
// Public surface: window.emulatorRomAcquire
(function () {
  'use strict';

  function createIaClient(cfg) {
    if (!cfg || !cfg.iaBaseUrl || !window.InternetArchiveRoms) return null;
    return new window.InternetArchiveRoms({
      baseUrl: cfg.iaBaseUrl,
      descriptionPrefix: cfg.iaDescriptionPrefix,
      fileExtensions: cfg.iaFileExtensions,
      excludeNames: cfg.iaExcludeNames,
      binaryTimeout: cfg.iaBinaryTimeout,
      maxRetries: cfg.iaMaxRetries,
      preferMetadata: cfg.iaPreferMetadata !== false
    });
  }

  /**
   * Wrap downloaded ROM bytes in a File so EmulatorJS / libretro cores see a
   * real filename. Preserve the archive extension: .zip collections unzip
   * inside the core; raw .gb / .gbc must keep their suffix.
   *
   * @param {ArrayBuffer|Uint8Array|Blob} romData
   * @param {{ title?: string, name?: string, fileExtension?: string }} rom
   * @returns {File}
   */
  function fileFromRomBytes(romData, rom) {
    const ext = (rom && rom.fileExtension) || '.zip';
    const mimeType = ext === '.zip' ? 'application/zip' : 'application/octet-stream';
    const title = (rom && (rom.title || rom.name)) || 'rom';
    const filename = `${title}${ext}`;
    return new File([romData], filename, { type: mimeType });
  }

  /**
   * Match a deep-link `?rom=` query against an IA list entry by name, title,
   * or name+extension.
   *
   * @param {Array<{ name: string, title: string, fileExtension?: string }>} roms
   * @param {string} wanted
   * @returns {object|undefined}
   */
  function findRomByQuery(roms, wanted) {
    const lower = String(wanted || '')
      .trim()
      .toLowerCase();
    if (!lower || !Array.isArray(roms)) return undefined;
    return roms.find(
      (r) =>
        r.name.toLowerCase() === lower ||
        r.title.toLowerCase() === lower ||
        `${r.name}${r.fileExtension || ''}`.toLowerCase() === lower
    );
  }

  window.emulatorRomAcquire = {
    createIaClient,
    fileFromRomBytes,
    findRomByQuery
  };
})();
