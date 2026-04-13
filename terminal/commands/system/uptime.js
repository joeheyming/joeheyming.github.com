// uptime - session uptime (honest: browser tab, not kernel)

const USAGE = `Usage: uptime [--help]

Show how long this jsh session (browser tab) has been running.
This is not the host machine uptime or a real OS boot time.
`;

function uptimeHandler(terminal, args) {
  if (args[0] === '--help' || args[0] === '-h') {
    return { stdout: USAGE, stderr: '', exitCode: 0 };
  }
  if (args.length > 0) {
    return {
      stdout: '',
      stderr: `uptime: unrecognized argument '${args[0]}'`,
      exitCode: 1
    };
  }

  const ms = typeof performance !== 'undefined' ? performance.now() : 0;
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  let up = '';
  if (days) up += `${days} day${days === 1 ? '' : 's'}, `;
  if (hrs || days) up += `${hrs}:${String(mins).padStart(2, '0')}`;
  else if (mins > 0) up += `${mins} min`;
  else up += `${secs} sec`;

  const host = (terminal.env && terminal.env.HOSTNAME) || 'heyming-os';
  const line = `${new Date().toLocaleString()}  up ${up},  1 user,  load average: 0.00, 0.00, 0.00  (${host}; tab session)\n`;
  return { stdout: line, stderr: '', exitCode: 0 };
}

export default {
  name: 'uptime',
  handler: uptimeHandler,
  description: 'session uptime (browser tab)',
  category: 'System'
};
