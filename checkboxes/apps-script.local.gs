/**
 * Compaction script for the shared Checkboxes app.
 *
 * INSTALL
 *   1. Open the spreadsheet linked to your form.
 *   2. Extensions → Apps Script.
 *   3. Replace Code.gs with this entire file. Save.
 *   4. From the function dropdown, select `installTriggers` and click
 *      Run. Authorize when prompted. This sets up:
 *        - Hourly time trigger calling compactIfNeeded (routine pruning)
 *        - On-form-submit trigger calling onFormSubmitCheck (spike net)
 *      You can also do it by hand from the Triggers panel; see
 *      installTriggers below for the exact configuration.
 *
 * WHAT IT DOES
 *   The form appends one row per click to "Form Responses 1". Left
 *   alone that grows forever. This script periodically folds the log
 *   into a bitmap snapshot stored as base64 chunks in a second tab
 *   named "Snapshot", then truncates the responses tab.
 *
 * SNAPSHOT SCHEMA
 *   Snapshot tab is keyed by name, not by row position:
 *     | key      | value                       |
 *     | chunk0   | <up to 50,000 base64 chars> |
 *     | chunk1   | <up to 50,000 base64 chars> |
 *     | chunk2   | <up to 50,000 base64 chars> |
 *     | chunk3   | <remaining base64>          |
 *     | maxTs    | <ISO-8601 timestamp>        |
 *   Concatenating chunk0..chunkK and base64-decoding gives the raw
 *   bitmap of N/8 bytes. The maxTs row is the latest timestamp
 *   already folded into the bitmap, so the page can ignore any
 *   delta rows older than maxTs.
 *
 * IDEMPOTENT
 *   Running it twice in a row is a no-op when the response log is
 *   under threshold. The threshold check exits early.
 *
 * MIGRATION
 *   Detects and silently overwrites the old per-cellId snapshot
 *   format if present (rows of [cellId, value, lastTs]). Existing
 *   form responses are read either way and folded in.
 *
 * MANUAL HELPERS (run from the Apps Script editor function dropdown)
 *   installTriggers           Wire up routine + spike triggers.
 *   rebuildSnapshotFromScratch  Force-fold all responses into a fresh
 *                               snapshot. Doesn't lose data.
 *   resetAll                  Wipe everything: response log + snapshot.
 *                             Stale browser tabs converge on the empty
 *                             grid within a minute (next snapshot poll).
 *   resetAllIncludingForm     Same as resetAll, but also clears the
 *                             form's own internal response history.
 *                             Asks for FormApp permission on first run.
 *
 * TUNABLES
 *   N                       — total cells; must match config.js CONFIG.N
 *   COMPACT_THRESHOLD_ROWS  — routine threshold; the hourly trigger
 *                             skips compaction below this.
 *   SPIKE_THRESHOLD_ROWS    — emergency threshold; on-form-submit
 *                             trigger compacts immediately above this.
 *   SNAPSHOT_CHUNK_CHARS    — max base64 chars per Snapshot cell. Stays
 *                             under Sheets' 50,000-char cap.
 */

var N = 1000000;
// Routine compaction threshold for the hourly time trigger.
// Lower = more frequent compaction, smaller polling payloads, but more
// Apps Script invocations (still well under the 6h/day quota at 500).
var COMPACT_THRESHOLD_ROWS = 500;
// Emergency threshold for the on-form-submit trigger. Compaction fires
// the moment the response log crosses this, regardless of where the
// hourly timer is in its cycle. 10k rows ≈ 1.5 MB gviz response per
// page poll, which is the point at which polling starts to feel slow.
var SPIKE_THRESHOLD_ROWS = 10000;
// Sheets cell hard cap is 50,000 chars. The bitmap is N/8 bytes
// = 125,000 bytes for 1M cells, base64-encoded to ~166,667 chars,
// so we need ceil(166667 / 50000) = 4 chunks. Header + 4 chunks +
// maxTs = 6 rows. Tiny snapshot regardless of N.
var SNAPSHOT_CHUNK_CHARS = 50000;

