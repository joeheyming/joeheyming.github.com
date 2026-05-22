/**
 * editor.js — Monaco bootstrap, language detection, model registry, theme,
 * Vim-mode integration. The rest of the app interacts with Monaco only via
 * this module.
 */

const MONACO_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.46.0/min/vs';

// Filename / extension → Monaco language id.
const LANG_BY_EXT = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  txt: 'plaintext',
  log: 'plaintext'
};

const SPECIAL_NAMES = {
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  '.gitignore': 'plaintext',
  '.env': 'shell'
};

export function detectLanguage(filename) {
  if (!filename) return 'plaintext';
  const base = filename.split('/').pop();
  if (SPECIAL_NAMES[base]) return SPECIAL_NAMES[base];
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
  return LANG_BY_EXT[ext] || 'plaintext';
}

/** Map a Monaco language id to a Prettier parser name (or null). */
export function prettierParserFor(language) {
  switch (language) {
    case 'javascript':
      return 'babel';
    case 'typescript':
      return 'typescript';
    case 'json':
      return 'json';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'html':
    case 'xml':
      return 'html';
    case 'markdown':
      return 'markdown';
    default:
      return null;
  }
}

/**
 * Configure the AMD loader, load Monaco core + (lazily) monaco-vim.
 */
export async function loadMonaco() {
  await new Promise((resolve) => {
    if (window.monaco) {
      resolve();
      return;
    }
    // Wait for the AMD `require` shipped by loader.js to be available.
    const tick = () => {
      if (window.require) resolve();
      else setTimeout(tick, 16);
    };
    tick();
  });

  if (!window.monaco) {
    window.require.config({
      paths: {
        vs: MONACO_BASE
      }
    });

    await new Promise((resolve, reject) => {
      window.require(
        ['vs/editor/editor.main'],
        () => resolve(),
        (err) => reject(err)
      );
    });
  }

  return window.monaco;
}

/**
 * Lazily load monaco-vim. Returns the module which exposes `initVimMode`.
 *
 * monaco-vim ships a UMD bundle that declares AMD deps on
 * `vs/editor/editor.main` (and `vs/editor/common/commands/shiftCommand`,
 * which is part of the same package), both of which are already registered
 * with the Monaco AMD loader.
 */
export async function loadMonacoVim() {
  await loadMonaco();
  return new Promise((resolve, reject) => {
    window.require.config({
      paths: {
        'monaco-vim': 'https://unpkg.com/monaco-vim@0.4.1/dist/monaco-vim'
      }
    });
    window.require(['monaco-vim'], (m) => resolve(m), reject);
  });
}

const FILE_THEMES = ['vs', 'vs-dark', 'hc-black'];

export class EditorHost {
  constructor(container, options = {}) {
    this.container = container;
    this.monaco = null;
    this.editor = null;
    this.diffEditor = null;
    this.models = new Map(); // path -> { model, viewState, dirty, baseline }
    this.activePath = null;
    this.themeName = options.theme || 'vs-dark';
    this.vim = null;
    this.vimEnabled = false;
    this.cursorListeners = new Set();
    this.modelChangeListeners = new Set();
  }

  async init(diffContainer) {
    this.monaco = await loadMonaco();
    this.diffContainer = diffContainer || null;

    this.editor = this.monaco.editor.create(this.container, {
      value: '',
      language: 'plaintext',
      theme: this.themeName,
      automaticLayout: true,
      fontSize: 14,
      fontFamily:
        '"JetBrains Mono", "Fira Code", Menlo, Monaco, "Cascadia Mono", Consolas, monospace',
      fontLigatures: true,
      minimap: { enabled: true, scale: 1 },
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true },
      tabSize: 2,
      renderWhitespace: 'selection',
      wordWrap: 'off'
    });

    this.editor.onDidChangeCursorPosition(() => this.fireCursor());
    this.editor.onDidChangeModelContent(() => this.fireDirty());

