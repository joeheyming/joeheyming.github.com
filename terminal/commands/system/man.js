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

  if (t === 'jsh') {
    const page = await renderJshOverviewPage();
    return { stdout: page, stderr: '', exitCode: 0 };
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

/**
 * Render the `man jsh` overview page. Prefers the live JSH-SPEC.md when we
 * can fetch it (browser environment with the static file served alongside);
 * otherwise falls back to a compact inline summary.
 *
 * @returns {Promise<string>}
 */
async function renderJshOverviewPage() {
  const fallback = buildJshFallbackPage();
  if (typeof fetch !== 'function') return fallback;
  try {
    const candidates = ['JSH-SPEC.md', '/terminal/JSH-SPEC.md'];
    for (const url of candidates) {
      try {
        const resp = await fetch(url, { cache: 'no-cache' });
        if (resp.ok) {
          const text = await resp.text();
          if (text && text.length > 100) {
            return `JSH(1)\n\n${text.trim()}\n`;
          }
        }
      } catch (_) {
        // Try next candidate URL.
      }
    }
  } catch (_) {
    // Fall through to the inline summary.
  }
  return fallback;
}

function buildJshFallbackPage() {
  return `JSH(1)

NAME
       jsh - HeymingOS shell (browser-resident, not bash)

SYNOPSIS
       jsh [SHELL-OPTIONS] [SCRIPT|COMMAND]

DESCRIPTION
       jsh is a JS-hosted shell built into HeymingOS. It runs entirely in
       a single browser tab and operates against the shared FileSystemDB
       VFS. It is not bash, dash, or BusyBox.

CAPABILITIES (HIGHLIGHTS)
       Lists      &&, ||, ; with short-circuit
       Pipes      | between stages
       Redirects  >, >>, <, 2>, 2>&1 (stream merge)
       Expansion  $VAR, $?, $(...), \`...\`, brace, glob, parameter
                  expansion ($\{VAR:-d\}, $\{VAR%pat\}, $\{#VAR\})
       Jobs       trailing &, jobs, fg, bg, %n
       Options    set -e, set -u, set -o pipefail, set -x
       Functions  name() { ... } with $1..$@..$#

COMMANDS
       Run 'help' for the live, category-grouped catalog of builtins.

LIMITATIONS
       jsh cannot offer real processes, signals, raw TCP/UDP, a TTY, or
       a privilege boundary. See the JSH-SPEC.md file shipped with the
       terminal for the full capability / promise / impossible matrix.

SEE ALSO
       help(1jsh), man(1), JSH-SPEC.md
`;
}

export default {
  name: 'man',
  handler: manHandler,
  description: 'short manual pages for jsh commands (no real man-db)',
  category: 'System'
};

export { renderJshOverviewPage, buildJshFallbackPage };
