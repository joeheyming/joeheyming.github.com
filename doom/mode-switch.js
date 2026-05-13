// URL-driven boot mode. Runs synchronously inside <body> so CSS doesn't
// flash the wrong layout. Sets one of:
//   body.clean         → ?flavor=NAME  (auto-prime, hero launches it)
//   body.picker-mode   → (default)     (three-card flavor picker)
//   (no class)         → ?manual=1     (full uzdoom-loader picker UI)
// Also tags body.flavor-classic / .flavor-freedoom / .flavor-legend /
// .flavor-mario / .flavor-metroid / .flavor-castlevania for accent
// color theming when a flavor is locked in.

(function () {
  var p = new URLSearchParams(window.location.search);
  var manualVal = p.get('manual');
  var manual = manualVal === '1' || manualVal === 'browse';
  var flavor = p.get('flavor');
  var validFlavors = {
    classic: 1,
    freedoom: 1,
    legend: 1,
    mario: 1,
    metroid: 1,
    castlevania: 1
  };
  if (manual) {
    // No class — leave the manual picker visible.
  } else if (flavor && validFlavors[flavor]) {
    document.body.classList.add('clean');
    document.body.classList.add('flavor-' + flavor);
  } else {
    document.body.classList.add('picker-mode');
  }
})();
