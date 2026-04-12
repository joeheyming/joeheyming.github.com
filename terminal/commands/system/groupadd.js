// groupadd - create a new group
(function () {
  'use strict';

  registerCommand(
    'groupadd',
    async (terminal, args) => {
      const sm = terminal.os?.kernel?.securityManager;
      if (!sm) return 'groupadd: security subsystem not available';

      let gid = null;
      let groupname = null;

      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-g' && i + 1 < args.length) {
          gid = Number(args[++i]);
          if (isNaN(gid)) return 'groupadd: invalid GID';
        } else if (a === '--help') {
          return 'Usage: groupadd [-g GID] GROUPNAME\n';
        } else if (!a.startsWith('-')) {
          groupname = a;
        } else {
          return `groupadd: unrecognized option '${a}'`;
        }
      }

      if (!groupname) return 'Usage: groupadd [-g GID] GROUPNAME';

      if (sm.getGroupByName(groupname)) {
        return `groupadd: group '${groupname}' already exists`;
      }

      if (gid === null) gid = sm.getNextGid();

      try {
        sm.createGroup(groupname, gid);
      } catch (e) {
        return `groupadd: ${e.message}`;
      }

      await sm.syncEtcFiles(terminal.fileSystemDB);
      return '';
    },
    'create a new group',
    'System'
  );
})();
