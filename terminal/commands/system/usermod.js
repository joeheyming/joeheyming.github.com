// usermod - modify a user account

async function usermodHandler(terminal, args) {
  const sm = terminal.os?.kernel?.securityManager;
  if (!sm) return 'usermod: security subsystem not available';

  let username = null;
  const changes = {};
  let newGroups = null;
  let lock = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-l' && i + 1 < args.length) {
      changes.username = args[++i];
    } else if (a === '-d' && i + 1 < args.length) {
      changes.home = args[++i];
    } else if (a === '-s' && i + 1 < args.length) {
      changes.shell = args[++i];
    } else if (a === '-g' && i + 1 < args.length) {
      const gArg = args[++i];
      const gNum = Number(gArg);
      if (!isNaN(gNum)) {
        changes.gid = gNum;
      } else {
        const grp = sm.getGroupByName(gArg);
        if (!grp) return `usermod: group '${gArg}' does not exist`;
        changes.gid = grp.gid;
      }
    } else if (a === '-G' && i + 1 < args.length) {
      newGroups = args[++i].split(',').map((n) => n.trim());
    } else if (a === '-L') {
      lock = true;
    } else if (a === '-U') {
      lock = false;
    } else if (a === '--help') {
      return (
        'Usage: usermod [OPTIONS] USERNAME\n\n' +
        '  -l NAME         New username\n' +
        '  -d HOME         New home directory\n' +
        '  -s SHELL        New login shell\n' +
        '  -g GROUP        New primary group\n' +
        '  -G GROUP1,...   Set supplementary groups (replaces current)\n' +
        '  -L              Lock account\n' +
        '  -U              Unlock account\n'
      );
    } else if (!a.startsWith('-')) {
      username = a;
    } else {
      return `usermod: unrecognized option '${a}'`;
    }
  }

  if (!username) return 'Usage: usermod [OPTIONS] USERNAME';

  const user = sm.getUserByName(username);
  if (!user) return `usermod: user '${username}' does not exist`;

  if (lock !== null) changes.locked = lock;

  if (changes.username && sm.getUserByName(changes.username)) {
    return `usermod: username '${changes.username}' already in use`;
  }

  try {
    sm.modifyUser(user.uid, changes);
  } catch (e) {
    return `usermod: ${e.message}`;
  }

  if (newGroups !== null) {
    // Remove from all supplementary groups
    for (const g of sm.getAllGroups()) {
      if (g.gid !== user.gid) g.members.delete(user.uid);
    }
    // Add to specified groups
    for (const name of newGroups) {
      if (!name) continue;
      const grp = sm.getGroupByName(name);
      if (!grp) return `usermod: group '${name}' does not exist`;
      sm.addUserToGroup(user.uid, grp.gid);
    }
  }

  // If modifying the current user, update terminal env
  if (user.uid === 1000 || user.username === terminal.env.USER) {
    if (changes.username) terminal.env.USER = changes.username;
    if (changes.home) {
      terminal.env.HOME = changes.home;
      terminal.env.PWD = changes.home;
      terminal.currentDirectory = changes.home;
    }
  }

  await sm.syncEtcFiles(terminal.fileSystemDB);
  return '';
}

export default {
  name: 'usermod',
  handler: usermodHandler,
  description: 'modify a user account',
  category: 'System'
};
