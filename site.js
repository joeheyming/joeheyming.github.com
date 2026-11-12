// Shared page chrome: the nav drawer, feedback button, related-projects
// share panel, and achievements. Every page loads this one tag, placed after
// /analytics.js; `npm run sync:site-boot` writes it.
//
//   <script src="/site.js" data-nav-size="compact" data-share-fab="off"
//           data-skip="achievements"></script>
//
// data-nav-size and data-share-fab are passed through to nav.js and share.js,
// which read them from their own tag. data-skip names scripts this page does
// without. The scripts are inserted with async=false: they download at once
// without blocking the parser and run in the order below.
(function () {
  'use strict';

  var self = document.currentScript;
  if (!self) return;

  var SCRIPTS = [
    { name: 'nav', src: '/nav.js', pass: ['data-nav-size'] },
    { name: 'feedback', src: '/feedback.js', pass: [] },
    { name: 'share', src: '/share.js', pass: ['data-share-fab'] },
    { name: 'achievements', src: '/achievements.js', pass: [] }
  ];

  var skip = (self.getAttribute('data-skip') || '').split(/\s+/);
  var anchor = self;
  SCRIPTS.forEach(function (entry) {
    if (skip.indexOf(entry.name) !== -1) return;
    var s = document.createElement('script');
    s.src = entry.src;
    s.async = false;
    entry.pass.forEach(function (attr) {
      var value = self.getAttribute(attr);
      if (value !== null) s.setAttribute(attr, value);
    });
    anchor.after(s);
    anchor = s;
  });
})();
