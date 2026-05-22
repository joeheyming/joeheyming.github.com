/**
 * Tool definitions + executors for the HeymingOS chat assistant.
 *
 * Each tool has:
 *   - `definition`: an OpenAI-shaped function schema (sent to the model).
 *   - `execute(args, ctx)`: runs in the browser, returns a JSON-able value.
 *
 * Read-leaning by design. The two write tools (`applyEdit` for editing
 * an existing file, `createFile` for writing a new one) are both gated
 * by a mandatory dry-run / preview step — the model proposes the
 * write, the UI shows a diff, and only an explicit user accept
 * triggers a real write. Other actions (`launchApp`, `notify`) are
 * bounded and safe to run without confirmation; the user sees them
 * happen.
 *
 * `ctx` is provided by the chat client and exposes:
 *   - `embed`: the `os-embed` bridge (for notify / launchApp).
 *   - `notify(msg, kind?)`: local fallback notifier.
 *   - `fs`: a FileSystemDB instance (lazily initialized in the client).
 *   - `proxy`: `window.proxyService` (for webFetch).
 *   - `appsRegistry`: cached parsed apps-registry.json.
 *   - `toolNames` (optional): when present, restricts which tools
 *     `getToolDefinitions()` exposes to the model. Used by hosts like
 *     Code IDE to drop irrelevant tools (e.g. `launchApp`, which would
 *     navigate the IDE iframe and lose the user's editor state).
 */

const MAX_RESULT_CHARS = 6000;

