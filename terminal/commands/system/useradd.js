// useradd - create a new user account

async function useraddHandler(terminal, args) {
  const sm = terminal.os?.kernel?.securityManager;
  if (!sm) return 'useradd: security subsystem not available';

  let createHome = false;
  let shell = '/bin/jsh';
  let primaryGid = null;
  let supplementary = [];
  let username = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-m') {
      createHome = true;
    } else if (a === '-s' && i + 1 < args.length) {
      shell = args[++i];
    } else if (a === '-g' && i + 1 < args.length) {
      const gArg = args[++i];
      const gNum = Number(gArg);
      if (!isNaN(gNum)) {
        primaryGid = gNum;
      } else {
        const grp = sm.getGroupByName(gArg);
        if (!grp) return `useradd: group '${gArg}' does not exist`;
        primaryGid = grp.gid;
      }
    } else if (a === '-G' && i + 1 < args.length) {
      const names = args[++i].split(',');
      for (const n of names) {
        const grp = sm.getGroupByName(n.trim());
        if (!grp) return `useradd: group '${n.trim()}' does not exist`;
        supplementary.push(grp.gid);
      }
    } else if (a === '--help') {
      return (
        'Usage: useradd [-m] [-s SHELL] [-g GROUP] [-G GROUP1,GROUP2,...] USERNAME\n\n' +
        '  -m              Create home directory\n' +
        '  -s SHELL        Login shell (default: /bin/jsh)\n' +
        '  -g GROUP        Primary group (name or GID)\n' +
        '  -G GROUP1,...   Supplementary groups\n'
      );
    } else if (!a.startsWith('-')) {
      username = a;
    } else {
      return `useradd: unrecognized option '${a}'`;
    }
  }

  if (!username) return 'Usage: useradd [-m] [-s SHELL] [-g GROUP] [-G GROUPS] USERNAME';

  if (sm.getUserByName(username)) {
    return `useradd: user '${username}' already exists`;
  }

  const uid = sm.getNextUid();

  if (primaryGid === null) {
    const nextGid = sm.getNextGid();
    try {
      sm.createGroup(username, nextGid);
    } catch (e) {
      return `useradd: ${e.message}`;
    }
    primaryGid = nextGid;
  }

  const home = `/home/${username}`;
  try {
    sm.createUser(username, uid, primaryGid, home, shell);
  } catch (e) {
    return `useradd: ${e.message}`;
  }

  sm.addUserToGroup(uid, primaryGid);
  for (const gid of supplementary) {
    sm.addUserToGroup(uid, gid);
  }

  if (createHome && terminal.fileSystemDB) {
    try {
      await terminal.fileSystemDB.createDirectory(home);
    } catch {
      // may already exist
    }
  }

  await sm.syncEtcFiles(terminal.fileSystemDB);
  return '';
}

export default {
  name: 'useradd',
  handler: useraddHandler,
  description: 'create a new user account',
  category: 'System'
};
