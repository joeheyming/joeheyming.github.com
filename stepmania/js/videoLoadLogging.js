// Structured console logs for background video / FFmpeg — filter console by "[StepMania:video]"

const PREFIX = '[StepMania:video]';

/**
 * @param {string} phase
 * @param {Record<string, unknown>} [fields]
 */
export function logVideoLoad(phase, fields = {}) {
  const payload = { phase, t: new Date().toISOString(), ...fields };
  // Use console.log (not .info) so messages stay visible when the console is filtered to "Warnings" only.
  console.log(PREFIX, payload);
}

/**
 * @param {string} phase
 * @param {unknown} err
 * @param {Record<string, unknown>} [fields]
 */
export function logVideoError(phase, err, fields = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  const payload = {
    phase,
    t: new Date().toISOString(),
    errorName: e.name,
    errorMessage: e.message,
    ...fields
  };
  if (e.stack) {
    payload.errorStack = e.stack;
  }
  console.warn(PREFIX, payload);
}
