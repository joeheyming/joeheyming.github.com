'use strict';

const TEST_HELP = `Usage: test [OPTION]
       test [EXPRESSION]
       [ EXPRESSION]
       [ EXPRESSION ]

Check file types and compare strings.

Options:
      --help     display this help and exit
      --version  output version information and exit

jsh implements a subset of POSIX test: recursive \`!\`, one-arg non-empty
string, two-arg unary primaries (\`-n\`, \`-z\`, \`-e\`, \`-f\`, \`-d\`,
\`-L\`, \`-h\`), and three-arg \`=\` / \`!=\` string comparisons. Symlinks
for \`-e\` / \`-f\` / \`-d\` are followed (like GNU); \`-L\` and \`-h\` test
the link itself.

Not implemented: \`-a\` / \`-o\`, parentheses, integer comparisons (\`-eq\`,
\`-gt\`, …), \`-r\` / \`-w\` / \`-x\` / \`-s\`, and other primaries.

The \`-h\` primary means a symbolic link (BSD-style), not \`--help\`. Use
\`test --help\` for this usage.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/test-invocation.html>
`;

const TEST_VERSION_LINE = 'Heyming OS jsh 2.0.0 — in-browser test(1) subset (see test --help).\n';

/**
 * Parse leading `test` / `[` options only (`--help`, `--version`).
 * Expression operands (including `-f`, `-h`, …) are not parsed here.
 *
 * @param {string[]} args
 * @returns {{ ok: true, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseTestArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  if (argsArr.length === 0) {
    return { ok: true };
  }
  const a0 = argsArr[0];
  if (a0 === '--help') {
    return { ok: true, help: true };
  }
  if (a0 === '--version') {
    return { ok: true, version: true };
  }
  if (a0.startsWith('--') && a0.length > 2) {
    const tryLine = `Try 'test --help' for more information.\n`;
    return {
      ok: false,
      stderr: `test: unrecognized option '${a0}'\n${tryLine}`,
      exitCode: 2
    };
  }
  return { ok: true };
}

const TRUE_HELP = `Usage: true [OPTION]...
Exit with a status code of zero.

      --help     display this help and exit
      --version  output version information and exit

jsh: GNU-style; operands are ignored. A lone \`-\` is treated as an operand, not an option.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/true-invocation.html>
`;

const FALSE_HELP = `Usage: false [OPTION]...
Exit with a status code of one.

      --help     display this help and exit
      --version  output version information and exit

jsh: GNU-style; operands are ignored. A lone \`-\` is treated as an operand, not an option.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/false-invocation.html>
`;

/**
 * Parse `true` / `false` argv (GNU coreutils-style).
 * A lone `-` is an operand (ignored), not an option.
 *
 * @param {string[]} args
 * @param {'true'|'false'} progName
 * @returns {{ ok: true, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseTrueFalseArgv(args, progName) {
  const argsArr = Array.isArray(args) ? args : [];
  let i = 0;
  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      break;
    }
    if (a === '-') {
      i++;
      continue;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, help: true };
    }
    if (a === '--version') {
      return { ok: true, version: true };
    }
    if (a.startsWith('-')) {
      const tryLine = `Try '${progName} --help' for more information.\n`;
      if (a.startsWith('--') && a.length > 2) {
        return {
          ok: false,
          stderr: `${progName}: unrecognized option '${a}'\n${tryLine}`,
          exitCode: 2
        };
      }
      if (a.length === 2) {
        return {
          ok: false,
          stderr: `${progName}: invalid option -- '${a[1]}'\n${tryLine}`,
          exitCode: 2
        };
      }
      return {
        ok: false,
        stderr: `${progName}: unrecognized option '${a}'\n${tryLine}`,
        exitCode: 2
      };
    }
    i++;
  }
  return { ok: true };
}

const TestLib = {
  TEST_HELP,
  TEST_VERSION_LINE,
  parseTestArgv,
  TRUE_HELP,
  FALSE_HELP,
  parseTrueFalseArgv
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).TestLib = TestLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TestLib;
}
