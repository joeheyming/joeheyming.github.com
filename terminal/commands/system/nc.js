// nc — HTTP-shaped netcat. Reads an HTTP request from stdin (or the args
// after `host port`) and prints the raw response.
//
// jsh: there is no real TCP from a browser. Anything other than HTTP[S]
// is unsupported and reported clearly.

const NC_HELP = `Usage: nc [OPTIONS] HOST PORT
Send a request to HOST:PORT and print the raw response.

  -e CMD       (unsupported in jsh)
  -l           (unsupported in jsh; we cannot listen)
  -s           use HTTPS regardless of PORT
  -w SEC       per-request timeout in seconds (default: none)
  -h, --help   display this help and exit

jsh:
  - Browsers cannot open raw TCP sockets. nc maps host:port to fetch().
  - Common use:  printf 'GET / HTTP/1.0\\r\\nHost: example.com\\r\\n\\r\\n' | nc example.com 80
  - For inbound connections, see JSH-SPEC.md (impossible in a tab).
`;

function parseNcArgv(args) {
  let useHttps = false;
  let timeoutMs = null;
  const operands = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i++];
    if (a === '-h' || a === '--help') return { ok: true, help: true };
    if (a === '-s') {
      useHttps = true;
      continue;
    }
    if (a === '-l' || a === '-e') {
      return { ok: false, stderr: `nc: ${a} is unsupported in jsh (no inbound sockets / no exec)\n`, exitCode: 2 };
    }
    if (a === '-w') {
      const n = parseFloat(args[i++]);
      if (!Number.isFinite(n)) return { ok: false, stderr: 'nc: -w requires a number\n', exitCode: 2 };
      timeoutMs = n * 1000;
      continue;
    }
    operands.push(a);
  }
  if (operands.length < 2) return { ok: false, stderr: 'nc: HOST and PORT required\n', exitCode: 2 };
  const host = operands[0];
  const port = parseInt(operands[1], 10);
  if (!Number.isFinite(port)) return { ok: false, stderr: 'nc: PORT must be numeric\n', exitCode: 2 };
  return { ok: true, host, port, useHttps, timeoutMs };
}

async function ncHandler(terminal, args) {
  const parsed = parseNcArgv(args || []);
  if (parsed.ok === false) return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  if (parsed.help) return { stdout: NC_HELP, stderr: '', exitCode: 0 };

  const stdin =
    terminal.stdin != null && String(terminal.stdin).length > 0
      ? String(terminal.stdin)
      : `GET / HTTP/1.0\r\nHost: ${parsed.host}\r\nConnection: close\r\n\r\n`;

  const sm = terminal.os?.kernel?.networkManager;
  if (!sm || typeof sm.createSocket !== 'function') {
    return { stdout: '', stderr: 'nc: network manager unavailable\n', exitCode: 1 };
  }
  const fd = sm.createSocket();
  const scheme =
    parsed.useHttps || parsed.port === 443 ? 'https' : 'http';
  try {
    sm.connect(fd, { host: parsed.host, port: parsed.port, scheme });
  } catch (e) {
    sm.close?.(fd);
    return { stdout: '', stderr: `nc: connect: ${e.message}\n`, exitCode: 1 };
  }
  try {
    const sendPromise = sm.send(fd, stdin);
    if (parsed.timeoutMs) {
      await Promise.race([
        sendPromise,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), parsed.timeoutMs))
      ]);
    } else {
      await sendPromise;
    }
  } catch (e) {
    sm.close?.(fd);
    return { stdout: '', stderr: `nc: ${e.message}\n`, exitCode: 1 };
  }
  // Drain the response (the simulated network manager populates synchronously
  // after _flushRequest resolves).
  const out = typeof sm.recv === 'function' ? sm.recv(fd) : '';
  sm.close?.(fd);
  return { stdout: out, stderr: '', exitCode: out ? 0 : 1 };
}

export default {
  name: 'nc',
  handler: ncHandler,
  description: 'HTTP-shaped netcat over fetch (jsh: no raw TCP)',
  category: 'System'
};

export { parseNcArgv };
