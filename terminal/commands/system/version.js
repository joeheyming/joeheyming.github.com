// version - terminal / jsh version string

const USAGE = `Usage: version [--help]

Print Heyming OS shell (jsh) version. Describes the in-browser userland,
not the host operating system.
`;

function versionHandler(terminal, args) {
  if (args[0] === '--help' || args[0] === '-h') {
    return { stdout: USAGE, stderr: '', exitCode: 0 };
  }
  if (args.length > 0) {
    return {
      stdout: '',
      stderr: `version: unrecognized argument '${args[0]}'`,
      exitCode: 1
    };
  }
  return {
    stdout:
      'Heyming OS jsh 2.0.0 — in-browser userland (virtual FS, simulated kernel). Does not report host OS version.\n',
    stderr: '',
    exitCode: 0
  };
}

export default {
  name: 'version',
  handler: versionHandler,
  description: 'show terminal version',
  category: 'System'
};
