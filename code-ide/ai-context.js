/**
 * ai-context.js — builds the `toolCtx` object that the chat-side tool
 * runtime expects, but backed by Code IDE's filesystem and notifier
 * instead of HeymingOS-wide ones.
 *
 * The chat tools (`/chat/tools.js`) dispatch on a `ctx` shape:
 *   - ctx.fs() → FileSystemDB-like (getItem, createFile, readdir).
 *   - ctx.notify(msg, kind), ctx.proxy(), ctx.appsRegistry(),
 *     ctx.embed.{isEmbedded, launchApp}.
 *
 * Code IDE has its own filesystem adapters (`fs-os.js` / `fs-local.js`)
 * with a different shape: readFile, writeFile, listDir, createFile.
 * We wrap that into a FileSystemDB-shaped facade so the existing
 * `applyEdit`, `readFile`, and `listFiles` tool executors work unchanged.
 *
 * We also extend `toolCtx` with two Code-IDE-only fields:
 *   - host: 'code-ide' — picked up by chat-side system-prompt.js to
 *     emit a coding-focused prompt instead of the OS-assistant prompt.
 *   - activeFile: () => snapshot of the file the user is editing,
 *     including selection range when the user has one. Lets the
 *     system prompt include immediate code context without the model
 *     having to call readFile first.
 */

const APPS_REGISTRY_URL = '/apps-registry.json';

/**
 * Wrap a Code IDE FS adapter as a FileSystemDB-shaped object.
 *
 * @param {any} ideFs — the createOsFs / createLocalFs return value.
 */
function makeFsShim(ideFs) {
  return {
    /**
     * Stat-like probe. Returns:
     *   - `{ type: 'file', path, content, size }` if path is a file.
     *   - `{ type: 'directory', path }` if path is a real directory.
     *   - `null` if path doesn't exist.
     *
     * Implementation note: neither fs adapter exposes a real `stat()`,
     * and `listDir` is unreliable as a directory check — the local
     * memory adapter's `listDir(missingPath)` returns `[]` instead of
     * throwing, which would falsely mark every non-existent path as
     * an empty directory and break `createFile`'s "does it already
     * exist?" guard. So we do this in two passes:
     *
     *   1. `readFile(path)` — succeeds iff path is a file.
     *   2. On failure, list the PARENT and look for an entry whose
     *      name matches `baseName(path)`. The parent listing tells us
     *      whether `path` exists as a real directory or not at all.
     *
     * @param {string} path
     */
    async getItem(path) {
      try {
        const content = await ideFs.readFile(path);
        return {
          type: 'file',
          path,
          content: typeof content === 'string' ? content : '',
          size: typeof content === 'string' ? content.length : 0
        };
      } catch (err) {
        // The path is either missing OR a directory. Disambiguate via
        // the parent's listing.
        if (!path || path === '/' || path === '') {
          return { type: 'directory', path: '/' };
        }
        try {
          const parent = typeof ideFs.parentOf === 'function' ? ideFs.parentOf(path) : '/';
          const name = typeof ideFs.baseName === 'function' ? ideFs.baseName(path) : path;
          const entries = await ideFs.listDir(parent || '/');
          const match = Array.isArray(entries) ? entries.find((e) => e.name === name) : null;
          if (match) {
            return match.isDirectory
              ? { type: 'directory', path }
              : {
                  type: 'file',
                  path,
                  content: '',
                  size: typeof match.size === 'number' ? match.size : 0
                };
          }
        } catch {
          // Parent doesn't exist either — fall through to null.
        }
        return null;
      }
    },

    /**
     * @param {string} path
     * @param {string} content
     * @param {boolean} [_overwrite]
     */
    async createFile(path, content, _overwrite = false) {
      // Prefer the adapter's real createFile when present (the local
      // adapter has one; the OS adapter falls back to writeFile).
      if (typeof ideFs.createFile === 'function') {
        try {
          await ideFs.createFile(path, content);
          return;
        } catch {
          // Some create implementations refuse on conflict; defer to
          // writeFile which is create-or-overwrite everywhere.
        }
      }
      await ideFs.writeFile(path, content);
    },

    /** @param {string} path */
    async readdir(path) {
      const entries = await ideFs.listDir(path);
      return entries.map((e) => ({
        name: e.name,
        type: e.isDirectory ? 'directory' : 'file',
        size: e.size != null ? e.size : 0
      }));
    }
  };
}

/**
 * Build the toolCtx for a Code IDE AI session.
 *
 * @param {{
 *   ide: any,                  — the CodeIDE instance (uses ide.fs, ide.toast, ide.host).
 *   isEmbedded: boolean,       — true when running inside HeymingOS.
 *   getActiveFile: () => object | null
 * }} opts
 */
