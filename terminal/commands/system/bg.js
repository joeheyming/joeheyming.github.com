// bg — resume a (stopped) job in the background (jsh: no-op, cooperative; A5)
import { registerCommand } from '../../commands.js';

async function bgHandler(terminal, args) {
  const argsArr = Array.isArray(args) ? args : [];
  if (argsArr.includes('--help') || argsArr.includes('-h')) {
    return { stdout: 'Usage: bg [%n|n]\n', stderr: '', exitCode: 0 };
  }
  void terminal;
  // jsh background jobs cannot be stopped (no SIGSTOP); bg is informational.
  return {
    stdout: '',
    stderr: 'bg: no real STOP/CONT in jsh (jobs are already async; see jobs)\n',
    exitCode: 0
  };
}

registerCommand('bg', bgHandler, 'resume a stopped job (jsh: no-op; jobs run cooperatively)', 'System');

export default {
  name: 'bg',
  handler: bgHandler,
  description: 'resume a stopped job (jsh: no-op; jobs run cooperatively)',
  category: 'System'
};
