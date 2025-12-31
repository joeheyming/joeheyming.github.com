// joke command - hear a programming joke
(function () {
  'use strict';

  registerCommand(
    'joke',
    (terminal, args) => {
      const jokes = [
        'Why do programmers prefer dark mode? Because light attracts bugs! 🐛',
        "How many programmers does it take to screw in a light bulb? None, that's a hardware problem.",
        "Why do Java developers wear glasses? Because they don't C#! 👓",
        "A SQL query walks into a bar, walks up to two tables and asks: 'Can I join you?'",
        "Why did the programmer quit his job? He didn't get arrays! 📊",
        'How do you comfort a JavaScript bug? You console it! 🤗',
        "Why don't programmers like nature? It has too many bugs! 🦗",
        "What's a programmer's favorite hangout place? Foo Bar! 🍺",
        'Why did the developer go broke? Because he used up all his cache! 💰',
        'What do you call a programmer from Finland? Nerdic! 🇫🇮'
      ];

      return '😂 ' + jokes[Math.floor(Math.random() * jokes.length)];
    },
    'hear a programming joke',
    'Fun Stuff'
  );
})();