function truncateForModel(value, max = MAX_RESULT_CHARS) {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated; ${str.length - max} more characters]`;
}

/**
 * Resolve the user's home directory from same-origin localStorage. The
 * `heymingOS_username` key is set by the OS shell during onboarding and
 * is shared across iframes (same origin = same localStorage). Falls
 * back to `/home/user` when nothing's been set, which matches what the
 * FileSystemDB scaffolding does.
 */
export function getHome() {
  try {
    const user = localStorage.getItem('heymingOS_username') || 'user';
    return `/home/${user}`;
  } catch {
    return '/home/user';
  }
}

/**
 * Normalize a path the model gave us. Accepts:
 *   - `~` and `~/` → home
 *   - `~/Downloads` → /home/<user>/Downloads
 *   - bare names like `Downloads` or `Documents/notes.txt` → resolved
 *     against `base` (defaults to home for the chat host; Code IDE
 *     passes its workspace root)
 *   - already-absolute paths → unchanged (minus trailing slash)
 *
 * Trailing slashes are stripped (except on the root `/`) so e.g.
 * `/home/joe/Downloads/` and `/home/joe/Downloads` index into the same
 * entry. Multiple slashes collapse.
 *
 * @param {string} input
 * @param {{ base?: string }} [opts]  When `base` is provided, bare
 *   relative paths are resolved against it instead of $HOME. `~/...`
 *   still resolves against $HOME — the tilde explicitly means home.
 * @returns {string}
 */
export function resolvePath(input, opts = {}) {
  const home = getHome();
  const base = typeof opts.base === 'string' && opts.base ? opts.base : home;
  let path = String(input || '').trim();
  if (!path || path === '~' || path === '~/') return home;
  if (path.startsWith('~/')) path = `${home}/${path.slice(2)}`;
  else if (!path.startsWith('/')) {
    // Resolve relative paths against the host's working base. For the
    // chat host that's $HOME; for Code IDE it's the workspace root
    // (`/` in standalone, `/home/<user>/Documents` in OS-embedded).
    path = base === '/' ? `/${path}` : `${base}/${path}`;
  }
  // Collapse `//` and strip trailing `/` (except root).
  path = path.replace(/\/+/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

/**
 * Pick the right base directory for `resolvePath` from the chat tool
 * context. Hosts may expose a `workspaceRoot()` callback (Code IDE
 * does); otherwise we fall back to the user's home so the legacy chat
 * tools keep their old behavior unchanged.
 *
 * @param {any} ctx
 * @returns {string}
 */
function resolveBaseForCtx(ctx) {
  if (ctx && typeof ctx.workspaceRoot === 'function') {
    try {
      const root = ctx.workspaceRoot();
      if (typeof root === 'string' && root) return root;
    } catch {
      /* fall through */
    }
  }
  return getHome();
}

// Strings that show up when the model emitted a placeholder path
// instead of a real one — "/path/to/yourfile.cpp", "/your/file.py",
// "<filename>.js", etc. We catch these BEFORE dispatching the tool so
// the model gets a useful error back ("pick a real path") instead of
// silently creating a junk file the user has to clean up.
const PLACEHOLDER_PATH_PATTERNS = [
  /\/path\/to\//i,
  /\/your(?:_|-)?(?:file|dir|directory|folder|project|app|code)/i,
  /\/your\/(?:file|dir|directory|folder|project|app|code|src)/i,
  /\/example\b/i,
  /\/placeholder\b/i,
  /<[^>]+>/, // `<filename>`, `<path>`, etc.
  /\.{3,}/ // `...` ellipsis stand-in
];

/**
 * Quick reject for obvious placeholder paths. Returns an error string
 * to send back to the model, or null when the path looks real.
 *
 * When `workspaceRoot` is supplied (Code IDE always does), the error
 * message includes a concrete suggested replacement built from the
 * path's basename + the workspace root, e.g.:
 *
 *   "Path '/path/to/hello.sh' is a placeholder. Did you mean '/hello.sh'?"
 *
 * That suggestion is what the model echoes back on the retry pass,
 * which is the difference between "wasted iteration + apology" and
 * "second call lands a valid path".
 *
 * @param {string} path
 * @param {string} [workspaceRoot]
 * @returns {string | null}
 */
export function placeholderRejection(path, workspaceRoot) {
  if (typeof path !== 'string') return null;
  for (const re of PLACEHOLDER_PATH_PATTERNS) {
    if (re.test(path)) {
      const baseHint = suggestRealPath(path, workspaceRoot);
      const suggestion = baseHint ? ` Did you mean "${baseHint}"? ` : ' ';
      const root =
        typeof workspaceRoot === 'string' && workspaceRoot ? workspaceRoot : '/';
      return (
        `Path "${path}" is a placeholder.${suggestion}` +
        `Pick a real absolute path inside the workspace (root is "${root}"). ` +
        'Use the PROJECT TREE in your system message as the basis for new paths. ' +
        'Never emit "/path/to/<file>", "/your/file.X", "<filename>", or "..." literally.'
      );
    }
  }
  return null;
}

/**
 * Strip the placeholder prefix (`/path/to/`, `/your/`, `/example/`,
 * `<...>` brackets, `...`) from a path and rejoin the remaining
 * basename onto the workspace root. Returns null when no usable
 * basename can be recovered.
 *
 * @param {string} path
 * @param {string} [workspaceRoot]
 */
function suggestRealPath(path, workspaceRoot) {
  if (typeof path !== 'string' || !path) return null;
  const parts = path.split('/').filter(Boolean);
  // Bail if the original basename was a placeholder bracket
  // (`<filename>`) or an ellipsis. We have nothing useful to
  // suggest in that case — the model literally never named a file.
  const lastSegment = parts[parts.length - 1];
  if (
    !lastSegment ||
    /<[^>]+>/.test(lastSegment) ||
    /^\.{3,}$/.test(lastSegment) ||
    /^your/i.test(lastSegment) ||
    lastSegment.toLowerCase() === 'file' ||
    lastSegment.toLowerCase() === 'dir' ||
    lastSegment.toLowerCase() === 'directory' ||
    lastSegment.toLowerCase() === 'folder'
  ) {
    return null;
  }
  const root =
    typeof workspaceRoot === 'string' && workspaceRoot ? workspaceRoot.replace(/\/+$/, '') : '';
  return `${root}/${lastSegment}`;
}

/** @typedef {{ definition: object, execute: (args: any, ctx: any) => Promise<any> }} ChatTool */

/** @type {Record<string, ChatTool>} */
export const TOOLS = {
  listApps: {
    definition: {
      type: 'function',
      function: {
        name: 'listApps',
        description:
          'List apps available on HeymingOS. Returns a compact array of { id, name, description, category }.',
        parameters: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: "Optional category filter, e.g. 'game' or 'utility'."
            }
          },
          additionalProperties: false
        }
      }
    },
    async execute(args, ctx) {
      const apps = await ctx.appsRegistry();
      const filtered =
        args && args.category ? apps.filter((a) => a.category === args.category) : apps;
      return filtered.map((a) => ({
        id: a.id,
        name: a.shortName || a.name,
        description: a.description,
        category: a.category
      }));
    }
  },

  launchApp: {
    definition: {
      type: 'function',
      function: {
        name: 'launchApp',
        description:
          'Open one of the apps in the HeymingOS registry. Only call this after the user has asked to open or launch something.',
        parameters: {
          type: 'object',
          properties: {
            appId: {
              type: 'string',
              description: "Exact app id from listApps (e.g. 'paint', 'notepad', 'stepmania')."
            }
          },
          required: ['appId'],
          additionalProperties: false
        }
      }
    },
    async execute(args, ctx) {
      console.log('[chat:tool:launchApp] called', { args, embedded: !!ctx.embed?.isEmbedded });
      if (!args || !args.appId) {
        console.warn('[chat:tool:launchApp] missing appId');
        return { ok: false, error: 'appId is required.' };
      }
      const apps = await ctx.appsRegistry();
      const match = apps.find((a) => a.id === args.appId);
      if (!match) {
        console.warn('[chat:tool:launchApp] unknown appId', {
          appId: args.appId,
          available: apps.map((a) => a.id)
        });
        return { ok: false, error: `Unknown app id '${args.appId}'.` };
      }
      if (ctx.embed && ctx.embed.isEmbedded) {
        // Embedded in HeymingOS: ask the host to open the app as another
        // desktop window. The chat stays open; both apps run side by side.
        const sent = ctx.embed.launchApp(match.id);
        console.log('[chat:tool:launchApp] postMessage to host', {
          appId: match.id,
          sent
        });
        if (sent) {
          ctx.notify(`Launched ${match.shortName || match.name}.`, 'success');
          return { ok: true, launched: match.id, mode: 'embedded' };
        }
        console.warn(
          '[chat:tool:launchApp] embed.launchApp returned false — falling through to standalone nav'
        );
      }
      // Standalone (e.g. someone visiting /chat/ directly): there is no
      // window manager to talk to, so navigate the current tab to the
      // app. Matches what the system prompt promises the user.
      //
      // URL() handles every path form in the registry ("./foo/",
      // "foo/", "/foo/") correctly — slicing strings by hand has bitten
      // us before when a registry entry forgot the leading "./".
      const url = new URL(match.path, `${window.location.origin}/`).pathname;
      console.log('[chat:tool:launchApp] navigating current tab to', url);
      ctx.notify(`Opening ${match.shortName || match.name}…`, 'success');
      window.location.assign(url);
      return { ok: true, launched: match.id, mode: 'standalone-nav', url };
    }
  },

  listFiles: {
    definition: {
      type: 'function',
      function: {
        name: 'listFiles',
        description:
          "List the contents of a directory in the user's HeymingOS virtual filesystem. Returns an array of { name, type, size }. Use this whenever the user asks to see, browse, or list files (e.g. 'show me downloads', 'what's in documents', 'ls ~').",
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                "Path to list. Accepts: '~' (home), '~/Downloads', 'Downloads' (home-relative), or absolute paths like '/home/<user>/Documents' or '/bin'. The most common user-data dirs all live under home: ~/Desktop, ~/Documents, ~/Downloads, ~/Pictures, ~/Music, ~/Videos."
            }
          },
          required: ['path'],
          additionalProperties: false
        }
      }
    },
    async execute(args, ctx) {
      if (!args || typeof args.path !== 'string') {
        return { ok: false, error: 'path is required.' };
      }
      const resolved = resolvePath(args.path, { base: resolveBaseForCtx(ctx) });
      console.log('[chat:tool:listFiles] resolving', { input: args.path, resolved });
      try {
        const fs = await ctx.fs();
        const entries = await fs.readdir(resolved);
        return {
          ok: true,
          path: resolved,
          entries: entries.map((e) => ({
            name: e.name,
            type: e.type,
            size: e.size
          }))
        };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    }
  },

  readFile: {
    definition: {
      type: 'function',
      function: {
        name: 'readFile',
        description:
          "Read the contents of a text file in the user's HeymingOS virtual filesystem. Binary files are rejected.",
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                "Path to the file. Accepts '~', '~/Documents/notes.txt', 'Documents/notes.txt' (home-relative), or an absolute path like '/home/<user>/Documents/notes.txt'."
            }
          },
          required: ['path'],
          additionalProperties: false
        }
      }
    },
    async execute(args, ctx) {
      if (!args || typeof args.path !== 'string') {
        return { ok: false, error: 'path is required.' };
      }
      const resolved = resolvePath(args.path, { base: resolveBaseForCtx(ctx) });
      console.log('[chat:tool:readFile] resolving', { input: args.path, resolved });
      try {
        const fs = await ctx.fs();
        const item = await fs.getItem(resolved);
        if (!item) return { ok: false, error: `No such file: ${resolved}` };
        if (item.type !== 'file') {
          return { ok: false, error: `Not a regular file: ${resolved}` };
        }
        if (item.contentBytes) {
          return {
            ok: false,
            error: `'${resolved}' is binary (${item.size} bytes). readFile only handles text.`
          };
        }
        return {
          ok: true,
          path: resolved,
          size: item.size,
          content: truncateForModel(item.content || '', 8000)
        };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    }
  },

  webFetch: {
    definition: {
      type: 'function',
      function: {
        name: 'webFetch',
        description:
          'Fetch a public web page or JSON URL through the site CORS proxy chain and return its text. Use this to answer questions about real-time external content.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Absolute http(s) URL to fetch.'
            },
            format: {
              type: 'string',
              enum: ['text', 'json'],
              description: "How to parse the response. Defaults to 'text' (HTML stripped)."
            }
          },
          required: ['url'],
          additionalProperties: false
        }
      }
    },
    async execute(args, ctx) {
      if (!args || typeof args.url !== 'string') {
        return { ok: false, error: 'url is required.' };
      }
      let parsed;
      try {
        parsed = new URL(args.url);
      } catch {
        return { ok: false, error: `Invalid URL: ${args.url}` };
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'Only http(s) URLs are allowed.' };
      }
      const proxy = ctx.proxy();
      if (!proxy) {
        return { ok: false, error: 'CORS proxy unavailable on this page.' };
      }
      try {
        if (args.format === 'json') {
          const data = await proxy.fetchJson(args.url, { skipDirect: false });
          return {
            ok: true,
            url: args.url,
            format: 'json',
            data: truncateForModel(data)
          };
        }
        const doc = await proxy.fetchHtml(args.url, { skipDirect: false });
        // Crude text extraction: title + visible body text, scripts removed.
        doc.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
        const title = doc.querySelector('title')?.textContent?.trim() || '';
        const bodyText = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          ok: true,
          url: args.url,
          format: 'text',
          title,
          text: truncateForModel(bodyText)
        };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    }
  },

  applyEdit: {
    definition: {
      type: 'function',
      function: {
        name: 'applyEdit',
        description:
          "Modify an EXISTING text file by applying one or more exact search/replace edits. Each edit's `search` must appear EXACTLY ONCE in the current file content (after preceding edits in the same call). Always pass `dryRun: true` (the default); the UI will show the user a diff and they must accept before anything writes. Refuses binary files. Use `createFile` for new files — applyEdit refuses to create files.",
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                "Path to an existing file. Accepts '~', '~/Documents/notes.txt', 'Documents/notes.txt' (home-relative), or absolute paths."
            },
            edits: {
              type: 'array',
              description:
                'Ordered list of edits. Each replaces an exact substring with another. Include enough surrounding context in `search` to make it unambiguous within the file. `replace` may be empty to delete.',
              items: {
                type: 'object',
                properties: {
                  search: {
                    type: 'string',
                    description: 'Exact text to find. Must occur exactly once in the current content.'
                  },
                  replace: {
                    type: 'string',
                    description: 'Replacement text. May be empty to delete the matched range.'
                  }
                },
                required: ['search', 'replace'],
                additionalProperties: false
              },
              minItems: 1
            },
            dryRun: {
              type: 'boolean',
              description:
                'When true (the default), do not write — return the proposed new content + per-edit summary so the user can preview a diff. Set to false only after the user has accepted the preview.'
            }
          },
          required: ['path', 'edits'],
          additionalProperties: false
        }
      }
    },
    async execute(args, ctx) {
      if (!args || typeof args.path !== 'string') {
        return { ok: false, error: 'path is required.' };
      }
      const placeholder = placeholderRejection(args.path, resolveBaseForCtx(ctx));
      if (placeholder) return { ok: false, error: placeholder };
      if (!Array.isArray(args.edits) || args.edits.length === 0) {
        return { ok: false, error: 'edits must be a non-empty array.' };
      }
      const dryRun = args.dryRun !== false;
      const resolved = resolvePath(args.path, { base: resolveBaseForCtx(ctx) });
      console.log('[chat:tool:applyEdit]', {
        input: args.path,
        resolved,
        editCount: args.edits.length,
        dryRun
      });

      const fs = await ctx.fs();
      const item = await fs.getItem(resolved);
      if (!item) return { ok: false, error: `No such file: ${resolved}` };
      if (item.type !== 'file') return { ok: false, error: `Not a regular file: ${resolved}` };
      if (item.contentBytes) {
        return {
          ok: false,
          error: `'${resolved}' is binary (${item.size} bytes); applyEdit only handles text.`
        };
      }

      let content = item.content || '';
      const applied = [];
      for (let i = 0; i < args.edits.length; i++) {
        const { search, replace } = args.edits[i];
        if (typeof search !== 'string' || typeof replace !== 'string') {
          return { ok: false, error: `Edit ${i}: search and replace must both be strings.` };
        }
        if (search === '') {
          return { ok: false, error: `Edit ${i}: search must be non-empty.` };
        }
        const first = content.indexOf(search);
        if (first === -1) {
          return {
            ok: false,
            error: `Edit ${i}: search text not found. Re-read the file with readFile and try again.`
          };
        }
        if (content.indexOf(search, first + 1) !== -1) {
          return {
            ok: false,
            error: `Edit ${i}: search text matches more than once. Add surrounding context to disambiguate.`
          };
        }
        content = content.slice(0, first) + replace + content.slice(first + search.length);
        applied.push({
          index: i,
          offset: first,
          searchPreview: truncateForModel(search, 120),
          replacePreview: truncateForModel(replace, 120)
        });
      }

      if (dryRun) {
        return {
          ok: true,
          path: resolved,
          dryRun: true,
          applied,
          newSize: new Blob([content]).size,
          preview: truncateForModel(content, 8000)
        };
      }

      try {
        await fs.createFile(resolved, content, true);
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
      ctx.notify(`Edited ${resolved.split('/').pop()}.`, 'success');
      return {
        ok: true,
        path: resolved,
        dryRun: false,
        applied,
        newSize: new Blob([content]).size
      };
    }
  },

  createFile: {
    definition: {
      type: 'function',
      function: {
        name: 'createFile',
        description:
          "Create a NEW text file at the given path. Refuses if the file already exists — use applyEdit to modify existing files. Always pass `dryRun: true` (the default); the UI will show the user a diff (empty → proposed content) and they must accept before anything writes. Returns the proposed content for preview when dryRun is true.",
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                "Absolute path or home-relative path for the new file (e.g. '/scripts/foo.sh', '~/notes/todo.md', 'Documents/draft.txt'). Must include a sensible filename and extension. Do NOT pass weird/random names — pick one that matches what the user asked for."
            },
            content: {
              type: 'string',
              description:
                'Full text content for the new file. May be empty. Do not include literal escape sequences like \\n — emit real newlines.'
            },
            dryRun: {
              type: 'boolean',
              description:
                'When true (the default), do not write — return the proposed content so the user can preview a diff. Set to false only after the user has accepted the preview.'
            }
          },
          required: ['path', 'content'],
          additionalProperties: false
        }
      }
    },
    async execute(args, ctx) {
      if (!args || typeof args.path !== 'string' || !args.path.trim()) {
        return { ok: false, error: 'path is required.' };
      }
      const placeholder = placeholderRejection(args.path, resolveBaseForCtx(ctx));
      if (placeholder) return { ok: false, error: placeholder };
      if (typeof args.content !== 'string') {
        return { ok: false, error: 'content is required and must be a string.' };
      }
      const dryRun = args.dryRun !== false;
      const resolved = resolvePath(args.path, { base: resolveBaseForCtx(ctx) });
      console.log('[chat:tool:createFile]', {
        input: args.path,
        resolved,
        contentSize: args.content.length,
        dryRun
      });

      const fs = await ctx.fs();
      const existing = await fs.getItem(resolved);
      if (existing) {
        return {
          ok: false,
          error: `'${resolved}' already exists (${existing.type}). Use applyEdit to modify an existing file.`
        };
      }

      if (dryRun) {
        return {
          ok: true,
          path: resolved,
          dryRun: true,
          newSize: new Blob([args.content]).size,
          preview: truncateForModel(args.content, 8000)
        };
      }

      try {
        await fs.createFile(resolved, args.content, false);
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
      ctx.notify(`Created ${resolved.split('/').pop()}.`, 'success');
      return {
        ok: true,
        path: resolved,
        dryRun: false,
        newSize: new Blob([args.content]).size
      };
    }
  },

  notify: {
    definition: {
      type: 'function',
      function: {
        name: 'notify',
        description:
          'Surface a short desktop notification to the user. Use sparingly — for example, when a long task finishes or to highlight a result the user asked you to find.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Short text, < 100 chars.' },
            kind: {
              type: 'string',
              enum: ['info', 'success', 'warn', 'error'],
              description: 'Visual style. Defaults to info.'
            }
          },
          required: ['message'],
          additionalProperties: false
        }
      }
    },
    async execute(args, ctx) {
      if (!args || typeof args.message !== 'string' || !args.message.trim()) {
        return { ok: false, error: 'message is required.' };
      }
      const text = args.message.length > 200 ? `${args.message.slice(0, 197)}…` : args.message;
      const kind = ['info', 'success', 'warn', 'error'].includes(args.kind) ? args.kind : 'info';
      ctx.notify(text, kind);
      return { ok: true };
    }
  }
};

