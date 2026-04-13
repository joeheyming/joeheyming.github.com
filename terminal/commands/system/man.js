// man - minimal manual pages for jsh (no groff / no /usr/share/man)

import { commandRegistry } from '../../commands.js';

const MAN_USAGE = `Usage: man [--help] [-h] [section] name

jsh man shows short pages for registered commands only. There is no troff,
no man-db, and no system manual tree. Built-in "help" is documented here as
man help; use help(1) from the shell for the live catalog.

Exit status: 0 success, 1 usage error, 16 no manual entry (BSD-style).
`;

function formatPage(titleLine, name, description, category, extra) {
  const ex = extra ? `\n${extra}\n` : '';
  return `${titleLine}

NAME
       ${name} - ${description}

SYNOPSIS
       ${name} [options] [operands]

DESCRIPTION
       jsh built-in command (${category}). This is not a full POSIX manual;
       run 'help ${name}' in the shell when available for registry text.${ex}`;
}

async function manHandler(terminal, args) {
  if (args[0] === '--help' || args[0] === '-h') {
    return { stdout: MAN_USAGE, stderr: '', exitCode: 0 };
  }

  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'man: what manual page do you want?',
      exitCode: 1
    };
  }

  let section = null;
  let topic = null;
  if (/^\d+$/.test(args[0])) {
    if (args.length < 2) {
      return {
        stdout: '',
        stderr: 'man: missing page argument',
        exitCode: 1
      };
    }
    if (args.length > 2) {
      return {
        stdout: '',
        stderr: 'man: too many arguments',
        exitCode: 1
      };
    }
    section = args[0];
    topic = args[1];
  } else {
    if (args.length > 1) {
      return {
        stdout: '',
        stderr: 'man: too many arguments',
        exitCode: 1
      };
    }
    topic = args[0];
  }

  const t = topic.toLowerCase();

  if (section && section !== '1') {
    return {
      stdout: '',
      stderr: `No manual entry for ${topic} in section ${section}`,
      exitCode: 16
    };
  }

  if (t === 'man') {
    return {
      stdout: formatPage(
        'MAN(1)',
        'man',
        'display short manual pages for jsh commands',
        'System',
        '\nNOTES\n       Section numbers are accepted only as "1"; other sections\n       are not implemented.'
      ),
      stderr: '',
      exitCode: 0
    };
  }

  if (t === 'help') {
    return {
      stdout: formatPage(
        'HELP(1jsh)',
        'help',
        'jsh built-in command catalog and per-topic help',
        'Shell',
        '\nNOTES\n       help is implemented inside the Terminal class, not the lazy-loaded\n       command registry; man and help both describe the same ecosystem.'
      ),
      stderr: '',
      exitCode: 0
    };
  }

  if (!commandRegistry.has(t)) {
    return {
      stdout: '',
      stderr: `No manual entry for ${topic}`,
      exitCode: 16
    };
  }

  await commandRegistry.get(t);
  const cmds = commandRegistry.getCommands();
  const info = cmds.find((c) => c.name === t);
  if (!info) {
    return {
      stdout: '',
      stderr: `No manual entry for ${topic}`,
      exitCode: 16
    };
  }

  const title = `${t.toUpperCase()}(1)`;
  const page = formatPage(title, t, info.description, info.category);
  return { stdout: page, stderr: '', exitCode: 0 };
}

export default {
  name: 'man',
  handler: manHandler,
  description: 'short manual pages for jsh commands (no real man-db)',
  category: 'System'
};
