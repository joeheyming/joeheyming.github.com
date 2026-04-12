// userdel - delete a user account
(function () {
  'use strict';

  registerCommand(
    'userdel',
    async (terminal, args) => {
      const sm = terminal.os?.kernel?.securityManager;
      if (!sm) return 'userdel: security subsystem not available';

      let removeHome = false;
      let username = null;

      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-r') {
          removeHome = true;
        } else if (a === '--help') {
          return 'Usage: userdel [-r] USERNAME\n\n  -r    Remove home directory\n';
        } else if (!a.startsWith('-')) {
          username = a;
        } else {
          return `userdel: unrecognized option '${a}'`;
        }
      }

      if (!username) return 'Usage: userdel [-r] USERNAME';

      const user = sm.getUserByName(username);
      if (!user) return `userdel: user '${username}' does not exist`;

      if (user.username === terminal.env.USER) {
        return 'userdel: cannot delete the currently logged-in user';
      }

      const home = user.home;
      try {
        sm.deleteUser(user.uid);
      } catch (e) {
        return `userdel: ${e.message}`;
      }

      // Remove user from all groups
      for (const g of sm.getAllGroups()) {
        g.members.delete(user.uid);
      }

      // Delete the user's primary group if it has no other members and matches the username
      const primaryGroup = sm.getAllGroups().find((g) => g.gid === user.gid);
      if (primaryGroup && primaryGroup.groupname === username && primaryGroup.members.size === 0) {
        try {
          sm.deleteGroup(primaryGroup.gid);
        } catch {
          // ignore
        }
      }

      if (removeHome && terminal.fileSystemDB) {
        try {
          await terminal.fileSystemDB.deleteItem(home, true);
        } catch {
          // may not exist
        }
      }

      await sm.syncEtcFiles(terminal.fileSystemDB);
      return '';
    },
    'delete a user account',
    'System'
  );
})();
