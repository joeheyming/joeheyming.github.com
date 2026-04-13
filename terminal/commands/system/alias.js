// alias command - create command shortcuts
import { BuiltinsLib } from './builtins-lib.js';

/**
 * @param {Record<string, string>} aliases
 * @returns {string}
 */
function formatAliasList(aliases) {
  const entries = Object.entries(aliases);
  if (entries.length === 0) {
    return '';
  }
  return entries.map(([name, command]) => `alias ${name}='${command}'`).join('\n');
}

function aliasHandler(terminal, args) {
  const parsed = BuiltinsLib.parseAliasArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: BuiltinsLib.ALIAS_HELP, stderr: '', exitCode: 0 };
  }

  const aliases = terminal.aliases || (terminal.aliases = {});
  const stdoutLines = [];
  const stderrLines = [];

  if (parsed.operands.length === 0) {
    const list = formatAliasList(aliases);
    return { stdout: list, stderr: '', exitCode: 0 };
  }

  if (parsed.printReusable) {
    const block = formatAliasList(aliases);
    if (block) {
      stdoutLines.push(block);
    }
  }

  for (const arg of parsed.operands) {
    if (arg.includes('=')) {
      const [name, ...commandParts] = arg.split('=');
      const command = commandParts.join('=');

      if (!name.match(/^[A-Za-z_][A-Za-z0-9_-]*$/)) {
        stderrLines.push(`alias: invalid alias name: '${name}'`);
        continue;
      }

      const cleanCommand = command.replace(/^["']|["']$/g, '');
      aliases[name] = cleanCommand;
    } else {
      if (aliases[arg]) {
        stdoutLines.push(`alias ${arg}='${aliases[arg]}'`);
      } else {
        stderrLines.push(`alias: ${arg}: not found`);
      }
    }
  }

  const stdout = stdoutLines.join('\n');
  const stderr = stderrLines.join('\n');
  return {
    stdout,
    stderr,
    exitCode: stderrLines.length > 0 ? 1 : 0
  };
}

export default {
  name: 'alias',
  handler: aliasHandler,
  description: 'create command shortcuts',
  category: 'System'
};
