function makeProgram(id, name, description, generator) {
  const roots = [36, 48, 60, 72, 84];
  const zones = roots.map((rootKey, index) => ({
    id: `${id}-${rootKey}`,
    name: `${name} ${rootKey}`,
    sampleFile: 'Generated locally',
    rootKey,
    keyLow: index === 0 ? 0 : Math.floor((roots[index - 1] + rootKey) / 2) + 1,
    keyHigh: index === roots.length - 1 ? 127 : Math.floor((rootKey + roots[index + 1]) / 2),
    velocityLow: 0,
    velocityHigh: 127,
    tuningCents: 0,
    loop: null,
    generator
  }));

  return {
    id,
    format: 'built-in',
    name,
    description,
    zones,
    keyLow: 0,
    keyHigh: 127,
    velocityLayers: 1
  };
}

export const EXAMPLES = [
  makeProgram('warm-pad', 'Warm Pad', 'A soft sustained tone.', 'warm-pad'),
  makeProgram('glass-bell', 'Glass Bell', 'A bright bell with a quick decay.', 'glass-bell'),
  makeProgram('pluck', 'Quick Pluck', 'A short plucked sound for quick melodies.', 'pluck')
];

export function exampleById(id) {
  return EXAMPLES.find((example) => example.id === id) || EXAMPLES[0];
}
