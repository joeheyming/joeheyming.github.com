// cowsay command - make a cow say something

function cowsayHandler(terminal, args) {
  const message = args.join(' ') || 'Moo!';
  const messageLength = message.length;
  const topBorder = ' ' + '_'.repeat(messageLength + 2);
  const bottomBorder = ' ' + '-'.repeat(messageLength + 2);

  return `${topBorder}
< ${message} >
${bottomBorder}
        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||`;
}

export default {
  name: 'cowsay',
  handler: cowsayHandler,
  description: 'make a cow say something',
  category: 'Fun Stuff'
};
