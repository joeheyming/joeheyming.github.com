import {
  initGoogleAuth,
  isOAuthUserCancelledError,
  requestAccessToken,
  getCachedAccessToken,
  clearAccessToken
} from '../google-db/google-auth.js';
import {
  createGoogleSheetClient,
  createSheetTab,
  deleteSheetTab,
  listSheetTabs,
  renameSheetTab
} from './todo-sheets.js';
import { tryFetchSpreadsheetMeta } from '../google-db/sheets-api.js';
import { loadPickerApi, openSpreadsheetPicker } from '../google-db/drive-picker.js';
import { clientId, spreadsheetId, sheetName, pickerApiKey } from './config.js';

/** Todo row emoji controls (match list toolbar styling). */
const TW_BTN_EMOJI =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg shadow-sm transition hover:border-violet-400 hover:bg-violet-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:border-violet-500 dark:hover:bg-violet-950/50';
const TW_BTN_EMOJI_DANGER =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg shadow-sm transition hover:border-rose-400 hover:bg-rose-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:border-rose-500 dark:hover:bg-rose-950/40';

const LS_SHEET_NAME = 'todo.sheetName';

function loadStoredTabName() {
  try {
    return localStorage.getItem(LS_SHEET_NAME) || '';
  } catch {
    return '';
  }
}

function saveStoredTabName(name) {
  try {
    localStorage.setItem(LS_SHEET_NAME, name || 'Sheet1');
  } catch {
    /* quota / private mode */
  }
}

function getEffectiveSheetName() {
  const fromLs = loadStoredTabName().trim();
  if (fromLs) {
    return fromLs;
  }
  return sheetName || 'Sheet1';
}