var RESPONSES_SHEET = 'Form Responses 1';
var SNAPSHOT_SHEET = 'Snapshot';

// Form column order: [Timestamp, cellId, value, clientId, comments(honeypot)]
var COL_TS = 0;
var COL_CELL = 1;
var COL_VALUE = 2;
// var COL_CLIENT  = 3;  // not used during compaction
var COL_HONEYPOT = 4;

// Sheets auto-detects column types. If every submitted `value` cell
// happens to be TRUE (or every cell FALSE), the column flips from
// "string" to "boolean" and getValues() returns native booleans
// instead of the strings 'TRUE'/'FALSE'. Normalize both shapes.
function toBit(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === 'string') {
    var u = v.toUpperCase();
    if (u === 'TRUE') return 1;
    if (u === 'FALSE') return 0;
  }
  return -1;
}

function compactIfNeeded() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var responses = ss.getSheetByName(RESPONSES_SHEET);
  if (!responses) {
    throw new Error('Responses tab not found: ' + RESPONSES_SHEET);
  }

  var snapshot = ss.getSheetByName(SNAPSHOT_SHEET);
  if (!snapshot) {
    snapshot = ss.insertSheet(SNAPSHOT_SHEET);
  }

  var lastRow = responses.getLastRow();
  var dataRows = lastRow - 1;
  if (dataRows < COMPACT_THRESHOLD_ROWS) {
    return;
  }

  // 1. Read existing snapshot. Tolerate either format:
  //    - new (key/value rows)  — primary case
  //    - old (cellId/value/lastTs rows) — pre-1M layout, gets folded in
  //    - empty / header-only — fresh sheet
  var bitmap = newBitmap(N);
  var maxTs = 0;
  var snapData = snapshot.getDataRange().getValues();
  var newFormatChunks = {};
  var newFormatMaxTs = 0;
  for (var i = 0; i < snapData.length; i++) {
    var row = snapData[i];
    var first = row[0];
    if (typeof first === 'string') {
      if (first.indexOf('chunk') === 0) {
        newFormatChunks[first] = String(row[1] || '');
      } else if (first === 'maxTs') {
        newFormatMaxTs = row[1] instanceof Date ? row[1].getTime() : new Date(row[1]).getTime();
      }
    }
  }
  if (Object.keys(newFormatChunks).length > 0) {
    var b64 = '';
    for (var k = 0; k < 64; k++) {
      var c = newFormatChunks['chunk' + k];
      if (c == null) break;
      b64 += c;
    }
    if (b64.length > 0) {
      var decoded = Utilities.base64Decode(b64);
      // Utilities.base64Decode returns Byte[] (signed -128..127 in GAS).
      // Coerce to unsigned 0..255 when copying into our bitmap.
      var copyLen = Math.min(decoded.length, bitmap.length);
      for (var j = 0; j < copyLen; j++) {
        var b = decoded[j];
        bitmap[j] = b < 0 ? b + 256 : b;
      }
    }
    if (isFinite(newFormatMaxTs)) maxTs = newFormatMaxTs;
  } else {
    // Old per-cellId format fallback. First row is a header.
    for (var ii = 1; ii < snapData.length; ii++) {
      var oldRow = snapData[ii];
      var oid = Number(oldRow[0]);
      var obit = toBit(oldRow[1]);
      var ots = oldRow[2] instanceof Date ? oldRow[2].getTime() : new Date(oldRow[2]).getTime();
      if (!isFinite(oid) || oid < 0 || oid >= N) continue;
      if (obit < 0) continue;
      setBit(bitmap, oid, obit);
      if (isFinite(ots) && ots > maxTs) maxTs = ots;
    }
  }

  // 2. Replay all responses, taking latest write per cellId.
  //    Apps Script V8 handles 100K+ rows of getValues() fine; for very
  //    large logs this would be where to chunk-read. At thresholds in
  //    the low thousands we never hit that regime.
  var rng = responses.getRange(2, 1, dataRows, 5).getValues();
  // Track per-cell latest ts within the delta so we don't flip a bit
  // back to an older value if rows arrive out of order in the log.
  var deltaLastTs = {};
  var processed = 0;
  for (var rj = 0; rj < rng.length; rj++) {
    var r = rng[rj];
    if (r[COL_HONEYPOT]) continue;
    var rid = Number(r[COL_CELL]);
    var rbit = toBit(r[COL_VALUE]);
    var rtsRaw = r[COL_TS];
    var rts = rtsRaw instanceof Date ? rtsRaw.getTime() : new Date(rtsRaw).getTime();
    if (!isFinite(rid) || rid < 0 || rid >= N) continue;
    if (rbit < 0) continue;
    if (!isFinite(rts)) continue;
    var prevTs = deltaLastTs[rid];
    if (prevTs == null || rts > prevTs) {
      setBit(bitmap, rid, rbit);
      deltaLastTs[rid] = rts;
    }
    if (rts > maxTs) maxTs = rts;
    processed++;
  }

  // 3. Encode bitmap → base64 → chunk → write Snapshot tab.
  // Apps Script's Utilities.base64Encode wants a Byte[]. Native arrays
  // of 0..255 numbers auto-coerce.
  var byteArr = [];
  byteArr.length = bitmap.length;
  for (var bi = 0; bi < bitmap.length; bi++) byteArr[bi] = bitmap[bi];
  var encoded = Utilities.base64Encode(byteArr);
  var chunks = [];
  for (var ci = 0; ci < encoded.length; ci += SNAPSHOT_CHUNK_CHARS) {
    chunks.push(encoded.substring(ci, ci + SNAPSHOT_CHUNK_CHARS));
  }
  var out = [['key', 'value']];
  for (var cj = 0; cj < chunks.length; cj++) {
    out.push(['chunk' + cj, chunks[cj]]);
  }
  out.push(['maxTs', new Date(maxTs).toISOString()]);
  snapshot.clear();
  snapshot.getRange(1, 1, out.length, 2).setValues(out);

  // 4. Truncate responses (keep header).
  responses.getRange(2, 1, dataRows, responses.getLastColumn()).clearContent();

  Logger.log(
    'compacted: ' +
      processed +
      ' rows folded; bitmap encoded as ' +
      chunks.length +
      ' chunk(s) totalling ' +
      encoded.length +
      ' chars; responses cleared'
  );
}

