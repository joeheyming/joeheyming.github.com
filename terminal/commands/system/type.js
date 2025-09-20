// type command - display information about command type
(function () {
  'use strict';

  registerCommand(
    'type',
    async (terminal, args) => {
      if (args.length === 0) {
        return 'type: usage: type [-a] name [name ...]';
      }

      const showAll = args.includes('-a');
      const commands = args.filter((arg) => !arg.startsWith('-'));

      if (commands.length === 0) {
        return 'type: usage: type [-a] name [name ...]';
      }
s
      const results = [];

      for (const cmdName of commands) {
        const cmdResults = [];

        // Check if it's an alias first
        if (terminal.aliases[cmdName]) {
          cmdResults.push(`${cmdName} is aliased to \`${terminal.aliases[cmdName]}\``);
          if (!showAll) {
            results.push(cmdResults[0]);
            continue;
          }
        }

        // Check if it's a built-in command
        if (window.commandRegistry.has(cmdName)) {
          // Try to get the command source code
          try {
            await window.commandRegistry.get(cmdName);
            const scriptPath = window.commandRegistry.commandMap[cmdName];

            if (scriptPath) {
              // Fetch and display the source code
              try {
                const response = await fetch(scriptPath);
                if (response.ok) {
                  const sourceCode = await response.text();
                  cmdResults.push(`${cmdName} is a shell builtin:\n\n${sourceCode}`);
                } else {
                  cmdResults.push(`${cmdName} is a shell builtin (source not available)`);
                }
              } catch (fetchError) {
                cmdResults.push(`${cmdName} is a shell builtin (source not available)`);
              }
            } else {
              cmdResults.push(`${cmdName} is a shell builtin (source not available)`);
            }
          } catch (error) {
            cmdResults.push(`${cmdName} is a shell builtin (source not available)`);
          }

          if (!showAll && cmdResults.length > 0) {
            results.push(cmdResults[cmdResults.length - 1]);
            continue;
          }
        }

        // If we haven't found anything
        if (cmdResults.length === 0) {
          cmdResults.push(`type: ${cmdName}: not found`);
        }

        // Add all results for this command
        if (showAll && cmdResults.length > 1) {
          results.push(...cmdResults);
        } else {
          results.push(cmdResults[0]);
        }
      }

      return results.join('\n');
    },
    'display information about command type (-a to show all locations)',
    'System'
  );
})();
