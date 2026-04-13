// seq — print a sequence of numbers (GNU-style subset; jsh)
(function () {
  'use strict';

  registerCommand(
    'seq',
    (_terminal, args) => {
      const parsed = SeqLib.parseSeqArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: SeqLib.SEQ_HELP, stderr: '', exitCode: 0 };
      }
      if (parsed.version) {
        return { stdout: SeqLib.SEQ_VERSION_LINE, stderr: '', exitCode: 0 };
      }
      const seq = SeqLib.genSeqSequence(parsed.first, parsed.incr, parsed.last);
      if (seq.ok === false) {
        return { stdout: '', stderr: seq.stderr, exitCode: seq.exitCode };
      }
      const out = SeqLib.formatSeqOutput(seq.values, parsed.separator, parsed.equalWidth);
      return { stdout: out, stderr: '', exitCode: 0 };
    },
    'print a sequence of numbers (-s, -w, --help)',
    'System'
  );
})();
