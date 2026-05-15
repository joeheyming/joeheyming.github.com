// Strings page — tone dropdown + status line.
// Wraps the engine's setTone() so the orchestrator just calls switchTone(name)
// and lets this module handle the "loading…" text and the multi-sampler /
// soundfont fallback messaging.

/**
 * @param {{
 *   engine: any,
 *   toneEl: HTMLSelectElement,
 *   toneStatus: HTMLElement | null,
 *   getActiveInstrument: () => any,
 *   tonesPerInstrument: Record<string, string>,
 * }} ctx
 */
export function createToneControls(ctx) {
  const { engine, toneEl, toneStatus, getActiveInstrument, tonesPerInstrument } = ctx;

  const updateToneStatus = () => {
    if (!toneStatus) return;
    if (engine.isMultiSampleTone(engine.toneName) && engine.multiSamplerStatus === 'error') {
      toneStatus.textContent = 'offline · pick a soundfont tone';
      return;
    }
    toneStatus.textContent = engine.isReady() ? '' : 'loading…';
  };

  const switchTone = (name) => {
    if (toneStatus) toneStatus.textContent = 'loading…';
    engine.setTone(name).then(updateToneStatus).catch(updateToneStatus);
  };

  const populateToneOptions = () => {
    const activeInstrument = getActiveInstrument();
    toneEl.innerHTML = '';
    for (const tone of activeInstrument.tones) {
      const opt = document.createElement('option');
      opt.value = tone.value;
      opt.textContent = tone.label;
      toneEl.appendChild(opt);
    }
    const remembered = tonesPerInstrument[activeInstrument.id];
    const initial =
      remembered && activeInstrument.tones.some((t) => t.value === remembered)
        ? remembered
        : activeInstrument.defaultTone;
    toneEl.value = initial;
  };

  return { updateToneStatus, switchTone, populateToneOptions };
}
