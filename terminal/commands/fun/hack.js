// hack command - become a movie hacker

function hackHandler(terminal, args) {
  const hackSequence = [
    '🔍 Scanning for vulnerabilities...',
    '💻 Initiating hack sequence...',
    '🌐 Bypassing firewall...',
    '🔐 Cracking passwords...',
    '📡 Accessing mainframe...',
    '🎯 Target acquired...',
    '✨ HACK COMPLETE!',
    '',
    "🎬 Congratulations! You're now a movie hacker!",
    '💡 Pro tip: Real hacking involves way more reading documentation and way less dramatic typing.'
  ];

  return hackSequence.join('\n');
}

export default {
  name: 'hack',
  handler: hackHandler,
  description: 'become a movie hacker',
  category: 'Fun Stuff'
};