export function createIdeToolCtx(opts) {
  const { ide, isEmbedded, getActiveFile } = opts;

  let _fsShim = null;
  let _appsPromise = null;

  return {
    host: 'code-ide',

    // Whitelist the tools that make sense inside an editor. Drops
    // launchApp (would navigate away from the IDE), notify (we have
    // ide.toast), webFetch (not relevant for editing), listApps
    // (irrelevant). Keeps the file-oriented tools.
    toolNames: ['applyEdit', 'createFile', 'readFile', 'listFiles'],

    embed: {
      isEmbedded: !!isEmbedded,
      // launchApp is a no-op inside Code IDE — opening another app
      // would navigate the iframe and lose the user's editor state.
      // We deliberately keep `isEmbedded` true so chat-client.js's
      // intent detection and tool surface still know we have a host;
      // we just refuse the navigation.
      launchApp() {
        return false;
      }
    },

    notify(msg, kind) {
      try {
        ide?.toast?.(String(msg || ''), kind || 'info');
      } catch (err) {
        console.warn('[code-ide:ai] notify threw', err);
      }
    },

    proxy() {
      return /** @type {any} */ (window).proxyService || null;
    },

    appsRegistry() {
      if (!_appsPromise) {
        _appsPromise = fetch(APPS_REGISTRY_URL)
          .then((r) => r.json())
          .catch((err) => {
            console.warn('[code-ide:ai] apps-registry fetch failed', err);
            return [];
          });
      }
      return _appsPromise;
    },

    fs() {
      if (!_fsShim) _fsShim = makeFsShim(ide.fs);
      return _fsShim;
    },

    /**
     * Workspace root for relative-path resolution and prompt context.
     * - Standalone code-ide: '/' (the in-memory project root).
     * - OS-embedded code-ide: typically '/home/<user>/Documents' (whatever
     *   `ide.fs.root` returns).
     * Chat-side tools.js uses this to resolve bare paths against the
     * IDE workspace instead of the OS home directory.
     */
    workspaceRoot() {
      const root = ide?.fs?.root;
      return typeof root === 'string' && root ? root : '/';
    },

    activeFile() {
      try {
        return getActiveFile() || null;
      } catch (err) {
        console.warn('[code-ide:ai] getActiveFile threw', err);
        return null;
      }
    },

    /**
     * Snapshot of the workspace, used by the IDE system prompt so the
     * model picks paths that fit the existing project. Returns a
     * compact ASCII tree (root + first-level subdirs only) or null
     * on failure. Best-effort — the prompt builder is OK with null.
     *
     * @returns {Promise<string | null>}
     */
    async projectTree() {
      try {
        return await snapshotProjectTree(ide.fs);
      } catch (err) {
        console.warn('[code-ide:ai] projectTree snapshot failed', err);
        return null;
      }
    }
  };
}

/**
 * Build a compact ASCII listing of the project root and one level of
 * subdirectories, plus their immediate children. Caps the total
 * output at MAX_TREE_LINES so a huge workspace doesn't dominate the
 * model's context window.
 *
 * @param {any} ideFs
 * @returns {Promise<string>}
 */
export async function snapshotProjectTree(ideFs) {
  if (!ideFs || typeof ideFs.listDir !== 'function') return '';
  const MAX_TREE_LINES = 60;
  const MAX_PER_DIR = 25;
  const out = [];
  let truncated = false;

  const root = await safeListDir(ideFs, '/');
  if (!root || root.length === 0) return '(empty workspace)';

  out.push('/');
  for (let i = 0; i < root.length && i < MAX_PER_DIR; i += 1) {
    const entry = root[i];
    if (out.length >= MAX_TREE_LINES) {
      truncated = true;
      break;
    }
    const tag = entry.isDirectory ? '/' : '';
    out.push(`├── ${entry.name}${tag}`);
    if (entry.isDirectory) {
      const childPath = entry.path || `/${entry.name}`;
      const children = await safeListDir(ideFs, childPath);
      if (Array.isArray(children) && children.length > 0) {
        for (let j = 0; j < children.length && j < MAX_PER_DIR; j += 1) {
          if (out.length >= MAX_TREE_LINES) {
            truncated = true;
            break;
          }
          const child = children[j];
          out.push(`│   ├── ${child.name}${child.isDirectory ? '/' : ''}`);
        }
        if (children.length > MAX_PER_DIR) {
          out.push(`│   └── … ${children.length - MAX_PER_DIR} more`);
        }
      }
    }
  }
  if (root.length > MAX_PER_DIR) {
    out.push(`└── … ${root.length - MAX_PER_DIR} more`);
  } else if (truncated) {
    out.push('└── …');
  }
  return out.join('\n');
}

