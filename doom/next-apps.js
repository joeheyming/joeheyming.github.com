// Next games offered when Doom quits or a flavor fails to load.
// The three targets are the other quality-minute engines (emulator hub,
// Stepmania, Pac-Man). Clicks are counted by analytics.js via
// [data-next-app] / [data-next-surface].

(function () {
  var APPS = [
    {
      id: 'emulator',
      href: '/emulator/',
      name: '🎮 Emulator',
      blurb: 'NES, SNES, Genesis, and more'
    },
    {
      id: 'stepmania',
      href: '/stepmania/',
      name: '💃 Stepmania',
      blurb: 'Play a chart'
    },
    {
      id: 'pacman',
      href: '/pacman/',
      name: '👻 Pac-Man',
      blurb: 'A 3D maze'
    }
  ];

  function mount(container, surface) {
    if (!container || container.querySelector('[data-next-app]')) return;
    container.classList.add('doom-next-apps');
    if (!container.getAttribute('aria-label')) {
      container.setAttribute('aria-label', 'Play something else');
    }
    APPS.forEach(function (app) {
      var link = document.createElement('a');
      link.href = app.href;
      link.dataset.nextApp = app.id;
      link.dataset.nextSurface = surface;
      var name = document.createElement('span');
      name.className = 'doom-next-name';
      name.textContent = app.name;
      var blurb = document.createElement('span');
      blurb.className = 'doom-next-blurb';
      blurb.textContent = app.blurb;
      link.appendChild(name);
      link.appendChild(blurb);
      container.appendChild(link);
    });
  }

  window.DoomNextApps = { mount: mount, apps: APPS };

  var exitSlot = document.getElementById('doomExitNext');
  if (exitSlot) mount(exitSlot, 'doom_exit');
})();
