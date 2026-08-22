/**
 * Shared app presentation taxonomy for the home gallery and nav drawer.
 *
 * One Module answers “which section does this registry app belong to?”
 * so home and nav stop maintaining divergent filter lists.
 *
 * First matching section wins. Leftovers go to `more` (nav) or are
 * omitted from the gallery (home only renders known sections).
 */
(function (global) {
  'use strict';

  function isPlayFamily(app) {
    return app?.id === 'play' || /^play-/.test(app?.id || '');
  }

  /**
   * Canonical section order. `id` is stable across surfaces.
   * Home uses title/icon/blurb; nav uses label (falls back to title).
   */
  const SECTIONS = [
    {
      id: 'games',
      label: 'Games',
      title: 'Games',
      icon: '🕹️',
      blurb: 'Browser games — no install, no signup, no ads.',
      filter: (app) =>
        app.category === 'game' && app.subCategory !== 'console' && app.subCategory !== 'music'
    },
    {
      id: 'consoles',
      label: 'Retro consoles',
      title: 'Retro consoles',
      icon: '🎮',
      blurb:
        'Emulate NES, Sega, SNES, Game Boy, GBA, Neo Geo, Neo Geo Pocket, N64, and more in the browser.',
      filter: (app) => app.subCategory === 'console'
    },
    {
      id: 'music',
      label: 'Make music',
      title: 'Make music',
      icon: '🎵',
      blurb: 'Pick an instrument and play it right in your browser.',
      filter: (app) => isPlayFamily(app) || app.subCategory === 'music'
    },
    {
      id: 'tools',
      label: 'Utilities',
      title: 'Tools',
      icon: '🛠️',
      blurb: 'Useful little utilities.',
      // Play family is carved into music even when category is utility.
      filter: (app) => app.category === 'utility' && !isPlayFamily(app)
    },
    {
      id: 'fun',
      label: 'Entertainment',
      title: 'Fun & experiments',
      icon: '🎉',
      blurb: 'Just-for-fun side projects.',
      filter: (app) => app.category === 'entertainment' && !isPlayFamily(app)
    }
  ];

  function sectionForApp(app) {
    for (const section of SECTIONS) {
      if (section.filter(app)) return section;
    }
    return null;
  }

  function tierFor(app) {
    return app?.appTier || 'app';
  }

  /**
   * Bucket apps into sections (first match wins). Apps that match no
   * section land in `unsectioned`.
   */
  function groupApps(apps) {
    const buckets = Object.fromEntries(SECTIONS.map((s) => [s.id, []]));
    const unsectioned = [];
    for (const app of apps || []) {
      const section = sectionForApp(app);
      if (section) buckets[section.id].push(app);
      else unsectioned.push(app);
    }
    return { buckets, unsectioned, sections: SECTIONS };
  }

  global.HeymingAppSections = {
    SECTIONS,
    isPlayFamily,
    sectionForApp,
    tierFor,
    groupApps
  };
})(typeof window !== 'undefined' ? window : globalThis);
