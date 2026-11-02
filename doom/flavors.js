// One record per playable DOOM flavor. Cards, both switcher menus,
// ?flavor= allowlisting, and the light/dark ink colors are built from
// this list. Add a flavor here; do not copy it into the HTML or CSS.
//
// Fetched zips stay out of git (*.wad is ignored). Gameplay pk3 and
// ipk3 mods are fetched from MOD_BASE and ignored the same way.
// `files` is the load order inside a zip. Anything not named there
// is not passed to the engine.
//
// MOD_COMMIT is the last commit that stored those five archives.
// raw.githubusercontent.com sends CORS and CORP on that blob, so the
// loader reads it directly. Keep the SHA: a master URL 404s once the
// files leave the branch. LegendOfDoom-1.1.0.pk3 in that commit is
// the OGG repack; the upstream MP3 music will not play in this build.

(function (root) {
  var MOD_COMMIT = '73875b5e91f8780dd663c6620f5e530f110eddda';
  var MOD_BASE =
    'https://raw.githubusercontent.com/joeheyming/joeheyming.github.com/' + MOD_COMMIT + '/doom/';

  var FLAVORS = [
    {
      id: 'classic',
      title: 'Classic DOOM',
      brand: 'Classic DOOM',
      card: 'Classic DOOM',
      menu: 'Classic DOOM',
      desc: 'The 1993 original. Knee-Deep in the Dead.',
      tagline: 'The original 1993 DOOM, running in your browser.',
      launchLabel: 'Launch Classic DOOM',
      emoji: '💀',
      initialFocus: true,
      inkLight: '#9f1d1d',
      inkDark: '#f06055',
      accentDim: '#6a1f18',
      iwadUrl: 'https://console-doom.netlify.app/data/doom.wad',
      iwadName: 'doom.wad'
    },
    {
      id: 'freedoom',
      title: 'Freedoom',
      brand: 'Freedoom',
      card: 'Freedoom',
      menu: 'Freedoom',
      desc: 'The free, open-source DOOM.',
      tagline: 'Freedoom Phase 1 (open-source DOOM clone), running in your browser.',
      launchLabel: 'Launch Freedoom',
      emoji: '👹',
      inkLight: '#9a3412',
      inkDark: '#d9883a',
      accentDim: '#6e421a'
    },
    {
      id: 'legend',
      title: 'Legend of DOOM',
      brand: 'Legend of DOOM',
      card: '🗡️ Legend of DOOM',
      menu: 'Legend of DOOM',
      desc: 'A Zelda-style adventure.',
      tagline: 'The Legend of DOOM mod, running in your browser.',
      launchLabel: 'Launch Legend of DOOM',
      emoji: '🗡️',
      inkLight: '#166534',
      inkDark: '#4fa861',
      accentDim: '#2a5b37',
      modUrl: MOD_BASE + 'LegendOfDoom-1.1.0.pk3',
      modName: 'LegendOfDoom-1.1.0.pk3'
    },
    {
      id: 'mario',
      title: 'Mario DOOM',
      brand: 'Mario DOOM',
      card: '🍄 Mario DOOM',
      menu: '🍄 Mario DOOM',
      desc: 'Mario sprites, sounds, and music.',
      tagline: 'MarioDoom by Valigarmander, running in your browser.',
      launchLabel: 'Launch Mario DOOM',
      emoji: '🍄',
      inkLight: '#1d4ed8',
      inkDark: '#5b9dfb',
      accentDim: '#18467f',
      modUrl: MOD_BASE + 'mariodoom.pk3',
      modName: 'mariodoom.pk3'
    },
    {
      // MarioDoom loads first so its sounds and extra frames remain.
      // The map WADs then win on palette, maps, music, and sprites.
      // The update WAD is last: it fixes MAP25 and the barrel sprites.
      id: 'mayhem',
      title: 'Super MAYhem',
      brand: 'Super MAYhem',
      card: '⭐ Super MAYhem',
      menu: '⭐ Super MAYhem',
      desc: 'A Mario campaign of custom maps.',
      tagline: 'Super MAYhem 17, the Mario map set, running in your browser.',
      launchLabel: 'Launch Super MAYhem',
      emoji: '⭐',
      inkLight: '#be123c',
      inkDark: '#fb7185',
      accentDim: '#881337',
      bundledIwad: 'freedoom2.wad',
      modUrl: MOD_BASE + 'mariodoom.pk3',
      modName: 'mariodoom.pk3',
      zips: [
        {
          url: 'https://youfailit.net/pub/idgames/levels/doom2/Ports/megawads/mayhem17.zip',
          label: 'mayhem17.zip',
          files: ['mayhem17.wad', 'mayhem17_updatev1.wad']
        }
      ]
    },
    {
      id: 'metroid',
      title: 'Metroid DOOM',
      brand: 'Metroid DOOM',
      card: '🛸 Metroid DOOM',
      menu: '🛸 Metroid DOOM',
      desc: 'Explore Zebes as Samus.',
      tagline: "Spram's Metroid DOOM Metroidvania, running in your browser.",
      launchLabel: 'Launch Metroid DOOM',
      emoji: '🛸',
      inkLight: '#854d0e',
      inkDark: '#c39e3a',
      accentDim: '#6e571c',
      bundledIwad: 'freedoom2.wad',
      modUrl: MOD_BASE + 'met2.pk3',
      modName: 'met2.pk3'
    },
    {
      // Castlevania.ipk3 is the IWAD, not a mod on top of Freedoom.
      id: 'castlevania',
      title: 'Castlevania: Simon’s Destiny',
      brand: 'Castlevania',
      card: '🦇 Castlevania',
      menu: '🦇 Castlevania',
      desc: 'Whip combat through Castle Dracula.',
      tagline: 'Castlevania: Simon’s Destiny by Batandy, running in your browser.',
      launchLabel: 'Launch Castlevania',
      emoji: '🦇',
      inkLight: '#6b21a8',
      inkDark: '#b894e8',
      accentDim: '#3f1f5c',
      iwadUrl: MOD_BASE + 'Castlevania.ipk3',
      iwadName: 'Castlevania.ipk3'
    },
    {
      id: 'sonic',
      title: 'Sonic DOOM',
      brand: 'Sonic DOOM',
      card: '💨 Sonic DOOM',
      menu: '💨 Sonic DOOM',
      desc: 'Rings, boost, and Super Sonic.',
      tagline: 'Sonic the Hedgehog in DOOM: Legacy Edition, running in your browser.',
      launchLabel: 'Launch Sonic DOOM',
      emoji: '💨',
      inkLight: '#0c6478',
      inkDark: '#1ec8e8',
      accentDim: '#0a5a6e',
      bundledIwad: 'freedoom2.wad',
      modUrl: MOD_BASE + 'sonicdoom-legacy.pk3',
      modName: 'sonicdoom-legacy.pk3'
    },
    {
      // batman.wad, then batman.deh. The zip's DOS tools are not listed.
      id: 'batman',
      title: 'Batman DOOM',
      brand: 'Batman DOOM',
      card: '🦸 Batman DOOM',
      menu: '🦸 Batman DOOM',
      desc: "ACE Team's Batman campaign.",
      tagline: "ACE Team's Batman DOOM, running in your browser.",
      launchLabel: 'Launch Batman DOOM',
      emoji: '🦸',
      inkLight: '#92400e',
      inkDark: '#fbbf24',
      accentDim: '#713f12',
      bundledIwad: 'freedoom2.wad',
      zips: [
        {
          url: 'https://youfailit.net/pub/idgames/themes/batman/batman.zip',
          label: 'batman.zip',
          files: ['batman.wad', 'batman.deh']
        }
      ]
    },
    {
      id: 'zombies',
      title: 'Zombies',
      brand: 'Zombies',
      card: '🧟 Zombies',
      menu: '🧟 Zombies',
      desc: 'A Dawn of the Dead campaign.',
      tagline: 'Zombies, the Dawn of the Dead campaign, running in your browser.',
      launchLabel: 'Launch Zombies',
      emoji: '🧟',
      inkLight: '#3f6212',
      inkDark: '#a3e635',
      accentDim: '#365314',
      bundledIwad: 'freedoom2.wad',
      zips: [
        {
          url: 'https://youfailit.net/pub/idgames/levels/doom2/v-z/zombies.zip',
          label: 'zombies.zip',
          files: ['zombie.wad', 'zombie.deh']
        }
      ]
    },
    {
      // Free MIDI edition. The paid Buckethead soundtrack is MP3, which
      // this engine cannot play. Episode 6 is its own flavor: loading
      // both WADs at once replaces episode 5's sky and episode key.
      id: 'sigil',
      title: 'Sigil',
      brand: 'Sigil',
      card: '🔥 Sigil',
      menu: '🔥 Sigil',
      desc: "Romero's fifth episode.",
      tagline: "John Romero's Sigil, running in your browser.",
      launchLabel: 'Launch Sigil',
      emoji: '🔥',
      inkLight: '#7c2d12',
      inkDark: '#fdba74',
      accentDim: '#431407',
      zips: [
        {
          url: 'https://youfailit.net/pub/idgames/levels/doom/Ports/s-u/sigil_v1_23.zip',
          label: 'sigil_v1_23.zip',
          files: ['SIGIL_V1_23.wad']
        }
      ]
    },
    {
      id: 'sigil2',
      title: 'Sigil II',
      brand: 'Sigil II',
      card: '✴️ Sigil II',
      menu: '✴️ Sigil II',
      desc: "Romero's sixth episode.",
      tagline: "John Romero's Sigil II, running in your browser.",
      launchLabel: 'Launch Sigil II',
      emoji: '✴️',
      inkLight: '#9f1239',
      inkDark: '#fda4af',
      accentDim: '#881337',
      zips: [
        {
          url: 'https://youfailit.net/pub/idgames/levels/doom/Ports/s-u/sigil_ii_v1_0.zip',
          label: 'sigil_ii_v1_0.zip',
          files: ['SIGIL_II_V1_0.WAD']
        }
      ]
    },
    {
      // Eight maps plus a finale. The DeHackEd patch is inside the WAD.
      id: 'witching',
      title: 'Witching Hour',
      brand: 'Witching Hour',
      card: '🕯️ Witching Hour',
      menu: '🕯️ Witching Hour',
      desc: 'Eight Halloween maps.',
      tagline: 'Witching Hour, running in your browser.',
      launchLabel: 'Launch Witching Hour',
      emoji: '🕯️',
      inkLight: '#3730a3',
      inkDark: '#a5b4fc',
      accentDim: '#312e81',
      bundledIwad: 'freedoom2.wad',
      zips: [
        {
          url: 'https://youfailit.net/pub/idgames/levels/doom2/Ports/v-z/witchinghour.zip',
          label: 'witchinghour.zip',
          files: ['witchinghour.wad']
        }
      ]
    },
    {
      // Three Minecraft maps for ZDoom. Both music lumps are MP3, which
      // this engine cannot play, so those songs stay silent.
      id: 'doomcraft',
      title: 'DoomCraft',
      brand: 'DoomCraft',
      card: '⛏️ DoomCraft',
      menu: '⛏️ DoomCraft',
      desc: 'Three Minecraft maps.',
      tagline: 'DoomCraft, three Minecraft maps, running in your browser.',
      launchLabel: 'Launch DoomCraft',
      emoji: '⛏️',
      inkLight: '#14532d',
      inkDark: '#86efac',
      accentDim: '#052e16',
      bundledIwad: 'freedoom2.wad',
      zips: [
        {
          url: 'https://youfailit.net/pub/idgames/themes/terrywads/dmcraft.zip',
          label: 'dmcraft.zip',
          files: ['DMCRAFT.wad']
        }
      ]
    },
    {
      id: 'lego',
      title: 'Lego Base',
      brand: 'Lego Base',
      card: '🧱 Lego Base',
      menu: '🧱 Lego Base',
      desc: 'One Lego level.',
      tagline: 'Lego Base Enhanced, one Lego level, running in your browser.',
      launchLabel: 'Launch Lego Base',
      emoji: '🧱',
      inkLight: '#a16207',
      inkDark: '#fde047',
      accentDim: '#78350f',
      bundledIwad: 'freedoom2.wad',
      zips: [
        {
          url: 'https://youfailit.net/pub/idgames/levels/doom2/Ports/j-l/legob-sp.zip',
          label: 'legob-sp.zip',
          files: ['legob-sp.wad']
        }
      ]
    },
    {
      // MAP01 is the finished fort. MAP02 was left unfinished in the wad.
      // Music and textures are the pk3, loaded first.
      id: 'blockfort',
      title: 'Block Fort',
      brand: 'Block Fort',
      card: '🏰 Block Fort',
      menu: '🏰 Block Fort',
      desc: 'A Mario Kart fort.',
      tagline: 'Mario Kart 64 Block Fort, running in your browser.',
      launchLabel: 'Launch Block Fort',
      emoji: '🏰',
      inkLight: '#c2410c',
      inkDark: '#fdba74',
      accentDim: '#7c2d12',
      bundledIwad: 'freedoom2.wad',
      zips: [
        {
          url: 'https://youfailit.net/pub/idgames/levels/doom2/Ports/a-c/bfremade.zip',
          label: 'bfremade.zip',
          files: ['Music&Textures.pk3', 'BDremade.wad']
        }
      ]
    },
    {
      // One joke map. Its music lump is MP3 and will not play.
      id: 'roblox',
      title: 'Roblox DOOM',
      brand: 'Roblox DOOM',
      card: '🟥 Roblox DOOM',
      menu: '🟥 Roblox DOOM',
      desc: 'One Roblox joke map.',
      tagline: 'A one-map Roblox joke wad, running in your browser.',
      launchLabel: 'Launch Roblox DOOM',
      emoji: '🟥',
      inkLight: '#1e3a8a',
      inkDark: '#93c5fd',
      accentDim: '#172554',
      bundledIwad: 'freedoom2.wad',
      zips: [
        {
          url: 'https://youfailit.net/pub/idgames/levels/doom2/s-u/spykid.zip',
          label: 'spykid.zip',
          files: ['spykid.wad']
        }
      ]
    }
  ];

  function cssText() {
    var light = [];
    var dark = [];
    var rules = [];
    for (var i = 0; i < FLAVORS.length; i++) {
      var f = FLAVORS[i];
      if (!/^[a-z0-9]+$/.test(f.id)) continue;
      if (!/^#[0-9a-fA-F]{6}$/.test(f.inkLight) || !/^#[0-9a-fA-F]{6}$/.test(f.inkDark)) continue;
      if (!/^#[0-9a-fA-F]{6}$/.test(f.accentDim)) continue;
      light.push('  --doom-ink-' + f.id + ': ' + f.inkLight + ';');
      light.push('  --doom-dot-' + f.id + ': var(--doom-ink-' + f.id + ');');
      dark.push('  --doom-ink-' + f.id + ': ' + f.inkDark + ';');
      rules.push(
        'body.flavor-' +
          f.id +
          ' { --accent: var(--doom-ink-' +
          f.id +
          '); --accent-dim: ' +
          f.accentDim +
          '; }'
      );
      rules.push(
        ".flavor-card[data-flavor='" + f.id + "'] { --flavor-color: var(--doom-ink-" + f.id + '); }'
      );
      rules.push(
        ".flavor-switch-menu button[data-switch='" +
          f.id +
          "'] .dot { background: var(--doom-dot-" +
          f.id +
          '); }'
      );
    }
    return (
      ':root {\n' +
      light.join('\n') +
      '\n}\n' +
      ":root[data-theme='dark'] {\n" +
      dark.join('\n') +
      '\n}\n' +
      '@media (prefers-color-scheme: dark) {\n' +
      "  :root:not([data-theme='light']) {\n" +
      dark.join('\n') +
      '\n  }\n}\n' +
      rules.join('\n') +
      '\n'
    );
  }

  function install(doc) {
    var head = doc.head || doc.documentElement;
    if (!head || doc.getElementById('doom-flavor-inks')) return;
    var style = doc.createElement('style');
    style.id = 'doom-flavor-inks';
    style.textContent = cssText();
    head.appendChild(style);
  }

  function cardButton(doc, flavor) {
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'flavor-card';
    btn.setAttribute('data-flavor', flavor.id);
    btn.disabled = true;
    btn.setAttribute('aria-label', flavor.launchLabel);
    if (flavor.initialFocus) btn.setAttribute('data-initial-focus', '');
    var name = doc.createElement('span');
    name.className = 'name';
    name.textContent = flavor.card;
    var desc = doc.createElement('span');
    desc.className = 'desc';
    desc.textContent = flavor.desc;
    var cta = doc.createElement('span');
    cta.className = 'cta';
    cta.setAttribute('data-default-cta', 'Preparing engine');
    cta.textContent = 'Preparing engine';
    btn.appendChild(name);
    btn.appendChild(desc);
    btn.appendChild(cta);
    return btn;
  }

  function menuButton(doc, flavor) {
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('data-switch', flavor.id);
    var dot = doc.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    btn.appendChild(dot);
    btn.appendChild(doc.createTextNode(' ' + flavor.menu));
    return btn;
  }

  function mount(doc) {
    var picker = doc.getElementById('flavorPicker');
    if (picker && !picker.querySelector('.flavor-card')) {
      for (var i = 0; i < FLAVORS.length; i++) picker.appendChild(cardButton(doc, FLAVORS[i]));
    }
    var menus = doc.querySelectorAll('.flavor-switch-menu');
    for (var m = 0; m < menus.length; m++) {
      var menu = menus[m];
      if (menu.querySelector('button[data-switch]')) {
        var already = false;
        var existing = menu.querySelectorAll('button[data-switch]');
        for (var e = 0; e < existing.length; e++) {
          if (existing[e].getAttribute('data-switch') === FLAVORS[0].id) already = true;
        }
        if (already) continue;
      }
      var sep = menu.querySelector('.flavor-switch-sep');
      for (var j = 0; j < FLAVORS.length; j++) {
        var item = menuButton(doc, FLAVORS[j]);
        if (sep) menu.insertBefore(item, sep);
        else menu.appendChild(item);
      }
    }
    var lists = doc.querySelectorAll('[data-flavor-links]');
    for (var k = 0; k < lists.length; k++) fillLinks(doc, lists[k]);
  }

  function fillLinks(doc, ul) {
    if (ul.querySelector('a[href*="flavor="]')) return;
    var tail = ul.querySelector('[data-flavor-index]');
    for (var i = 0; i < FLAVORS.length; i++) {
      var flavor = FLAVORS[i];
      if (flavor.id === 'classic') continue;
      var li = doc.createElement('li');
      var link = doc.createElement('a');
      link.href = '/doom/?flavor=' + flavor.id;
      link.textContent = flavor.brand;
      li.appendChild(link);
      if (tail) ul.insertBefore(li, tail);
      else ul.appendChild(li);
    }
    if (tail) {
      var indexLink = tail.querySelector('a');
      if (indexLink) indexLink.textContent = 'All ' + FLAVORS.length + ' on one page';
    }
  }

  root.DOOM_FLAVORS = FLAVORS;
  root.DOOM_FLAVOR_CSS = cssText;
  root.DoomFlavors = { mount: mount, cssText: cssText };
  if (root.document) install(root.document);
})(typeof window !== 'undefined' ? window : globalThis);
