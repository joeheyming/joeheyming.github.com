import {
  initGoogleAuth,
  isOAuthUserCancelledError,
  requestAccessToken,
  getCachedAccessToken,
  getStoredSpreadsheetId,
  clearAccessToken
} from '../google-db/google-auth.js';
import { openSiteDatabase } from '../google-db/site-database.js';
import { createGoogleSheetClient, isTodoDoneValue } from './todo-sheets.js';

/** Todo row emoji controls (match list toolbar styling). */
const TW_BTN_EMOJI =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg shadow-sm transition hover:border-violet-400 hover:bg-violet-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:border-violet-500 dark:hover:bg-violet-950/50';
const TW_BTN_EMOJI_DANGER =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg shadow-sm transition hover:border-rose-400 hover:bg-rose-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:border-rose-500 dark:hover:bg-rose-950/40';

const TODO_TAB_PREFIX = 'todo-app-';
const DEFAULT_LIST_DISPLAY_NAME = 'Tasks';
const DEFAULT_FULL_SHEET_TITLE = `${TODO_TAB_PREFIX}${DEFAULT_LIST_DISPLAY_NAME}`;

const LS_SHEET_NAME = 'todo.sheetName';

const MAX_LIST_DISPLAY_LEN = 100 - TODO_TAB_PREFIX.length;

const INVALID_LIST_NAME_CHARS = new Set(['[', ']', '\\', '/', '?', ':', '*']);

function sanitizeListDisplayName(raw) {
  const trimmed = raw.trim();
  let out = '';
  for (let i = 0; i < trimmed.length && out.length < MAX_LIST_DISPLAY_LEN; i++) {
    const c = trimmed[i];
    if (!INVALID_LIST_NAME_CHARS.has(c)) {
      out += c;
    }
  }
  return out;
}

function fullTitleFromUserListName(userInput) {
  const d = sanitizeListDisplayName(userInput);
  if (!d) {
    throw new Error('List name is invalid or empty.');
  }
  return TODO_TAB_PREFIX + d;
}

function displayNameFromFullTitle(full) {
  if (!full.startsWith(TODO_TAB_PREFIX)) {
    return full;
  }
  const rest = full.slice(TODO_TAB_PREFIX.length);
  return rest || full;
}

function loadStoredTabName() {
  try {
    return localStorage.getItem(LS_SHEET_NAME) || '';
  } catch {
    return '';
  }
}

function saveStoredTabName(fullTitle) {
  try {
    localStorage.setItem(LS_SHEET_NAME, fullTitle || DEFAULT_FULL_SHEET_TITLE);
  } catch {
    /* quota / private mode */
  }
}

function getEffectiveSheetName() {
  const fromLs = loadStoredTabName().trim();
  if (fromLs && fromLs.startsWith(TODO_TAB_PREFIX)) {
    return fromLs;
  }
  return DEFAULT_FULL_SHEET_TITLE;
}

