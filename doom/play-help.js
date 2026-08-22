// Dismissible "How to play" card. Players who already know WASD should
// not have it covering the canvas every session, so the choice persists
// in localStorage; the "Controls" chip brings it back.

(function () {
  var STORAGE_KEY = 'doom:play-help-hidden';
  var card = document.getElementById('playHelp');
  var closeBtn = document.getElementById('playHelpClose');
  var openBtn = document.getElementById('playHelpOpen');
  if (!card || !closeBtn || !openBtn) return;

  function readHidden() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function writeHidden(hidden) {
    try {
      if (hidden) {
        window.localStorage.setItem(STORAGE_KEY, '1');
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      /* private mode / storage disabled — session-only is fine */
    }
  }

  function apply(hidden) {
    card.hidden = hidden;
    openBtn.hidden = !hidden;
  }

  apply(readHidden());

  closeBtn.addEventListener('click', function () {
    writeHidden(true);
    apply(true);
    openBtn.focus();
  });

  openBtn.addEventListener('click', function () {
    writeHidden(false);
    apply(false);
    closeBtn.focus();
  });
})();