function getConfigSpreadsheetId() {
  return spreadsheetId.trim();
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

  let client = null;
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

  /**
   * OAuth uses `drive.file`: the token only allows Sheets/Drive files the user opens via this app.
   * First time (or new browser), we open the Picker so they grant access to the configured file only.
   * @param {string} token
   * @param {{ silent?: boolean }} [opts]
   */
  async function ensureSpreadsheetAccess(token, opts = {}) {
    const { silent = false } = opts;
    const sid = getConfigSpreadsheetId();
    if (!sid) {
      return;
    }
    let check = await tryFetchSpreadsheetMeta(sid, token);
    if (check.ok) {
      return;
    }
    if (silent) {
      throw new Error(
        'Sign in with Google, then select this app’s spreadsheet when the file picker opens (one-time per browser).'
      );
    }
    const key = (pickerApiKey || '').trim();
    if (!key) {
      throw new Error(
        'Set pickerApiKey in config.js (Google Cloud → Credentials → API key; restrict HTTP referrers). Enable the Google Drive API for this project.'
      );
    }
    setStatus(statusEl, 'Select your todo spreadsheet in Google…');
    await loadPickerApi();
    const picked = await openSpreadsheetPicker({
      developerKey: key,
      accessToken: token,
      title: 'Choose the spreadsheet for this app'
    });
    if (!picked) {
      throw new Error('No spreadsheet selected.');
    }
    if (picked.trim() !== sid.trim()) {
      throw new Error(
        'Wrong file selected. Pick the spreadsheet whose ID matches spreadsheetId in config.js.'
      );
    }
    check = await tryFetchSpreadsheetMeta(sid, token);
    if (!check.ok) {
      throw new Error(
        check.text ||
          'Could not open that spreadsheet after selection. Try again, or confirm Sheets API + Drive API are enabled.'
      );
    }
    setStatus(statusEl, '');
  }

  function setConnectedUi(connected) {
    todoPanel.hidden = !connected;
    btnSignin.hidden = connected;
    btnSignout.hidden = !connected;
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
        if (todo.done === 'TRUE' || todo.done === 'true') {
          line.classList.add('line-through', 'opacity-65');
        }
        li.appendChild(line);

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
    const sid = getConfigSpreadsheetId();
    if (!sid) {
      return preferredTitle || getEffectiveSheetName();
    }
    const t = await getAccessToken();
    const tabs = await listSheetTabs(sid, t);
    tabSelectSilence = true;
    sheetTabSelect.replaceChildren();
    for (const tab of tabs) {
      const opt = document.createElement('option');
      opt.value = tab.title;
      opt.textContent = tab.title;
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
   * @param {string | null | undefined} preferredTab
   * @param {{ silent?: boolean }} [opts]
   */
  async function connectToSheet(preferredTab, opts = {}) {
    const { silent = false } = opts;
    const sid = getConfigSpreadsheetId();
    if (!clientId) {
      setStatus(statusEl, 'Set clientId in config.js.', true);
      throw new Error('No clientId');
    }
    if (!sid) {
      setStatus(statusEl, 'Set spreadsheetId in config.js.', true);
      throw new Error('No spreadsheet');
    }
    await waitForGoogle();
    initGoogleAuth(clientId);
    let token = getCachedAccessToken();
    if (!token) {
      if (silent) {
        setConnectedUi(false);
        setStatus(statusEl, '');
        return;
      }
      await getAccessToken();
      token = getCachedAccessToken();
      if (!token) {
        throw new Error('No access token');
      }
    }
    await ensureSpreadsheetAccess(token, { silent: opts.silent });
    const tabName = await populateTabSelect(
      preferredTab != null && preferredTab !== '' ? String(preferredTab) : getEffectiveSheetName()
    );
    client = createGoogleSheetClient({
      spreadsheetId: sid,
      sheetName: tabName,
      getAccessToken
    });
    saveStoredTabName(tabName);
    await refreshTodos();
    setConnectedUi(true);
    setStatus(statusEl, '');
    console.log('[todo] Connected', {
      spreadsheetId: sid,
      sheetName: tabName,
      todoRows: todoList.querySelectorAll('li').length,
      silent
    });
  }

  async function tryAutoConnect() {
    if (!clientId) {
      setStatus(statusEl, 'Set clientId in config.js.', true);
      return;
    }
    if (!getConfigSpreadsheetId()) {
      setStatus(statusEl, 'Set spreadsheetId in config.js.');
      return;
    }
    setStatus(statusEl, 'Loading…');
    try {
      await connectToSheet(null, { silent: true });
    } catch (e) {
      if (isOAuthUserCancelledError(e)) {
        client = null;
        setConnectedUi(false);
        setStatus(statusEl, '');
        return;
      }
      console.log('[todo] Auto-connect failed', e);
      client = null;
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
    const sid = getConfigSpreadsheetId();
    if (!name || !sid) {
      return;
    }
    setStatus(statusEl, 'Loading…');
    try {
      saveStoredTabName(name);
      client = createGoogleSheetClient({
        spreadsheetId: sid,
        sheetName: name,
        getAccessToken
      });
      await refreshTodos();
      setStatus(statusEl, '');
      setConnectedUi(true);
    } catch (e) {
      setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
    }
  });

  btnOpenRename.addEventListener('click', () => {
    renameInput.value = sheetTabSelect.value;
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
    const newTitle = renameInput.value.trim();
    const sid = getConfigSpreadsheetId();
    const opt = sheetTabSelect.selectedOptions[0];
    if (!newTitle || !opt || !sid) {
      return;
    }
    const sheetIdNum = Number(opt.dataset.sheetId);
    if (!Number.isFinite(sheetIdNum)) {
      return;
    }
    renameBtnOk.disabled = true;
    renameBtnCancel.disabled = true;
    try {
      setStatus(statusEl, 'Renaming…');
      const t = await getAccessToken();
      await renameSheetTab(sid, sheetIdNum, newTitle, t);
      opt.value = newTitle;
      opt.textContent = newTitle;
      sheetTabSelect.value = newTitle;
      saveStoredTabName(newTitle);
      client = createGoogleSheetClient({
        spreadsheetId: sid,
        sheetName: newTitle,
        getAccessToken
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
      if (!clientId) {
        setStatus(statusEl, 'Set clientId in config.js.', true);
        return;
      }
      if (!getConfigSpreadsheetId()) {
        setStatus(statusEl, 'Set spreadsheetId in config.js.', true);
        return;
      }
      await waitForGoogle();
      initGoogleAuth(clientId);
      setStatus(statusEl, 'Sign in…');
      console.log('[todo] Waiting for Google (complete the popup if shown).');
      await requestAccessToken({ prompt: 'consent' });
      setStatus(statusEl, 'Signed in.');
      console.log('[todo] Sign-in finished; connecting…');
      await connectToSheet(getEffectiveSheetName());
    } catch (e) {
      if (isOAuthUserCancelledError(e)) {
        setStatus(statusEl, '');
        return;
      }
      console.error('[todo] Sign-in failed', e);
      setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
    }
  });

  btnSignout.addEventListener('click', () => {
    clearAccessToken();
    client = null;
    setConnectedUi(false);
    setStatus(statusEl, 'Signed out');
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
    const name = listNameInput.value.trim();
    const sid = getConfigSpreadsheetId();
    if (!name || !sid) {
      addListDialog.close();
      return;
    }
    listAddBtnOk.disabled = true;
    listAddBtnCancel.disabled = true;
    try {
      setStatus(statusEl, 'Creating list…');
      const t = await getAccessToken();
      await createSheetTab(sid, name, t);
      await populateTabSelect(name);
      sheetTabSelect.value = name;
      saveStoredTabName(name);
      client = createGoogleSheetClient({
        spreadsheetId: sid,
        sheetName: name,
        getAccessToken
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
    removeListNameEl.textContent = `“${sheetTabSelect.value}”`;
    removeListDialog.showModal();
  });

  removeListBtnCancel.addEventListener('click', () => {
    removeListDialog.close();
  });

  removeListBtnOk.addEventListener('click', async () => {
    const sid = getConfigSpreadsheetId();
    const opt = sheetTabSelect.selectedOptions[0];
    if (!opt || !sid) {
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
      const t = await getAccessToken();
      await deleteSheetTab(sid, sheetIdNum, t);
      await populateTabSelect(undefined);
      const nextTab = sheetTabSelect.value;
      saveStoredTabName(nextTab);
      client = createGoogleSheetClient({
        spreadsheetId: sid,
        sheetName: nextTab,
        getAccessToken
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

  void tryAutoConnect();
}

main();
