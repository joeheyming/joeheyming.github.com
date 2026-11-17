/**
 * Quick saves the game list and the home page can see.
 *
 * EmulatorJS keeps the state bytes in its own IndexedDB. This index is
 * the small record — which game, when, and a shot of the screen — so a
 * card can offer Continue before the core is loaded.
 */
(function () {
  'use strict';

  if (window.emulatorResumes) return;

  const KEY = 'heyming.emulator.resumes.v1';
  const LIMIT = 8;
  const SHOT_MAX = 20000;

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function clean(value) {
    let text = '';
    for (const ch of String(value || '')) {
      if (ch.charCodeAt(0) >= 32) text += ch;
    }
    return text.trim().slice(0, 180);
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function consoleId(value) {
    return clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 24);
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function shotOf(value) {
    const shot = typeof value === 'string' ? value : '';
    if (!shot.startsWith('data:image/jpeg')) return '';
    return shot.length <= SHOT_MAX ? shot : '';
  }

  /**
   * @param {unknown} row
   * @returns {{ console: string, file: string, title: string, at: number, shot: string } | null}
   */
  function rowOf(row) {
    if (!row || typeof row !== 'object') return null;
    const record =
      /** @type {{ console?: unknown, file?: unknown, title?: unknown, at?: unknown, shot?: unknown }} */ (
        row
      );
    const id = consoleId(record.console);
    const file = clean(record.file);
    const title = clean(record.title) || file;
    if (!id || !file) return null;
    return {
      console: id,
      file,
      title,
      at: Number(record.at) || 0,
      shot: shotOf(record.shot)
    };
  }

  /**
   * @param {{ getItem?: (key: string) => string | null } | null | undefined} storage
   * @returns {Array<{ console: string, file: string, title: string, at: number, shot: string }>}
   */
  function read(storage) {
    if (!storage || typeof storage.getItem !== 'function') return [];
    try {
      const parsed = JSON.parse(storage.getItem(KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      /** @type {Array<{ console: string, file: string, title: string, at: number, shot: string }>} */
      const out = [];
      for (const row of parsed) {
        const record = rowOf(row);
        if (record) out.push(record);
        if (out.length >= LIMIT) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * @param {{ setItem?: (key: string, value: string) => void } | null | undefined} storage
   * @param {Array<{ console: string, file: string, title: string, at: number, shot: string }>} rows
   * @param {boolean} keepShots
   * @returns {boolean}
   */
  function write(storage, rows, keepShots) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    const payload = keepShots
      ? rows
      : rows.map((row) => ({
          console: row.console,
          file: row.file,
          title: row.title,
          at: row.at,
          shot: ''
        }));
    try {
      storage.setItem(KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {{ getItem?: (key: string) => string | null, setItem?: (key: string, value: string) => void } | null | undefined} storage
   * @param {{ console?: unknown, file?: unknown, title?: unknown, shot?: unknown }} input
   * @returns {boolean}
   */
  function remember(storage, input) {
    const next = rowOf({
      console: input && input.console,
      file: input && input.file,
      title: input && input.title,
      at: Date.now(),
      shot: input && input.shot
    });
    if (!next) return false;
    const rows = read(storage).filter(
      (row) => !(row.console === next.console && row.file === next.file)
    );
    rows.unshift(next);
    const trimmed = rows.slice(0, LIMIT);
    if (write(storage, trimmed, true)) return true;
    return write(storage, trimmed, false);
  }

  /**
   * @param {{ console: string, file: string, title: string }} entry
   * @param {string} id
   * @param {{ name?: string, title?: string } | null | undefined} rom
   * @returns {boolean}
   */
  function matches(entry, id, rom) {
    if (!entry || entry.console !== consoleId(id) || !rom) return false;
    const file = clean(rom.name);
    const title = clean(rom.title);
    if (file && entry.file === file) return true;
    if (title && (entry.title === title || entry.file === title)) return true;
    return false;
  }

  /**
   * @param {{ getItem?: (key: string) => string | null } | null | undefined} storage
   * @param {string} id
   * @param {{ name?: string, title?: string } | null | undefined} rom
   */
  function forRom(storage, id, rom) {
    return read(storage).find((entry) => matches(entry, id, rom)) || null;
  }

  /**
   * @param {{ console: string, file: string, title: string }} entry
   * @returns {string}
   */
  function href(entry) {
    const rom = encodeURIComponent(entry.file || entry.title);
    return `/emulator/${entry.console}/?rom=${rom}&resume=1`;
  }

  window.emulatorResumes = {
    key: KEY,
    read,
    remember,
    forRom,
    href
  };
})();