async function safeListDir(ideFs, path) {
  try {
    const items = await ideFs.listDir(path);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/**
 * Apply an array of search/replace edits (the `edits` arg from the
 * applyEdit tool) to a string and return the result. Mirrors the
 * exact-match-once semantics of `chat/tools.js`'s applyEdit. Used by
 * the IDE host when intercepting a dry-run result so we can render
 * the FULL proposed content (the tool's `preview` field is truncated
 * to 8000 chars to fit the model's context window — the host wants
 * the untruncated version for the diff).
 *
 * Returns `{ ok: true, content }` on success, or
 * `{ ok: false, error }` when an edit doesn't match cleanly.
 *
 * @param {string} originalContent
 * @param {Array<{ search: string, replace: string }>} edits
 */
export function reapplyEditsLocally(originalContent, edits) {
  if (typeof originalContent !== 'string') {
    return { ok: false, error: 'original content unavailable' };
  }
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, error: 'no edits to apply' };
  }
  let content = originalContent;
  for (let i = 0; i < edits.length; i += 1) {
    const { search, replace } = edits[i] || {};
    if (typeof search !== 'string' || typeof replace !== 'string') {
      return { ok: false, error: `edit ${i}: search/replace must be strings` };
    }
    if (search === '') {
      return { ok: false, error: `edit ${i}: search is empty` };
    }
    const first = content.indexOf(search);
    if (first === -1) {
      return { ok: false, error: `edit ${i}: search not found` };
    }
    if (content.indexOf(search, first + 1) !== -1) {
      return { ok: false, error: `edit ${i}: search matches more than once` };
    }
    content = content.slice(0, first) + replace + content.slice(first + search.length);
  }
  return { ok: true, content };
}

/**
 * Walk a chat-history array (mutated in place by runChatTurn) and pull
 * out the most recent write-tool dry-run result — either an
 * `applyEdit` (modify existing file) or `createFile` (write new
 * file). Returns the full-fidelity proposal:
 *
 *   - For applyEdit: re-apply the model's original search/replace
 *     edits to the current Monaco buffer locally, so the diff view
 *     shows the entire proposed file even if the tool's `preview`
 *     field was truncated to 8000 chars for the model's context.
 *   - For createFile: the proposed `content` straight from the tool
 *     args, with `original` set to '' (so the diff renders as an
 *     empty-→-content view). The IDE host can decorate the bar with
 *     a "create" affordance.
 *
 * Returns null if there's no write proposal in the history.
 *
 * @param {Array<object>} history
 * @param {(path: string) => string | null} readBuffer  Returns the
 *   current Monaco-side content for a path, or null if not open.
 * @returns {{
 *   kind: 'edit' | 'create',
 *   path: string,
 *   original: string,
 *   proposed: string,
 *   editCount: number
 * } | null}
 */
