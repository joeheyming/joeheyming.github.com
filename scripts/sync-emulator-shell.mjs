#!/usr/bin/env node
/**
 * Sync emulator hub picker tiles + missing console landers from consoles.js.
 *
 *   1. Regenerates the static picker-grid inside emulator/index.html
 *      (between <!-- sync:emulator-picker:start/end --> markers).
 *   2. Creates emulator/<id>/index.html for any console missing a lander
 *      (never overwrites existing hand-tuned SEO).
 *
 * Run: npm run sync:emulator
 *
 * After this: add/update apps-registry.json, then npm run sync:catalog.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const consolesPath = join(root, 'emulator/consoles.js');
const hubPath = join(root, 'emulator/index.html');

const PICKER_START = '<!-- sync:emulator-picker:start -->';
const PICKER_END = '<!-- sync:emulator-picker:end -->';

function loadConsoles() {
  const code = readFileSync(consolesPath, 'utf8');
  const stubWindow = { location: { pathname: '/emulator/', search: '', hash: '' } };
  new Function('window', code)(stubWindow);
  const consoles = stubWindow.EMULATOR_CONSOLES;
  if (!consoles || typeof consoles !== 'object') {
    throw new Error('EMULATOR_CONSOLES missing after loading emulator/consoles.js');
  }
  return consoles;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, '&#96;');
}

function pickerTilesHtml(consoles) {
  return Object.values(consoles)
    .map((cfg) => {
      const href = `/emulator/${cfg.id}/`;
      return [
        `          <a class="picker-tile" href="${href}">`,
        `            <span class="picker-emoji">${cfg.emoji}</span>`,
        `            <span class="picker-title">${escapeHtml(cfg.title)}</span>`,
        `            <span class="picker-sub">${escapeHtml(cfg.subtitle)}</span>`,
        `          </a>`
      ].join('\n');
    })
    .join('\n');
}

function syncPickerGrid(consoles) {
  const html = readFileSync(hubPath, 'utf8');
  if (!html.includes(PICKER_START) || !html.includes(PICKER_END)) {
    throw new Error(`emulator/index.html missing ${PICKER_START} / ${PICKER_END} markers`);
  }
  const tiles = pickerTilesHtml(consoles);
  const replacement = `${PICKER_START}\n${tiles}\n          ${PICKER_END}`;
  const next = html.replace(
    new RegExp(
      `${PICKER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${PICKER_END.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      )}`
    ),
    replacement
  );
  if (next === html) {
    return { changed: false, count: Object.keys(consoles).length };
  }
  writeFileSync(hubPath, next);
  return { changed: true, count: Object.keys(consoles).length };
}

function defaultSeoDescription(cfg) {
  const exts = cfg.fileExtsLabel || cfg.fileAccept || 'ROM';
  return `Browser ${cfg.title} emulator (${cfg.subtitle}). Load your own ${exts} dump; save states and gamepads stay on this device. Powered by EmulatorJS.`;
}

function landerHtml(cfg) {
  const id = cfg.id;
  const title = cfg.title;
  const subtitle = cfg.subtitle;
  const emoji = cfg.emoji;
  const desc = cfg.seoDescription || defaultSeoDescription(cfg);
  const pageTitle = `${title} Emulator — ${subtitle} ${emoji}`;
  const socialTitle = `${title} Emulator — ${subtitle} ${emoji}`;
  const canonical = `https://joeheyming.github.io/emulator/${id}/`;
  const preview = `https://joeheyming.github.io/emulator/${id}/${id}-preview.png`;
  const fileAccept = cfg.fileAccept || '.zip,.7z';
  const extsLabel = cfg.fileExtsLabel || fileAccept;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: `${title} Emulator`,
        applicationCategory: 'WebApplication',
        operatingSystem: 'Web Browser',
        description: desc,
        url: canonical,
        author: {
          '@type': 'Person',
          name: 'Joe Heyming',
          url: 'https://joeheyming.github.io/about/'
        },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        inLanguage: 'en'
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Joe Heyming',
            item: 'https://joeheyming.github.io/'
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Retro Game Emulator',
            item: 'https://joeheyming.github.io/emulator/'
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: `${title} Emulator`
          }
        ]
      }
    ]
  };

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta
      name="viewport"
      content="width=device-width,initial-scale=1,user-scalable=no,viewport-fit=cover"
    />

    <title>${escapeHtml(pageTitle)}</title>
    <meta name="theme-color" content="#FAFAFA" />
    <meta name="author" content="Joe Heyming" />
    <meta name="robots" content="index, follow" />
    <meta name="language" content="English" />
    <meta name="description" content="${escapeAttr(desc)}" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Joe Heyming - Retro Emulator" />
    <meta property="og:title" content="${escapeAttr(socialTitle)}" />
    <meta property="og:description" content="${escapeAttr(desc)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${preview}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta
      property="og:image:alt"
      content="${escapeAttr(`${title} emulator running in a web browser`)}"
    />
    <meta property="og:locale" content="en_US" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@joeheyming" />
    <meta name="twitter:creator" content="@joeheyming" />
    <meta name="twitter:title" content="${escapeAttr(socialTitle)}" />
    <meta name="twitter:description" content="${escapeAttr(desc)}" />
    <meta name="twitter:image" content="${preview}" />

    <link rel="canonical" href="${canonical}" />

    <link
      rel="icon"
      href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${emoji}</text></svg>"
    />

    <script type="application/ld+json">
      ${JSON.stringify(jsonLd, null, 2).replace(/\n/g, '\n      ')}
    </script>

    <script src="/coi-serviceworker.js"></script>

    <script async src="https://www.googletagmanager.com/gtag/js?id=G-Q62Q3E20Y0"></script>
    <script src="/analytics.js"></script>
    <script src="/achievements.js"></script>
    <script src="/nav.js" data-nav-size="compact"></script>
    <script src="/feedback.js"></script>
    <script src="/share.js" data-share-fab="off"></script>
    <script src="/proxy.js"></script>

    <script src="/emulator/leanback.js"></script>
    <script src="/emulator/consoles.js"></script>
    <script src="/emulator/internet-archive.js"></script>
    <script src="/emulator/rom-acquire.js"></script>
    <script src="/emulator/rom-browser.js"></script>
    <script src="/shared/breadcrumbs.js"></script>
    <script src="/emulator/socd.js"></script>
    <script src="/emulator/bios.js"></script>
    <script src="/emulator/ejs-mount.js"></script>
    <script src="/emulator/launch.js"></script>

    <link rel="stylesheet" href="/emulator/emulator.css" />

    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700&family=JetBrains+Mono:wght@400;500;600&display=optional"
    />
    <link rel="stylesheet" href="/brand.css" />
    <link rel="stylesheet" href="/shared/breadcrumbs.css" />
  </head>

  <body>
    <header class="app-header" id="emu-header">
      <nav id="emu-breadcrumbs" class="app-breadcrumbs" aria-label="Breadcrumb"></nav>
    </header>

    <input
      type="file"
      id="romFileInput"
      class="hidden-input"
      accept="${escapeAttr(fileAccept)}"
    />
    <input type="file" id="biosFileInput" class="hidden-input" accept=".zip,.7z,.bin" />

    <!-- Static fallback for crawlers / no-JS; launch.js replaces #brand / #boot-card. -->
    <div id="boot">
      <div class="brand" id="brand">
        <span class="brand-logo">${emoji}</span>
        <h1>
          ${escapeHtml(title)}
          <span class="sub">${escapeHtml(subtitle)}</span>
        </h1>
      </div>

      <div class="boot-card" id="boot-card">
        <h2>${emoji} ${escapeHtml(title)} Emulator</h2>
        <p class="picker-help">
          Load your own
          <code>${escapeHtml(extsLabel)}</code>
          dump. Search results open on Internet Archive so you can download
          there, then choose the saved file here. Powered by EmulatorJS.
        </p>
        <p class="picker-help">
          <a href="/emulator/">All consoles</a>
          &middot;
          <a href="/doom/">DOOM</a>
          &middot;
          <a href="/pacman/">Pac-Man</a>
          &middot;
          <a href="/about/">About</a>
        </p>
      </div>
    </div>

    <div id="game-container">
      <div id="game"></div>
    </div>

    <div class="share-overlay">
      <share-button label="📤 Share" theme="retro"></share-button>
    </div>
  </body>
</html>
`;
}

function ensureLanders(consoles) {
  const created = [];
  const skipped = [];
  for (const cfg of Object.values(consoles)) {
    const dir = join(root, 'emulator', cfg.id);
    const lander = join(dir, 'index.html');
    if (existsSync(lander)) {
      skipped.push(cfg.id);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(lander, landerHtml(cfg));
    created.push(cfg.id);
  }
  return { created, skipped };
}

const consoles = loadConsoles();
const ids = Object.keys(consoles);
const picker = syncPickerGrid(consoles);
const landers = ensureLanders(consoles);

console.log('sync-emulator-shell');
console.log(`  consoles: ${ids.length} (${ids.join(', ')})`);
console.log(
  `  picker:   ${
    picker.changed ? `updated ${picker.count} tiles in emulator/index.html` : 'unchanged'
  }`
);
if (landers.created.length) {
  console.log(`  landers:  created ${landers.created.join(', ')}`);
} else {
  console.log('  landers:  all present (none created)');
}
console.log(`  skipped:  ${landers.skipped.length} existing lander(s) preserved`);
