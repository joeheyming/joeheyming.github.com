import {
  initGoogleAuth,
  isOAuthUserCancelledError,
  requestAccessToken,
  waitForGoogle,
  clearAccessToken
} from '../google-db/google-auth.js';
import { parseSpreadsheetIdFromInput } from '../google-db/drive-api.js';
import {
  fetchSpreadsheetMeta,
  getSheetIdByTitle,
  renameSheetTab
} from '../google-db/sheets-api.js';
import { createGoogleSheetClient } from './todo-sheets.js';
import {
  TODO_TAB_PREFIX,
  clearStoredListSpreadsheetId,
  displayNameFromFullTitle,
  fullTitleFromUserListName,
  getEffectiveSheetName,
  openedListValue,
  parseOpenedListValue,
  saveStoredListSpreadsheetId,
  saveStoredTabName,
  sanitizeListDisplayName,
  sheetTitleFromListValue
} from './todo-constants.js';
import { injectDialogs, wireBackdropClose } from './todo-dialogs.js';
import { setStatus } from './todo-ui.js';
import { createShellUi } from './todo-shell-ui.js';
import { createTodoListView } from './todo-list-view.js';
import { createWorkbookConnection } from './todo-workbook.js';
import {
  readExternalListEntries,
  removeExternalEntry,
  writeExternalListEntries
} from './todo-manifest.js';
import {
  addOpenedSharedEntry,
  loadOpenedSharedEntries,
  removeOpenedSharedEntry
} from './todo-opened-shared.js';
import {
  grantSpreadsheetAccess,
  migrateTabToSharedWorkbook,
  parseEmailList
} from './todo-share.js';
import {
  getBtnAdd,
  getBtnOpenAddList,
  getBtnOpenAddShared,
  getBtnOpenRename,
  getBtnOpenShareList,
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
    removeListDetailEl,
    removeListBtnOk,
    removeListBtnCancel,
    shareListDialog,
    shareEmailsInput,
    shareListBtnOk,
    shareListBtnCancel,
    openSharedDialog,
    openSharedInput,
    openSharedBtnOk,
    openSharedBtnCancel
  } = injectDialogs();
  wireBackdropClose(renameDialog);
  wireBackdropClose(addListDialog);
  wireBackdropClose(removeListDialog);
  wireBackdropClose(shareListDialog);
  wireBackdropClose(openSharedDialog);

  const statusEl = getStatusEl();
  const btnSignin = getBtnSignin();
  const btnSignout = getBtnSignout();
  const sheetTabSelect = getSheetTabSelectEl();
  const btnOpenAddList = getBtnOpenAddList();
  const btnRemoveList = getBtnRemoveList();
  const btnOpenRename = getBtnOpenRename();
  const btnOpenShareList = getBtnOpenShareList();
  const btnOpenAddShared = getBtnOpenAddShared();
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

  const {
    connectToSheet,
    tryAutoConnect,
    populateTabSelect,
    getAccessToken,
    applySelectionToClient
  } = createWorkbookConnection({
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
      applySelectionToClient(name);
      await refreshTodos();
      setStatus(statusEl, '');
      setConnectedUi(true);
    } catch (e) {
      setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
    }
  });

  btnOpenRename.addEventListener('click', () => {
    const opt = sheetTabSelect.selectedOptions[0];
    const origin = opt?.dataset.listOrigin || 'main';
    const v = sheetTabSelect.value;
    const opened = parseOpenedListValue(v);
    renameInput.value =
      origin === 'opened' && opened
        ? displayNameFromFullTitle(opened.sheetTitle)
        : displayNameFromFullTitle(v);
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
    const origin = opt.dataset.listOrigin || 'main';
    renameBtnOk.disabled = true;
    renameBtnCancel.disabled = true;
    try {
      setStatus(statusEl, 'Renaming…');
      if (origin === 'main') {
        const sheetIdNum = Number(opt.dataset.sheetId);
        if (!Number.isFinite(sheetIdNum)) {
          setStatus(statusEl, 'Cannot resolve this sheet to rename.', true);
          return;
        }
        await state.siteDb.renameTable(sheetIdNum, newFull);
        opt.value = newFull;
        opt.textContent = displayNameFromFullTitle(newFull);
        sheetTabSelect.value = newFull;
        saveStoredListSpreadsheetId('');
        applySelectionToClient(newFull);
      } else {
        const spreadsheetId = (opt.dataset.spreadsheetId || '').trim();
        if (!spreadsheetId) {
          throw new Error('Missing spreadsheet for this list.');
        }
        const token = await getAccessToken();
        const oldTitle = sheetTitleFromListValue(opt.value);
        const sid = await getSheetIdByTitle(spreadsheetId, oldTitle, token);
        await renameSheetTab(spreadsheetId, sid, newFull, token);
        if (origin === 'manifest') {
          const entries = await readExternalListEntries(state.siteDb);
          const rest = removeExternalEntry(entries, opt.value);
          rest.push({
            fullTabTitle: newFull,
            spreadsheetId,
            sheetTitle: newFull
          });
          await writeExternalListEntries(state.siteDb, rest);
          opt.value = newFull;
          opt.textContent = displayNameFromFullTitle(newFull);
          opt.dataset.sheetTitle = newFull;
        } else {
          const parsed = parseOpenedListValue(opt.value);
          if (parsed) {
            removeOpenedSharedEntry(parsed.spreadsheetId, parsed.sheetTitle);
          }
          addOpenedSharedEntry({ spreadsheetId, sheetTitle: newFull });
          const nextVal = openedListValue(spreadsheetId, newFull);
          opt.value = nextVal;
          opt.textContent = `${displayNameFromFullTitle(newFull)} (shared)`;
          opt.dataset.sheetTitle = newFull;
          sheetTabSelect.value = nextVal;
        }
        if (origin === 'manifest') {
          sheetTabSelect.value = newFull;
        }
        applySelectionToClient(sheetTabSelect.value);
      }
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
    clearStoredListSpreadsheetId();
    state.client = null;
    state.siteDb = null;
    setConnectedUi(false);
    setStatus(statusEl, '');
  });

  btnOpenShareList?.addEventListener('click', () => {
    shareEmailsInput.value = '';
    shareListDialog.showModal();
    shareEmailsInput.focus();
  });
  shareListBtnCancel.addEventListener('click', () => {
    shareListDialog.close();
  });
  shareListBtnOk.addEventListener('click', async () => {
    const opt = sheetTabSelect?.selectedOptions[0];
    if (!opt || !state.siteDb) {
      shareListDialog.close();
      return;
    }
    const emails = parseEmailList(shareEmailsInput.value);
    if (!emails.length) {
      setStatus(statusEl, 'Enter at least one email address.', true);
      return;
    }
    const origin = opt.dataset.listOrigin || 'main';
    shareListBtnOk.disabled = true;
    shareListBtnCancel.disabled = true;
    try {
      setStatus(statusEl, 'Sharing…');
      const token = await getAccessToken();
      if (origin === 'main') {
        const sheetIdNum = Number(opt.dataset.sheetId);
        if (!Number.isFinite(sheetIdNum)) {
          throw new Error('Could not resolve sheet to share.');
        }
        await migrateTabToSharedWorkbook({
          mainDb: state.siteDb,
          sheetId: sheetIdNum,
          fullTabTitle: opt.value,
          displayName: displayNameFromFullTitle(opt.value),
          emails,
          accessToken: token
        });
      } else {
        const sid = (opt.dataset.spreadsheetId || '').trim();
        if (!sid) {
          throw new Error('This list has no spreadsheet id.');
        }
        await grantSpreadsheetAccess(sid, emails, token);
      }
      const keep = sheetTabSelect.value;
      await populateTabSelect(keep);
      applySelectionToClient(sheetTabSelect.value);
      await refreshTodos();
      shareListDialog.close();
      setStatus(
        statusEl,
        origin === 'main' ? 'List moved to a shared spreadsheet and invites sent.' : 'Invites sent.'
      );
    } catch (e) {
      setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
    } finally {
      shareListBtnOk.disabled = false;
      shareListBtnCancel.disabled = false;
    }
  });

  btnOpenAddShared?.addEventListener('click', () => {
    openSharedInput.value = '';
    openSharedDialog.showModal();
    openSharedInput.focus();
  });
  openSharedBtnCancel.addEventListener('click', () => {
    openSharedDialog.close();
  });
  openSharedBtnOk.addEventListener('click', async () => {
    const raw = openSharedInput.value.trim();
    const spreadsheetId = parseSpreadsheetIdFromInput(raw);
    if (!spreadsheetId || !state.siteDb) {
      setStatus(statusEl, 'Paste a valid Google Sheets link or spreadsheet id.', true);
      return;
    }
    openSharedBtnOk.disabled = true;
    openSharedBtnCancel.disabled = true;
    try {
      setStatus(statusEl, 'Loading spreadsheet…');
      const token = await getAccessToken();
      const meta = await fetchSpreadsheetMeta(spreadsheetId, token);
      const sheets = meta.sheets || [];
      const todoSheets = sheets
        .map((s) => s.properties?.title)
        .filter((t) => typeof t === 'string' && t.startsWith(TODO_TAB_PREFIX));
      if (todoSheets.length === 0) {
        throw new Error(`No tabs starting with “${TODO_TAB_PREFIX}” in that spreadsheet.`);
      }
      for (const title of todoSheets) {
        addOpenedSharedEntry({ spreadsheetId, sheetTitle: title });
      }
      const pick = openedListValue(spreadsheetId, todoSheets[0]);
      await populateTabSelect(pick);
      applySelectionToClient(sheetTabSelect.value);
      await refreshTodos();
      openSharedDialog.close();
      setStatus(statusEl, `Added ${todoSheets.length} list(s) from the shared file.`);
    } catch (e) {
      setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
    } finally {
      openSharedBtnOk.disabled = false;
      openSharedBtnCancel.disabled = false;
    }
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
      saveStoredListSpreadsheetId('');
      applySelectionToClient(fullTitle);
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
      setStatus(statusEl, 'You only have one list in the menu.', true);
      return;
    }
    const opt = sheetTabSelect.selectedOptions[0];
    const origin = opt?.dataset.listOrigin || 'main';
    const opened = parseOpenedListValue(sheetTabSelect.value);
    const label =
      origin === 'opened' && opened
        ? displayNameFromFullTitle(opened.sheetTitle)
        : displayNameFromFullTitle(sheetTabSelect.value);
    const strong = document.createElement('strong');
    strong.id = 'remove-list-name';
    strong.className = 'text-text-1';
    strong.textContent = `“${label}”`;
    removeListDetailEl.replaceChildren();
    if (origin === 'main') {
      removeListDetailEl.append(
        document.createTextNode('Delete the tab '),
        strong,
        document.createTextNode(
          ' from this spreadsheet? All todos on that list are removed. This cannot be undone.'
        )
      );
    } else if (origin === 'manifest') {
      removeListDetailEl.append(
        document.createTextNode('Remove '),
        strong,
        document.createTextNode(
          ' from this app? The shared spreadsheet file stays in Google Drive; collaborators keep access. You can add it again with “Open shared spreadsheet” if you still have access.'
        )
      );
    } else {
      removeListDetailEl.append(
        document.createTextNode('Remove '),
        strong,
        document.createTextNode(
          ' from this browser? The spreadsheet is not deleted. You can add the link again later.'
        )
      );
    }
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
    const origin = opt.dataset.listOrigin || 'main';
    removeListBtnOk.disabled = true;
    removeListBtnCancel.disabled = true;
    try {
      setStatus(statusEl, 'Removing…');
      if (origin === 'main') {
        const sheetIdNum = Number(opt.dataset.sheetId);
        if (!Number.isFinite(sheetIdNum)) {
          removeListDialog.close();
          return;
        }
        await state.siteDb.deleteTable(sheetIdNum);
      } else if (origin === 'manifest') {
        const entries = await readExternalListEntries(state.siteDb);
        await writeExternalListEntries(state.siteDb, removeExternalEntry(entries, opt.value));
      } else {
        const parsed = parseOpenedListValue(opt.value);
        if (parsed) {
          removeOpenedSharedEntry(parsed.spreadsheetId, parsed.sheetTitle);
        }
      }
      await populateTabSelect(undefined);
      applySelectionToClient(sheetTabSelect.value);
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
        newTitle.focus();
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