/**
 * Manual helper. Wipes Snapshot and re-folds the entire response log
 * into a fresh snapshot. Use after schema changes or to recover from a
 * corrupted snapshot.
 */
function rebuildSnapshotFromScratch() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var snapshot = ss.getSheetByName(SNAPSHOT_SHEET);
  if (snapshot) snapshot.clear();
  var orig = COMPACT_THRESHOLD_ROWS;
  COMPACT_THRESHOLD_ROWS = 0;
  try {
    compactIfNeeded();
  } finally {
    COMPACT_THRESHOLD_ROWS = orig;
  }
}

function newBitmap(n) {
  var arr = new Array(n >> 3);
  for (var i = 0; i < arr.length; i++) arr[i] = 0;
  return arr;
}

function setBit(bm, idx, v) {
  var byte = idx >> 3;
  var mask = 1 << (idx & 7);
  if (v) bm[byte] |= mask;
  else bm[byte] &= ~mask & 0xff;
}

/**
 * On-form-submit safety net. Fires once per checkbox click. Cheap
 * row count check; runs compactIfNeeded only when the log has crossed
 * SPIKE_THRESHOLD_ROWS so we don't pay the full compaction cost on
 * every click. Lets the response log self-cap during traffic spikes
 * even between hourly trigger runs.
 */
function onFormSubmitCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var responses = ss.getSheetByName(RESPONSES_SHEET);
  if (!responses) return;
  var rows = responses.getLastRow() - 1;
  if (rows >= SPIKE_THRESHOLD_ROWS) {
    var orig = COMPACT_THRESHOLD_ROWS;
    COMPACT_THRESHOLD_ROWS = 0;
    try {
      compactIfNeeded();
    } finally {
      COMPACT_THRESHOLD_ROWS = orig;
    }
  }
}

