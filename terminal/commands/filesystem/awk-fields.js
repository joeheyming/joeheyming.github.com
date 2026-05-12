/**
 * Split awk default (whitespace) fields — $0 preserved separately.
 * @param {string} line
 * @returns {string[]}
 */
function awkSplitFieldsDefault(line) {
  const m = line.match(/[^\s]+/g);
  return m || [];
}

/**
 * @param {string} line
 * @param {string} fs — ' ' means default whitespace; otherwise literal split string
 * @returns {string[]}
 */
function awkSplitFields(line, fs) {
  if (fs === ' ') {
    return awkSplitFieldsDefault(line);
  }
  return line.split(fs);
}

/**
 * Rebuild **$0** from **fields** using the same separator as **-F** (GNU **OFS**-like for jsh).
 * @param {string[]} fields
 * @param {string} ofs
 * @returns {string}
 */
function awkRebuild0FromFields(fields, ofs) {
  if (ofs === ' ') {
    return fields.join(' ');
  }
  return fields.join(ofs);
}

/**
 * Split input into awk records (lines). Trailing newline does not add an extra empty record.
 * @param {string} text
 * @returns {string[]}
 */
function awkSplitRecordLines(text) {
  const raw = String(text);
  if (raw === '') {
    return [];
  }
  const lines = raw.split('\n');
  if (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export { awkSplitFields, awkRebuild0FromFields, awkSplitRecordLines };
