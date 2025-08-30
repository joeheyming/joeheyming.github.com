// assuming google analytics is already loaded
// onload
window.onload = function () {
  if (location.hostname === 'localhost') {
    window.gtag = function () {};
    return;
  }
  window.gtag = function () {
    dataLayer.push(arguments);
  };
  gtag('js', new Date());

  gtag('config', 'G-Q62Q3E20Y0');
};
