export const FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSdpLR_J_Dilxbqu801OMWxkjEcjQVUCdgEyebpOvsg1xaXPpQ/formResponse';

export const SHEET_QUERY_URL =
  'https://docs.google.com/spreadsheets/d/1gr3KPOpGvd3X4cNdEK_yR5mIro0wDhy6NwIWjtKlow8/gviz/tq?gid=0&tq=';

export const FORM_FIELDS = {
  peer: 'entry.414865559',
  kind: 'entry.617399286',
  target: 'entry.1012538492',
  payload: 'entry.729388220'
};

export const MAX_SIGNAL_AGE_MS = 20_000;

function parseTimestamp(cell) {
  const raw = String(cell?.v ?? '').trim();
  const gvizDate = raw.match(
    /^Date\((\d{4}),(\d{1,2}),(\d{1,2})(?:,(\d{1,2}),(\d{1,2}),(\d{1,2}))?\)$/
  );

  if (gvizDate) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = gvizDate;
    return new Date(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
  }

  return new Date(String(cell?.f ?? cell?.v ?? ''));
}

export function createPeerId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('');
}

export function newestTimestamp(signals) {
  return signals.reduce((newest, signal) => Math.max(newest, signal.timestamp?.getTime() ?? 0), 0);
}

export function signalIsFresh(signal, now) {
  return Boolean(signal.timestamp && now - signal.timestamp.getTime() < MAX_SIGNAL_AGE_MS);
}

export function parseSheetResponse(response) {
  const columns = response?.table?.cols ?? [];
  const rows = response?.table?.rows ?? [];
  const headers = columns.map((column) =>
    String(column.label || '')
      .trim()
      .toLowerCase()
  );

  return rows
    .map((row) => {
      const values = row.c ?? [];
      const get = (name) => {
        const index = headers.indexOf(name);
        return index === -1 ? '' : String(values[index]?.v ?? '').trim();
      };
      const timestampIndex = headers.indexOf('timestamp');
      const timestamp = parseTimestamp(timestampIndex === -1 ? null : values[timestampIndex]);

      return {
        timestamp: Number.isNaN(timestamp.getTime()) ? null : timestamp,
        peer: get('peer'),
        kind: get('kind'),
        target: get('target'),
        payload: get('payload')
      };
    })
    .filter((signal) => signal.peer && ['waiting', 'offer', 'answer', 'bye'].includes(signal.kind));
}

export function latestSignalsByPeer(signals, now = newestTimestamp(signals)) {
  const latest = new Map();

  for (const signal of signals) {
    if (!signalIsFresh(signal, now)) continue;
    const previous = latest.get(signal.peer);
    if (!previous || signal.timestamp > previous.timestamp) latest.set(signal.peer, signal);
  }

  return latest;
}

/*
 * The form's `kind` question only accepts waiting/offer/answer/bye, so a
 * `waiting` row says where its sender is through `target`:
 *   ''              the random queue
 *   'room:<code>'   a private invite room
 *   'busy:<peer>'   in a call with <peer>; counted as present, never matched
 */
export const RANDOM_LOBBY = '';

export function roomLobby(code) {
  return `room:${code}`;
}

export function busyTarget(partnerId) {
  return `busy:${partnerId}`;
}

const ROOM_CODE_PATTERN = /^[a-z0-9]{6,24}$/;

export function createRoomCode() {
  return createPeerId().slice(0, 10);
}

export function parseRoomCode(value) {
  const code = String(value ?? '')
    .trim()
    .toLowerCase();
  return ROOM_CODE_PATTERN.test(code) ? code : '';
}

export function findWaitingPeer(
  signals,
  peerId,
  { lobby = RANDOM_LOBBY, now = newestTimestamp(signals) } = {}
) {
  return [...latestSignalsByPeer(signals, now).values()]
    .filter((signal) => signal.kind === 'waiting' && signal.target === lobby)
    .filter((signal) => signal.peer !== peerId && signal.peer < peerId)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
}

export function summarizeLobby(signals, peerId, now = newestTimestamp(signals)) {
  const summary = { ready: 0, inCall: 0 };

  for (const signal of latestSignalsByPeer(signals, now).values()) {
    if (signal.peer === peerId || signal.kind === 'bye') continue;
    if (signal.kind === 'waiting' && signal.target === RANDOM_LOBBY) summary.ready += 1;
    else if (signal.kind !== 'waiting' || signal.target.startsWith('busy:')) summary.inCall += 1;
  }

  return summary;
}

export function partnerHasLeft(partnerSignal, peerId) {
  if (!partnerSignal) return false;
  if (partnerSignal.kind === 'bye') return true;
  return partnerSignal.target !== peerId && partnerSignal.target !== busyTarget(peerId);
}

export function formBody({ peer, kind, target = '', payload = '' }) {
  const body = new URLSearchParams({
    [FORM_FIELDS.peer]: peer,
    [FORM_FIELDS.kind]: kind,
    [FORM_FIELDS.target]: target,
    [FORM_FIELDS.payload]: payload
  });
  return body;
}
