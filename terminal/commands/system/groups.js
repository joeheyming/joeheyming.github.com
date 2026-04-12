// groups - print group memberships for a user
(function () {
  'use strict';

  registerCommand(
    'groups',
    (terminal, args) => {
      const sm = terminal.os?.kernel?.securityManager;
      if (!sm) return 'groups: security subsystem not available';

      const targetName = args[0] || terminal.env.USER;
      const user = sm.getUserByName(targetName);
      if (!user) return `groups: '${targetName}': no such user`;

      const userGroups = sm.getGroupsForUser(user.uid);
      const names = userGroups.map((g) => g.groupname).join(' ');
      return `${user.username} : ${names}`;
    },
    'print group memberships',
    'System'
  );
})();
