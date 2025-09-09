// alias command - create command shortcuts
(function () {
  'use strict';

  registerCommand(
    'alias',
    (terminal, args) => {
      if (args.length === 0) {
        // Show all aliases
        const aliases = Object.entries(terminal.aliases);
        if (aliases.length === 0) {
          return 'No aliases defined';
        }
        return aliases.map(([name, command]) => `alias ${name}='${command}'`).join('\n');
      }

      const results = [];
      for (const arg of args) {
        if (arg.includes('=')) {
          // Define new alias: alias name=command
          const [name, ...commandParts] = arg.split('=');
          const command = commandParts.join('=');

          if (!name.match(/^[A-Za-z_][A-Za-z0-9_-]*$/)) {
            results.push(`alias: '${name}': not a valid alias name`);
            continue;
          }

          // Remove quotes if present
          const cleanCommand = command.replace(/^["']|["']$/g, '');
          terminal.aliases[name] = cleanCommand;
          results.push(`alias ${name}='${cleanCommand}'`);
        } else {
          // Show specific alias
          if (terminal.aliases[arg]) {
            results.push(`alias ${arg}='${terminal.aliases[arg]}'`);
          } else {
            results.push(`alias: ${arg}: not found`);
          }
        }
      }

      return results.join('\n');
    },
    'create command shortcuts',
    'System'
  );
})();
