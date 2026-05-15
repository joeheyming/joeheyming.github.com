/**
 * Prefs — persistent app state in `localStorage`.
 *
 * Two levels:
 *   • `makePrefs(key)`        — raw blob load/save, swallows failures.
 *                                Used by the play/* instrument pages.
 *   • `createPrefs(config)`    — versioned + defaulted + sanitized + URL-aware
 *                                lifecycle. Used by apps with structured state
 *                                that needs validation, migration, or sharing.
 *
 * The two coexist: `makePrefs` is fine for "tiny key/value bag of UI
 * preferences"; `createPrefs` absorbs the "load → check version → migrate
 * → sanitize → merge URL → save → debounce" scaffolding that several
 * apps used to each re-derive (stock, pacman-infinite, paint, code-ide,
 * countdown, play/strings).
 */

// ─────────────────────────────────────────────────────────────────────────
//  Level 1 — raw load/save bag (existing API, kept verbatim).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Tiny localStorage wrapper that quietly ignores failures (private mode,
 * disabled storage, etc.). Each instrument page passes its own key.
 */
export function makePrefs(key) {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed ? parsed : {};
      } catch (_) {
        return {};
      }
    },
    save(obj) {
      try {
        localStorage.setItem(key, JSON.stringify(obj));
      } catch (_) {
        /* ignore */
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  Level 2 — full state lifecycle.
// ─────────────────────────────────────────────────────────────────────────

/**
 * @template T
 * @typedef {Object} CreatePrefsConfig
 *
 * @property {string} key
 *   localStorage key. Use a versioned key (e.g. `heyming.stock.v2`) when
 *   you want a hard cutover at major schema breaks; use a stable key with
 *   `version` + `migrate` for incremental schema evolution.
 *
 * @property {() => T} defaults
 *   Factory that returns a fresh, fully-populated state. Called on every
 *   missing/corrupt storage read so each load gets independent objects.
 *
 * @property {(raw: any) => T} [sanitize]
 *   Validates and repairs a possibly-malformed loaded blob into a
 *   well-typed `T`. Runs after `migrate`. If omitted the loaded blob is
 *   merged onto defaults shallowly.
 *
 * @property {number} [version]
 *   Current schema version. When the stored blob's `__v` differs, the
 *   loader passes (stored, storedVersion) to `migrate`. Saves always
 *   stamp the current version. Omit to skip versioning entirely.
 *
 * @property {(stored: any, fromVersion: number | null) => any} [migrate]
 *   Transform a stored blob from `fromVersion` (or `null` for unstamped)
 *   into the current shape. Result is then handed to `sanitize`. Default:
 *   return the stored blob unchanged (sanitize is then expected to cope).
 *
 * @property {(state: T) => any} [serialize]
 *   Map state to the wire shape stored in localStorage. Default identity.
 *   Useful when state contains Sets/Maps that don't survive `JSON`.
 *
 * @property {(stored: any) => any} [deserialize]
 *   Inverse of `serialize`. Runs before `migrate`. Default identity.
 *
 * @property {(url: URL) => Partial<T> | null} [readUrlState]
 *   Read state overrides from the page URL. When present and non-null,
 *   `load()` shallow-merges this on top of the localStorage value (URL
 *   overrides local, so shared links work in fresh windows).
 *
 * @property {(state: T) => Record<string, string>} [writeUrlState]
 *   Build a query-string map for `buildShareUrl(state)`. The result is
 *   set on `URL.searchParams` and the URL is returned as a string.
 *
 * @property {number} [saveDebounceMs]
 *   When > 0, `save()` debounces writes by this many ms. Useful for
 *   hot-loop callers (e.g. the pacman-infinite game tick that wants to
 *   save every 1–2s without spamming localStorage). Default 0 = sync.
 */

/**
 * @template T
 * @param {CreatePrefsConfig<T>} config
 * @returns {{
 *   load: () => T,
 *   save: (state: T) => void,
 *   clear: () => void,
 *   has: () => boolean,
 *   buildShareUrl: (state: T, base?: string) => string,
 *   flush: () => void
 * }}
 */
export function createPrefs(config) {
  const {
    key,
    defaults,
    sanitize = (raw) => raw,
    version,
    migrate,
    serialize = (s) => s,
    deserialize = (s) => s,
    readUrlState,
    writeUrlState,
    saveDebounceMs = 0
  } = config;

  if (!key) throw new Error('createPrefs: `key` is required');
  if (typeof defaults !== 'function') throw new Error('createPrefs: `defaults` must be a function');

  const versioned = typeof version === 'number';

  function readRaw() {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      // Corrupt / private mode → caller will fall through to defaults.
      return null;
    }
  }

  function load() {
    const base = defaults();
    const stored = readRaw();
    if (!stored || typeof stored !== 'object') {
      return applyUrl(base);
    }

    let blob = stored;
    let storedVersion = null;
    if (versioned) {
      // Versioned saves stamp `__v` (defensively stash on the wrapper
      // object even when serialize() returns the user's flat blob).
      storedVersion =
        typeof blob.__v === 'number'
          ? blob.__v
          : typeof blob.version === 'number'
            ? blob.version
            : null;
      if (typeof blob.__data !== 'undefined') {
        // We wrote with the wrapped envelope shape. Unwrap.
        blob = blob.__data;
      }
    }

    let unwrapped;
    try {
      unwrapped = deserialize(blob);
    } catch {
      return applyUrl(base);
    }

    let migrated = unwrapped;
    if (versioned && storedVersion !== version && typeof migrate === 'function') {
      try {
        migrated = migrate(unwrapped, storedVersion);
      } catch {
        return applyUrl(base);
      }
    } else if (versioned && storedVersion !== version) {
      // Version mismatch with no migrator — treat as corrupt rather
      // than silently loading possibly-incompatible state. Same policy
      // pacman-infinite/save.js had inlined.
      return applyUrl(base);
    }

    let merged;
    try {
      // sanitize accepts the possibly-shape-shifted migrated blob and
      // returns a fully-validated state. Apps that don't want
      // structural validation just provide identity sanitize and a
      // permissive defaults factory.
      merged = sanitize({ ...base, ...migrated });
    } catch {
      return applyUrl(base);
    }

    return applyUrl(merged);
  }

  function applyUrl(state) {
    if (typeof readUrlState !== 'function' || typeof URL === 'undefined') return state;
    if (typeof location === 'undefined') return state;
    let urlOverrides;
    try {
      urlOverrides = readUrlState(new URL(location.href));
    } catch {
      return state;
    }
    if (!urlOverrides || typeof urlOverrides !== 'object') return state;
    // Apps with shape-aware URL merging should override `sanitize` to
    // re-validate after merge. Default merge is shallow — same shape
    // policy stock/state.js used.
    return sanitize({ ...state, ...urlOverrides });
  }

  /** @type {ReturnType<typeof setTimeout> | null} */
  let pendingTimer = null;
  /** @type {T | null} */
  let pendingState = null;

  function writeNow(state) {
    if (typeof localStorage === 'undefined') return;
    try {
      let payload;
      try {
        payload = serialize(state);
      } catch {
        return;
      }
      const wireShape = versioned ? { __v: version, __data: payload } : payload;
      localStorage.setItem(key, JSON.stringify(wireShape));
    } catch {
      /* quota / private mode */
    }
  }

  function save(state) {
    if (saveDebounceMs > 0) {
      pendingState = state;
      if (pendingTimer) return;
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        if (pendingState != null) {
          writeNow(pendingState);
          pendingState = null;
        }
      }, saveDebounceMs);
      return;
    }
    writeNow(state);
  }

  function flush() {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    if (pendingState != null) {
      writeNow(pendingState);
      pendingState = null;
    }
  }

  function clear() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  function has() {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem(key) != null;
    } catch {
      return false;
    }
  }

  function buildShareUrl(state, base) {
    if (typeof URL === 'undefined') return base || '';
    const url = new URL(base || (typeof location !== 'undefined' ? location.href : 'http://localhost/'));
    url.search = '';
    if (typeof writeUrlState === 'function') {
      const params = writeUrlState(state) || {};
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== '') url.searchParams.set(k, v);
      }
    }
    return url.toString();
  }

  return { load, save, clear, has, buildShareUrl, flush };
}
