// whoami command - display username

function whoamiHandler(terminal, args) {
  return terminal.env.USER;
}

export default {
  name: 'whoami',
  handler: whoamiHandler,
  description: 'display current username',
  category: 'System'
};