export function pickLastWriteProposal(history, readBuffer) {
  // Trace every skip reason. Without this, "tool returned ok:true
  // but no diff appeared" is invisible — there are 7+ ways this
  // function can silently return null. Every continue/return below
  // is now a console log so the user can grep the console for
  // [code-ide:ai:pick] and see exactly which seam dropped the
  // proposal.
  const writeTools = history.filter(
    (m) => m.role === 'tool' && (m.name === 'applyEdit' || m.name === 'createFile')
  );
  console.log('[code-ide:ai:pick] scanning history for write proposal', {
    historyLength: history.length,
    writeToolMessageCount: writeTools.length
  });

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = /** @type {any} */ (history[i]);
    if (m.role !== 'tool') continue;
    if (m.name !== 'applyEdit' && m.name !== 'createFile') continue;

    let toolResult;
    try {
      toolResult = JSON.parse(m.content);
    } catch {
      console.warn('[code-ide:ai:pick] skipping tool message — content not JSON', {
        historyIdx: i,
        name: m.name,
        contentPreview: String(m.content || '').slice(0, 120)
      });
      continue;
    }
    if (!toolResult || !toolResult.ok) {
      console.log('[code-ide:ai:pick] skipping tool result — ok=false', {
        historyIdx: i,
        name: m.name,
        error: toolResult && toolResult.error ? String(toolResult.error).slice(0, 200) : null
      });
      continue;
    }
    if (!toolResult.dryRun) {
      console.log('[code-ide:ai:pick] skipping tool result — already written (dryRun=false)', {
        historyIdx: i,
        name: m.name,
        path: toolResult.path
      });
      continue;
    }

    const callId = m.tool_call_id;
    const callArgs = findToolCallArgs(history, i, callId);
    if (!callArgs) {
      console.warn('[code-ide:ai:pick] skipping — no matching assistant.tool_calls entry', {
        historyIdx: i,
        name: m.name,
        callId
      });
      continue;
    }
    if (typeof callArgs.path !== 'string') {
      console.warn('[code-ide:ai:pick] skipping — callArgs.path is not a string', {
        historyIdx: i,
        name: m.name,
        callArgsKeys: Object.keys(callArgs)
      });
      continue;
    }

    if (m.name === 'createFile') {
      const proposed =
        typeof callArgs.content === 'string'
          ? callArgs.content
          : typeof toolResult.preview === 'string'
          ? toolResult.preview
          : '';
      console.log('[code-ide:ai:pick] picked createFile proposal', {
        path: callArgs.path,
        proposedSize: proposed.length,
        contentSource:
          typeof callArgs.content === 'string'
            ? 'callArgs.content'
            : typeof toolResult.preview === 'string'
            ? 'toolResult.preview'
            : 'empty'
      });
      return {
        kind: 'create',
        path: callArgs.path,
        original: '',
        proposed,
        editCount: 1
      };
    }

    // applyEdit
    if (!Array.isArray(callArgs.edits)) {
      console.warn('[code-ide:ai:pick] skipping — applyEdit callArgs.edits not an array', {
        historyIdx: i,
        callArgsKeys: Object.keys(callArgs)
      });
      continue;
    }
    const original = readBuffer(callArgs.path);
    if (typeof original !== 'string') {
      console.warn(
        '[code-ide:ai:pick] skipping — applyEdit target not loaded in editor (readBuffer returned non-string)',
        { path: callArgs.path }
      );
      continue;
    }

    const replayed = reapplyEditsLocally(original, callArgs.edits);
    if (!replayed.ok) {
      if (typeof toolResult.preview === 'string') {
        console.warn(
          '[code-ide:ai:pick] applyEdit local replay failed — falling back to truncated preview',
          { path: callArgs.path, replayError: replayed.error }
        );
        return {
          kind: 'edit',
          path: callArgs.path,
          original,
          proposed: toolResult.preview,
          editCount: callArgs.edits.length
        };
      }
      console.warn(
        '[code-ide:ai:pick] skipping — applyEdit local replay failed and no preview fallback',
        { path: callArgs.path, replayError: replayed.error }
      );
      continue;
    }
    console.log('[code-ide:ai:pick] picked applyEdit proposal', {
      path: callArgs.path,
      editCount: callArgs.edits.length,
      proposedSize: replayed.content.length
    });
    return {
      kind: 'edit',
      path: callArgs.path,
      original,
      proposed: replayed.content,
      editCount: callArgs.edits.length
    };
  }
  console.log('[code-ide:ai:pick] no write proposal found in history');
  return null;
}

// Back-compat alias — earlier internal call sites used the
// applyEdit-only name. Will be removed once the migration is in.
export const pickLastApplyEditProposal = pickLastWriteProposal;

function findToolCallArgs(history, toolMsgIdx, callId) {
  for (let j = toolMsgIdx - 1; j >= 0; j -= 1) {
    const am = /** @type {any} */ (history[j]);
    if (am.role !== 'assistant' || !Array.isArray(am.tool_calls)) continue;
    for (const tc of am.tool_calls) {
      if (tc.id !== callId) continue;
      try {
        return JSON.parse(tc.function.arguments);
      } catch (err) {
        console.warn(
          '[code-ide:ai:pick] findToolCallArgs: tool_calls arguments not valid JSON',
          { callId, error: err && err.message, argsPreview: String(tc.function?.arguments).slice(0, 200) }
        );
        return null;
      }
    }
  }
  return null;
}

/**
 * Snapshot the currently-active editor buffer + Monaco selection into
 * the shape buildSystemPrompt expects.
 *
 * @param {any} ide
 * @param {{ includeContent?: boolean, includeSelection?: boolean }} [opts]
 * @returns {{ path: string, language: string, content?: string, selection?: object } | null}
 */
export function snapshotActiveFile(ide, opts = {}) {
  const includeContent = opts.includeContent !== false;
  const includeSelection = opts.includeSelection !== false;

  if (!ide || !ide.activePath || !ide.host) return null;
  const path = ide.activePath;
  const language = ide.host.getLanguage(path);

  /** @type {any} */
  const out = { path, language };

  if (includeContent) {
    out.content = ide.host.getValue(path);
  }

  if (includeSelection) {
    const editor = ide.host.editor;
    const sel = editor && editor.getSelection ? editor.getSelection() : null;
    if (sel && !sel.isEmpty()) {
      const model = editor.getModel ? editor.getModel() : null;
      const text = model ? model.getValueInRange(sel) : '';
      out.selection = {
        text,
        range: {
          startLine: sel.startLineNumber,
          startColumn: sel.startColumn,
          endLine: sel.endLineNumber,
          endColumn: sel.endColumn
        }
      };
    }
  }

  return out;
}
