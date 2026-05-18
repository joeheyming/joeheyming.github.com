/**
 * Tool definitions + executors for the HeymingOS chat assistant.
 *
 * Each tool has:
 *   - `definition`: an OpenAI-shaped function schema (sent to the model).
 *   - `execute(args, ctx)`: runs in the browser, returns a JSON-able value.
 *
 * Read-leaning by design — no `writeFile`, no `runJsh` in v1. The few
 * actions we DO expose (`launchApp`, `notify`) are bounded and safe to
 * run without confirmation; the user sees them happen.
 *
 * `ctx` is provided by the chat client and exposes:
 *   - `embed`: the `os-embed` bridge (for notify / launchApp).
 *   - `notify(msg, kind?)`: local fallback notifier.
 *   - `fs`: a FileSystemDB instance (lazily initialized in the client).
 *   - `proxy`: `window.proxyService` (for webFetch).
 *   - `appsRegistry`: cached parsed apps-registry.json.
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
 *   - bare names like `Downloads` or `Documents/notes.txt` → home-relative
 *   - already-absolute paths → unchanged (minus trailing slash)
 *
 * Trailing slashes are stripped (except on the root `/`) so e.g.
 * `/home/joe/Downloads/` and `/home/joe/Downloads` index into the same
 * entry. Multiple slashes collapse.
 *
 * @param {string} input
 * @returns {string}
 */
export function resolvePath(input) {
  const home = getHome();
  let path = String(input || '').trim();
  if (!path || path === '~' || path === '~/') return home;
  if (path.startsWith('~/')) path = `${home}/${path.slice(2)}`;
  else if (!path.startsWith('/')) path = `${home}/${path}`;
  // Collapse `//` and strip trailing `/` (except root).
  path = path.replace(/\/+/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
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
      const resolved = resolvePath(args.path);
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
      const resolved = resolvePath(args.path);
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

/** @returns {Array<object>} OpenAI-shaped tools array. */
export function getToolDefinitions() {
  return Object.values(TOOLS).map((t) => t.definition);
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
