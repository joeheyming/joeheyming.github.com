// Play controls start in the header. Once a chart is on a stage with room
// beside the lanes, they move into that gutter so the header keeps the
// song, share, feedback, and difficulty controls.

export function syncStageRail() {
  const rail = document.getElementById('sm-play-rail');
  const stage = document.getElementById('sm-micro');
  const toolbar = document.querySelector('.sm-toolbar');
  if (!rail || !stage || !toolbar) return;

  const onStage =
    stage.classList.contains('sm-stage-roomy') && !stage.classList.contains('is-home');
  if (onStage) {
    if (rail.parentElement !== stage) stage.appendChild(rail);
    return;
  }

  if (rail.parentElement === toolbar) return;
  const difficulty = toolbar.querySelector('difficulty-selector');
  if (difficulty) toolbar.insertBefore(rail, difficulty);
  else toolbar.appendChild(rail);
}

if (typeof document !== 'undefined') {
  document.addEventListener('sm-stage-rail-sync', syncStageRail);
}
