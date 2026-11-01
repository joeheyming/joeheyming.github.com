// URL-driven boot mode. Runs synchronously inside <body>, after
// flavors.js, so CSS doesn't flash the wrong layout. Sets one of:
//   body.clean         → ?flavor=NAME  (auto-prime, hero launches it)
//   body.picker-mode   → (default)     (flavor picker)
//   (no class)         → ?manual=1     (full uzdoom-loader picker UI)
// Also tags body.flavor-<id>. Accent colors for that class come from
// the style tag flavors.js installs.

(function () {
  var p = new URLSearchParams(window.location.search);
  var manualVal = p.get('manual');
  var manual = manualVal === '1' || manualVal === 'browse';
  var flavor = p.get('flavor');
  var validFlavors = {};
  var list = window.DOOM_FLAVORS || [];
  for (var i = 0; i < list.length; i++) validFlavors[list[i].id] = 1;
  if (manual) {
    // No class — leave the manual picker visible.
  } else if (flavor && validFlavors[flavor]) {
    document.body.classList.add('clean');
    document.body.classList.add('flavor-' + flavor);
  } else {
    document.body.classList.add('picker-mode');
  }
})();
