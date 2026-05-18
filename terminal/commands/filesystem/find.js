// find — GNU-style file finder over the VFS.
//
// Supports a useful subset:
//   - Paths (one or more)
//   - Predicates: -name GLOB, -iname GLOB, -type f|d|l, -size [+-]N[ckMG],
//     -mtime [+-]N, -maxdepth N, -mindepth N, -empty, -path GLOB
//   - Actions: -print (default), -print0, -delete, -exec CMD ... \; / +
//   - Operators: -a / -and (implicit), -o / -or, ! / -not, ( … )
//
// Legacy form for backward compatibility:
//   find PATTERN [PATH]
// is used only when no recognized predicate / operator appears in args.

import { ShellCore } from '../../lib/shell-core.js';

const PREDICATE_TOKENS = new Set([
  '-name',
  '-iname',
  '-type',
  '-size',
  '-mtime',
  '-mmin',
  '-maxdepth',
  '-mindepth',
  '-empty',
  '-path',
  '-print',
  '-print0',
  '-delete',
  '-exec',
  '-execdir',
  '-a',
  '-and',
  '-o',
  '-or',
  '-not',
  '!',
  '(',
  ')'
]);

function isPredicateToken(tok) {
  return PREDICATE_TOKENS.has(tok);
}

function globToRegex(glob) {
  // Reuse the shell's pattern compiler for consistency with file globs.
  // It accepts *, ?, and [abc]/[!abc] character classes.
  // We anchor full-string.
  return ShellCore.shellPatternToRegex(glob);
}

function iglobToRegex(glob) {
  const src = ShellCore.shellPatternToRegexSrc(glob);
  return new RegExp(src, 'i');
}

/**
 * Parse the expression portion of a find invocation into a tree.
 *
 * Grammar (loosely):
 *   expr   := or
 *   or     := and ( ( -o | -or ) and )*
 *   and    := not ( ( -a | -and )? not )*
 *   not    := ( ! | -not ) not | atom
 *   atom   := ( expr ) | predicate
 */
