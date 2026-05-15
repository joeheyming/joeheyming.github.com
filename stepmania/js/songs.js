// Songs data — local song registry.
//
// History: this module used to also export a `proxySimfile()` URL-builder
// (hardcoded `https://api.allorigins.win/raw?url=…`) plus two debug
// helpers (`showProxiedSimfiles`, `debugSimfileContent`) that referenced
// a `song.simfile` field that no entry actually carries. None of those
// were imported anywhere. They were the last consumers of an allorigins
// URL outside of `proxy.js`'s managed chain — removing them lets
// `window.proxyService.fetchWithProxy` be the single proxy seam in the
// repo (the rest of stepmania already routes through it via
// `songProxyTransport.js` / `zeniusFetch.js`).

export const songs = {
  Lost: {
    url: '/stepmania/songs/Lost/Lost.mp3',
    background: '/stepmania/songs/Lost/background.png',
    title: 'Lost',
    artist: 'Unknown',
    bpm: 120
  }
};

export default songs;
