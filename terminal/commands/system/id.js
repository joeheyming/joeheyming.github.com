// id - print real and effective user and group IDs
(function () {
  'use strict';

  registerCommand(
    'id',
    (terminal, args) => {
      const sm = terminal.os?.kernel?.securityManager;
      if (!sm) return 'id: security subsystem not available';

      const targetName = args[0] || terminal.env.USER;
      const user = sm.getUserByName(targetName);
      if (!user) return `id: '${targetName}': no such user`;

      const primaryGroup = sm.getAllGroups().find((g) => g.gid === user.gid);
      const primaryGName = primaryGroup ? primaryGroup.groupname : user.gid;

      const allGroups = sm.getGroupsForUser(user.uid);
      const groupsStr = allGroups.map((g) => `${g.gid}(${g.groupname})`).join(',');

      return `uid=${user.uid}(${user.username}) gid=${user.gid}(${primaryGName}) groups=${groupsStr}`;
    },
    'print user and group IDs',
    'System'
  );
})();
