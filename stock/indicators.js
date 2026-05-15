// Pure-math technical indicators. Each function takes a numeric series and returns
// an aligned output array (same length, with `null` for "warm-up" positions where
// the indicator isn't defined yet).

/**
 * Simple moving average.
 * @param {Array<number>} values
 * @param {number} period
 * @returns {Array<number|null>}
 */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average. Seeded with the SMA of the first `period` values.
 * @param {Array<number>} values
 * @param {number} period
 * @returns {Array<number|null>}
 */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seedSum = 0;
  for (let i = 0; i < period; i++) seedSum += values[i];
  let prev = seedSum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Sample standard deviation rolling window. Aligned to the *end* of the window.
 * @param {Array<number>} values
 * @param {number} period
 * @returns {Array<number|null>}
 */
export function stdev(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 1) return out;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const mean = sum / period;
    let varSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean;
      varSum += d * d;
    }
    out[i] = Math.sqrt(varSum / period);
  }
  return out;
}

/**
 * Bollinger Bands. `mid` is the SMA(period); upper/lower are mid ± mult*stdev.
 * @param {Array<number>} values
 * @param {number} [period=20]
 * @param {number} [mult=2]
 * @returns {{ mid: Array<number|null>, upper: Array<number|null>, lower: Array<number|null> }}
 */
export function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const sd = stdev(values, period);
  const upper = mid.map((m, i) => (m == null || sd[i] == null ? null : m + mult * sd[i]));
  const lower = mid.map((m, i) => (m == null || sd[i] == null ? null : m - mult * sd[i]));
  return { mid, upper, lower };
}

/**
 * Wilder's RSI (smoothed moving average).
 * @param {Array<number>} values
 * @param {number} [period=14]
 * @returns {Array<number|null>}
 */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * MACD line + signal line + histogram.
 * @param {Array<number>} values
 * @param {number} [fast=12]
 * @param {number} [slow=26]
 * @param {number} [signal=9]
 */
export function macd(values, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  /** @type {Array<number|null>} */
  const macdLine = emaFast.map((v, i) =>
    v == null || emaSlow[i] == null ? null : v - emaSlow[i]
  );

  // Compute signal EMA over the densely-packed (non-null) MACD values, then
  // splice the result back into the aligned positions.
  /** @type {number[]} */
  const dense = [];
  /** @type {number[]} */
  const denseIdx = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] != null) {
      dense.push(/** @type {number} */ (macdLine[i]));
      denseIdx.push(i);
    }
  }
  const sigDense = ema(dense, signal);
  /** @type {Array<number|null>} */
  const signalLine = new Array(values.length).fill(null);
  for (let j = 0; j < denseIdx.length; j++) {
    signalLine[denseIdx[j]] = sigDense[j];
  }
  /** @type {Array<number|null>} */
  const histogram = macdLine.map((m, i) =>
    m == null || signalLine[i] == null ? null : m - signalLine[i]
  );
  return { macd: macdLine, signal: signalLine, histogram };
}
