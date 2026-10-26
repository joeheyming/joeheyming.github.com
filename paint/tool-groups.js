// PhotoCraft's toolbox (panels.rs TOOL_SECTIONS, state.rs Tool::key): one tool-column slot per
// group, each a flyout of the tools in it. Paint's tool ids, in PhotoCraft's toolbox order.

export const TOOL_GROUPS = [
  ['select'],
  ['rectSelect', 'ellipseSelect', 'singleRowMarquee', 'singleColumnMarquee'],
  ['lasso', 'polyLasso', 'magneticLasso'],
  ['quickSelection', 'magicWand'],
  ['crop', 'perspectiveCrop'],
  ['eyedropper', 'colorSampler', 'ruler', 'note', 'count'],
  ['spotHealing', 'healingBrush', 'patch', 'redEye'],
  ['brush', 'pencil', 'mixerBrush', 'colorReplacement'],
  ['cloneStamp', 'patternStamp'],
  ['historyBrush'],
  ['eraser', 'backgroundEraser', 'magicEraser'],
  ['gradient', 'fill'],
  ['blur', 'sharpen', 'smudge'],
  ['dodge', 'burn', 'sponge'],
  ['text', 'verticalType', 'verticalTypeMask', 'horizontalTypeMask'],
  ['pen', 'freeformPen', 'curvaturePen', 'addAnchorPoint', 'deleteAnchorPoint', 'convertPoint'],
  ['pathSelection', 'directSelection'],
  ['rect', 'ellipse', 'triangle', 'polygon', 'line', 'customShape'],
  ['hand', 'rotateView'],
  ['zoom']
];

// Tool::key. The single-line marquees and Blur / Sharpen / Smudge have no key (flyout only).
export const TOOL_KEYS = {
  select: 'V',
  rectSelect: 'M',
  ellipseSelect: 'M',
  lasso: 'L',
  polyLasso: 'L',
  magneticLasso: 'L',
  quickSelection: 'W',
  magicWand: 'W',
  crop: 'C',
  perspectiveCrop: 'C',
  eyedropper: 'I',
  colorSampler: 'I',
  ruler: 'I',
  note: 'I',
  count: 'I',
  spotHealing: 'J',
  healingBrush: 'J',
  patch: 'J',
  redEye: 'J',
  brush: 'B',
  pencil: 'B',
  mixerBrush: 'B',
  colorReplacement: 'B',
  cloneStamp: 'S',
  patternStamp: 'S',
  historyBrush: 'Y',
  eraser: 'E',
  backgroundEraser: 'E',
  magicEraser: 'E',
  gradient: 'G',
  fill: 'G',
  dodge: 'O',
  burn: 'O',
  sponge: 'O',
  text: 'T',
  verticalType: 'T',
  verticalTypeMask: 'T',
  horizontalTypeMask: 'T',
  pen: 'P',
  freeformPen: 'P',
  curvaturePen: 'P',
  addAnchorPoint: 'P',
  deleteAnchorPoint: 'P',
  convertPoint: 'P',
  pathSelection: 'A',
  directSelection: 'A',
  rect: 'U',
  ellipse: 'U',
  triangle: 'U',
  polygon: 'U',
  line: 'U',
  customShape: 'U',
  hand: 'H',
  rotateView: 'R',
  zoom: 'Z'
};

/** The tool's shortcut letter, or '' when it has none. */
export function toolKey(id) {
  return TOOL_KEYS[id] ?? '';
}

/** Index of the TOOL_GROUPS slot holding `id`, or -1. */
export function toolGroupIndex(id) {
  return TOOL_GROUPS.findIndex((g) => g.includes(id));
}

/**
 * The tool a key press picks (shortcuts.rs, Use Shift Key for Tool Switch): `letter` names the
 * key group (every tool with that key, toolbox order). Shift cycles to the next tool in it when
 * the current tool is in it; a plain letter keeps the current tool. From another group the key
 * picks the slot's current tool, `slotTool(groupIndex)`, when it shares the key, else the first.
 * Returns null for a letter no tool uses.
 */
export function toolForKey(letter, shift, current, slotTool = (g) => TOOL_GROUPS[g][0]) {
  const k = letter.toUpperCase();
  const group = TOOL_GROUPS.flat().filter((id) => TOOL_KEYS[id] === k);
  if (!group.length) return null;
  const i = group.indexOf(current);
  if (i >= 0) return shift ? group[(i + 1) % group.length] : current;
  const remembered = slotTool(toolGroupIndex(group[0]));
  return group.includes(remembered) ? remembered : group[0];
}
