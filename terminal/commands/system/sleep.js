// sleep — delay for a specified time (GNU-style subset; jsh)

import { SleepLib } from './sleep-lib.js';

/** Max single setTimeout delay in many browsers (~24.8 days). */
const MAX_TIMEOUT_MS = 2147483647;

/**
 * @param {number} ms
 * @param {AbortSignal|null|undefined} signal
 */
function sleepWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        },
        { once: true }
      );
    }
  });
}

/**
 * @param {number} totalMs
 * @param {AbortSignal|null|undefined} signal
 */
async function sleepMsChunked(totalMs, signal) {
  let remaining = totalMs;
  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_TIMEOUT_MS);
    await sleepWithAbort(chunk, signal);
    remaining -= chunk;
  }
}

async function sleepHandler(terminal, args) {
  const parsed = SleepLib.parseSleepArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: SleepLib.SLEEP_HELP, stderr: '', exitCode: 0 };
  }
  if (parsed.version) {
    return { stdout: SleepLib.SLEEP_VERSION_LINE, stderr: '', exitCode: 0 };
  }
  const totalMs = parsed.totalSeconds * 1000;
  await sleepMsChunked(totalMs, terminal.runAbortSignal);
  return { stdout: '', stderr: '', exitCode: 0 };
}

export default {
  name: 'sleep',
  handler: sleepHandler,
  description: 'delay for a specified time (GNU-style; Ctrl+C aborts)',
  category: 'System'
};