function parseFindExpr(tokens) {
  let i = 0;
  function peek() {
    return i < tokens.length ? tokens[i] : null;
  }
  function consume() {
    return tokens[i++];
  }

  function parseAtom() {
    const t = peek();
    if (t === null) {
      throw new Error("find: expected predicate before end of expression");
    }
    if (t === '(') {
      consume();
      const e = parseOr();
      if (peek() !== ')') {
        throw new Error("find: expected ')'");
      }
      consume();
      return e;
    }
    if (t === '!' || t === '-not') {
      consume();
      return { type: 'not', child: parseAtom() };
    }
    return parsePredicate();
  }

  function parsePredicate() {
    const tok = consume();
    switch (tok) {
      case '-name':
      case '-iname':
      case '-path':
      case '-type':
      case '-size':
      case '-mtime':
      case '-mmin':
      case '-maxdepth':
      case '-mindepth': {
        const arg = consume();
        if (arg === undefined) {
          throw new Error(`find: missing argument to '${tok}'`);
        }
        return { type: 'pred', name: tok, arg };
      }
      case '-empty':
      case '-print':
      case '-print0':
      case '-delete':
        return { type: 'pred', name: tok };
      case '-exec':
      case '-execdir': {
        const cmd = [];
        let terminator = null;
        while (i < tokens.length) {
          const t = consume();
          if (t === ';') {
            terminator = ';';
            break;
          }
          if (t === '+') {
            terminator = '+';
            break;
          }
          cmd.push(t);
        }
        if (terminator === null) {
          throw new Error(`find: missing terminator (';' or '+') for ${tok}`);
        }
        return { type: 'pred', name: tok, cmd, terminator };
      }
      default:
        throw new Error(`find: unknown predicate '${tok}'`);
    }
  }

  function parseNot() {
    return parseAtom();
  }

  function parseAnd() {
    let left = parseNot();
    while (i < tokens.length) {
      const t = peek();
      if (t === '-a' || t === '-and') {
        consume();
        const right = parseNot();
        left = { type: 'and', left, right };
        continue;
      }
      if (t === '-o' || t === '-or' || t === ')') break;
      // implicit AND
      const right = parseNot();
      left = { type: 'and', left, right };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (peek() === '-o' || peek() === '-or') {
      consume();
      const right = parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }

  const expr = parseOr();
  if (i < tokens.length) {
    throw new Error(`find: unexpected token '${tokens[i]}'`);
  }
  return expr;
}

function exprHasAction(node) {
  if (!node) return false;
  if (node.type === 'not') return exprHasAction(node.child);
  if (node.type === 'and' || node.type === 'or') {
    return exprHasAction(node.left) || exprHasAction(node.right);
  }
  if (node.type === 'pred') {
    return (
      node.name === '-print' ||
      node.name === '-print0' ||
      node.name === '-delete' ||
      node.name === '-exec' ||
      node.name === '-execdir'
    );
  }
  return false;
}

function exprMaxDepth(node) {
  if (!node) return null;
  if (node.type === 'pred' && node.name === '-maxdepth') {
    const n = parseInt(node.arg, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (node.type === 'and' || node.type === 'or') {
    const l = exprMaxDepth(node.left);
    const r = exprMaxDepth(node.right);
    if (l === null) return r;
    if (r === null) return l;
    return Math.min(l, r);
  }
  if (node.type === 'not') return exprMaxDepth(node.child);
  return null;
}

function exprMinDepth(node) {
  if (!node) return null;
  if (node.type === 'pred' && node.name === '-mindepth') {
    const n = parseInt(node.arg, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (node.type === 'and' || node.type === 'or') {
    const l = exprMinDepth(node.left);
    const r = exprMinDepth(node.right);
    if (l === null) return r;
    if (r === null) return l;
    return Math.max(l, r);
  }
  if (node.type === 'not') return exprMinDepth(node.child);
  return null;
}

function parseSizeArg(s) {
  let cmp = '=';
  let str = s;
  if (str.startsWith('+')) {
    cmp = '>';
    str = str.slice(1);
  } else if (str.startsWith('-')) {
    cmp = '<';
    str = str.slice(1);
  }
  let unit = 'b'; // 512-byte blocks default per POSIX, but practically people expect c (chars/bytes)
  const last = str[str.length - 1];
  if ('cwbkMG'.includes(last)) {
    unit = last;
    str = str.slice(0, -1);
  }
  const n = Number(str);
  if (!Number.isFinite(n)) return null;
  const multiplier =
    unit === 'c' ? 1 : unit === 'w' ? 2 : unit === 'k' ? 1024 : unit === 'M' ? 1024 * 1024 : unit === 'G' ? 1024 * 1024 * 1024 : 512;
  return { cmp, bytes: n * multiplier, unit };
}

function parseTimeArg(s) {
  let cmp = '=';
  let str = s;
  if (str.startsWith('+')) {
    cmp = '>';
    str = str.slice(1);
  } else if (str.startsWith('-')) {
    cmp = '<';
    str = str.slice(1);
  }
  const n = Number(str);
  if (!Number.isFinite(n)) return null;
  return { cmp, n };
}

function compare(cmp, actual, threshold) {
  if (cmp === '>') return actual > threshold;
  if (cmp === '<') return actual < threshold;
  return actual === threshold;
}

/**
 * Evaluate the predicate tree against a candidate item. Returns
 *   { match: boolean, prune?: boolean, deleted?: boolean, deleteRequested?: boolean }.
 * Side-effects (print / -exec / -delete) accumulate into `ctx`.
 */
async function evalExpr(node, item, ctx) {
  if (!node) return true;
  if (node.type === 'and') {
    const l = await evalExpr(node.left, item, ctx);
    if (!l) return false;
    return evalExpr(node.right, item, ctx);
  }
  if (node.type === 'or') {
    const l = await evalExpr(node.left, item, ctx);
    if (l) return true;
    return evalExpr(node.right, item, ctx);
  }
  if (node.type === 'not') {
    return !(await evalExpr(node.child, item, ctx));
  }
  // pred
  const name = node.name;
  switch (name) {
    case '-name':
      return globToRegex(node.arg).test(item.basename);
    case '-iname':
      return iglobToRegex(node.arg).test(item.basename);
    case '-path':
      return globToRegex(node.arg).test(item.path);
    case '-type': {
      if (node.arg === 'f') return item.type === 'file';
      if (node.arg === 'd') return item.type === 'directory';
      if (node.arg === 'l') return item.type === 'symlink';
      return false;
    }
    case '-size': {
      const spec = parseSizeArg(node.arg);
      if (!spec) return false;
      const size = item.size || 0;
      // For -size N[c], people compare bytes directly. For 'b' (blocks), round up.
      let actual = size;
      let threshold = spec.bytes;
      if (spec.unit === 'b') {
        actual = Math.ceil(size / 512);
        threshold = spec.bytes / 512;
      }
      return compare(spec.cmp, actual, threshold);
    }
    case '-mtime': {
      const spec = parseTimeArg(node.arg);
      if (!spec) return false;
      const m = item.modified ? new Date(item.modified).getTime() : 0;
      const ageDays = Math.floor((Date.now() - m) / (24 * 3600 * 1000));
      return compare(spec.cmp, ageDays, spec.n);
    }
    case '-mmin': {
      const spec = parseTimeArg(node.arg);
      if (!spec) return false;
      const m = item.modified ? new Date(item.modified).getTime() : 0;
      const ageMin = Math.floor((Date.now() - m) / (60 * 1000));
      return compare(spec.cmp, ageMin, spec.n);
    }
    case '-empty': {
      if (item.type === 'file') return (item.size || 0) === 0;
      if (item.type === 'directory') {
        const entries = await ctx.terminal.listDirectoryContents(item.path);
        return entries.length === 0;
      }
      return false;
    }
    case '-maxdepth':
    case '-mindepth':
      return true; // depth gating happens in the walker
    case '-print':
      ctx.printed.push(item.path);
      return true;
    case '-print0':
      ctx.printed0.push(item.path);
      return true;
    case '-delete':
      ctx.toDelete.push(item);
      return true;
    case '-exec':
    case '-execdir': {
      if (node.terminator === ';') {
        // Run the command synchronously (each-file form).
        const argv = node.cmd.map((tok) => (tok === '{}' ? item.path : tok));
        const result = await ctx.runCommand(argv);
        return result.exitCode === 0;
      }
      // + form: accumulate and batch at the end.
      ctx.execBatches = ctx.execBatches || new Map();
      const key = node.cmd.join('\0');
      if (!ctx.execBatches.has(key)) {
        ctx.execBatches.set(key, { template: node.cmd, items: [] });
      }
      ctx.execBatches.get(key).items.push(item.path);
      return true;
    }
    default:
      return false;
  }
}

async function collectAll(terminal, rootPath, maxDepth) {
  const out = [];
  async function walk(path, depth) {
    const item = await terminal.getFileSystemItem(path);
    if (!item) return;
    const basename = terminal.fileSystemDB.getFileName(path) || path;
    out.push({
      path,
      basename: basename === '' ? '/' : basename,
      type: item.type,
      size: item.size || 0,
      modified: item.modified,
      depth
    });
    if (item.type === 'directory' && (maxDepth === null || depth < maxDepth)) {
      const entries = await terminal.listDirectoryContents(path);
      for (const e of entries) {
        await walk(e.path, depth + 1);
      }
    }
  }
  await walk(rootPath, 0);
  return out;
}

async function findHandler(terminal, args) {
  if (args.length === 0) {
    args = ['.'];
  }

  // Split args into [paths..., expression-tokens...]. Any token that is a
  // known predicate / operator (or starts with '!' or '(') begins the
  // expression. Everything before is a search root.
  const paths = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith('-') || a === '!' || a === '(' || isPredicateToken(a)) break;
    paths.push(a);
    i++;
  }
  const exprTokens = args.slice(i);

  if (paths.length === 0) {
    // No leading paths, but first token isn't a predicate either — legacy form.
    if (exprTokens.length > 0 && !isPredicateToken(exprTokens[0]) && exprTokens[0] !== '!' && exprTokens[0] !== '(') {
      // shouldn't happen given the split above, but be safe
    }
    paths.push('.');
  }

  let expr = null;
  if (exprTokens.length > 0) {
    try {
      expr = parseFindExpr(exprTokens);
    } catch (e) {
      return { stdout: '', stderr: `${e.message}\n`, exitCode: 1 };
    }
  }

  const maxDepth = expr ? exprMaxDepth(expr) : null;
  const minDepth = expr ? exprMinDepth(expr) : null;
  const hasAction = expr ? exprHasAction(expr) : false;

  const ctx = {
    terminal,
    printed: [],
    printed0: [],
    toDelete: [],
    execBatches: null,
    async runCommand(argv) {
      // Use the terminal's captureInnerPipeline (same path used by $()) for
      // -exec. Each invocation runs as if it had been typed inline.
      try {
        const cmdline = argv
          .map((a) => (/[\s'"$`]/.test(a) ? "'" + a.replace(/'/g, "'\\''") + "'" : a))
          .join(' ');
        if (typeof terminal.captureInnerPipeline === 'function') {
          const out = await terminal.captureInnerPipeline(cmdline);
          if (out) ctx.execStdout.push(out);
          return { exitCode: terminal.lastExitCode | 0 };
        }
        return { exitCode: 127 };
      } catch (_) {
        return { exitCode: 1 };
      }
    },
    execStdout: []
  };

  const allErrors = [];
  for (const pathArg of paths) {
    const root = terminal.resolvePath(pathArg);
    const rootItem = await terminal.getFileSystemItem(root);
    if (!rootItem) {
      allErrors.push(`find: '${pathArg}': No such file or directory`);
      continue;
    }
    const items = await collectAll(terminal, root, maxDepth);
    for (const item of items) {
      if (minDepth !== null && item.depth < minDepth) continue;
      const ok = expr ? await evalExpr(expr, item, ctx) : true;
      if (ok && !hasAction) ctx.printed.push(item.path);
    }
  }

  // Run batched -exec ... + commands.
  if (ctx.execBatches && ctx.execBatches.size > 0) {
    for (const { template, items } of ctx.execBatches.values()) {
      const argv = [];
      for (const tok of template) {
        if (tok === '{}') {
          for (const p of items) argv.push(p);
        } else {
          argv.push(tok);
        }
      }
      await ctx.runCommand(argv);
    }
  }

  // Apply -delete in reverse-depth order so dirs become empty first.
  if (ctx.toDelete.length > 0) {
    ctx.toDelete.sort((a, b) => b.depth - a.depth);
    for (const it of ctx.toDelete) {
      try {
        if (it.type === 'directory') {
          await terminal.fileSystemDB.deleteItem(it.path);
        } else {
          await terminal.fileSystemDB.deleteItem(it.path);
        }
      } catch (e) {
        allErrors.push(`find: cannot delete '${it.path}': ${e.message}`);
      }
    }
  }

  const stdoutParts = [];
  if (ctx.printed.length) stdoutParts.push(ctx.printed.join('\n'));
  if (ctx.printed0.length) stdoutParts.push(ctx.printed0.join('\0'));
  if (ctx.execStdout.length) stdoutParts.push(ctx.execStdout.join('\n'));
  const stdout = stdoutParts.length ? stdoutParts.join('\n') + '\n' : '';
  const stderr = allErrors.length ? allErrors.join('\n') + '\n' : '';
  return { stdout, stderr, exitCode: allErrors.length > 0 ? 1 : 0 };
}

export default {
  name: 'find',
  handler: findHandler,
  description:
    'find files: -name/-iname/-path/-type/-size/-mtime/-mmin/-maxdepth/-mindepth/-empty/-print/-print0/-delete/-exec ... \\;|+',
  category: 'File System'
};

export {
  parseFindExpr,
  parseSizeArg,
  parseTimeArg,
  isPredicateToken,
  globToRegex,
  iglobToRegex,
  exprMaxDepth,
  exprMinDepth,
  exprHasAction
};
