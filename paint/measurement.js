// Image › Analysis measurement scale (PhotoCraft crates/doc/src/analysis.rs MeasurementScale):
// pixelLength document pixels are logicalLength units. Saved in .paintproj.

/** 1 pixel = 1 pixel (MeasurementScale::default). */
export const DEFAULT_MEASUREMENT_SCALE = Object.freeze({
  pixelLength: 1,
  logicalLength: 1,
  units: 'pixels'
});

/** Units per pixel (MeasurementScale::factor): logical / pixel length, 1 for a zero pixel length. */
export function measurementScaleFactor(scale) {
  return scale.pixelLength > 0 ? scale.logicalLength / scale.pixelLength : 1;
}

/** A saved scale as a fresh object; older .paintproj files and bad values open with the default. */
export function normalizeMeasurementScale(scale) {
  const ok =
    scale &&
    Number.isFinite(scale.pixelLength) &&
    Number.isFinite(scale.logicalLength) &&
    typeof scale.units === 'string';
  const { pixelLength, logicalLength, units } = ok ? scale : DEFAULT_MEASUREMENT_SCALE;
  return { pixelLength, logicalLength, units };
}

/** Photoshop's Scale text (MeasurementScale::describe), e.g. `100 pixels = 2.5000 cm`. */
export function measurementScaleText(scale) {
  return `${scale.pixelLength} pixels = ${scale.logicalLength.toFixed(4)} ${scale.units}`;
}

/** The scale is 1 pixel = 1 pixel (MeasurementScale::is_default). */
export function isDefaultMeasurementScale(scale) {
  const d = DEFAULT_MEASUREMENT_SCALE;
  return (
    scale.pixelLength === d.pixelLength &&
    scale.logicalLength === d.logicalLength &&
    scale.units === d.units
  );
}

/**
 * Set Measurement Scale… OK (analysis_cmds.rs set_scale): fields are the dialog's
 * { preset: 'default' | 'custom', pixelLength, logicalLength, units }; a missing value keeps
 * `cur`'s. Returns { scale } or { error } when a length is not positive or the units are empty.
 */
export function measurementScaleFromDialog(fields, cur = DEFAULT_MEASUREMENT_SCALE) {
  if (fields.preset === 'default') return { scale: normalizeMeasurementScale(null) };
  const num = (v, fallback) => (v === undefined || v === null || v === '' ? fallback : Number(v));
  const pixelLength = num(fields.pixelLength, cur.pixelLength);
  const logicalLength = num(fields.logicalLength, cur.logicalLength);
  const units = typeof fields.units === 'string' ? fields.units : cur.units;
  const positive = (v) => Number.isFinite(v) && v > 0;
  if (!positive(pixelLength) || !positive(logicalLength)) {
    return { error: 'Pixel Length and Logical Length must be positive.' };
  }
  if (!units.trim()) return { error: 'Logical Units must not be empty.' };
  return { scale: { pixelLength, logicalLength, units } };
}
