/**
 * Named playlists for Airwave — save the current queue under a name,
 * reload it later. Storage shape under `heyming.airwave.playlists.v1`:
 *
 *   {
 *     v: 1,
 *     savedAt: <ms>,
 *     playlists: {
 *       "<id>": { id, name, createdAt, updatedAt, tracks: Track[] },
 *       ...
 *     }
 *   }
 *
 * Each playlist is keyed by a deterministic id derived from the name
 * (slugified) so renaming the same playlist doesn't leave duplicates,
 * while two playlists with the same name conflict — `save()` returns
 * a `replaced: true` flag so the UI can confirm overwrites if it wants.
 *
 * Pure data layer — no DOM, no fetch — testable under `node --test`.
 */

const STORAGE_KEY = 'heyming.airwave.playlists.v1';
const MAX_NAME_LENGTH = 80;
const MAX_PLAYLISTS = 64;
const MAX_TRACKS_PER_PLAYLIST = 500;

/** @typedef {{ id:string,title:string,author:string,thumbnail:string,duration:number|null }} Track */
/**
 * @typedef {Object} Playlist
 * @property {string} id
 * @property {string} name
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {Track[]} tracks
 */

function isValidTrack(t) {
  return (
    !!t &&
    typeof t.id === 'string' &&
    /^[a-zA-Z0-9_-]{11}$/.test(t.id) &&
    typeof t.title === 'string'
  );
}

/**
 * Stable slug for a playlist name. We prefer to merge by slug so
 * "My Mix" and "my   mix" hit the same bucket — users almost never
 * mean to keep both.
 */
export function slugifyName(name) {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Trim and clamp the user's typed name. Empty after normalization
 * means "no name" — caller should reject.
 */
export function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
}

export class AirwavePlaylists {
  /**
   * @param {{ storage?: Storage, now?: () => number }} [opts]
   */
  constructor(opts = {}) {
    this.storage = opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    /** @type {Map<string, Playlist>} */
    this.playlists = new Map();
    /** @type {Set<(snapshot: { playlists: Playlist[] }) => void>} */
    this.subs = new Set();
    this._load();
  }

  _load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const map = data && data.playlists;
      if (!map || typeof map !== 'object') return;
      for (const [id, p] of Object.entries(map)) {
        if (!p || typeof p !== 'object') continue;
        if (typeof p.name !== 'string' || !p.name) continue;
        if (!Array.isArray(p.tracks)) continue;
        const tracks = p.tracks.filter(isValidTrack).slice(0, MAX_TRACKS_PER_PLAYLIST);
        this.playlists.set(id, {
          id,
          name: p.name,
          createdAt: typeof p.createdAt === 'number' ? p.createdAt : this.now(),
          updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : this.now(),
          tracks
        });
      }
    } catch {
      /* ignore corrupt */
    }
  }

  _save() {
    if (!this.storage) return;
    try {
      const playlists = {};
      for (const [id, p] of this.playlists) playlists[id] = p;
      this.storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, savedAt: this.now(), playlists }));
    } catch {
      /* quota / private mode */
    }
  }

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this.subs.add(fn);
    fn(this.snapshot());
    return () => this.subs.delete(fn);
  }

  snapshot() {
    // Return playlists sorted by updatedAt desc so the UI renders
    // most-recent-first in the dropdown.
    const playlists = Array.from(this.playlists.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    return { playlists };
  }

  _emit() {
    const snap = this.snapshot();
    for (const fn of this.subs) {
      try {
        fn(snap);
      } catch (err) {
        console.error('[airwave playlists] listener threw:', err);
      }
    }
  }

  /**
   * Save (or overwrite) a playlist. Returns `{ ok, id, replaced, reason }`.
   *
   *   ok=false / reason="empty-name"     → name was blank after trim
   *   ok=false / reason="empty-tracks"   → no valid tracks to save
   *   ok=false / reason="too-many"       → playlist cap hit (≥ MAX_PLAYLISTS)
   *   ok=true  / replaced=true|false     → saved, replaced indicates overwrite
   */
  save(name, tracks) {
    const cleanName = normalizeName(name);
    if (!cleanName) return { ok: false, reason: 'empty-name' };
    const cleanTracks = (Array.isArray(tracks) ? tracks : [])
      .filter(isValidTrack)
      .slice(0, MAX_TRACKS_PER_PLAYLIST);
    if (cleanTracks.length === 0) return { ok: false, reason: 'empty-tracks' };

    const id = slugifyName(cleanName) || `pl-${this.now().toString(36)}`;
    const existed = this.playlists.has(id);
    if (!existed && this.playlists.size >= MAX_PLAYLISTS) {
      return { ok: false, reason: 'too-many' };
    }

    const previous = this.playlists.get(id);
    const playlist = {
      id,
      name: cleanName,
      createdAt: previous ? previous.createdAt : this.now(),
      updatedAt: this.now(),
      tracks: cleanTracks
    };
    this.playlists.set(id, playlist);
    this._save();
    this._emit();
    return { ok: true, id, replaced: existed };
  }

  /** @returns {Playlist | null} */
  get(id) {
    if (typeof id !== 'string') return null;
    const p = this.playlists.get(id);
    return p ? { ...p, tracks: p.tracks.slice() } : null;
  }

  /** Remove a playlist by id. Returns `true` if something was removed. */
  remove(id) {
    if (!this.playlists.has(id)) return false;
    this.playlists.delete(id);
    this._save();
    this._emit();
    return true;
  }
}

export const _internals = {
  STORAGE_KEY,
  MAX_NAME_LENGTH,
  MAX_PLAYLISTS,
  MAX_TRACKS_PER_PLAYLIST,
  isValidTrack
};
