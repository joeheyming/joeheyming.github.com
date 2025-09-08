// cmdcount command - show count and list of all registered commands
(function () {
  'use strict';

  registerCommand('cmdcount', (terminal, args) => {
    if (!window.commandRegistry) {
      return 'Command registry not available';
    }
    
    const loadedCommands = window.commandRegistry.getCommands();
    const allCommands = window.commandRegistry.getAllCommands();
    const loadedCount = loadedCommands.length;
    const totalCount = allCommands.length;
    
    let output = `📊 Command Registry Status:\n`;
    output += `Total available commands: ${totalCount}\n`;
    output += `Currently loaded: ${loadedCount}\n`;
    output += `Dynamically loadable: ${totalCount - loadedCount}\n\n`;
    
    if (args.includes('--loaded')) {
      output += `Loaded commands: ${loadedCommands.map(c => c.name).sort().join(', ')}\n`;
    } else if (args.includes('--all')) {
      const byCategory = window.commandRegistry.getCommandsByCategory();
      Object.entries(byCategory).forEach(([category, commands]) => {
        output += `\n${category}:\n`;
        commands.forEach(cmd => {
          const status = loadedCommands.find(c => c.name === cmd.name) ? '✅' : '⏳';
          output += `  ${status} ${cmd.name} - ${cmd.description}\n`;
        });
      });
    } else {
      output += `Use --loaded to see loaded commands, --all to see all with status`;
    }
    
    return output;
  }, 'show command registry status (--loaded, --all)', 'System');
})();
