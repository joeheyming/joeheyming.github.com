// jobs — list active background jobs (A5)
import { registerCommand } from '../../commands.js';

const JOBS_HELP = `Usage: jobs [-l] [-p] [-r] [-s]
List active jobs.

  -l    list PIDs along with the job IDs
  -p    list only PIDs
  -r    restrict to running jobs only
  -s    restrict to stopped jobs only (jsh: not implemented; cooperative only)
      --help  show this help

jsh:
  Jobs run cooperatively in the same tab — no true SIGSTOP / SIGCONT.
`;

async function jobsHandler(terminal, args) {
  const argsArr = Array.isArray(args) ? args : [];
  if (argsArr.includes('--help') || argsArr.includes('-h')) {
    return { stdout: JOBS_HELP, stderr: '', exitCode: 0 };
  }
  const long = argsArr.includes('-l');
  const pidsOnly = argsArr.includes('-p');
  const runningOnly = argsArr.includes('-r');
  const list = terminal.jobs || [];
  const filtered = runningOnly ? list.filter((j) => j.state === 'Running') : list;
  if (filtered.length === 0) return { stdout: '', stderr: '', exitCode: 0 };
  const lines = filtered.map((j) => {
    if (pidsOnly) return String(j.pid || '');
    const lead = `[${j.jobId}]+ ${j.state.padEnd(8)}`;
    if (long) return `${lead}${(j.pid || '').toString().padStart(8)} ${j.command}`;
    return `${lead} ${j.command}`;
  });
  return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
}

registerCommand('jobs', jobsHandler, 'list active background jobs (-l, -p, -r)', 'System');

export default {
  name: 'jobs',
  handler: jobsHandler,
  description: 'list active background jobs (-l, -p, -r)',
  category: 'System'
};
