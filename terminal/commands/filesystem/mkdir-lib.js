/**
 * Parse `mkdir` argv: `-p` / `--parents` and operands (after `--`).
 * @param {string[]} args
 * @returns {{ ok: true, parents: boolean, operands: string[] } | { ok: false, stderr: string }}
 */
function parseMkdirArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let parents = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (a === '--parents') {
      parents = true;
      i++;
      continue;
    }
    if (a === '-p') {
      parents = true;
      i++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (a.startsWith('--')) {
        return { ok: false, stderr: `mkdir: unrecognized option '${a}'` };
      }
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'p') {
          parents = true;
        } else {
          return { ok: false, stderr: `mkdir: invalid option -- '${c}'` };
        }
      }
      i++;
      continue;
    }
    operands.push(a);
    i++;
  }
  return { ok: true, parents, operands };
}

export const MkdirLib = {
  parseMkdirArgv
};
