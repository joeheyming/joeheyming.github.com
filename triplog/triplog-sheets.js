/**
 * Trip Log row clients backed by `../google-db/site-database.js` tables.
 *
 * Two tables, both in the shared site workbook:
 *
 *   • `triplog-trips`   — one row per recorded trip (summary).
 *   • `triplog-points`  — one row per GPS sample, partitioned by `tripId`.
 *
 * Points stream in fast (≈1 sample/sec) so we expose a buffered append
 * helper: callers push samples into `bufferPoint`, then flush in batches
 * to keep us comfortably under the per-minute Sheets quota.
 */

import { a1ColumnLetter } from '../google-db/sheets-api.js';
import {
  POINTS_HEADER,
  POINTS_RANGE,
  TRIPS_HEADER,
  TRIPS_RANGE,
  TRIPS_TABLE,
  POINTS_TABLE,
  TRIP_STATUS
} from './triplog-constants.js';

/**
 * @typedef {import('../google-db/site-database.js').SiteDatabase} SiteDatabase
 */

/**
 * @typedef {object} TripRow
 * @property {string} id
 * @property {string} name
 * @property {string} startedAt — ISO 8601
 * @property {string} endedAt   — ISO 8601, or '' while recording
 * @property {number} durationSec
 * @property {number} distanceMeters
 * @property {number} pointCount
 * @property {'recording' | 'complete' | string} status
 * @property {number} sheetRow  — 1-based row in the sheet (for in-place update)
 */

/**
 * @typedef {object} PointSample
 * @property {string} tripId
 * @property {number} t          — epoch ms
 * @property {number} lat
 * @property {number} lon
 * @property {number} [accuracy]
 * @property {number | null} [altitude]
 * @property {number | null} [speed]
 * @property {number | null} [heading]
 */

/**
 * Make sure both `triplog-*` tables exist with the expected header rows.
 * Safe to call on every connect — only writes when something is missing.
 *
 * @param {SiteDatabase} db
 */
export async function ensureTripLogTables(db) {
  const tables = await db.listTables();
  const have = new Set(tables.map((t) => t.title));

  if (!have.has(TRIPS_TABLE)) {
    await db.createTable(TRIPS_TABLE);
    await db.writeRange(TRIPS_TABLE, `A1:${a1ColumnLetter(TRIPS_HEADER.length - 1)}1`, [
      [...TRIPS_HEADER]
    ]);
  } else {
    const existing = await db.readRange(TRIPS_TABLE, 'A1:H1');
    if (!existing.length || !existing[0]?.length) {
      await db.writeRange(TRIPS_TABLE, `A1:${a1ColumnLetter(TRIPS_HEADER.length - 1)}1`, [
        [...TRIPS_HEADER]
      ]);
    }
  }

  if (!have.has(POINTS_TABLE)) {
    await db.createTable(POINTS_TABLE);
    await db.writeRange(POINTS_TABLE, `A1:${a1ColumnLetter(POINTS_HEADER.length - 1)}1`, [
      [...POINTS_HEADER]
    ]);
  } else {
    const existing = await db.readRange(POINTS_TABLE, 'A1:H1');
    if (!existing.length || !existing[0]?.length) {
      await db.writeRange(POINTS_TABLE, `A1:${a1ColumnLetter(POINTS_HEADER.length - 1)}1`, [
        [...POINTS_HEADER]
      ]);
    }
  }
}

/**
 * Tiny header-aware lookup: `findColumn(['id','title'], 'title') === 1`. Returns
 * `-1` when no header matches. Case- and whitespace-insensitive.
 * @param {readonly string[]} header
 * @param {string} name
 */
function findColumn(header, name) {
  const want = name.trim().toLowerCase();
  for (let i = 0; i < header.length; i++) {
    if (
      String(header[i] ?? '')
        .trim()
        .toLowerCase() === want
    ) {
      return i;
    }
  }
  return -1;
}