function waitForGoogle() {
  return new Promise((resolve) => {
    if (globalThis.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const id = setInterval(() => {
      if (globalThis.google?.accounts?.oauth2) {
        clearInterval(id);
        resolve();
      }
    }, 30);
  });
}

const STATUS_TEXT_BASE = 'min-w-0 flex-1 break-words text-right empty:hidden text-xs sm:text-sm';

function setStatus(el, text, isError = false) {
  const s = typeof text === 'string' ? text.trim() : String(text);
  el.textContent = s;
  el.className = isError
    ? `${STATUS_TEXT_BASE} text-red-600 dark:text-red-400`
    : `${STATUS_TEXT_BASE} text-zinc-500 dark:text-zinc-400`;
}

/**
 * Clones dialog `<template>`s from `index.html` and appends them to `document.body`.
 * @returns {Record<string, HTMLElement>}
 */
function injectDialogs() {
  const tplRename = document.getElementById('tpl-rename-dialog');
  const tplAddList = document.getElementById('tpl-add-list-dialog');
  const tplRemoveList = document.getElementById('tpl-remove-list-dialog');
  if (!tplRename?.content || !tplAddList?.content || !tplRemoveList?.content) {
    throw new Error(
      'Missing dialog templates (tpl-rename-dialog, tpl-add-list-dialog, tpl-remove-list-dialog).'
    );
  }

  const renameDialog = /** @type {HTMLDialogElement} */ (
    tplRename.content.firstElementChild.cloneNode(true)
  );
  const addListDialog = /** @type {HTMLDialogElement} */ (
    tplAddList.content.firstElementChild.cloneNode(true)
  );
  const removeListDialog = /** @type {HTMLDialogElement} */ (
    tplRemoveList.content.firstElementChild.cloneNode(true)
  );
  document.body.append(renameDialog, addListDialog, removeListDialog);

  return {
    renameDialog,
    renameInput: /** @type {HTMLInputElement} */ (
      renameDialog.querySelector('#rename-dialog-input')
    ),
    renameBtnOk: renameDialog.querySelector('[data-rename="ok"]'),
    renameBtnCancel: renameDialog.querySelector('[data-rename="cancel"]'),
    addListDialog,
    listPromptMessage: /** @type {HTMLParagraphElement} */ (
      addListDialog.querySelector('#add-list-prompt-message')
    ),
    listNameInput: /** @type {HTMLInputElement} */ (
      addListDialog.querySelector('#add-list-prompt-input')
    ),
    listAddBtnOk: /** @type {HTMLButtonElement} */ (
      addListDialog.querySelector('[data-add-list="ok"]')
    ),
    listAddBtnCancel: addListDialog.querySelector('[data-add-list="cancel"]'),
    removeListDialog,
    removeListNameEl: /** @type {HTMLElement} */ (
      removeListDialog.querySelector('#remove-list-name')
    ),
    removeListBtnOk: removeListDialog.querySelector('[data-remove-list="ok"]'),
    removeListBtnCancel: removeListDialog.querySelector('[data-remove-list="cancel"]')
  };
}

function wireBackdropClose(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      dialog.close();
    }
  });
}

