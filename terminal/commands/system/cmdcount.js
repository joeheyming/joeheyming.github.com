// cmdcount - command registry stats
(function () {
  'use strict';

  const USAGE = `Usage: cmdcount [--help] [--loaded | --all]

Show how many commands are registered vs loaded in jsh.
`;

  registerCommand(
    'cmdcount',
    (terminal, args) => {
      if (args.includes('--help') || args.includes('-h')) {
        return { stdout: USAGE, stderr: '', exitCode: 0 };
      }

      const bad = args.filter((a) => !['--loaded', '--all'].includes(a));
      if (bad.length > 0) {
        return {
          stdout: '',
          stderr: `cmdcount: unrecognized option '${bad[0]}'`,
          exitCode: 2
        };
      }

      if (!window.commandRegistry) {
        return {
          stdout: '',
          stderr: 'cmdcount: command registry not available',
          exitCode: 1
        };
      }

      const loadedCommands = window.commandRegistry.getCommands();
      const allCommands = window.commandRegistry.getAllCommands();
      const loadedCount = loadedCommands.length;
      const totalCount = allCommands.length;

      let output = `📊 Command Registry Status:\n`;
      output += `Total available commands: ${totalCount}\n`;
      output += `Currently loaded: ${loadedCount}\n`;
      output += `Dynamically loadable: ${totalCount - loadedCount}\n\n`;

      if (args.includes('--all')) {
        const byCategory = window.commandRegistry.getCommandsByCategory();
        Object.entries(byCategory).forEach(([category, commands]) => {
          output += `\n${category}:\n`;
          commands.forEach((cmd) => {
            const status = loadedCommands.find((c) => c.name === cmd.name) ? '✅' : '⏳';
            output += `  ${status} ${cmd.name} - ${cmd.description}\n`;
          });
        });
      } else if (args.includes('--loaded')) {
        output += `Loaded commands: ${loadedCommands
          .map((c) => c.name)
          .sort()
          .join(', ')}\n`;
      } else {
        output += `Use --loaded to see loaded commands, --all to see all with status\n`;
      }

      return { stdout: output, stderr: '', exitCode: 0 };
    },
    'show command registry status (--loaded, --all)',
    'System'
  );
})();
