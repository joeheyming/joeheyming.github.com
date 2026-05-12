// [SITE] Post-callMain melt reveal sequence (UZDoomMelt integration).

export async function runMeltRevealAfterMain({
  wantMelt,
  snapshotPromise,
  revealCut,
  announceReveal,
  $
}) {
  if (!wantMelt) {
    revealCut();
    return;
  }
  const snap = await snapshotPromise;
  if (!snap) {
    revealCut();
    return;
  }
  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
  window.UZDoomMelt.runOn(snap, announceReveal);
  $('boot').classList.add('hidden');
  $('fsBtn').classList.remove('hidden');
}
