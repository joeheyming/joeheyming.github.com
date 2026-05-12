import { commandRegistry } from './commands.js';
import { ShellCore } from './lib/shell-core.js';
import { VfsUtils } from './lib/vfs-utils.js';
import { _defaultHome } from './terminal-defaults.js';
export class TerminalCompletionMixin {
async handleTabCompletion(input) {
  const value = input.value;
  const parts = value.split(' ');
  const lastPart = parts[parts.length - 1];

  // Check for environment variable completion
  if (lastPart.startsWith('$')) {
    await this.handleEnvVarCompletion(input, parts, lastPart);
    return;
  }

  // Command completion (first word)
  if (parts.length === 1) {
    let matches = [];

    // If the input starts with a path, handle path-based completion
    if (lastPart.includes('/')) {
      await this.handlePathCompletion(input, parts, lastPart);
      return;
    }

    // Get regular command names
    const commands = commandRegistry.getCommandNames();
    matches = commands.filter((cmd) => cmd.startsWith(lastPart));

    // Also add /bin/ versions of commands if user is typing /bin/
    if (lastPart.startsWith('/bin/')) {
      const binPrefix = lastPart.substring(5); // Remove '/bin/'
      const binMatches = commands
        .filter((cmd) => cmd.startsWith(binPrefix))
        .map((cmd) => `/bin/${cmd}`);
      matches = matches.concat(binMatches);
    } else if (lastPart === '/bin' || lastPart === '/bin/') {
      // Show all /bin/ commands
      const binCommands = commands.map((cmd) => `/bin/${cmd}`);
      matches = matches.concat(binCommands);
    }

    if (matches.length === 1) {
      input.value = matches[0] + ' ';
    } else if (matches.length > 1) {
      // Show multiple matches
      const commonPrefix = this.findCommonPrefix(matches);
      if (commonPrefix.length > lastPart.length) {
        input.value = commonPrefix;
      } else {
        // Show all matches
        this.addOutput(`\nAvailable commands: ${matches.join('  ')}`);
        this.addCommandToOutput(value);
      }
    }
  } else {
    // Path completion (arguments to commands)
    await this.handlePathCompletion(input, parts, lastPart);
  }
}

async handleEnvVarCompletion(input, parts, lastPart) {
  const varPrefix = lastPart.substring(1); // Remove the $
  const envVars = Object.keys(this.env);
  const matches = envVars.filter((varName) => varName.startsWith(varPrefix));

  if (matches.length === 1) {
    // Single match - complete it
    const beforeLastPart = parts.slice(0, -1).join(' ');
    input.value = beforeLastPart + (beforeLastPart ? ' ' : '') + '$' + matches[0] + ' ';
  } else if (matches.length > 1) {
    // Multiple matches
    const commonPrefix = this.findCommonPrefix(matches);

    if (commonPrefix.length > varPrefix.length) {
      // Complete to common prefix
      const beforeLastPart = parts.slice(0, -1).join(' ');
      input.value = beforeLastPart + (beforeLastPart ? ' ' : '') + '$' + commonPrefix;
    } else {
      // Show all matches with their values
      const matchDisplay = matches
        .map((varName) => `$${varName}="${this.env[varName]}"`)
        .join('  ');
      this.addOutput(`\nEnvironment variables: ${matchDisplay}`);
      this.addCommandToOutput(input.value);
    }
  }
}

async handlePathCompletion(input, parts, lastPart) {
  const home = ShellCore.resolveVirtualPath(
    String(this.env.HOME || _defaultHome()).replace(/\/+$/, '') || '/',
    '/'
  );
  const usesTilde = lastPart === '~' || lastPart.startsWith('~/');
  let work;
  if (lastPart === '~') {
    work = home;
  } else if (lastPart.startsWith('~/')) {
    work = ShellCore.resolveVirtualPath(`${home}/${lastPart.slice(2)}`, '/');
  } else {
    work = lastPart;
  }

  let searchDir = this.currentDirectory;
  let searchPattern = work;

  if (work.startsWith('/')) {
    if (work === home || work === `${home}/`) {
      searchDir = home;
      searchPattern = '';
    } else {
      const lastSlash = work.lastIndexOf('/');
      if (lastSlash === 0) {
        searchDir = '/';
        searchPattern = work.substring(1);
      } else if (lastSlash > 0) {
        searchDir = work.substring(0, lastSlash);
        searchPattern = work.substring(lastSlash + 1);
      }
    }
  } else if (work.includes('/')) {
    const lastSlash = work.lastIndexOf('/');
    const relativePath = work.substring(0, lastSlash);
    searchDir = this.resolvePath(relativePath);
    searchPattern = work.substring(lastSlash + 1);
  }

  searchDir = ShellCore.resolveVirtualPath(searchDir, '/');

  let displayBase = '';
  if (usesTilde) {
    if (searchDir === home) {
      displayBase = '~/';
    } else if (searchDir.startsWith(`${home}/`)) {
      displayBase = `~/${searchDir.slice(home.length + 1)}/`;
    } else {
      const idx = work.lastIndexOf('/');
      displayBase = idx >= 0 ? work.substring(0, idx + 1) : '';
    }
  } else {
    const idx = lastPart.lastIndexOf('/');
    displayBase = idx >= 0 ? lastPart.substring(0, idx + 1) : '';
  }

  // Get directory contents
  try {
    const entries = await this.listDirectoryContents(searchDir);
    const matches = VfsUtils.filterDirectoryEntriesForTabCompletion(entries, searchPattern).map(
      (entry) => {
        const isDir = entry.type === 'directory';
        return {
          name: entry.name,
          fullPath: displayBase + entry.name + (isDir ? '/' : ''),
          isDirectory: isDir
        };
      }
    );

    if (matches.length === 1) {
      // Single match - complete it
      const beforeLastPart = parts.slice(0, -1).join(' ');
      input.value = beforeLastPart + (beforeLastPart ? ' ' : '') + matches[0].fullPath;

      // If it's a directory, don't add a space (user might want to continue the path)
      if (!matches[0].isDirectory) {
        input.value += ' ';
      }
    } else if (matches.length > 1) {
      // Multiple matches
      const matchNames = matches.map((m) => m.name);
      const commonPrefix = this.findCommonPrefix(matchNames);

      if (commonPrefix.length > searchPattern.length) {
        // Complete to common prefix
        const beforeLastPart = parts.slice(0, -1).join(' ');
        input.value = beforeLastPart + (beforeLastPart ? ' ' : '') + displayBase + commonPrefix;
      } else {
        // Show all matches
        const matchDisplay = matches
          .map((m) => (m.isDirectory ? `📁 ${m.name}` : `📄 ${m.name}`))
          .join('  ');
        this.addOutput(`\n${matchDisplay}`);
        this.addCommandToOutput(input.value);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read - no completion
    console.log('Tab completion error:', error);
  }
}

findCommonPrefix(strings) {
  if (strings.length === 0) return '';
  if (strings.length === 1) return strings[0];

  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (prefix.length > 0 && !strings[i].startsWith(prefix)) {
      prefix = prefix.substring(0, prefix.length - 1);
    }
    if (prefix.length === 0) break;
  }
  return prefix;
}
}
