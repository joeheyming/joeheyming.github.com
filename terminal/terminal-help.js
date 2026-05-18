/**
 * Terminal `help` builtin mixin.
 *
 * Owns the bare `help`, `help TOPIC`, and `help --help` dispatch plus the
 * category-grouped catalog renderer with the pro-tips footer. Mixed into
 * `TerminalPipelineMixin.prototype`.
 */

import { commandRegistry } from './commands.js';
import { ShellCore } from './lib/shell-core.js';

export const helpMethods = {
  helpCommand(args = []) {
    const parsed = ShellCore.parseHelpArgs(args);
    if (parsed.ok === false) {
      return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
    }
    if (parsed.sawHelpFlag) {
      return { stdout: ShellCore.HELP_USAGE.trim() + '\n', stderr: '', exitCode: 0 };
    }
    const rest = parsed.rest;
    if (rest.length === 1) {
      const topic = rest[0];
      const line = this.lookupHelpTopicLine(topic);
      if (!line) {
        return {
          stdout: '',
          stderr: `help: no help topics match '${topic}'\n`,
          exitCode: 1
        };
      }
      return { stdout: line.endsWith('\n') ? line : line + '\n', stderr: '', exitCode: 0 };
    }
    return { stdout: this.buildFullHelpCatalog(), stderr: '', exitCode: 0 };
  },

  /**
   * One-line or short description for `help TOPIC` (includes built-in `help` itself).
   * @param {string} topic - Operand as typed (preserved for display)
   * @returns {string|null}
   */
  lookupHelpTopicLine(topic) {
    const key = topic.toLowerCase();
    if (key === 'help') {
      return `${ShellCore.HELP_USAGE.trim()}\n\n  (builtin) List all commands or describe one command by name.`;
    }
    const all = commandRegistry.getAllCommands();
    const found = all.find((c) => c.name.toLowerCase() === key);
    if (!found) {
      return null;
    }
    return `${found.name}: ${found.description}`;
  },

  buildFullHelpCatalog() {
    const commandsByCategory = commandRegistry.getCommandsByCategory();

    const categoryEmojis = {
      'File System': '📁',
      System: '📊',
      Apps: '🚀',
      'Fun Stuff': '🎪',
      'Speech & Media': '🔊',
      Other: '🔧'
    };

    const categoryOrder = ['File System', 'System', 'Apps', 'Fun Stuff', 'Speech & Media', 'Other'];

    let helpText = 'Available commands:\n\n';
    helpText += `🧭 Shell:\n  ${'help'.padEnd(
      12
    )} - List commands or describe one topic (try "help help")\n\n`;

    const sortedCategories = Object.keys(commandsByCategory).sort((a, b) => {
      const aIndex = categoryOrder.indexOf(a);
      const bIndex = categoryOrder.indexOf(b);

      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      } else if (aIndex !== -1) {
        return -1;
      } else if (bIndex !== -1) {
        return 1;
      } else {
        return a.localeCompare(b);
      }
    });

    sortedCategories.forEach((category) => {
      const commands = commandsByCategory[category];
      const emoji = categoryEmojis[category] || '🔧';

      helpText += `${emoji} ${category}:\n`;

      commands.forEach((cmd) => {
        helpText += `  ${cmd.name.padEnd(12)} - ${cmd.description}\n`;
      });
      helpText += '\n';
    });

    helpText += `💡 Pro Tips:
- Use arrow keys to navigate command history
- Tab completion works for commands
- clear/Ctrl+L to clear screen
- Ctrl+W to delete word backwards
- Ctrl+U to delete line backwards
- Ctrl+K to delete line forwards
- Ctrl+A/E to move to beginning/end of line
- Ctrl+R for reverse search

🔧 Pipes & Redirection:
- Use | to pipe output: ls | grep txt
- Lists: cmd1 && cmd2 (if first succeeds), cmd1 || cmd2 (if first fails), a; b (always run both)
- Redirect output: echo "hello" > file.txt
- Append to file: echo "world" >> file.txt
- Redirect stderr: command 2> error.log
- Read from file: sort < data.txt`;

    return helpText;
  }
};