/** @param {string} v */
function toNumber(v) {
  if (v === '' || v == null) {
    return 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read all trips from the trips table, newest first by `startedAt`.
 * Also tags each row with its 1-based `sheetRow` so we can update in
 * place (the rest of the world treats trip identity as `id`, but Sheets
 * needs a row index for `writeRange`).
 *
 * @param {SiteDatabase} db
 * @returns {Promise<TripRow[]>}
 */
export async function listTrips(db) {
  const rows = await db.readRange(TRIPS_TABLE, TRIPS_RANGE);
  if (!rows.length) {
    return [];
  }
  const header = rows[0].map((c) => String(c ?? ''));
  const idI = findColumn(header, 'id');
  const nameI = findColumn(header, 'name');
  const startedI = findColumn(header, 'startedAt');
  const endedI = findColumn(header, 'endedAt');
  const durationI = findColumn(header, 'durationSec');
  const distanceI = findColumn(header, 'distanceMeters');
  const pointsI = findColumn(header, 'pointCount');
  const statusI = findColumn(header, 'status');

  if (idI === -1) {
    return [];
  }

  /** @type {TripRow[]} */
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = String(row[idI] ?? '').trim();
    if (!id) {
      continue;
    }
    out.push({
      id,
      name: String(row[nameI] ?? ''),
      startedAt: String(row[startedI] ?? ''),
      endedAt: String(row[endedI] ?? ''),
      durationSec: toNumber(String(row[durationI] ?? '')),
      distanceMeters: toNumber(String(row[distanceI] ?? '')),
      pointCount: toNumber(String(row[pointsI] ?? '')),
      status: String(row[statusI] ?? ''),
      sheetRow: r + 1
    });
  }
  out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  return out;
}

/**
 * Append a brand-new trip row in `recording` state. Returns the trip with
 * its assigned sheet row so subsequent updates can target it.
 *
 * @param {SiteDatabase} db
 * @param {{ id: string, name: string, startedAt: Date }} init
 * @returns {Promise<TripRow>}
 */
export async function createTrip(db, init) {
  const startedAtIso = init.startedAt.toISOString();
  const row = [init.id, init.name, startedAtIso, '', 0, 0, 0, TRIP_STATUS.RECORDING];
  await db.appendTableRow(TRIPS_TABLE, TRIPS_RANGE, row);

  // Re-read to discover the sheet row Sheets assigned. `appendTableRow`
  // doesn't tell us; the most recent row matching our id wins.
  const trips = await listTrips(db);
  const found = trips.find((t) => t.id === init.id);
  if (!found) {
    throw new Error('Trip row was not found after append');
  }
  return found;
}

/**
 * Update the rolling stats for a trip already in the sheet. Writes only
 * the columns we care about. `endedAt`/`status` are optional so this can
 * be used both during recording (live counters) and on stop.
 *
 * @param {SiteDatabase} db
 * @param {TripRow} trip
 * @param {{
 *   distanceMeters: number,
 *   durationSec: number,
 *   pointCount: number,
 *   endedAt?: Date,
 *   status?: 'recording' | 'complete' | string
 * }} update
 */
export async function updateTripStats(db, trip, update) {
  const row = [
    trip.id,
    trip.name,
    trip.startedAt,
    update.endedAt ? update.endedAt.toISOString() : trip.endedAt || '',
    Math.round(update.durationSec),
    Math.round(update.distanceMeters),
    update.pointCount,
    update.status ?? trip.status
  ];
  const lastCol = a1ColumnLetter(TRIPS_HEADER.length - 1);
  await db.writeRange(TRIPS_TABLE, `A${trip.sheetRow}:${lastCol}${trip.sheetRow}`, [row]);
}

/**
 * Read all GPS points belonging to one trip, oldest first (by `t`).
 *
 * @param {SiteDatabase} db
 * @param {string} tripId
 * @returns {Promise<PointSample[]>}
 */
export async function listPoints(db, tripId) {
  const rows = await db.readRange(POINTS_TABLE, POINTS_RANGE);
  if (rows.length < 2) {
    return [];
  }
  const header = rows[0].map((c) => String(c ?? ''));
  const tripI = findColumn(header, 'tripId');
  const tI = findColumn(header, 't');
  const latI = findColumn(header, 'lat');
  const lonI = findColumn(header, 'lon');
  const accI = findColumn(header, 'accuracy');
  const altI = findColumn(header, 'altitude');
  const spdI = findColumn(header, 'speed');
  const hdgI = findColumn(header, 'heading');
  if (tripI === -1 || latI === -1 || lonI === -1) {
    return [];
  }

  /** @type {PointSample[]} */
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (String(row[tripI] ?? '').trim() !== tripId) {
      continue;
    }
    const lat = Number(row[latI]);
    const lon = Number(row[lonI]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    const tRaw = String(row[tI] ?? '');
    const tMs = Date.parse(tRaw);
    out.push({
      tripId,
      t: Number.isFinite(tMs) ? tMs : 0,
      lat,
      lon,
      accuracy: accI === -1 ? undefined : Number(row[accI]) || undefined,
      altitude: altI === -1 ? null : row[altI] === '' ? null : Number(row[altI]),
      speed: spdI === -1 ? null : row[spdI] === '' ? null : Number(row[spdI]),
      heading: hdgI === -1 ? null : row[hdgI] === '' ? null : Number(row[hdgI])
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Convert one point sample into a sheet row in canonical column order.
 * @param {PointSample} p
 */
function pointToRow(p) {
  return [
    p.tripId,
    new Date(p.t).toISOString(),
    p.lat,
    p.lon,
    p.accuracy ?? '',
    p.altitude ?? '',
    p.speed ?? '',
    p.heading ?? ''
  ];
}

/**
 * Buffered point appender. `flush()` writes everything pushed since the
 * last flush in a single Sheets call (way under quota even for long
 * trips). Safe to call when empty.
 *
 * @param {SiteDatabase} db
 */
export function createPointBuffer(db) {
  /** @type {PointSample[]} */
  let buffer = [];

  return {
    /** @param {PointSample} p */
    push(p) {
      buffer.push(p);
    },

    get size() {
      return buffer.length;
    },

    async flush() {
      if (buffer.length === 0) {
        return;
      }
      const rows = buffer.map(pointToRow);
      buffer = [];
      try {
        await db.appendTableRows(POINTS_TABLE, POINTS_RANGE, rows);
      } catch (err) {
        // Don't lose the points if the network blipped — put them back at
        // the front of the buffer so the next flush retries.
        buffer = [
          ...rows.map((r) => ({
            tripId: String(r[0] ?? ''),
            t: Date.parse(String(r[1] ?? '')) || 0,
            lat: Number(r[2]) || 0,
            lon: Number(r[3]) || 0,
            accuracy: r[4] === '' ? undefined : Number(r[4]),
            altitude: r[5] === '' ? null : Number(r[5]),
            speed: r[6] === '' ? null : Number(r[6]),
            heading: r[7] === '' ? null : Number(r[7])
          })),
          ...buffer
        ];
        throw err;
      }
    }
  };
}
