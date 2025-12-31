// coffee command - order coffee
(function () {
  'use strict';

  registerCommand(
    'coffee',
    (terminal, args) => {
      const responses = [
        '☕ Brewing coffee... Error: Coffee machine not found. Have you tried turning it off and on again?',
        '☕ Order placed! Your virtual coffee will arrive in 0 seconds. ⚡',
        "☕ HTTP 418: I'm a teapot. Cannot brew coffee.",
        '☕ Coffee.exe has stopped working. Please restart your Monday.',
        "☕ Insufficient privileges to access coffee. Try 'sudo coffee'.",
        '☕ Coffee successful! +10 productivity, +5 jitter, -3 sleep.'
      ];

      return responses[Math.floor(Math.random() * responses.length)];
    },
    'order coffee',
    'Fun Stuff'
  );
})();