function main() {
  const {
    renameDialog,
    renameInput,
    renameBtnOk,
    renameBtnCancel,
    addListDialog,
    listPromptMessage,
    listNameInput,
    listAddBtnOk,
    listAddBtnCancel,
    removeListDialog,
    removeListNameEl,
    removeListBtnOk,
    removeListBtnCancel
  } = injectDialogs();
  wireBackdropClose(renameDialog);
  wireBackdropClose(addListDialog);
  wireBackdropClose(removeListDialog);

  const statusEl = document.getElementById('status');
  const todoAppRoot = document.getElementById('todo-app-root');
  const appLoadingEl = document.getElementById('app-loading');
  const appLoadingMessageEl = document.getElementById('app-loading-message');
  const signedOutEmpty = document.getElementById('signed-out-empty');
  const authCard = document.getElementById('auth-card');
  const btnSignin = document.getElementById('btn-signin');
  const btnSignout = document.getElementById('btn-signout');
  const sheetTabSelect = document.getElementById('sheet-tab-select');
  const btnOpenAddList = document.getElementById('btn-open-add-list');
  const btnRemoveList = document.getElementById('btn-remove-list');
  const btnOpenRename = document.getElementById('btn-open-rename');
  const todoPanel = document.getElementById('todo-panel');
  const newTitle = document.getElementById('new-title');
  const btnAdd = document.getElementById('btn-add');
  const todoList = document.getElementById('todo-list');
  const todoEmpty = document.getElementById('todo-empty');
  const signedOutTitleEl = document.getElementById('signed-out-empty-title');
  const signedOutBodyEl = document.getElementById('signed-out-empty-body');

  let client = null;
  /** @type {import('../google-db/site-database.js').SiteDatabase | null} */
  let siteDb = null;
  let tabSelectSilence = false;
  /** @type {string | null} id of the row in inline edit mode */
  let editingTodoId = null;

  async function getAccessToken() {
    let t = getCachedAccessToken();
    if (t) {
      return t;
    }
    await requestAccessToken({ prompt: '' });
    t = getCachedAccessToken();
    if (!t) {
      throw new Error('No access token');
    }
    return t;
  }

  function setAppLoadingMessage(text) {
    if (appLoadingMessageEl && typeof text === 'string') {
      appLoadingMessageEl.textContent = text;
    }
  }

  /**
   * Full-width loading state while Google APIs run (avoids looking “signed out”).
   * @param {boolean} loading
   * @param {string} [message] — defaults to “Connecting to Google…”
   */
  function setAppLoading(loading, message) {
    if (!appLoadingEl) {
      return;
    }
    if (loading) {
      const text =
        typeof message === 'string' && message.trim() !== ''
          ? message.trim()
          : 'Connecting to Google…';
      setAppLoadingMessage(text);
      appLoadingEl.hidden = false;
      todoAppRoot?.setAttribute('aria-busy', 'true');
      if (signedOutEmpty) {
        signedOutEmpty.hidden = true;
      }
      todoPanel.hidden = true;
      if (authCard) {
        authCard.hidden = true;
      }
    } else {
      appLoadingEl.hidden = true;
      todoAppRoot?.setAttribute('aria-busy', 'false');
    }
  }

  function refreshSignedOutEmptyCopy() {
    const hasWorkbook = getStoredSpreadsheetId().length > 0;
    if (signedOutTitleEl) {
      signedOutTitleEl.textContent = hasWorkbook ? 'Sign in to reconnect' : 'You’re signed out';
    }
    if (signedOutBodyEl) {
      signedOutBodyEl.textContent = hasWorkbook
        ? 'This browser has a saved spreadsheet link. Sign in with Google to open it and load your lists.'
        : 'Sign in with Google to open your spreadsheet and load your lists.';
    }
    if (signedOutEmpty) {
      signedOutEmpty.setAttribute(
        'aria-label',
        hasWorkbook ? 'Reconnect to spreadsheet' : 'Signed out'
      );
    }
  }

  function setConnectedUi(connected) {
    if (!connected) {
      refreshSignedOutEmptyCopy();
    }
    if (signedOutEmpty) {
      signedOutEmpty.hidden = connected;
    }
    todoPanel.hidden = !connected;
    if (authCard) {
      authCard.hidden = !connected;
    }
  }

  async function refreshTodos() {
    if (!client) {
      return;
    }
    const todos = await client.listTodos();
    todoList.replaceChildren();
    if (!todos.length) {
      editingTodoId = null;
      todoEmpty.hidden = false;
      return;
    }
    todoEmpty.hidden = true;
    if (editingTodoId && !todos.some((t) => t.id === editingTodoId)) {
      editingTodoId = null;
    }
    for (const todo of todos) {
      const li = document.createElement('li');
      li.className = 'flex flex-nowrap items-center gap-3 py-2.5';

      const rowActions = document.createElement('div');
      rowActions.className = 'flex shrink-0 flex-nowrap items-center gap-1';

      if (todo.id === editingTodoId) {
        const editWrap = document.createElement('div');
        editWrap.className = 'flex min-w-0 flex-1 flex-nowrap items-center gap-2';
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className =
          'min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-base focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-violet-500';
        inp.id = `todo-edit-${todo.id}`;
        inp.maxLength = 500;
        inp.value = (todo.title || '').trim();
        inp.setAttribute('aria-label', 'Edit todo text');
        inp.setAttribute('data-todo-edit-focus', '');
        const btnUpdate = document.createElement('button');
        btnUpdate.type = 'button';
        btnUpdate.className =
          'shrink-0 rounded-full border border-violet-600 bg-violet-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-violet-700 dark:border-violet-500 dark:hover:bg-violet-500';
        btnUpdate.textContent = 'Update';

        const finishEdit = () => {
          editingTodoId = null;
          void refreshTodos();
        };

        let suspendBlurCancel = false;

        const commit = async () => {
          if (!client) {
            return;
          }
          const next = inp.value.trim();
          const prev = (todo.title || '').trim();
          if (next === prev) {
            finishEdit();
            return;
          }
          suspendBlurCancel = true;
          btnUpdate.disabled = true;
          inp.disabled = true;
          try {
            setStatus(statusEl, 'Updating…');
            await client.updateTodoTitle(todo.id, next);
            setStatus(statusEl, '');
            finishEdit();
          } catch (e) {
            setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
          } finally {
            btnUpdate.disabled = false;
            inp.disabled = false;
            suspendBlurCancel = false;
          }
        };

        btnUpdate.addEventListener('click', () => {
          void commit();
        });
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            void commit();
          }
          if (ev.key === 'Escape') {
            ev.preventDefault();
            finishEdit();
          }
        });
        inp.addEventListener('blur', () => {
          window.setTimeout(() => {
            if (suspendBlurCancel) {
              return;
            }
            if (!li.contains(document.activeElement)) {
              finishEdit();
            }
          }, 0);
        });

        editWrap.appendChild(inp);
        editWrap.appendChild(btnUpdate);
        li.appendChild(editWrap);
      } else {
        const done = isTodoDoneValue(todo.done);

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = done;
        chk.className =
          'mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-zinc-300 text-violet-600 focus:ring-violet-400 dark:border-zinc-500 dark:bg-zinc-900 dark:text-violet-500';
        chk.setAttribute('aria-label', done ? 'Mark as not done' : 'Mark as done');
        chk.addEventListener('click', (e) => {
          e.stopPropagation();
        });
        chk.addEventListener('change', async () => {
          if (!client) {
            chk.checked = done;
            return;
          }
          const next = chk.checked;
          chk.disabled = true;
          try {
            setStatus(statusEl, next ? 'Marking done…' : 'Marking active…');
            await client.setTodoDone(todo.id, next);
            setStatus(statusEl, '');
            await refreshTodos();
          } catch (e) {
            chk.checked = done;
            setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
          } finally {
            chk.disabled = false;
          }
        });

        const displayTitle = (todo.title || '').trim() || '—';
        const line = document.createElement('div');
        line.className =
          'min-w-0 flex-1 cursor-pointer touch-manipulation break-words pr-1 text-[0.95rem] [-webkit-tap-highlight-color:transparent]';
        line.addEventListener('click', () => {
          editingTodoId = todo.id;
          void refreshTodos();
        });
        const dateEl = document.createElement('span');
        dateEl.className = 'mr-1.5 text-[0.82em] text-zinc-500 dark:text-zinc-400';
        dateEl.textContent = todo.createdAt
          ? String(todo.createdAt).slice(0, 19).replace('T', ' ')
          : '—';
        const contentEl = document.createElement('span');
        contentEl.className = 'text-zinc-900 dark:text-zinc-100';
        contentEl.textContent = displayTitle;
        line.appendChild(dateEl);
        line.appendChild(document.createTextNode(' '));
        line.appendChild(contentEl);
        if (done) {
          line.classList.add('line-through', 'opacity-65');
        }

        const rowMain = document.createElement('div');
        rowMain.className = 'flex min-w-0 flex-1 items-start gap-3';
        rowMain.appendChild(chk);
        rowMain.appendChild(line);
        li.appendChild(rowMain);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = TW_BTN_EMOJI;
        editBtn.setAttribute('aria-label', 'Edit todo');
        editBtn.title = 'Edit';
        editBtn.textContent = '✏️';
        editBtn.addEventListener('click', () => {
          editingTodoId = todo.id;
          void refreshTodos();
        });
        rowActions.appendChild(editBtn);
      }

      const del = document.createElement('button');
      del.type = 'button';
      del.className = TW_BTN_EMOJI_DANGER;
      del.setAttribute('aria-label', 'Remove todo');
      del.title = 'Remove';
      del.textContent = '🗑️';
      del.addEventListener('click', async () => {
        del.disabled = true;
        try {
          setStatus(statusEl, 'Removing…');
          if (todo.id === editingTodoId) {
            editingTodoId = null;
          }
          await client.removeTodo(todo.id);
          await refreshTodos();
          setStatus(statusEl, '');
        } catch (e) {
          setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
        } finally {
          del.disabled = false;
        }
      });
      rowActions.appendChild(del);
      li.appendChild(rowActions);
      todoList.appendChild(li);
    }

    if (editingTodoId) {
      const focusInp = todoList.querySelector('[data-todo-edit-focus]');
      if (focusInp instanceof HTMLInputElement) {
        focusInp.focus();
        focusInp.select();
      }
    }
  }

  /**
   * Fills the tab dropdown. Returns the title to use (may differ if preferred tab is missing).
   * @param {string | undefined} preferredTitle
   */
  async function populateTabSelect(preferredTitle) {
    if (!siteDb) {
      return preferredTitle || getEffectiveSheetName();
    }
    let tabs = await siteDb.listTables();
    let todoTabs = tabs.filter((tab) => tab.title.startsWith(TODO_TAB_PREFIX));
    if (todoTabs.length === 0) {
      await siteDb.createTable(DEFAULT_FULL_SHEET_TITLE);
      tabs = await siteDb.listTables();
      todoTabs = tabs.filter((tab) => tab.title.startsWith(TODO_TAB_PREFIX));
    }
    tabSelectSilence = true;
    sheetTabSelect.replaceChildren();
    for (const tab of todoTabs) {
      const opt = document.createElement('option');
      opt.value = tab.title;
      opt.textContent = displayNameFromFullTitle(tab.title);
      opt.dataset.sheetId = String(tab.sheetId);
      sheetTabSelect.appendChild(opt);
    }
    const want = (preferredTitle || '').trim() || getEffectiveSheetName();
    let chosen = want;
    if (![...sheetTabSelect.options].some((o) => o.value === want)) {
      chosen = sheetTabSelect.options[0]?.value || want;
    }
    sheetTabSelect.value = chosen;
    tabSelectSilence = false;
    return chosen;
  }

  /**
   * If `localStorage` has no workbook id, Drive may still list a file created earlier with this app (`drive.file`).
   * @param {{ id: string, name: string }[]} candidates
   * @returns {Promise<'create' | string>}
   */
  async function resolveUncachedWorkbook(candidates) {
    const title = candidates[0]?.name ?? 'spreadsheet';
    if (candidates.length === 1) {
      const ok = globalThis.confirm(
        `Found an existing “${title}” from this site in your Google account.\n\nReconnect to it instead of creating a new spreadsheet?`
      );
      return ok ? candidates[0].id : 'create';
    }
    const ok = globalThis.confirm(
      `Found ${candidates.length} spreadsheets named “${title}”.\n\nOK = use the most recently updated one. Cancel = create a new spreadsheet.`
    );
    return ok ? candidates[0].id : 'create';
  }

  /**
   * @param {string | null | undefined} preferredTab
   * @param {{ silent?: boolean, showLoadingUi?: boolean }} [opts]
   */
  async function connectToSheet(preferredTab, opts = {}) {
    const { silent = false, showLoadingUi = false } = opts;
    if (showLoadingUi) {
      setStatus(statusEl, '');
      setAppLoading(true, 'Connecting to Google…');
    }
    try {
      await waitForGoogle();
      initGoogleAuth();
      let token = getCachedAccessToken();
      if (!token) {
        if (silent) {
          const storedWorkbookId = getStoredSpreadsheetId();
          if (storedWorkbookId) {
            try {
              await requestAccessToken({ prompt: '' });
              token = getCachedAccessToken();
            } catch (e) {
              if (!isOAuthUserCancelledError(e)) {
                console.log('[todo] Silent token refresh failed', e);
              }
            }
          }
          if (!token) {
            setConnectedUi(false);
            setStatus(statusEl, '');
            return;
          }
        } else {
          await getAccessToken();
          token = getCachedAccessToken();
          if (!token) {
            throw new Error('No access token');
          }
        }
      }

      siteDb = null;

      const opened = await openSiteDatabase({
        getAccessToken,
        initialTables: [DEFAULT_FULL_SHEET_TITLE],
        silent,
        onWillCreateWorkbook: () => {
          setStatus(statusEl, 'Setting up your data…');
          if (showLoadingUi) {
            setAppLoadingMessage('Setting up your spreadsheet…');
          }
        },
        resolveUncachedWorkbook: silent ? undefined : resolveUncachedWorkbook
      });
      if (opened === null) {
        setConnectedUi(false);
        setStatus(statusEl, '');
        return;
      }
      const { db, created } = opened;
      siteDb = db;
      if (created) {
        await db.writeRange(DEFAULT_FULL_SHEET_TITLE, 'A1:D1', [
          ['id', 'title', 'done', 'createdAt']
        ]);
      }
      setStatus(statusEl, '');

      const tabName = await populateTabSelect(
        preferredTab != null && preferredTab !== '' ? String(preferredTab) : getEffectiveSheetName()
      );
      client = createGoogleSheetClient({
        db,
        sheetName: tabName
      });
      saveStoredTabName(tabName);
      await refreshTodos();
      if (showLoadingUi) {
        setAppLoading(false);
      }
      setConnectedUi(true);
      setStatus(statusEl, '');
      console.log('[todo] Connected', {
        workbookId: db.workbookId,
        sheetName: tabName,
        todoRows: todoList.querySelectorAll('li').length,
        silent
      });
    } finally {
      if (showLoadingUi) {
        setAppLoading(false);
      }
    }
  }

  async function tryAutoConnect() {
    try {
      await connectToSheet(null, { silent: true, showLoadingUi: true });
    } catch (e) {
      if (isOAuthUserCancelledError(e)) {
        client = null;
        siteDb = null;
        setConnectedUi(false);
        setStatus(statusEl, '');
        return;
      }
      console.log('[todo] Auto-connect failed', e);
      client = null;
      siteDb = null;
      setConnectedUi(false);
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(
        statusEl,
        msg || 'Could not connect automatically. Use “Sign in with Google” or check config.',
        true
      );
    }
  }

  sheetTabSelect.addEventListener('change', async () => {
    if (tabSelectSilence) {
      return;
    }
    const name = sheetTabSelect.value;
    if (!name || !siteDb) {
      return;
    }
    setStatus(statusEl, 'Loading…');
    try {
      saveStoredTabName(name);
      client = createGoogleSheetClient({
        db: siteDb,
        sheetName: name
      });
      await refreshTodos();
      setStatus(statusEl, '');
      setConnectedUi(true);
    } catch (e) {
      setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
    }
  });

  btnOpenRename.addEventListener('click', () => {
    renameInput.value = displayNameFromFullTitle(sheetTabSelect.value);
    renameDialog.showModal();
    renameInput.focus();
    renameInput.select();
  });

  renameBtnCancel.addEventListener('click', () => {
    renameDialog.close();
  });

  renameInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      renameBtnOk.click();
    }
  });

  renameBtnOk.addEventListener('click', async () => {
    const newDisplay = sanitizeListDisplayName(renameInput.value);
    const opt = sheetTabSelect.selectedOptions[0];
    if (!newDisplay || !opt || !siteDb) {
      return;
    }
    const newFull = TODO_TAB_PREFIX + newDisplay;
    const sheetIdNum = Number(opt.dataset.sheetId);
    if (!Number.isFinite(sheetIdNum)) {
      return;
    }
    renameBtnOk.disabled = true;
    renameBtnCancel.disabled = true;
    try {
      setStatus(statusEl, 'Renaming…');
      await siteDb.renameTable(sheetIdNum, newFull);
      opt.value = newFull;
      opt.textContent = displayNameFromFullTitle(newFull);
      sheetTabSelect.value = newFull;
      saveStoredTabName(newFull);
      client = createGoogleSheetClient({
        db: siteDb,
        sheetName: newFull
      });
      await refreshTodos();
      setStatus(statusEl, '');
      setConnectedUi(true);
      renameDialog.close();
    } catch (e) {
      setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
    } finally {
      renameBtnOk.disabled = false;
      renameBtnCancel.disabled = false;
    }
  });

  btnSignin.addEventListener('click', async () => {
    console.log('[todo] Click: Sign in with Google');
    try {
      await waitForGoogle();
      initGoogleAuth();
      setStatus(statusEl, 'Sign in…');
      console.log('[todo] Waiting for Google (complete the popup if shown).');
      await requestAccessToken({ prompt: 'consent' });
      setStatus(statusEl, '');
      console.log('[todo] Sign-in finished; connecting…');
      await connectToSheet(getEffectiveSheetName(), { showLoadingUi: true });
    } catch (e) {
      if (isOAuthUserCancelledError(e)) {
        setStatus(statusEl, '');
        return;
      }
      console.error('[todo] Sign-in failed', e);
      client = null;
      siteDb = null;
      setConnectedUi(false);
      setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
    }
  });

  btnSignout.addEventListener('click', () => {
    clearAccessToken();
    client = null;
    siteDb = null;
    setConnectedUi(false);
    setStatus(statusEl, '');
  });

  btnOpenAddList.addEventListener('click', () => {
    listPromptMessage.textContent = 'New list name:';
    listNameInput.value = '';
    addListDialog.showModal();
    listNameInput.focus();
  });

  listAddBtnCancel.addEventListener('click', () => {
    addListDialog.close();
  });

  listNameInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      listAddBtnOk.click();
    }
  });

  listAddBtnOk.addEventListener('click', async () => {
    let fullTitle;
    try {
      fullTitle = fullTitleFromUserListName(listNameInput.value);
    } catch {
      addListDialog.close();
      return;
    }
    if (!siteDb) {
      addListDialog.close();
      return;
    }
    listAddBtnOk.disabled = true;
    listAddBtnCancel.disabled = true;
    try {
      setStatus(statusEl, 'Creating list…');
      await siteDb.createTable(fullTitle);
      await populateTabSelect(fullTitle);
      sheetTabSelect.value = fullTitle;
      saveStoredTabName(fullTitle);
      client = createGoogleSheetClient({
        db: siteDb,
        sheetName: fullTitle
      });
      await refreshTodos();
      setStatus(statusEl, '');
      setConnectedUi(true);
      addListDialog.close();
    } catch (e) {
      setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
    } finally {
      listAddBtnOk.disabled = false;
      listAddBtnCancel.disabled = false;
    }
  });

  btnRemoveList.addEventListener('click', () => {
    if (sheetTabSelect.options.length <= 1) {
      setStatus(
        statusEl,
        'Cannot remove the only list. A spreadsheet must keep at least one tab.',
        true
      );
      return;
    }
    removeListNameEl.textContent = `“${displayNameFromFullTitle(sheetTabSelect.value)}”`;
    removeListDialog.showModal();
  });

  removeListBtnCancel.addEventListener('click', () => {
    removeListDialog.close();
  });

  removeListBtnOk.addEventListener('click', async () => {
    const opt = sheetTabSelect.selectedOptions[0];
    if (!opt || !siteDb) {
      removeListDialog.close();
      return;
    }
    const sheetIdNum = Number(opt.dataset.sheetId);
    if (!Number.isFinite(sheetIdNum)) {
      removeListDialog.close();
      return;
    }
    removeListBtnOk.disabled = true;
    removeListBtnCancel.disabled = true;
    try {
      setStatus(statusEl, 'Removing list…');
      await siteDb.deleteTable(sheetIdNum);
      await populateTabSelect(undefined);
      const nextTab = sheetTabSelect.value;
      saveStoredTabName(nextTab);
      client = createGoogleSheetClient({
        db: siteDb,
        sheetName: nextTab
      });
      await refreshTodos();
      setStatus(statusEl, '');
      setConnectedUi(true);
      removeListDialog.close();
    } catch (e) {
      setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
    } finally {
      removeListBtnOk.disabled = false;
      removeListBtnCancel.disabled = false;
    }
  });

  const newTodoForm = document.getElementById('new-todo-form');
  newTodoForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const title = newTitle.value.trim();
    if (!title || !client) {
      return;
    }
    btnAdd.disabled = true;
    try {
      setStatus(statusEl, 'Adding…');
      await client.addTodo(title);
      newTitle.value = '';
      await refreshTodos();
      setStatus(statusEl, '');
    } catch (e) {
      setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
    } finally {
      btnAdd.disabled = false;
    }
  });

  refreshSignedOutEmptyCopy();
  void tryAutoConnect();
}

main();
