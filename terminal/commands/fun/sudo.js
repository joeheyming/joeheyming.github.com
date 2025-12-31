// sudo command - try to run as admin (spoiler: you can't)
(function () {
  'use strict';

  registerCommand(
    'sudo',
    (terminal, args) => {
      const responses = [
        'Nice try! But this is a fake terminal, not real sudo 😏',
        'user is not in the sudoers file. This incident will be reported... to /dev/null',
        "Error: sudo is not installed. Try 'apt install sudo' (which also won't work)",
        'Permission denied. Have you tried asking nicely? Please? Pretty please?',
        "sudo: command not found (because you're not the boss of me)",
        'Access denied. This terminal runs on democracy, not dictatorship!'
      ];

      return responses[Math.floor(Math.random() * responses.length)];
    },
    "try to run as admin (spoiler: you can't)",
    'Fun Stuff'
  );
})();
