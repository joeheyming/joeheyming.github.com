// ---------- View switching ----------
//
// One flat list of views — Stradella variants × orientation, Piano, and
// Chromatic systems × orientation. Layout-/system-specific state is part
// of the view definition so the player picks "what they want to see" in a
// single dropdown rather than three.

export const VIEWS = {
  'stradella-standard-h': {
    kind: 'stradella',
    layout: 'standard',
    orientation: 'horizontal'
  },
  'stradella-standard-v': {
    kind: 'stradella',
    layout: 'standard',
    orientation: 'vertical'
  },
  'stradella-eastern-h': {
    kind: 'stradella',
    layout: 'eastern',
    orientation: 'horizontal'
  },
  'stradella-eastern-v': {
    kind: 'stradella',
    layout: 'eastern',
    orientation: 'vertical'
  },
  'stradella-freebass-h': {
    kind: 'stradella',
    layout: 'free-bass',
    orientation: 'horizontal'
  },
  'stradella-freebass-v': {
    kind: 'stradella',
    layout: 'free-bass',
    orientation: 'vertical'
  },
  piano: { kind: 'piano' },
  'chromatic-B-h': {
    kind: 'chromatic',
    system: 'B',
    orientation: 'horizontal'
  },
  'chromatic-B-v': { kind: 'chromatic', system: 'B', orientation: 'vertical' },
  'chromatic-C-h': {
    kind: 'chromatic',
    system: 'C',
    orientation: 'horizontal'
  },
  'chromatic-C-v': { kind: 'chromatic', system: 'C', orientation: 'vertical' },
  'diatonic-h': { kind: 'diatonic', orientation: 'horizontal' },
  'diatonic-v': { kind: 'diatonic', orientation: 'vertical' }
};

/**
 * On phone-sized viewports we override the picked H/V orientation to match
 * the device's own orientation: portrait phones get vertical layouts, and
 * landscape phones get horizontal. On desktop we always honour the user's
 * dropdown choice. Returns the orientation that should actually be used,
 * or `null` for the piano view (which has no H/V variant).
 */
export const MOBILE_BREAKPOINT_PX = 720;
export const portraitMql = window.matchMedia('(orientation: portrait)');
export const isMobileViewport = () => window.innerWidth <= MOBILE_BREAKPOINT_PX;
export const effectiveOrientation = (cfg) => {
  if (cfg.orientation == null) return null;
  if (isMobileViewport()) {
    return portraitMql.matches ? 'vertical' : 'horizontal';
  }
  return cfg.orientation;
};

/* ---------- Mobile dropdown labels ----------
 *
 * On a touch device we auto-pick the orientation, so showing the user a
 * "Standard (horizontal)" / "Standard (vertical)" pair is just confusing
 * noise. On mobile we therefore (a) hide the "-v" duplicates and (b)
 * relabel the "-h" entries with their bare name. Desktop keeps the full
 * H/V picker. The original labels are preserved in `data-desktop-label`
 * so we can restore them on the way back. */
export const MOBILE_VIEW_LABELS = {
  'stradella-standard-h': 'Standard',
  'stradella-eastern-h': 'Eastern 5-row',
  'stradella-freebass-h': 'Free bass',
  piano: 'Piano keyboard',
  'chromatic-B-h': 'Chromatic B-system',
  'chromatic-C-h': 'Chromatic C-system',
  'diatonic-h': 'Diatonic melodeon'
};
