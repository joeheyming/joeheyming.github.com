// Price alerts manager. Each call to `check(quotes)` evaluates active alerts
// against the latest quotes; when an alert fires we mark `lastTriggeredAt` and
// fire a browser notification (best-effort; we also dispatch a custom event so
// the UI can show a toast or refresh the detail panel).
//
// Storage lives in the main app state (passed via getter/setter), so alerts
// persist alongside watchlists.

/**
 * @typedef {Object} AlertSpec
 * @property {string} id                      Stable random id.
 * @property {string} symbol
 * @property {'above'|'below'} condition
 * @property {number} price
 * @property {number} [lastTriggeredAt]       Unix ms.
 */

/**
 * @typedef {Object} QuoteLike
 * @property {string} symbol
 * @property {number} [price]                 Latest known price.
 */

const RETRIGGER_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

/** Generate a short random id (no need to be cryptographic). */
export function newAlertId() {
  return 'al_' + Math.random().toString(36).slice(2, 10);
}

/**
 * Ask the browser for notification permission. Safe to call repeatedly.
 * Returns the final permission state.
 * @returns {Promise<NotificationPermission>}
 */
export async function ensureNotificationPermission() {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/**
 * Check each alert against the supplied quotes.
 *
 * @param {AlertSpec[]} alerts
 * @param {QuoteLike[]} quotes
 * @returns {{ triggered: { alert: AlertSpec, price: number }[], updated: AlertSpec[] }}
 */
export function checkAlerts(alerts, quotes) {
  const priceBySym = new Map();
  for (const q of quotes) {
    if (typeof q.price === 'number') priceBySym.set(String(q.symbol).toUpperCase(), q.price);
  }
  const now = Date.now();
  const triggered = [];
  const updated = alerts.map((a) => {
    const price = priceBySym.get(a.symbol);
    if (typeof price !== 'number') return a;
    const cond =
      a.condition === 'above' ? price >= a.price : a.condition === 'below' ? price <= a.price : false;
    if (!cond) return a;
    if (a.lastTriggeredAt && now - a.lastTriggeredAt < RETRIGGER_COOLDOWN_MS) return a;
    const next = { ...a, lastTriggeredAt: now };
    triggered.push({ alert: next, price });
    return next;
  });
  return { triggered, updated };
}

/**
 * Show a browser notification for a triggered alert. Safe in non-secure contexts
 * (will simply be a no-op if permission isn't granted).
 *
 * @param {AlertSpec} alert
 * @param {number} price
 */
export function notifyAlert(alert, price) {
  // Always emit a DOM event so the app UI can show an in-page toast too.
  try {
    document.dispatchEvent(
      new CustomEvent('stock:alert', { detail: { alert, price } })
    );
  } catch {
    /* ignore */
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const title = `${alert.symbol} ${alert.condition === 'above' ? '↑' : '↓'} ${alert.price}`;
    const body =
      alert.condition === 'above'
        ? `Price rose to ${price.toFixed(2)} (≥ ${alert.price})`
        : `Price fell to ${price.toFixed(2)} (≤ ${alert.price})`;
    new Notification(title, {
      body,
      tag: `stockalert-${alert.id}`,
      icon:
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📈</text></svg>`
        )
    });
  } catch {
    /* ignore */
  }
}
