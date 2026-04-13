// true / false / : — POSIX-style exit status helpers and null command

import { TestLib } from './test-lib.js';

const VERSION_LINE =
  'Heyming OS jsh 2.0.0 — in-browser userland (virtual FS, simulated kernel). Does not report host OS version.\n';

function runTrueFalse(_terminal, args, progName) {
  const parsed = TestLib.parseTrueFalseArgv(args, progName);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    const help = progName === 'true' ? TestLib.TRUE_HELP : TestLib.FALSE_HELP;
    return { stdout: `${help}\n`, stderr: '', exitCode: 0 };
  }
  if (parsed.version) {
    return { stdout: VERSION_LINE, stderr: '', exitCode: 0 };
  }
  const exitCode = progName === 'true' ? 0 : 1;
  return { stdout: '', stderr: '', exitCode };
}

function trueHandler(terminal, args) {
  return runTrueFalse(terminal, args, 'true');
}

function falseHandler(terminal, args) {
  return runTrueFalse(terminal, args, 'false');
}

function colonHandler(_terminal, _args) {
  return { stdout: '', stderr: '', exitCode: 0 };
}

export default [
  {
    name: 'true',
    handler: trueHandler,
    description: 'exit 0 (GNU-style true)',
    category: 'System'
  },
  {
    name: 'false',
    handler: falseHandler,
    description: 'exit 1 (GNU-style false)',
    category: 'System'
  },
  {
    name: ':',
    handler: colonHandler,
    description: 'null command (POSIX :)',
    category: 'System'
  }
];
