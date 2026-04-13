// fortune command - get a random fortune

function fortuneHandler(terminal, args) {
  const fortunes = [
    'A computer program does what you tell it to do, not what you want it to do.',
    "There are only 10 types of people: those who understand binary and those who don't.",
    '99 bugs in the code, 99 bugs in the code. Take one down, patch it around, 127 bugs in the code.',
    'Programming is like sex: one mistake and you have to support it for the rest of your life.',
    "A user interface is like a joke. If you have to explain it, it's not that good.",
    'Real programmers count from 0.',
    'There are two hard things in computer science: cache invalidation and naming things.',
    'It works on my machine ¯\\_(ツ)_/¯',
    'DEBUGGING: Removing the needles from the haystack.',
    "Coffee: The programmer's way of turning caffeine into code."
  ];

  return '🔮 ' + fortunes[Math.floor(Math.random() * fortunes.length)];
}

export default {
  name: 'fortune',
  handler: fortuneHandler,
  description: 'get a random fortune',
  category: 'Fun Stuff'
};
