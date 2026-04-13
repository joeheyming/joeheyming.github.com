// pizza command - order pizza

function pizzaHandler(terminal, args) {
  return `🍕 Pizza ordering system initialized...

📞 Calling Pizza Palace...
🛵 Delivery ETA: 30 minutes (or it's free!)
💰 Total: $12.99 (paid with fake money)

🍕 Your virtual pizza is on the way!
Toppings: Pepperoni, cheese, and a sprinkle of binary code.

⚠️  Warning: Virtual pizza provides no actual nutrition.`;
}

export default {
  name: 'pizza',
  handler: pizzaHandler,
  description: 'order pizza',
  category: 'Fun Stuff'
};
