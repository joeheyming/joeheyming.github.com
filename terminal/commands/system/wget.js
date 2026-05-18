// wget — thin wrapper around curl(1) that writes the response body to a
// local file. Browser-only constraints from curl apply (CORS, no auth
// tunneling, etc.).

const WGET_HELP = `Usage: wget [OPTIONS] URL
GNU-style download wrapper around curl.

  -O FILE       write body to FILE (- for stdout, default: basename of URL)
  -q            quiet (no progress output to stderr)
  --no-proxy    bypass the CORS proxy
  -h, --help    display this help and exit

jsh: backed by fetch via the project's CORS proxy. No FTP, no resume.
`;

function parseWgetArgv(args) {
  let outPath = null;
  let quiet = false;
  let noProxy = false;
  const operands = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i++];
    if (a === '-h' || a === '--help') return { ok: true, help: true };
    if (a === '-q') {
      quiet = true;
      continue;
    }
    if (a === '--no-proxy') {
      noProxy = true;
      continue;
    }
    if (a === '-O') {
      outPath = args[i++];
      if (outPath == null) return { ok: false, stderr: 'wget: -O requires a path\n', exitCode: 2 };
      continue;
    }
    if (a.startsWith('-O')) {
      outPath = a.slice(2);
      continue;
    }
    operands.push(a);
  }
  if (operands.length === 0) return { ok: false, stderr: 'wget: missing URL\n', exitCode: 2 };
  return { ok: true, url: operands[0], outPath, quiet, noProxy };
}

function urlBasename(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last || 'index.html';
  } catch (_) {
    return 'index.html';
  }
}

async function wgetHandler(terminal, args) {
  const parsed = parseWgetArgv(args || []);
  if (parsed.ok === false) return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  if (parsed.help) return { stdout: WGET_HELP, stderr: '', exitCode: 0 };

  const curlArgs = ['-s', '-L'];
  if (parsed.noProxy) curlArgs.push('--no-proxy');
  curlArgs.push(parsed.url);

  // Reuse the existing curl runner so we get the proxy plumbing for free.
  const result = terminal.captureInnerPipeline
    ? await terminal.captureInnerPipeline('curl ' + curlArgs.map((a) => JSON.stringify(a)).join(' '))
    : null;
  if (!result) {
    return { stdout: '', stderr: 'wget: pipeline runner unavailable\n', exitCode: 1 };
  }
  if (result.exitCode !== 0) {
    return { stdout: '', stderr: result.stderr || `wget: download failed (curl exit ${result.exitCode})\n`, exitCode: result.exitCode || 1 };
  }
  const body = result.stdout || '';
  const dest = parsed.outPath || urlBasename(parsed.url);
  if (dest === '-') {
    return { stdout: body, stderr: parsed.quiet ? '' : `wget: ‘${parsed.url}’ -> stdout\n`, exitCode: 0 };
  }
  const fsdb = terminal.fileSystemDB;
  if (!fsdb || typeof fsdb.createFile !== 'function') {
    return { stdout: body, stderr: 'wget: filesystem unavailable, writing to stdout\n', exitCode: 0 };
  }
  const cwd = terminal.currentDirectory || terminal.cwd || '/';
  const path = dest.startsWith('/') ? dest : cwd.replace(/\/$/, '') + '/' + dest;
  try {
    await fsdb.createFile(path, body, { overwrite: true });
  } catch (e) {
    return { stdout: '', stderr: `wget: ${e.message}\n`, exitCode: 1 };
  }
  return {
    stdout: '',
    stderr: parsed.quiet ? '' : `‘${dest}’ saved [${body.length}]\n`,
    exitCode: 0
  };
}

export default {
  name: 'wget',
  handler: wgetHandler,
  description: 'Download a URL to a local file (wrapper around curl)',
  category: 'System'
};

export { parseWgetArgv, urlBasename };
