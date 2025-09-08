// rick command - get rick rolled
(function () {
  'use strict';

  registerCommand('rick', (terminal, args) => {
    const noVideo = args && args.includes('--no-video');

    if (!noVideo) {
      // Actually Rick Roll the user by opening the video
      setTimeout(() => {
        window.open('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '_blank');
      }, 1000);
    }

    const baseMessage = `🎵 Never gonna give you up, never gonna let you down!

🕺 You just got Rick Roll'd in a terminal!

Did you know? Rick Astley's "Never Gonna Give You Up" has been 
viewed over 1 billion times on YouTube. That's a lot of Rick Rolling!

🎤 "We're no strangers to love..."`;

    if (noVideo) {
      return `${baseMessage}

😌 Safe mode: No video opened this time!
🔗 But here's the URL anyway: https://www.youtube.com/watch?v=dQw4w9WgXcQ`;
    }

    return `${baseMessage}

🔗 Opening: https://www.youtube.com/watch?v=dQw4w9WgXcQ
⏰ Video will open in 3... 2... 1...

💡 Pro tip: You can also try 'rick --no-video' to avoid the actual Rick Roll!`;
  }, 'get rick rolled', 'Fun Stuff');
})();
