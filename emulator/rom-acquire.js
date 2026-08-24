// Shared Internet Archive metadata client for the /emulator/ shell.
//
// Used by launch.js deep links and <rom-browser>. Both only ever use the IA
// client for *metadata* — listing and searching a collection. Loaded before
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
   * Match a deep-link `?rom=` query against an IA list entry by name, title,
   * or name+extension. Resolves which download link to offer — it never
   * starts a download.
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
    findRomByQuery
  };
})();
