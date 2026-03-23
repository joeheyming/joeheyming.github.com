import {
  initGoogleAuth,
  isOAuthUserCancelledError,
  requestAccessToken,
  waitForGoogle,
  clearAccessToken
} from '../google-db/google-auth.js';
import { createGoogleSheetClient } from './todo-sheets.js';
import {
  TODO_TAB_PREFIX,
  displayNameFromFullTitle,
  fullTitleFromUserListName,
  getEffectiveSheetName,
  saveStoredTabName,
  sanitizeListDisplayName
} from './todo-constants.js';
import { injectDialogs, wireBackdropClose } from './todo-dialogs.js';
import { setStatus } from './todo-ui.js';
import { createShellUi } from './todo-shell-ui.js';
import { createTodoListView } from './todo-list-view.js';
import { createWorkbookConnection } from './todo-workbook.js';
import {
  getBtnAdd,
  getBtnOpenAddList,
  getBtnOpenRename,
  getBtnRemoveList,
  getBtnSignin,
  getBtnSignout,
  getNewTitleInput,
  getNewTodoFormEl,
  getSheetTabSelectEl,
  getStatusEl,
  getTodoEmptyEl,
  getTodoListEl
} from './todo-dom.js';

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

  const statusEl = getStatusEl();
  const btnSignin = getBtnSignin();
  const btnSignout = getBtnSignout();
  const sheetTabSelect = getSheetTabSelectEl();
  const btnOpenAddList = getBtnOpenAddList();
  const btnRemoveList = getBtnRemoveList();
  const btnOpenRename = getBtnOpenRename();
  const newTitle = getNewTitleInput();
  const btnAdd = getBtnAdd();
  const todoList = getTodoListEl();
  const todoEmpty = getTodoEmptyEl();
  const newTodoForm = getNewTodoFormEl();

  const { setAppLoadingMessage, setAppLoading, refreshSignedOutEmptyCopy, setConnectedUi } =
    createShellUi();

  const state = {
    /** @type {ReturnType<typeof createGoogleSheetClient> | null} */
    client: null,
    /** @type {import('../google-db/site-database.js').SiteDatabase | null} */
    siteDb: null,
    tabSelectSilence: false,
    /** @type {string | null} */
    editingTodoId: null
  };

  let refreshTodos = async () => {};

  const { connectToSheet, tryAutoConnect, populateTabSelect } = createWorkbookConnection({
    state,
    statusEl,
    sheetTabSelect,
    todoList,
    setAppLoading,
    setAppLoadingMessage,
    setConnectedUi,
    getRefreshTodos: () => refreshTodos
  });

  ({ refreshTodos } = createTodoListView({
    state,
    todoList,
    todoEmpty,
    statusEl
  }));

  sheetTabSelect.addEventListener('change', async () => {
    if (state.tabSelectSilence) {
      return;
    }
    const name = sheetTabSelect.value;
    if (!name || !state.siteDb) {
      return;
    }
    setStatus(statusEl, 'Loading…');
    try {
      saveStoredTabName(name);
      state.client = createGoogleSheetClient({
        db: state.siteDb,
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
    if (!newDisplay || !opt || !state.siteDb) {
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
      await state.siteDb.renameTable(sheetIdNum, newFull);
      opt.value = newFull;
      opt.textContent = displayNameFromFullTitle(newFull);
      sheetTabSelect.value = newFull;
      saveStoredTabName(newFull);
      state.client = createGoogleSheetClient({
        db: state.siteDb,
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
      state.client = null;
      state.siteDb = null;
      setConnectedUi(false);
      setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
    }
  });

  btnSignout.addEventListener('click', () => {
    clearAccessToken();
    state.client = null;
    state.siteDb = null;
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
    if (!state.siteDb) {
      addListDialog.close();
      return;
    }
    listAddBtnOk.disabled = true;
    listAddBtnCancel.disabled = true;
    try {
      setStatus(statusEl, 'Creating list…');
      await state.siteDb.createTable(fullTitle);
      await populateTabSelect(fullTitle);
      sheetTabSelect.value = fullTitle;
      saveStoredTabName(fullTitle);
      state.client = createGoogleSheetClient({
        db: state.siteDb,
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
    if (!opt || !state.siteDb) {
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
      await state.siteDb.deleteTable(sheetIdNum);
      await populateTabSelect(undefined);
      const nextTab = sheetTabSelect.value;
      saveStoredTabName(nextTab);
      state.client = createGoogleSheetClient({
        db: state.siteDb,
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

  if (newTodoForm) {
    newTodoForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const title = newTitle?.value.trim() ?? '';
      if (!title || !state.client || !btnAdd || !newTitle) {
        return;
      }
      btnAdd.disabled = true;
      try {
        setStatus(statusEl, 'Adding…');
        await state.client.addTodo(title);
        newTitle.value = '';
        await refreshTodos();
        setStatus(statusEl, '');
      } catch (e) {
        setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
      } finally {
        btnAdd.disabled = false;
      }
    });
  }

  refreshSignedOutEmptyCopy();
  void tryAutoConnect();
}

main();