/**
 * One-time setup: wire up the two triggers this script needs.
 *   - Hourly: compactIfNeeded (routine pruning when log >= COMPACT_THRESHOLD_ROWS)
 *   - On-form-submit: onFormSubmitCheck (immediate compaction at SPIKE_THRESHOLD_ROWS)
 * Removes any pre-existing triggers pointing at these handlers first,
 * so calling installTriggers a second time replaces rather than stacks.
 *
 * On first run Apps Script will ask for permission to manage triggers
 * and (because of onFormSubmit) read the spreadsheet's form binding —
 * the standard "Google hasn't verified this app" warning, accept it.
 */
function installTriggers() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    var fn = existing[i].getHandlerFunction();
    if (fn === 'compactIfNeeded' || fn === 'onFormSubmitCheck') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  ScriptApp.newTrigger('compactIfNeeded').timeBased().everyHours(1).create();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('onFormSubmitCheck').forSpreadsheet(ss).onFormSubmit().create();
  Logger.log('triggers installed: hourly compactIfNeeded + onFormSubmit safety net');
}

/**
 * Wipe-and-reset. Clears the response log (keeps header) and writes a
 * fresh all-zeros snapshot with maxTs = now. Stale browser tabs see
 * the new snapshot on their next refresh (~within 60s) and clear
 * their own state to match. Refreshed tabs and new visitors see an
 * empty grid immediately.
 *
 * Does not touch the form's internal response history (still visible
 * in the form's "Responses" tab in the form editor). Use
 * resetAllIncludingForm to wipe that too.
 */
function resetAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var responses = ss.getSheetByName(RESPONSES_SHEET);
  if (!responses) {
    throw new Error('Responses tab not found: ' + RESPONSES_SHEET);
  }
  var snapshot = ss.getSheetByName(SNAPSHOT_SHEET);
  if (!snapshot) {
    snapshot = ss.insertSheet(SNAPSHOT_SHEET);
  }

  var dataRows = responses.getLastRow() - 1;
  if (dataRows > 0) {
    responses.getRange(2, 1, dataRows, responses.getLastColumn()).clearContent();
  }
  writeEmptySnapshot(snapshot);
  Logger.log('reset: ' + dataRows + ' response row(s) cleared, snapshot zeroed');
}

/**
 * Same as resetAll plus deletes the form's internal response history.
 * On first run this triggers an additional permission prompt for
 * FormApp access. If you don't care about the form-side history,
 * resetAll is enough — the page only ever reads the linked sheet.
 */
function resetAllIncludingForm() {
  resetAll();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var responses = ss.getSheetByName(RESPONSES_SHEET);
  if (!responses) return;
  var formUrl = responses.getFormUrl();
  if (!formUrl) {
    Logger.log('no linked form found; sheet-side reset only');
    return;
  }
  var form = FormApp.openByUrl(formUrl);
  form.deleteAllResponses();
  Logger.log('form responses cleared');
}

/**
 * Writes a fresh, all-zeros packed-bitmap snapshot to the given sheet.
 * Used by resetAll and (indirectly) by onFormSubmitCheck after a
 * compaction empties the log. maxTs is set to now so any stale rows
 * a viewer might still have buffered get treated as already-folded.
 */
function writeEmptySnapshot(snapshot) {
  var bytes = newBitmap(N);
  var encoded = Utilities.base64Encode(bytes);
  var chunks = [];
  for (var ci = 0; ci < encoded.length; ci += SNAPSHOT_CHUNK_CHARS) {
    chunks.push(encoded.substring(ci, ci + SNAPSHOT_CHUNK_CHARS));
  }
  var out = [['key', 'value']];
  for (var cj = 0; cj < chunks.length; cj++) out.push(['chunk' + cj, chunks[cj]]);
  out.push(['maxTs', new Date().toISOString()]);
  snapshot.clear();
  snapshot.getRange(1, 1, out.length, 2).setValues(out);
}
