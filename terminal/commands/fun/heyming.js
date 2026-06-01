// heyming — vanity command. The shell knows whose house it's in.
//
// Reads /apps-registry.json (same one the home page uses) and prints a small
// "business card" with the ASCII banner, app counts, and a couple of
// links / next-step hints. Pure stdout; no modal.

const HEYMING_HELP = `Usage: heyming [OPTION]
The shell's "about the host" card.

  -a, --apps       list every registered app id (sorted by category)
  -j, --json       print the apps-registry.json payload to stdout
  --no-banner      skip the ASCII banner
  --help           this help
`;

// Hand-rolled 6-row block letters spelling "joe heyming".
const BANNER = `
    _              _                       _                 _              
   (_) ___   ___  | |__    ___  _   _ _ __ ___ (_)_ __   __ _ 
   | |/ _ \\ / _ \\ | '_ \\  / _ \\| | | | '_ \` _ \\| | '_ \\ / _\` |
   | | (_) |  __/ | | | ||  __/| |_| | | | | | | | | | | (_| |
  _/ |\\___/ \\___| |_| |_| \\___| \\__, |_| |_| |_|_|_| |_|\\__, |
 |__/                            |___/                  |___/ 
`;

const TAGLINE =
  "joeheyming.github.io — a personal site that's mostly side-projects, with a Unix LARP on the side.";

const FAVES = [
  ['piano-hero', 'a Synthesia-style MIDI rhythm game'],
  ['doom', "browser DOOM, but it's the original"],
  ['watch', "TV-show tracker that doesn't sell your data"],
  ['ascii', 'video → text, in real time'],
  ['terminal', 'this thing — JSH (Heyming Shell)']
];

const NEXT_HINTS = [
  '`launch <id>`       open any registered app',
  '`tree -L 2 /`       glance at the VFS',
  '`cal -3`            this month, plus neighbors',
  '`vi joe.txt`        the modal way',
  '`joe joe.txt`       the modeless way',
  '`fortune`           offer something useful'
];

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  white: '\x1b[37m'
};

/**
 * @typedef {{
 *   id: string,
 *   name?: string,
 *   shortName?: string,
 *   category?: string,
 *   appTier?: string,
 *   description?: string,
 * }} AppEntry
 */

/**
 * Fetch the live apps registry. Uses absolute path so it works from any cwd in
 * the static site. Returns null on any failure (so the command degrades to a
 * banner-only response and never crashes the shell).
 * @returns {Promise<AppEntry[] | null>}
 */
async function loadRegistry() {
  try {
    const res = await fetch('/apps-registry.json', { cache: 'default' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json)) return null;
    return /** @type {AppEntry[]} */ (json);
  } catch (_e) {
    return null;
  }
}

function summarize(apps) {
  const byCategory = new Map();
  for (const a of apps) {
    const cat = a.category || 'other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(a.id);
  }
  return byCategory;
}

function bannerBlock() {
  return `${ANSI.cyan}${BANNER}${ANSI.reset}`;
}

function summaryBlock(apps) {
  const byCategory = summarize(apps);
  const total = apps.length;
  const ids = new Set(apps.map((a) => a.id));
  const knownFaves = FAVES.filter(([id]) => ids.has(id));

  const catLine = Array.from(byCategory.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cat, list]) => `${ANSI.bright}${list.length}${ANSI.reset} ${cat}`)
    .join(`${ANSI.dim} · ${ANSI.reset}`);

  const lines = [];
  lines.push(`${ANSI.bright}${ANSI.green}${TAGLINE}${ANSI.reset}`);
  lines.push('');
  lines.push(`${ANSI.yellow}apps      ${ANSI.reset}${total} registered (${catLine})`);
  lines.push(`${ANSI.yellow}github    ${ANSI.reset}https://github.com/joeheyming`);
  lines.push(`${ANSI.yellow}live      ${ANSI.reset}https://joeheyming.github.io`);
  lines.push('');

  if (knownFaves.length > 0) {
    lines.push(`${ANSI.magenta}a few I'm proud of:${ANSI.reset}`);
    for (const [id, blurb] of knownFaves) {
      lines.push(`  ${ANSI.bright}${id.padEnd(14)}${ANSI.reset}${ANSI.dim}— ${blurb}${ANSI.reset}`);
    }
    lines.push('');
  }

  lines.push(`${ANSI.magenta}try next:${ANSI.reset}`);
  for (const hint of NEXT_HINTS) {
    lines.push(`  ${hint}`);
  }
  return lines.join('\n');
}

function offlineSummary() {
  // Network-less fallback: skip stats, keep the human bits.
  const lines = [];
  lines.push(`${ANSI.bright}${ANSI.green}${TAGLINE}${ANSI.reset}`);
  lines.push('');
  lines.push(`${ANSI.dim}(couldn't load apps-registry.json; offline summary)${ANSI.reset}`);
  lines.push(`${ANSI.yellow}github    ${ANSI.reset}https://github.com/joeheyming`);
  lines.push(`${ANSI.yellow}live      ${ANSI.reset}https://joeheyming.github.io`);
  lines.push('');
  lines.push(`${ANSI.magenta}try next:${ANSI.reset}`);
  for (const hint of NEXT_HINTS) {
    lines.push(`  ${hint}`);
  }
  return lines.join('\n');
}

function listAppsByCategory(apps) {
  const byCategory = summarize(apps);
  const cats = Array.from(byCategory.keys()).sort();
  const lines = [];
  for (const cat of cats) {
    const ids = byCategory.get(cat).slice().sort();
    lines.push(`${ANSI.bright}${cat}${ANSI.reset} (${ids.length})`);
    for (const id of ids) lines.push(`  ${id}`);
  }
  return lines.join('\n');
}

async function heymingHandler(_terminal, args) {
  let listApps = false;
  let asJson = false;
  let showBanner = true;

  for (const a of args) {
    if (a === '--help' || a === '-h') return { stdout: HEYMING_HELP, stderr: '', exitCode: 0 };
    if (a === '-a' || a === '--apps') listApps = true;
    else if (a === '-j' || a === '--json') asJson = true;
    else if (a === '--no-banner') showBanner = false;
    else
      return {
        stdout: '',
        stderr: `heyming: unrecognized option: ${a}\nTry 'heyming --help'.\n`,
        exitCode: 2
      };
  }

  const apps = await loadRegistry();

  if (asJson) {
    if (!apps) {
      return { stdout: '', stderr: 'heyming: could not load registry\n', exitCode: 1 };
    }
    return { stdout: JSON.stringify(apps, null, 2) + '\n', stderr: '', exitCode: 0 };
  }

  if (listApps) {
    if (!apps) {
      return { stdout: '', stderr: 'heyming: could not load registry\n', exitCode: 1 };
    }
    return { stdout: listAppsByCategory(apps) + '\n', stderr: '', exitCode: 0 };
  }

  const parts = [];
  if (showBanner) parts.push(bannerBlock());
  parts.push(apps ? summaryBlock(apps) : offlineSummary());
  return { stdout: parts.join('\n') + '\n', stderr: '', exitCode: 0 };
}

export default {
  name: 'heyming',
  handler: heymingHandler,
  description: 'about-the-host card (-a apps, -j json, --no-banner)',
  category: 'Fun Stuff'
};
