// uname - system name (GNU-ish flags; browser is not real Linux)
(function () {
  'use strict';

  const USAGE = `Usage: uname [OPTION]...
Print certain system information. With no OPTION, same as -s.

  -a, --all                print all information
  -s, --kernel-name        print the kernel name
  -n, --nodename           print the network node hostname
  -r, --kernel-release     print the kernel release
  -v, --kernel-version     print the kernel version
  -m, --machine            print the machine hardware name
  -o, --operating-system   print the operating system
      --help               display this help and exit

jsh: values are emulated for the browser shell, not the host OS.
`;

  function fields(terminal) {
    const host = (terminal.env && terminal.env.HOSTNAME) || 'heyming-os';
    const plat =
      typeof navigator !== 'undefined' && navigator.platform ? navigator.platform : 'browser';
    return {
      kernel: 'Linux',
      nodename: host,
      release: '5.15.0-jsh-generic',
      version: '#1 SMP PREEMPT jsh (emulated)',
      machine: plat,
      os: 'GNU/jsh'
    };
  }

  registerCommand(
    'uname',
    (terminal, args) => {
      if (args[0] === '--help') {
        return { stdout: USAGE, stderr: '', exitCode: 0 };
      }

      const f = {
        all: false,
        s: false,
        n: false,
        r: false,
        v: false,
        m: false,
        o: false
      };

      for (const a of args) {
        if (a === '--help') {
          return { stdout: USAGE, stderr: '', exitCode: 0 };
        }
        if (a === '--all') {
          f.all = true;
          continue;
        }
        if (a === '--kernel-name') {
          f.s = true;
          continue;
        }
        if (a === '--nodename') {
          f.n = true;
          continue;
        }
        if (a === '--kernel-release') {
          f.r = true;
          continue;
        }
        if (a === '--kernel-version') {
          f.v = true;
          continue;
        }
        if (a === '--machine') {
          f.m = true;
          continue;
        }
        if (a === '--operating-system') {
          f.o = true;
          continue;
        }
        if (a === '-a') {
          f.all = true;
          continue;
        }
        if (a.startsWith('-') && a.length > 1 && !a.startsWith('--')) {
          for (let i = 1; i < a.length; i++) {
            const c = a[i];
            if (c === 'a') f.all = true;
            else if (c === 's') f.s = true;
            else if (c === 'n') f.n = true;
            else if (c === 'r') f.r = true;
            else if (c === 'v') f.v = true;
            else if (c === 'm') f.m = true;
            else if (c === 'o') f.o = true;
            else {
              return {
                stdout: '',
                stderr: `uname: invalid option -- '${c}'\nTry 'uname --help' for more information.`,
                exitCode: 2
              };
            }
          }
          continue;
        }
        if (a.startsWith('--')) {
          return {
            stdout: '',
            stderr: `uname: unrecognized option '${a}'\nTry 'uname --help' for more information.`,
            exitCode: 2
          };
        }
        return {
          stdout: '',
          stderr: `uname: extra operand '${a}'`,
          exitCode: 1
        };
      }

      const fld = fields(terminal);
      if (f.all) {
        const line = [fld.kernel, fld.nodename, fld.release, fld.version, fld.machine, fld.os].join(
          ' '
        );
        return { stdout: line + '\n', stderr: '', exitCode: 0 };
      }

      const any = f.s || f.n || f.r || f.v || f.m || f.o;
      if (!any) {
        return { stdout: fld.kernel + '\n', stderr: '', exitCode: 0 };
      }

      const parts = [];
      if (f.s) parts.push(fld.kernel);
      if (f.n) parts.push(fld.nodename);
      if (f.r) parts.push(fld.release);
      if (f.v) parts.push(fld.version);
      if (f.m) parts.push(fld.machine);
      if (f.o) parts.push(fld.os);
      return { stdout: parts.join(' ') + '\n', stderr: '', exitCode: 0 };
    },
    'print system information (-a -s -n -r -v -m -o)',
    'System'
  );
})();
