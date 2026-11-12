/**
 * Local date-and-time labels for chat lines.
 * `hasTime: false` is a calendar day only (UTC midnight). A date-only cell
 * format used to hide the clock; inventing 12:00 AM would be the wrong time.
 */

/**
 * @param {string|undefined} timeZone
 * @returns {Intl.DateTimeFormatOptions}
 */
function zoneOpts(timeZone) {
  return timeZone ? { timeZone } : {};
}

/**
 * @param {string} text
 */
function normalizeSpaces(text) {
  return text.replace(/[\u202f\u00a0]/g, ' ');
}

/**
 * Localized date and time, e.g. "Nov 12, 3:00 AM".
 * @param {number} ts
 * @param {{ locale?: string, timeZone?: string, hasTime?: boolean }} [opts]
 * @returns {string}
 */
export function formatChatTime(ts, opts = {}) {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  if (opts.hasTime === false) {
    return normalizeSpaces(
      new Intl.DateTimeFormat(opts.locale, {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric'
      }).format(ts)
    );
  }
  return normalizeSpaces(
    new Intl.DateTimeFormat(opts.locale, {
      ...zoneOpts(opts.timeZone),
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(ts)
  );
}

/**
 * Full local datetime for the hover label, including the time zone name.
 * @param {number} ts
 * @param {{ locale?: string, timeZone?: string, hasTime?: boolean }} [opts]
 * @returns {string}
 */
export function formatChatTimeTitle(ts, opts = {}) {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  if (opts.hasTime === false) {
    return normalizeSpaces(
      new Intl.DateTimeFormat(opts.locale, {
        timeZone: 'UTC',
        dateStyle: 'medium'
      }).format(ts)
    );
  }
  // dateStyle and timeStyle cannot be combined with timeZoneName.
  return normalizeSpaces(
    new Intl.DateTimeFormat(opts.locale, {
      ...zoneOpts(opts.timeZone),
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    }).format(ts)
  );
}

/**
 * `datetime` attribute. Date-only values stay on their calendar day.
 * @param {number} ts
 * @param {boolean} hasTime
 * @returns {string}
 */
export function chatTimeStamp(ts, hasTime) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  if (!hasTime) return d.toISOString().slice(0, 10);
  return d.toISOString();
}

/**
 * Short name of the viewer's time zone, e.g. "PST" or "GMT+1".
 * @param {number} [now]
 * @param {{ locale?: string, timeZone?: string }} [opts]
 * @returns {string}
 */
export function localTimeZoneLabel(now = Date.now(), opts = {}) {
  try {
    const parts = new Intl.DateTimeFormat(opts.locale, {
      ...zoneOpts(opts.timeZone),
      timeZoneName: 'short'
    }).formatToParts(now);
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}
