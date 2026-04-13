// groupdel - delete a group

async function groupdelHandler(terminal, args) {
  const sm = terminal.os?.kernel?.securityManager;
  if (!sm) return 'groupdel: security subsystem not available';

  if (args.length === 0 || args[0] === '--help') {
    return 'Usage: groupdel GROUPNAME\n';
  }

  const groupname = args[0];
  const group = sm.getGroupByName(groupname);
  if (!group) return `groupdel: group '${groupname}' does not exist`;

  try {
    sm.deleteGroup(group.gid);
  } catch (e) {
    return `groupdel: ${e.message}`;
  }

  await sm.syncEtcFiles(terminal.fileSystemDB);
  return '';
}

export default {
  name: 'groupdel',
  handler: groupdelHandler,
  description: 'delete a group',
  category: 'System'
};
