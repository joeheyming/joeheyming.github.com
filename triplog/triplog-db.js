/**
 * IndexedDB storage for the Trip Log app. Pure local — no network, no
 * accounts, just persistent data on the device that survives reloads
 * and offline use.
 *
 * Two object stores:
 *
 *   • `trips`  — one record per trip, keyed by `id` (UUID).
 *                Indexed by `startedAt` so the history list can sort
 *                without reading every record into memory.
 *
 *   • `points` — one record per accepted GPS sample, auto-incrementing
 *                primary key (we never address individual points by id).
 *                Indexed by `tripId` so reading one trip's path is a
 *                bounded cursor scan instead of a full-store walk.
 *
 * Single `openTriplogDb()` factory returns a small, promise-shaped
 * client. Direct `IDBDatabase` is kept private so the rest of the app
 * doesn't have to know about transactions or cursors.
 */

const DB_NAME = 'triplog';
const DB_VERSION = 1;
const STORE_TRIPS = 'trips';
const STORE_POINTS = 'points';
const INDEX_POINTS_TRIP = 'by_trip';
const INDEX_TRIPS_STARTED = 'by_startedAt';

/**
 * @typedef {object} TripRecord
 * @property {string} id
 * @property {string} name
 * @property {string} startedAt    — ISO 8601
 * @property {string} endedAt      — ISO 8601, or '' while recording
 * @property {number} durationSec  — moving time (auto-pause subtracted)
 * @property {number} [elapsedSec] — wall-clock duration; added in schema v2
 * @property {number} distanceMeters
 * @property {number} pointCount
 * @property {number} [elevationGainM] — cumulative positive altitude delta; added in v2
 * @property {string} [activity]   — 'run' | 'walk' | 'bike' | etc.; added in v2
 * @property {'recording' | 'complete' | string} status
 */

/**
 * @typedef {object} PointRecord
 * @property {string} tripId
 * @property {number} t            — epoch ms
 * @property {number} lat
 * @property {number} lon
 * @property {number} [accuracy]
 * @property {number | null} [altitude]
 * @property {number | null} [speed]
 * @property {number | null} [heading]
 * @property {boolean} [gap]       — true on the resume fix after a long
 *                                   silent gap (browser-tab suspension);
 *                                   marks the segment back to the
 *                                   previous point as "GPS lost here."
 */

/** Wrap an IDBRequest in a Promise. */
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Wrap an IDBTransaction's `complete` lifecycle in a Promise. */
function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Open the Trip Log database, creating object stores and indexes on
 * first run. Schema upgrades go in `onupgradeneeded` keyed by
 * `event.oldVersion` — we only have v1 today so it's a flat init.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openRawDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TRIPS)) {
        const trips = db.createObjectStore(STORE_TRIPS, { keyPath: 'id' });
        trips.createIndex(INDEX_TRIPS_STARTED, 'startedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_POINTS)) {
        const points = db.createObjectStore(STORE_POINTS, {
          keyPath: 'pk',
          autoIncrement: true
        });
        points.createIndex(INDEX_POINTS_TRIP, 'tripId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // Another tab opened a newer version — close ours so the upgrade
    // can proceed there. The user will get an error on next operation
    // and can reload; nothing's lost.
    req.onblocked = () => reject(new Error('Database upgrade blocked by another tab'));
  });
}

/**
 * Open the database and return the public Trip Log client. Safe to
 * call repeatedly — each call opens a fresh handle. (IndexedDB shares
 * the underlying storage; opening twice is cheap.)
 *
 * @returns {Promise<{
 *   listTrips: () => Promise<TripRecord[]>,
 *   getTrip: (id: string) => Promise<TripRecord | null>,
 *   createTrip: (init: { id: string, name: string, startedAt: Date, activity?: string }) => Promise<TripRecord>,
 *   updateTripStats: (
 *     id: string,
 *     update: {
 *       distanceMeters: number,
 *       durationSec: number,
 *       elapsedSec?: number,
 *       pointCount: number,
 *       elevationGainM?: number,
 *       endedAt?: Date,
 *       status?: 'recording' | 'complete' | string
 *     }
 *   ) => Promise<TripRecord>,
 *   renameTrip: (id: string, newName: string) => Promise<TripRecord>,
 *   deleteTrip: (id: string) => Promise<void>,
 *   addPoints: (points: PointRecord[]) => Promise<void>,
 *   listPoints: (tripId: string) => Promise<PointRecord[]>,
 *   removePointsAfter: (tripId: string, keepThroughMs: number) => Promise<number>
 * }>}
 */
