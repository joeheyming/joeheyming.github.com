/**
 * LoopTrackController — headless DOM glue for a LoopTrack.
 *
 * Pure DOM operations, no styles. The consumer's stylesheet owns the look
 * (drums brings drums-themed CSS; a future Step Sequencer brings its own).
 *
 * Required DOM (passed as { recBtn, playBtn, clearBtn, statusEl, barEl,
 * barFillEl, playLabelEl?, playIconEl? }):
 *
 *   - recBtn / playBtn / clearBtn: <button> elements
 *   - statusEl: <span>/<div> for the human-readable status line
 *   - barEl: <div> wrapper for the loop position bar
 *   - barFillEl: <div> inside barEl whose width is animated 0..100%
 *   - playLabelEl / playIconEl: optional spans inside playBtn for label/icon swap
 *
 * State CSS classes added to the matching elements (consumer styles them):
 *   - recBtn: 'armed' | 'recording' | 'overdubbing'
 *   - playBtn: 'playing'
 *   - barEl: 'recording' | 'overdubbing' | 'visible'
 *   - statusEl: 'has-loop' | 'armed' | 'recording' | 'playing' | 'overdubbing'
 *
 * Returns { destroy } to remove all listeners + the rAF loop.
 */

const STATE_CLASSES = ['armed', 'recording', 'playing', 'overdubbing', 'has-loop'];

const formatSeconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

export function createLoopTrackController(loopTrack, dom) {
  const {
    recBtn,
    playBtn,
    clearBtn,
    statusEl,
    barEl,
    barFillEl,
    playLabelEl = null,
    playIconEl = null,
    onUserAction = null,
  } = dom;

  if (!recBtn || !playBtn || !clearBtn || !statusEl || !barEl || !barFillEl) {
    throw new Error('createLoopTrackController requires recBtn, playBtn, clearBtn, statusEl, barEl, barFillEl');
  }

  let rafHandle = null;

  const render = () => {
    const { state } = loopTrack;
    const hasLoop = loopTrack.hasLoop();

    for (const el of [recBtn, playBtn, statusEl, barEl]) {
      el.classList.remove(...STATE_CLASSES);
    }
    if (state === 'armed' || state === 'recording' || state === 'overdubbing') {
      recBtn.classList.add(state);
    }
    if (state === 'playing' || state === 'overdubbing') playBtn.classList.add('playing');
    if (state === 'overdubbing') barEl.classList.add('overdubbing');
    if (state === 'recording') barEl.classList.add('recording');
    if (hasLoop) statusEl.classList.add('has-loop');
    if (state !== 'idle') statusEl.classList.add(state);

    recBtn.setAttribute(
      'aria-pressed',
      state === 'recording' || state === 'overdubbing' || state === 'armed' ? 'true' : 'false',
    );
    playBtn.setAttribute(
      'aria-pressed',
      state === 'playing' || state === 'overdubbing' ? 'true' : 'false',
    );

    playBtn.disabled = !hasLoop && state !== 'recording' && state !== 'armed';
    clearBtn.disabled = !hasLoop && state === 'idle';

    if (playLabelEl && playIconEl) {
      if (state === 'playing' || state === 'overdubbing') {
        playLabelEl.textContent = 'Stop';
        playIconEl.textContent = '■';
      } else {
        playLabelEl.textContent = 'Play';
        playIconEl.textContent = '▶';
      }
    }

    switch (state) {
      case 'armed':
        statusEl.textContent = 'Hit a pad to start';
        break;
      case 'recording':
        statusEl.textContent = `Rec ${formatSeconds(loopTrack.recordingElapsed())}`;
        break;
      case 'playing':
        statusEl.textContent = `Loop ${formatSeconds(loopTrack.loopLength)}`;
        break;
      case 'overdubbing':
        statusEl.textContent = `Overdub · ${formatSeconds(loopTrack.loopLength)}`;
        break;
      default:
        statusEl.textContent = hasLoop ? `Loop ${formatSeconds(loopTrack.loopLength)}` : '';
    }

    barEl.classList.toggle('visible', state !== 'idle' || hasLoop);
  };

  const tick = () => {
    rafHandle = null;
    if (!loopTrack.isActive() && !loopTrack.hasLoop()) return;
    const p = loopTrack.progress();
    barFillEl.style.width = p != null ? `${(p * 100).toFixed(2)}%` : '0%';
    if (loopTrack.state === 'recording') {
      statusEl.textContent = `Rec ${formatSeconds(loopTrack.recordingElapsed())}`;
    }
    if (loopTrack.isActive()) {
      rafHandle = requestAnimationFrame(tick);
    }
  };

  const ensureTicking = () => {
    if (rafHandle == null && loopTrack.isActive()) {
      rafHandle = requestAnimationFrame(tick);
    }
  };

  const onRec = () => {
    onUserAction?.();
    loopTrack.toggleRecord();
  };
  const onPlay = () => {
    onUserAction?.();
    loopTrack.togglePlay();
  };
  const onClear = () => {
    loopTrack.clear();
  };

  recBtn.addEventListener('click', onRec);
  playBtn.addEventListener('click', onPlay);
  clearBtn.addEventListener('click', onClear);

  const unsubscribeRender = loopTrack.on(render);
  const unsubscribeTick = loopTrack.on(ensureTicking);
  render();

  return {
    render,
    destroy() {
      recBtn.removeEventListener('click', onRec);
      playBtn.removeEventListener('click', onPlay);
      clearBtn.removeEventListener('click', onClear);
      unsubscribeRender();
      unsubscribeTick();
      if (rafHandle != null) cancelAnimationFrame(rafHandle);
    },
  };
}