/**
 * Return the OpenAI-shaped tool definitions array.
 *
 * @param {string[]} [toolNames]  When provided, only tools whose name
 *   appears in this array are exposed to the model. Used by hosts
 *   like Code IDE to drop irrelevant tools (`launchApp`, `notify`,
 *   etc.). When omitted (or empty), all tools are returned.
 * @returns {Array<object>}
 */
export function getToolDefinitions(toolNames) {
  const all = Object.values(TOOLS).map((t) => t.definition);
  if (!Array.isArray(toolNames) || toolNames.length === 0) return all;
  const allow = new Set(toolNames);
  return all.filter((d) => allow.has(d.function?.name));
}

/**
 * Run a tool call from the model. Always resolves — failures come back
 * as `{ ok: false, error }` so the model can recover next turn.
 *
 * @param {string} name
 * @param {string|object} args  — string when straight off the wire (we parse).
 * @param {object} ctx
 * @returns {Promise<string>} stringified result to feed back to the model
 */
export async function runTool(name, args, ctx) {
  const tool = TOOLS[name];
  if (!tool) {
    console.warn('[chat:tool] unknown tool requested', { name, available: Object.keys(TOOLS) });
    return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
  }
  let parsed = args;
  if (typeof args === 'string') {
    try {
      parsed = args ? JSON.parse(args) : {};
    } catch (err) {
      console.error('[chat:tool] failed to parse arguments', {
        name,
        rawArgs: args,
        error: err?.message
      });
      return JSON.stringify({
        ok: false,
        error: `Could not parse arguments: ${err?.message || String(err)}`
      });
    }
  }
  console.log('[chat:tool] runTool', { name, parsedArgs: parsed });
  try {
    const result = await tool.execute(parsed || {}, ctx);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    console.error('[chat:tool] execute threw', { name, error: err?.message });
    return JSON.stringify({ ok: false, error: err?.message || String(err) });
  }
}