export async function openTriplogDb() {
  const db = await openRawDb();

  /** @returns {Promise<TripRecord[]>} */
  async function listTrips() {
    const tx = db.transaction(STORE_TRIPS, 'readonly');
    const idx = tx.objectStore(STORE_TRIPS).index(INDEX_TRIPS_STARTED);
    /** @type {TripRecord[]} */
    const out = [];
    await new Promise((resolve, reject) => {
      const req = idx.openCursor(null, 'prev'); // newest first
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(undefined);
          return;
        }
        out.push(/** @type {TripRecord} */ (cursor.value));
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    await txComplete(tx);
    return out;
  }

  /** @param {string} id */
  async function getTrip(id) {
    const tx = db.transaction(STORE_TRIPS, 'readonly');
    const trip = /** @type {TripRecord | undefined} */ (
      await reqToPromise(tx.objectStore(STORE_TRIPS).get(id))
    );
    await txComplete(tx);
    return trip ?? null;
  }

  /** @param {{ id: string, name: string, startedAt: Date, activity?: string }} init */
  async function createTrip(init) {
    /** @type {TripRecord} */
    const trip = {
      id: init.id,
      name: init.name,
      startedAt: init.startedAt.toISOString(),
      endedAt: '',
      durationSec: 0,
      elapsedSec: 0,
      distanceMeters: 0,
      pointCount: 0,
      elevationGainM: 0,
      activity: init.activity ?? 'run',
      status: 'recording'
    };
    const tx = db.transaction(STORE_TRIPS, 'readwrite');
    await reqToPromise(tx.objectStore(STORE_TRIPS).add(trip));
    await txComplete(tx);
    return trip;
  }

  /**
   * @param {string} id
   * @param {{
   *   distanceMeters: number,
   *   durationSec: number,
   *   elapsedSec?: number,
   *   pointCount: number,
   *   elevationGainM?: number,
   *   endedAt?: Date,
   *   status?: 'recording' | 'complete' | string
   * }} update
   */
  async function updateTripStats(id, update) {
    const tx = db.transaction(STORE_TRIPS, 'readwrite');
    const store = tx.objectStore(STORE_TRIPS);
    const existing = /** @type {TripRecord | undefined} */ (await reqToPromise(store.get(id)));
    if (!existing) {
      await txComplete(tx);
      throw new Error(`Trip ${id} not found`);
    }
    const merged = {
      ...existing,
      distanceMeters: Math.round(update.distanceMeters),
      durationSec: Math.round(update.durationSec),
      elapsedSec:
        update.elapsedSec !== undefined ? Math.round(update.elapsedSec) : existing.elapsedSec ?? 0,
      pointCount: update.pointCount,
      elevationGainM:
        update.elevationGainM !== undefined
          ? Math.round(update.elevationGainM)
          : existing.elevationGainM ?? 0,
      endedAt: update.endedAt ? update.endedAt.toISOString() : existing.endedAt,
      status: update.status ?? existing.status
    };
    await reqToPromise(store.put(merged));
    await txComplete(tx);
    return merged;
  }

  /**
   * Delete a trip and every GPS sample belonging to it. One transaction
   * spans both stores so a half-deleted trip can't show up after a crash.
   * @param {string} id
   */
  async function deleteTrip(id) {
    const tx = db.transaction([STORE_TRIPS, STORE_POINTS], 'readwrite');
    tx.objectStore(STORE_TRIPS).delete(id);

    const idx = tx.objectStore(STORE_POINTS).index(INDEX_POINTS_TRIP);
    await new Promise((resolve, reject) => {
      const req = idx.openCursor(IDBKeyRange.only(id));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(undefined);
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    await txComplete(tx);
  }

  /**
   * Append many GPS samples in a single transaction. Faster than one
   * `put` per point (one fsync at commit, not N).
   * @param {PointRecord[]} points
   */
  async function addPoints(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return;
    }
    const tx = db.transaction(STORE_POINTS, 'readwrite');
    const store = tx.objectStore(STORE_POINTS);
    for (const p of points) {
      // We don't need to wait per-add — the transaction will surface
      // any failure on commit, and the structured-clone of `p` happens
      // synchronously here.
      store.add(p);
    }
    await txComplete(tx);
  }

  /**
   * Rename a saved (or in-progress) trip. Read-modify-write inside a
   * single transaction so two rapid renames can't race.
   *
   * @param {string} id
   * @param {string} newName
   * @returns {Promise<TripRecord>}
   */
  async function renameTrip(id, newName) {
    const tx = db.transaction(STORE_TRIPS, 'readwrite');
    const store = tx.objectStore(STORE_TRIPS);
    const existing = /** @type {TripRecord | undefined} */ (await reqToPromise(store.get(id)));
    if (!existing) {
      await txComplete(tx);
      throw new Error(`Trip ${id} not found`);
    }
    const renamed = { ...existing, name: newName };
    await reqToPromise(store.put(renamed));
    await txComplete(tx);
    return renamed;
  }

  /**
   * Delete every point belonging to a trip whose timestamp is strictly
   * greater than `keepThroughMs`. Used by the end-crop feature when
   * the user forgot to hit Stop and wants to trim the trailing tail
   * off a saved trip. The trip record's stats need to be recomputed
   * separately by the caller (this only touches the points store).
   *
   * @param {string} tripId
   * @param {number} keepThroughMs epoch ms; points with `t <= keepThroughMs` are kept
   * @returns {Promise<number>} number of points removed
   */
  async function removePointsAfter(tripId, keepThroughMs) {
    const tx = db.transaction(STORE_POINTS, 'readwrite');
    const idx = tx.objectStore(STORE_POINTS).index(INDEX_POINTS_TRIP);
    let removed = 0;
    await new Promise((resolve, reject) => {
      const req = idx.openCursor(IDBKeyRange.only(tripId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(undefined);
          return;
        }
        const pt = /** @type {PointRecord} */ (cursor.value);
        if (typeof pt.t === 'number' && pt.t > keepThroughMs) {
          cursor.delete();
          removed += 1;
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    await txComplete(tx);
    return removed;
  }

  /** @param {string} tripId @returns {Promise<PointRecord[]>} */
  async function listPoints(tripId) {
    const tx = db.transaction(STORE_POINTS, 'readonly');
    const idx = tx.objectStore(STORE_POINTS).index(INDEX_POINTS_TRIP);
    /** @type {PointRecord[]} */
    const out = [];
    await new Promise((resolve, reject) => {
      const req = idx.openCursor(IDBKeyRange.only(tripId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(undefined);
          return;
        }
        out.push(/** @type {PointRecord} */ (cursor.value));
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    await txComplete(tx);
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  return {
    listTrips,
    getTrip,
    createTrip,
    updateTripStats,
    renameTrip,
    deleteTrip,
    addPoints,
    listPoints,
    removePointsAfter
  };
}