    return this.editor;
  }

  /**
   * Register an editor-scoped action. Keybindings only fire when the
   * editor has focus, which is exactly what we want for things like
   * Cmd+K (we don't want it firing while the user is typing in the
   * tree's rename input). Registers on the live Monaco editor; safe
   * to call after `init`.
   *
   * @param {{
   *   id: string,
   *   label: string,
   *   keybindings?: number[],
   *   run: (editor: any) => void
   * }} spec
   */
  addEditorAction(spec) {
    if (!this.editor || !this.monaco) return null;
    return this.editor.addAction({
      id: spec.id,
      label: spec.label,
      keybindings: spec.keybindings || [],
      contextMenuGroupId: 'modification',
      contextMenuOrder: 1.5,
      run: (ed) => {
        try {
          spec.run(ed);
        } catch (err) {
          console.warn(`[code-ide] action ${spec.id} threw`, err);
        }
      }
    });
  }

  /**
   * Convenience getter that exposes Monaco's `KeyMod` / `KeyCode`
   * enums so callers can build keybindings without re-importing
   * monaco. Available after `init`.
   */
  keyConsts() {
    if (!this.monaco) return null;
    return { KeyMod: this.monaco.KeyMod, KeyCode: this.monaco.KeyCode };
  }

  /**
   * Show a side-by-side diff in the main editor area. Replaces the editor's
   * visible model with a Monaco diff editor backed by ephemeral models. Returns
   * the diff editor instance so callers can dispose models if needed.
   */
  showMainDiff(leftValue, rightValue, language, leftTitle, rightTitle) {
    if (!this.diffContainer) {
      console.error(
        '[code-ide:editor] showMainDiff called but diffContainer is missing — ' +
          'EditorHost was never .init()ed with a diff host element. The AI diff cannot mount.'
      );
      return null;
    }
    if (!this.monaco) {
      console.error(
        '[code-ide:editor] showMainDiff called but Monaco is not loaded yet — ' +
          'EditorHost.init() must finish before requesting a diff.'
      );
      return null;
    }
    if (!this.mainDiff) {
      this.mainDiff = this.monaco.editor.createDiffEditor(this.diffContainer, {
        readOnly: false,
        automaticLayout: true,
        renderSideBySide: true,
        theme: this.themeName,
        minimap: { enabled: false }
      });
    } else {
      this.monaco.editor.setTheme(this.themeName);
    }

    const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9_.\-/]/g, '_');
    const leftUri = this.monaco.Uri.parse(`inmemory:/__main_diff/L/${safe(leftTitle)}`);
    const rightUri = this.monaco.Uri.parse(`inmemory:/__main_diff/R/${safe(rightTitle)}`);

    const cur = this.mainDiff.getModel() || {};
    if (cur.original && !cur.original.isDisposed()) cur.original.dispose();
    if (cur.modified && !cur.modified.isDisposed()) cur.modified.dispose();

    this.mainDiff.setModel({
      original: this.monaco.editor.createModel(leftValue, language, leftUri),
      modified: this.monaco.editor.createModel(rightValue, language, rightUri)
    });

    this.container.style.visibility = 'hidden';
    this.diffContainer.hidden = false;
    return this.mainDiff;
  }

  hideMainDiff() {
    this.container.style.visibility = '';
    if (this.diffContainer) this.diffContainer.hidden = true;
  }

  setTheme(name) {
    this.themeName = name;
    this.monaco.editor.setTheme(name);
    document.body.classList.toggle('theme-light', name === 'vs');
    document.body.classList.toggle('theme-dark', name !== 'vs');
  }

  cycleTheme() {
    const idx = FILE_THEMES.indexOf(this.themeName);
    const next = FILE_THEMES[(idx + 1) % FILE_THEMES.length];
    this.setTheme(next);
    return next;
  }

  hasModel(path) {
    return this.models.has(path);
  }

  /**
   * Create or fetch a model for a given path/content/language.
   */
  openModel(path, content, language) {
    let entry = this.models.get(path);
    if (!entry) {
      const uri = this.monaco.Uri.parse('inmemory:/' + path.replace(/^\/+/, ''));
      const existing = this.monaco.editor.getModel(uri);
      const model =
        existing && !existing.isDisposed()
          ? existing
          : this.monaco.editor.createModel(content, language || detectLanguage(path), uri);
      if (existing && model.getValue() !== content) model.setValue(content);
      entry = { model, viewState: null, dirty: false, baseline: content };
      this.models.set(path, entry);
    }
    return entry;
  }

  /**
   * Switch the editor to the given model.
   */
  setActive(path) {
    if (this.activePath && this.activePath !== path) {
      const prev = this.models.get(this.activePath);
      if (prev) prev.viewState = this.editor.saveViewState();
    }
    const entry = this.models.get(path);
    if (!entry) return;
    this.editor.setModel(entry.model);
    if (entry.viewState) this.editor.restoreViewState(entry.viewState);
    this.editor.focus();
    this.activePath = path;
    this.fireCursor();
    this.fireDirty();
  }

  closeModel(path) {
    const entry = this.models.get(path);
    if (!entry) return;
    this.models.delete(path);
    if (this.activePath === path) {
      this.activePath = null;
      this.editor.setModel(null);
    }
    if (!entry.model.isDisposed()) entry.model.dispose();
  }

  renameModel(oldPath, newPath) {
    const entry = this.models.get(oldPath);
    if (!entry) return;
    this.models.delete(oldPath);
    this.models.set(newPath, entry);
    if (this.activePath === oldPath) this.activePath = newPath;
  }

  isDirty(path) {
    const entry = this.models.get(path);
    return !!entry && entry.model.getValue() !== entry.baseline;
  }

  markSaved(path) {
    const entry = this.models.get(path);
    if (!entry) return;
    entry.baseline = entry.model.getValue();
    this.fireDirty();
  }

  getValue(path) {
    const entry = this.models.get(path);
    return entry ? entry.model.getValue() : '';
  }

  setValue(path, content) {
    const entry = this.models.get(path);
    if (!entry) return;
    if (entry.model.getValue() !== content) entry.model.setValue(content);
    entry.baseline = content;
    this.fireDirty();
  }

  getLanguage(path) {
    const entry = this.models.get(path);
    return entry ? entry.model.getLanguageId() : 'plaintext';
  }

  setLanguage(path, language) {
    const entry = this.models.get(path);
    if (!entry) return;
    this.monaco.editor.setModelLanguage(entry.model, language);
  }

  getCursor() {
    const pos = this.editor?.getPosition();
    return pos ? { line: pos.lineNumber, column: pos.column } : { line: 1, column: 1 };
  }

  /** Format the current model with Monaco's built-in formatter. */
  async formatCurrent() {
    if (!this.editor) return;
    await this.editor.getAction('editor.action.formatDocument').run();
  }

  // --- Vim integration ---

  async enableVim(statusEl) {
    if (this.vimEnabled) return;
    const MonacoVim = await loadMonacoVim();
    this.vim = MonacoVim.initVimMode(this.editor, statusEl);
    this.vimEnabled = true;
  }

  disableVim() {
    if (!this.vimEnabled) return;
    try {
      this.vim?.dispose?.();
    } catch (err) {
      console.warn('[code-ide] dispose vim', err);
    }
    this.vim = null;
    this.vimEnabled = false;
  }

  async toggleVim(statusEl) {
    if (this.vimEnabled) {
      this.disableVim();
      return false;
    }
    await this.enableVim(statusEl);
    return true;
  }

  // --- Events ---

  onCursor(fn) {
    this.cursorListeners.add(fn);
    return () => this.cursorListeners.delete(fn);
  }

  onDirty(fn) {
    this.modelChangeListeners.add(fn);
    return () => this.modelChangeListeners.delete(fn);
  }

  fireCursor() {
    for (const fn of this.cursorListeners) fn(this.getCursor());
  }

  fireDirty() {
    for (const fn of this.modelChangeListeners) fn();
  }
}
